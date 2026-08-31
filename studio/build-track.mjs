/**
 * Сборка дикторской дорожки и подмешивание её в ролик.
 *
 *   node studio/build-track.mjs
 *
 * Реплики не склеиваются встык, а раскладываются по своим меткам поверх тишины длиной в
 * ролик: реплика должна начаться тогда, когда в кадре появляется её титр, а паузы между
 * ними неравные.
 *
 * Два шага, без которых получается тихий брак — оба выяснены на живом ролике:
 *
 *   * ОБРЕЗКА ТИШИНЫ. Синтез оставляет до секунды тишины в начале и до пяти в хвосте.
 *     Без обрезки реплика вступает позже своего титра — весь ролик едет, — а длительность
 *     файла перестаёт что-либо значить: фраза на четыре секунды лежит в десятисекундном
 *     файле и выглядит не влезающей в окно, хотя влезает.
 *   * ЯВНЫЙ ВЫБОР ПОТОКОВ. У ролика уже есть звуковая дорожка, и без -map ffmpeg
 *     оставляет в файле именно её. Ошибки при этом нет, размер правдоподобный —
 *     просто немой результат.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { inProject } from './project.mjs';
import { SERVER_INFO } from './home.mjs';
import { ok, fail } from './lib/out.mjs';

const run = promisify(execFile);
const DIR = path.dirname(fileURLToPath(import.meta.url));
const info = JSON.parse(fs.readFileSync(SERVER_INFO, 'utf8'));
const base = `http://localhost:${info.port}`;

const api = (route, payload) =>
  fetch(`${base}${route}?token=${info.token}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }).then((r) => r.json()).catch(() => null);

const narration = await fetch(`${base}/api/narration`).then((r) => r.json());
const movie = JSON.parse(fs.readFileSync(inProject('movie.json'), 'utf8'));
if (!narration?.lines?.length) {
  fail('no_narration', 'дикторский текст пуст',
       { help: ['текст пишет человек в студии или агент — затем: takt narrate'] });
  process.exit(1);
}

const VOICED = inProject('narration');
const TRIM = path.join(VOICED, 'trim');
fs.mkdirSync(TRIM, { recursive: true });

// Порог -40 дБ отделяет речь от шумовой подложки синтеза: сама подложка тише, а дыхание
// и затухание согласных громче, и срезать их было бы слышно.
const SILENCE = 'silenceremove=start_periods=1:start_threshold=-40dB:start_silence=0.05:'
  + 'stop_periods=-1:stop_threshold=-40dB:stop_silence=0.25';

const inputs = [];
const filters = [];
const labels = [];
const warnings = [];

for (const [i, line] of narration.lines.entries()) {
  const n = i + 1;
  const sub = path.join(VOICED, String(n).padStart(2, '0'));
  const wavs = fs.existsSync(sub) ? fs.readdirSync(sub).filter((f) => f.endsWith('.wav')) : [];
  if (!wavs.length) continue;

  const trimmed = path.join(TRIM, `${n}.wav`);
  await run('ffmpeg', ['-v', 'error', '-y', '-i', path.join(sub, wavs[0]),
                       '-af', SILENCE, '-ar', '48000', trimmed]);

  const { stdout } = await run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration',
                                           '-of', 'csv=p=0', trimmed]);
  const dur = Number(stdout.trim());

  // Реплика, вылезающая за своё окно, наедет на следующую — в дорожке это слышно как
  // два голоса разом. Синтез такого не ловит: там каждая реплика сама по себе нормальна.
  const hold = line.hold ?? (narration.lines[i + 1] ? narration.lines[i + 1].at - line.at : Infinity);
  if (dur > hold) warnings.push(`реплика ${n}: ${dur.toFixed(1)} с не влезает в окно ${hold.toFixed(1)} с`);

  const idx = labels.length;
  inputs.push('-i', trimmed);
  filters.push(`[${idx}:a]adelay=${Math.round(line.at * 1000)}|${Math.round(line.at * 1000)}[d${idx}]`);
  labels.push(`[d${idx}]`);
}

if (!labels.length) {
  fail('no_voice', 'реплики не озвучены', { help: ['синтезировать голосом: takt narrate'] });
  process.exit(1);
}

await api('/api/status', { state: 'busy', text: 'Собираю дорожку', step: null, of: null });

const track = inProject('narration.wav');
// apad добивает дорожку до длины ролика — иначе amix обрежет её по самому короткому
// входу. loudnorm в конце: сырой синтез гуляет по громкости от реплики к реплике, и в
// смонтированном ролике это слышно сильнее, чем в отдельных файлах.
const graph = `${filters.join(';')};${labels.join('')}amix=inputs=${labels.length}:normalize=0,`
  + `apad,atrim=0:${movie.duration},loudnorm=I=-18:TP=-2[out]`;
await run('ffmpeg', ['-v', 'error', '-y', ...inputs, '-filter_complex', graph, '-map', '[out]', track],
          { maxBuffer: 1 << 25 });

/**
 * Голос ложится ПОВЕРХ музыки, а не вместо неё.
 *
 * Раньше в озвученную версию бралась только голосовая дорожка, и вместе с музыкой
 * пропадали щелчки действий — те самые, что объясняют зрителю, что действие
 * произошло, а не само открылось. Ролик становился тише и беднее ровно в тот
 * момент, когда его считали готовым.
 *
 * Музыка под голосом пригрушается тем же приёмом, каким она пригрушается под
 * щелчками: боковая цепь компрессора. Поднимать голос вместо этого нельзя — он
 * начинает резать слух, а музыка всё равно спорит с ним за то же место.
 */
const withVoice = inProject('movie-vo.mp4');
const немой = (await run('ffprobe', ['-v', 'error', '-select_streams', 'a',
                                     '-show_entries', 'stream=codec_type', '-of', 'csv=p=0',
                                     inProject('movie.mp4')])).stdout.trim() === '';

await run('ffmpeg', ['-v', 'error', '-y', '-i', inProject('movie.mp4'), '-i', track,
  ...(немой
    // Ролик собран без звука — подкладывать нечего, голос идёт как есть.
    ? ['-map', '0:v:0', '-map', '1:a:0']
    : ['-filter_complex',
       '[1:a]asplit=2[voice][key];'
       + '[0:a][key]sidechaincompress=threshold=0.03:ratio=8:attack=8:release=320[bed];'
       + '[bed][voice]amix=inputs=2:normalize=0,alimiter=limit=0.95[out]',
       '-map', '0:v:0', '-map', '[out]']),
  '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-shortest', withVoice]);

await api('/api/movie', { ...movie, url: '/project/movie-vo.mp4', voiced: true });
await api('/api/status', { state: 'listening', text: 'Ролик озвучен', step: null, of: null });

ok({ ok: true, lines: labels.length, out: withVoice, warnings },
   ['показать человеку версию с озвучкой: takt poll']);
