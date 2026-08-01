/**
 * Хайлайты: короткая версия ролика из лучших моментов.
 *
 *   takt highlight              ≈25 секунд, горизонтально
 *   takt highlight --seconds 15
 *   takt highlight --vertical   9:16 для сторис и шортсов
 *
 * Полный ролик и хайлайты — разные жанры, а не длинный и укороченный. Полный отвечает
 * «как это работает» и его смотрят, когда уже интересно. Хайлайты отвечают «а что это
 * вообще» за время, которое человек готов потратить на незнакомый продукт в ленте, —
 * и потому строятся не обрезкой, а отбором.
 *
 * ЧТО СЧИТАЕТСЯ ЛУЧШИМ МОМЕНТОМ. Не «где больше движения»: экранные рекордеры так и
 * делают, и в подборку попадает прокрутка длинного списка. У нас есть то, чего у них
 * нет, — знание, что происходило: мы сами кликали, сами меняли экран, сами писали
 * подписи. Поэтому кандидаты берутся из смысла:
 *
 *   * ДЕЙСТВИЕ — клик или ввод. Самое ценное: видно функциональность, а не интерфейс;
 *   * НАЧАЛО СЦЕНЫ — первые секунды после смены экрана, пока он ещё новый для зрителя;
 *   * ФИНАЛЬНЫЙ КАДР — то, к чему всё шло.
 *
 * Отобранное режется, склеивается кроссфейдами и получает крупные титры: в ленте
 * смотрят без звука и мелкий текст не читают.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { inProject, currentProject } from './project.mjs';
import { renderOverlays } from './titles.mjs';
import { buildSound } from './sound.mjs';

const run = promisify(execFile);
const ff = (args) => run('ffmpeg', ['-v', 'error', '-y', ...args], { maxBuffer: 1 << 28 });

const arg = (name, def) => {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 ? Number(process.argv[i + 1]) : def;
};
const TARGET = arg('seconds', 25);
const VERTICAL = process.argv.includes('--vertical');

const W = VERTICAL ? 1080 : 1920;
const H = VERTICAL ? 1920 : 1080;
const FPS = 30;

const timeline = JSON.parse(fs.readFileSync(inProject('timeline.json'), 'utf8'));
const master = inProject('movie.mp4');
if (!fs.existsSync(master)) {
  console.error('Нет мастера: сначала соберите его — takt build');
  process.exit(1);
}

const { stdout: durOut } = await run('ffprobe', ['-v', 'error', '-show_entries',
  'format=duration', '-of', 'csv=p=0', master]);
const DUR = Number(durOut.trim());
const OFFSET = Number(timeline.trimmedStart || 0);
const at = (t) => t - OFFSET;

const scenes = (timeline.events || [])
  .filter((e) => e.kind === 'caption')
  .map((e, i, arr) => ({
    label: e.label,
    from: Math.max(0, at(e.t)),
    to: arr[i + 1] ? at(arr[i + 1].t) : DUR,
  }))
  .filter((s) => s.to - s.from > 0.8);

const hits = (timeline.hits || []).map((h) => ({ ...h, t: at(h.t) }))
  .filter((h) => h.t > 0.5 && h.t < DUR - 0.5);

/** Подпись сцены, в которую попал момент: хайлайт без подписи — просто мельтешение. */
const labelAt = (t) => scenes.find((s) => t >= s.from && t < s.to)?.label || '';

/**
 * Кандидаты с весами. Вес решает, что войдёт при нехватке времени: сначала действия,
 * потом новые экраны, потом финал.
 */
const CLIP = 3.2;                 // длина одного куска: короче — рвано, длиннее — скучно
const candidates = [];

for (const h of hits) {
  candidates.push({ from: Math.max(0, h.t - 1.1), weight: 3, label: labelAt(h.t) });
}
for (const s of scenes) {
  candidates.push({ from: s.from + 0.35, weight: 2, label: s.label });
}
if (DUR > CLIP + 1) {
  candidates.push({ from: DUR - CLIP - 0.4, weight: 1, label: scenes[scenes.length - 1]?.label || '' });
}

/** Куски не должны перекрываться: один и тот же момент дважды выглядит как заедание. */
const picked = [];
for (const c of candidates.sort((a, b) => b.weight - a.weight || a.from - b.from)) {
  const to = Math.min(DUR, c.from + CLIP);
  if (to - c.from < 1.6) continue;
  if (picked.some((p) => c.from < p.to + 0.4 && to > p.from - 0.4)) continue;
  picked.push({ ...c, to });
  if (picked.reduce((s, p) => s + (p.to - p.from), 0) >= TARGET) break;
}
picked.sort((a, b) => a.from - b.from);

if (!picked.length) {
  console.error('Нечего показать: в ролике нет ни действий, ни смен экрана');
  process.exit(1);
}

console.log(`хайлайты: ${picked.length} кусков · ≈${picked.reduce((s, p) => s + (p.to - p.from), 0).toFixed(0)} с`
  + ` · ${VERTICAL ? '9:16' : '16:9'}`);

const work = inProject('highlight');
fs.mkdirSync(work, { recursive: true });

