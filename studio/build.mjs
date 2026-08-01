/**
 * Сборка ролика из снятого материала.
 *
 *   node studio/build.mjs
 *
 * Playwright пишет webm — формат, который годится для хранения, но не для показа:
 * Safari его не играет вовсе, а перемотка по нему рваная, потому что ключевые кадры
 * расставлены как попало. Поэтому первым делом перекодируем в mp4 с ключевым кадром
 * каждые две секунды: по такому файлу плеер в студии перематывается мгновенно, а это
 * основной способ работы с роликом — прыгать по таймкодам замечаний.
 *
 * Титры В ВИДЕО НЕ ВЫЖИГАЮТСЯ, и это не обходной путь, а решение. Во-первых, местная
 * сборка ffmpeg собрана без libfreetype: фильтра drawtext в ней просто нет. Во-вторых,
 * выжженный текст необратим — поправить формулировку значит перекодировать весь ролик,
 * а формулировки правят чаще всего. Поэтому титры едут рядом с роликом данными, и
 * студия рисует их поверх плеера; правка титра там мгновенна.
 *
 * Выжигание понадобится только на финальном экспорте наружу — это отдельный шаг и
 * отдельный инструмент.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { inProject } from './project.mjs';

const run = promisify(execFile);
const DIR = path.dirname(fileURLToPath(import.meta.url));
const JOURNAL = path.join(DIR, 'journal');
const info = JSON.parse(fs.readFileSync(path.join(JOURNAL, 'server.json'), 'utf8'));
const base = `http://localhost:${info.port}`;

const api = (route, payload) =>
  fetch(`${base}${route}?token=${info.token}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }).then((r) => r.json()).catch(() => null);

const timelinePath = inProject('timeline.json');
if (!fs.existsSync(timelinePath)) {
  console.error('Нет телеметрии: сначала снимите сценарий (node studio/shoot.mjs)');
  process.exit(1);
}
const timeline = JSON.parse(fs.readFileSync(timelinePath, 'utf8'));
if (!timeline.video || !fs.existsSync(timeline.video)) {
  console.error('Запись не найдена:', timeline.video);
  process.exit(1);
}

const OUT = inProject('movie.mp4');

const captions = timeline.events.filter((e) => e.kind === 'caption');

/**
 * Интервалы загрузки вырезаются из мастера.
 *
 * Съёмка знает, когда экран был не готов: ожидание идёт по содержимому и возвращает,
 * сколько ждали. Эти куски — скелетоны и пустые витрины — в ролике не нужны никому,
 * а раньше они попадали в кадр и были главной претензией к качеству.
 *
 * Вырезаем select'ом по времени, а не нарезкой и склейкой: склейка потребовала бы
 * перекодировать каждый кусок отдельно и потерять качество там, где его и так мало.
 */
/**
 * Начало записи обрезается, и это обязательный шаг, а не улучшение.
 *
 * Playwright пишет видео с момента создания контекста, то есть захватывает открытие
 * стенда, форму входа и загрузочную заставку — секунд десять-пятнадцать. Телеметрия же
 * отсчитывает время от первого шага. Без обрезки картинка и подписи расходятся ровно на
 * эту разницу: титр первого шага стоит на нуле, а в кадре в это время ещё логотип.
 */
const probe = await run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration',
                                    '-of', 'csv=p=0', timeline.video]);
const rawDuration = Number(probe.stdout.trim());
const offset = Math.max(0, rawDuration - timeline.durationInSeconds);

const takePath = inProject('take.json');
const loading = (() => {
  try {
    const take = JSON.parse(fs.readFileSync(takePath, 'utf8'));
    // Мелкие ожидания не режем: склейка на них заметнее, чем полсекунды неподвижности.
    return (take.loading || []).filter((l) => l.to - l.from > 0.7);
  } catch { return []; }
})();

