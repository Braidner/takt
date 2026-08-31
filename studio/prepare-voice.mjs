/**
 * Подготовка добавленного голоса к синтезу.
 *
 *   node studio/prepare-voice.mjs <id>
 *
 * Что здесь происходит и почему именно так:
 *   * запись приводится к моно 24 кГц с выравниванием уровня и срезом гула ниже 60 Гц.
 *     ШУМОДАВ НЕ ПРИМЕНЯЕТСЯ — он срезает обертоны, по которым голос и узнаётся;
 *   * из длинной записи выбирается самый чистый кусок: клонирование берёт короткий
 *     образец, и лучше отдать модели двадцать восемь хороших секунд, чем пять минут,
 *     где половина — фон и паузы;
 *   * измеряется разрыв между уровнем речи и уровнем фона. Это главный предиктор
 *     сходства: на реальных записях разброс доходил до 8 дБ, и он влияет сильнее любых
 *     настроек синтеза. Число уходит в студию, чтобы человек видел качество источника
 *     до того, как удивится результату.
 *
 * Расшифровка эталона нужна движку клонирования, но она долгая и требует моделей —
 * поэтому здесь только режем и меряем, а расшифровку делает конвейер озвучки.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { VOICES, SERVER_INFO } from './home.mjs';
import { ok, fail } from './lib/out.mjs';

const run = promisify(execFile);
const DIR = path.dirname(fileURLToPath(import.meta.url));

const info = JSON.parse(fs.readFileSync(SERVER_INFO, 'utf8'));

const id = process.argv[2];
if (!id) { console.error('Укажите идентификатор голоса'); process.exit(1); }

const metaPath = path.join(VOICES, `${id}.json`);
if (!fs.existsSync(metaPath)) { console.error('Голос не найден:', id); process.exit(1); }
const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
const source = path.join(VOICES, meta.file);

const WINDOW = 28;   // столько секунд берёт движок клонирования

/** Уровни по полусекундным кадрам — из них считается разрыв речь/фон. */
async function levels(file) {
  const { stdout } = await run('ffmpeg', ['-v', 'error', '-i', file, '-ac', '1', '-ar', '16000',
                                          '-f', 's16le', '-'], { encoding: 'buffer', maxBuffer: 1 << 28 })
    .then((r) => ({ stdout: r.stdout }));
  const step = 8000;                       // 0.5 с при 16 кГц
  const out = [];
  for (let i = 0; i + step < stdout.length / 2; i += step) {
    let sum = 0;
    for (let j = 0; j < step; j++) {
      const v = stdout.readInt16LE((i + j) * 2);
      sum += v * v;
    }
    const rms = Math.sqrt(sum / step) || 1;
    out.push(20 * Math.log10(rms / 32768));
  }
  return out;
}

const db = await levels(source);
const perWindow = WINDOW * 2;              // кадров в окне

let best = { at: 0, gap: -Infinity };
for (let start = 0; start + perWindow <= db.length; start += 4) {
  const w = db.slice(start, start + perWindow).sort((a, b) => a - b);
  const floor = w[Math.floor(w.length * 0.05)];
  const speech = w[Math.floor(w.length * 0.6)];
  const gap = speech - floor;
  if (gap > best.gap) best = { at: start / 2, gap };
}
// Запись короче окна — берём целиком, иначе получили бы пустой эталон.
if (!Number.isFinite(best.gap)) best = { at: 0, gap: 0 };

const refWav = path.join(VOICES, `${id}-ref.wav`);
await run('ffmpeg', ['-v', 'error', '-y', '-ss', String(best.at), '-t', String(WINDOW),
                     '-i', source, '-ac', '1', '-ar', '24000',
                     '-af', 'highpass=f=60,loudnorm=I=-20:TP=-2', refWav]);

const { stdout: durOut } = await run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration',
                                                 '-of', 'csv=p=0', refWav]);
const seconds = Number(durOut.trim());

// Оценка источника словами: число в децибелах человеку ничего не говорит, а «чисто» и
// «шумно» — говорит, и сразу подсказывает, стоит ли перезаписать.
const quality = best.gap >= 30 ? 'чисто' : best.gap >= 22 ? 'приемлемо' : 'шумно';

await fetch(`http://localhost:${info.port}/api/voice-ready?token=${info.token}`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ id, seconds, quality }),
});

ok({
  ok: true, id, ref: refWav, seconds: Math.round(seconds),
  gap: Math.round(best.gap), quality, from: Math.round(best.at),
}, ['синтезировать реплики этим голосом: takt narrate']);