/**
 * Каждый кусок режется отдельно и приводится к общему формату.
 *
 * Для вертикали кадр не сжимается в полосу, а КАДРИРУЕТСЯ по центру интереса: в
 * 9:16 горизонтальный интерфейс целиком не влезает, и попытка вписать его даёт
 * ленточку в четверть экрана, которую в телефоне не разглядеть.
 */
const parts = [];
for (const [i, p] of picked.entries()) {
  const file = path.join(work, `part-${String(i + 1).padStart(2, '0')}.mp4`);
  const vf = VERTICAL
    // Берём вертикальную полосу вокруг центра действия, потом мягко подтягиваем масштаб.
    ? `crop=ih*9/16:ih:(iw-ih*9/16)/2:0,scale=${W}:${H},setsar=1,fps=${FPS}`
    : `scale=${W}:${H}:force_original_aspect_ratio=decrease,`
      + `pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:color=0x0b0e14,setsar=1,fps=${FPS}`;
  await ff(['-ss', p.from.toFixed(2), '-t', (p.to - p.from).toFixed(2), '-i', master,
            '-vf', vf, '-an', '-c:v', 'libx264', '-preset', 'fast', '-crf', '18', file]);
  parts.push({ ...p, file });
}

/**
 * Склейка кроссфейдами.
 *
 * xfade перекрывает куски, поэтому итог короче суммы на длину переходов — это учтено
 * при расчёте таймкодов титров ниже, иначе подписи разъехались бы с картинкой.
 */
const X = 0.32;
const inputs = [];
const chain = [];
for (const [i, p] of parts.entries()) inputs.push('-i', p.file);

let cur = '[0:v]';
let acc = parts[0].to - parts[0].from;
const marks = [{ label: parts[0].label, from: 0, to: acc }];
for (let i = 1; i < parts.length; i++) {
  const len = parts[i].to - parts[i].from;
  const offset = acc - X;
  chain.push(`${cur}[${i}:v]xfade=transition=fade:duration=${X}:offset=${offset.toFixed(2)}[x${i}]`);
  cur = `[x${i}]`;
  marks.push({ label: parts[i].label, from: offset + X, to: offset + len });
  acc = offset + len;
}

const joined = path.join(work, 'joined.mp4');
if (chain.length) {
  await ff([...inputs, '-filter_complex', chain.join(';'), '-map', cur,
            '-c:v', 'libx264', '-preset', 'medium', '-crf', '18', joined]);
} else {
  fs.copyFileSync(parts[0].file, joined);
}

const TOTAL = acc;

/** Титры хайлайтов крупнее обычных: в ленте смотрят с телефона и без звука. */
const captions = [];
let last = null;
for (const m of marks) {
  if (m.label && m.label !== last) {
    captions.push({ label: m.label, tc: '', from: m.from + 0.15,
                    to: Math.min(TOTAL, m.from + 2.6), kind: 'lower' });
    last = m.label;
  }
}

const overlays = await renderOverlays({ dir: work, captions, slate: null,
                                        viewport: timeline.viewport });

const inputs2 = ['-i', joined];
const filters2 = [];
let v = '[0:v]';
const still = (f) => ['-loop', '1', '-framerate', String(FPS), '-t', TOTAL.toFixed(2), '-i', f];

for (const [i, c] of overlays.captions.entries()) {
  inputs2.push(...still(c.file));
  const idx = i + 1;
  // Титр в вертикали живёт выше: нижнюю треть занимают интерфейсы приложений.
  const y = VERTICAL ? Math.round(H * 0.62) - 1080 : 0;
  filters2.push(`[${idx}:v]format=rgba,scale=${W}:-1,`
    + `fade=t=in:st=${c.from.toFixed(2)}:d=0.3:alpha=1,`
    + `fade=t=out:st=${(c.to - 0.3).toFixed(2)}:d=0.3:alpha=1[t${i}]`);
  filters2.push(`${v}[t${i}]overlay=0:${VERTICAL ? y : 0}:`
    + `enable='between(t,${c.from.toFixed(2)},${c.to.toFixed(2)})'[c${i}]`);
  v = `[c${i}]`;
}

inputs2.push(...still(overlays.vignette));
const vigIdx = inputs2.filter((x) => x === '-i').length - 1;
filters2.push(`[${vigIdx}:v]format=rgba,scale=${W}:${H}[vig]`);
filters2.push(`${v}[vig]overlay=0:0[vout]`);

const picture = path.join(work, 'picture.mp4');
await ff([...inputs2, '-filter_complex', filters2.join(';'), '-map', '[vout]',
          '-c:v', 'libx264', '-preset', 'medium', '-crf', '19', '-pix_fmt', 'yuv420p', picture]);

// Щелчки в хайлайтах ставятся на склейки: там и происходит смена смысла.
const beats = marks.slice(1).map((m) => ({ t: m.from }));
const out = inProject(VERTICAL ? 'movie-short-vertical.mp4' : 'movie-short.mp4');
await buildSound({ video: picture, out, hits: beats, duration: TOTAL, work });

const { stdout: metaOut } = await run('ffprobe', ['-v', 'error', '-show_entries',
  'format=duration,size', '-of', 'json', out]);
const meta = JSON.parse(metaOut).format;

console.log(JSON.stringify({
  ok: true, out,
  duration: Number(meta.duration).toFixed(1),
  megabytes: Math.round(Number(meta.size) / 1024 / 1024 * 10) / 10,
  clips: picked.length,
}, null, 1));