/**
 * Разметка загрузки годится, только если она лежит в шкале самой записи.
 *
 * Найдено сборкой: интервалы пишутся по часам съёмки, а длительность записи считает
 * кодировщик по временам кадров, и эти шкалы могут разъехаться. Тогда select вырежет
 * не тот кусок — молча и правдоподобно. Лучше не вырезать ничего, чем вырезать мимо.
 */
const takeSeconds = (() => {
  try { return JSON.parse(fs.readFileSync(takePath, 'utf8')).seconds || 0; } catch { return 0; }
})();
// Шкалы должны совпадать: интервалы размечены по часам съёмки, а вырезаем мы из записи.
const fits = takeSeconds > 0 && Math.abs(takeSeconds - rawDuration) < 1.5;
if (loading.length && !fits) {
  console.log(`разметка загрузки не в шкале записи (съёмка ${takeSeconds.toFixed(1)} с `
    + `против записи ${rawDuration.toFixed(1)} с) — не вырезаю, иначе срежу не то`);
}

const cutFilter = fits && loading.length
  ? [
      `select='${loading.map((l) => `not(between(t,${l.from.toFixed(2)},${l.to.toFixed(2)}))`).join('*')}'`,
      'setpts=N/FRAME_RATE/TB',
    ].join(',')
  : null;

if (cutFilter) {
  const total = loading.reduce((s2, l) => s2 + (l.to - l.from), 0);
  console.log(`вырезаю загрузку: ${loading.length} кусков, ${total.toFixed(1)} с`);
}


await api('/api/status', { state: 'busy', text: 'Собираю ролик', step: null, of: null });

const args = [
  '-v', 'error', '-y',
  // -ss перед -i режет по ключевым кадрам и быстрее; точность здесь не критична,
  // потому что дальше идёт перекодирование.
  ...(offset > 0.3 ? ['-ss', offset.toFixed(2)] : []),
  '-i', timeline.video,
  ...(cutFilter ? ['-vf', cutFilter] : []),
  '-c:v', 'libx264', '-preset', 'medium', '-crf', '20',
  // Ключевой кадр каждые две секунды: перемотка по таймкодам замечаний — основной
  // способ работы с роликом, а без частых ключевых кадров она прыгает мимо.
  '-g', '60', '-force_key_frames', 'expr:gte(t,n_forced*2)',
  '-pix_fmt', 'yuv420p', '-movflags', '+faststart',
  OUT,
];

const t0 = Date.now();
try {
  await run('ffmpeg', args, { maxBuffer: 1024 * 1024 * 32 });
} catch (e) {
  await api('/api/status', { state: 'listening', text: 'Сборка не удалась', step: null, of: null });
  console.error('ffmpeg:', (e.stderr || e.message).split('\n').slice(-3).join(' '));
  process.exit(1);
}

const { stdout } = await run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration',
                                         '-of', 'csv=p=0', OUT]);
const duration = Number(stdout.trim());

await api('/api/movie', {
  url: '/project/movie.mp4',
  duration,
  // Титры едут данными: студия рисует их поверх видео, правка не требует пересборки.
  // Первый прижимается к нулю: телеметрия ставит его на 0.006 с — через мгновение после
  // старта записи, — и при перемотке в самое начало он не показывается вовсе.
  captions: captions.map((c, i) => ({ t: i === 0 && c.t < 0.5 ? 0 : c.t, label: c.label, n: c.n })),
  builtAt: new Date().toISOString(),
});
await api('/api/status', { state: 'listening', text: 'Ролик собран', step: null, of: null });

// Обрезку записываем в телеметрию: монтаж пересчитывает по ней и титры, и точки
// действий. Без этого камера наезжала бы с опозданием ровно на длину входа в систему.
timeline.trimmedStart = Math.round(offset * 10) / 10;
fs.writeFileSync(timelinePath, JSON.stringify(timeline, null, 1));

console.log(JSON.stringify({
  ok: true, out: OUT, duration: Math.round(duration),
  trimmedStart: Math.round(offset * 10) / 10,
  captions: captions.length, seconds: Math.round((Date.now() - t0) / 1000),
}));
