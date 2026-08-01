/**
 * Монтаж: из записи экрана — готовый ролик.
 *
 *   takt edit                 смонтировать полную версию
 *   takt edit --no-zoom       без наездов камеры
 *
 * takt build даёт «мастер»: перекодированную запись, по которой удобно работать в
 * студии. Монтаж — отдельный шаг, и это разделение принципиально: мастер пересобирается
 * за секунды и нужен постоянно, монтаж считается минуты и нужен, когда ролик готов.
 *
 * Что делает монтаж и почему именно это:
 *
 *   * КАМЕРА. Наезд на место действия по координатам из телеметрии, а не по эвристике
 *     «где что мигнуло», как в экранных рекордерах. Мы сами кликали — мы точно знаем
 *     куда, и промахов не бывает. Между действиями камера возвращается на общий план:
 *     непрерывный зум укачивает.
 *   * КУРСОР. Headless-съёмка курсор не пишет — синтетические клики его не двигают.
 *     Поэтому рисуем сами: он появляется у цели перед кликом, «нажимает» и гаснет.
 *     Без курсора зритель не понимает, что произошло действие, а не само открылось.
 *   * ТИТРЫ. Готовыми картинками из titles.mjs — брендовая типографика вместо
 *     системного шрифта, и правка титра не требует пересъёмки.
 *   * ПЕРЕХОДЫ между смысловыми блоками — короткий кроссфейд. Резкая склейка на смене
 *     экрана читается как сбой записи.
 *   * ВИНЬЕТКА одной картинкой поверх всего: собирает разнородные экраны в единый ряд.
 *   * ЗВУК. Музыка с автопригрушением под щелчки, щелчок на каждом действии. Немой
 *     ролик выглядит как черновик, даже если картинка идеальная.
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

const W = 1920, H = 1080, FPS = 30;

const noZoom = process.argv.includes('--no-zoom');
const silent = process.argv.includes('--silent');
/**
 * Дрейф — медленное движение камеры по статичному кадру.
 *
 * Нужен там, где действий мало, а смотреть есть на что: витрина с постерами, дашборд,
 * длинная страница. Неподвижный кадр в рекламном ролике читается как стоп-кадр, даже
 * если на нём происходит загрузка. Наезд по клику эту задачу не решает — кликать там
 * не по чему.
 */
const drift = process.argv.includes('--drift');
/** Адрес на финальной плашке: ролик уезжает в ленту, и зритель должен знать, куда идти. */
const endUrl = (() => {
  const i = process.argv.indexOf('--end-url');
  return i !== -1 ? process.argv[i + 1] : null;
})();
/** Заголовок ролика можно задать явно: имя проекта — рабочее, а на заставке нужен показной. */
const titleArg = (() => {
  const i = process.argv.indexOf('--title');
  return i !== -1 ? process.argv[i + 1] : null;
})();

const timeline = JSON.parse(fs.readFileSync(inProject('timeline.json'), 'utf8'));
const master = inProject('movie.mp4');
if (!fs.existsSync(master)) {
  console.error('Нет мастера: сначала соберите его — takt build');
  process.exit(1);
}

const { stdout: durOut } = await run('ffprobe', ['-v', 'error', '-show_entries',
  'format=duration', '-of', 'csv=p=0', master]);
const DUR = Number(durOut.trim());

// Мастер обрезан с начала — телеметрия и щелчки должны считаться от того же нуля.
const OFFSET = Number(timeline.trimmedStart || 0);
const at = (t) => t - OFFSET;

const captions = (timeline.events || [])
  .filter((e) => e.kind === 'caption')
  .map((e, i, arr) => ({
    label: e.label,
    tc: mmss(Math.max(0, at(e.t))),
    from: Math.max(0, at(e.t)),
    to: arr[i + 1] ? at(arr[i + 1].t) : DUR,
    kind: 'lower',
  }))
  .filter((c) => c.to > 0.4);

const hits = (timeline.hits || [])
  .map((h) => ({ ...h, t: at(h.t) }))
  .filter((h) => h.t > 0 && h.t < DUR);

function mmss(s) {
  return `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
}

console.log(`монтаж: ${DUR.toFixed(0)} с · ${captions.length} титров · ${hits.length} действий`);

const work = inProject('edit');
fs.mkdirSync(work, { recursive: true });

const project = (() => {
  try { return JSON.parse(fs.readFileSync(inProject('project.json'), 'utf8')); }
  catch { return { title: currentProject() }; }
})();

const overlays = await renderOverlays({
  dir: work,
  captions,
  slate: { title: titleArg || project.title || 'Демонстрация', subtitle: null },
  end: { title: titleArg || project.title || 'Демонстрация', url: endUrl },
  viewport: timeline.viewport,
});

/**
 * План работы камеры.
 *
 * Наезд начинается ДО клика: зритель должен успеть увидеть, куда смотреть, иначе
 * действие происходит в кадре, который ещё едет. Держим план после клика — результат
 * действия и есть то, ради чего его показывали. Потом возврат на общий.
 */
const LEAD = 0.9;        // сколько секунды камера подъезжает до клика
const HOLD = 1.9;        // сколько держит план после
/**
 * Глубина наезда — компромисс, и обе стороны реальны. Мельче 1.2 наезд не читается
 * как приём. Глубже 1.3 у плотного интерфейса из кадра уходит контекст: видно кнопку,
 * но непонятно, в каком она разделе, — а запись 1440p ещё и начинает мылить.
 */
const ZOOM = 1.26;

/**
 * Кадрирование считаем в координатах ЗАПИСИ, а не готового кадра: телеметрия писала
 * позиции в вьюпорте съёмки, и пересчёт «на глаз» промахивался бы тем сильнее, чем
 * дальше край экрана. Объявлено здесь, до планов камеры: дрейф считает точки от них.
 */
const vw = timeline.viewport?.width || 1440;
const vh = timeline.viewport?.height || 810;

const shots = [];

/**
 * Дрейф раскладывается по сценам: каждая получает своё направление, чтобы соседние
 * планы не ехали одинаково — одинаковое движение подряд выглядит как заедание.
 */
if (drift) {
  const scenes = captions.length ? captions : [{ from: 0, to: DUR }];
  scenes.forEach((sc, i) => {
    const len = sc.to - sc.from;
    if (len < 2.2) return;
    // Чередуем: приближение к разным третям кадра. Величина маленькая — дрейф
    // должен ощущаться, а не замечаться.
    const targets = [[0.38, 0.42], [0.62, 0.5], [0.5, 0.62], [0.44, 0.38]];
    const [nx, ny] = targets[i % targets.length];
    shots.push({ from: sc.from, to: sc.to, x: nx * vw, y: ny * vh,
                 zoom: 1.14, slow: true });
  });
}

if (!noZoom && !drift) {
  for (const h of hits) {
    const from = Math.max(0, h.t - LEAD);
    const to = Math.min(DUR, h.t + HOLD);
    if (to - from < 1.2) continue;
    // Слить соседние действия в один план: две быстрые правки подряд не должны
    // дёргать камеру туда-сюда.
    const last = shots[shots.length - 1];
    if (last && from - last.to < 0.8) {
      last.to = to;
      last.x = (last.x + h.x) / 2;
      last.y = (last.y + h.y) / 2;
    } else {
      shots.push({ from, to, x: h.x, y: h.y });
    }
  }
}

const expr = [];
if (shots.length) {
  // Кусочная функция масштаба и центра: между планами — плавный переход по времени.
  const z = ['1'];
  const cx = ['0.5'], cy = ['0.5'];
  for (const s of shots) {
    const Z = s.zoom || ZOOM;
    // У дрейфа разгон во всю длину плана: он и есть движение, а не подъезд к точке.
    const inT = s.slow ? Math.min(1.6, (s.to - s.from) * 0.45) : 0.55;
    const a = s.from, b = s.from + inT, c = s.to - inT, d = s.to;
    // Центр кадра притягиваем к середине: наезд ровно на точку клика выбрасывает из
    // кадра шапку и соседние панели, по которым зритель понимает, где он находится.
    const pull = 0.45;
    const nx = Math.max(0.22, Math.min(0.78, 0.5 + (s.x / vw - 0.5) * pull));
    const ny = Math.max(0.24, Math.min(0.76, 0.5 + (s.y / vh - 0.5) * pull));
    // between() даёт ступеньки, lerp внутри — плавность.
    z.unshift(`if(between(t,${a},${b}), 1+(${Z}-1)*(t-${a})/${inT},`
      + `if(between(t,${b},${c}), ${Z},`
      + `if(between(t,${c},${d}), ${Z}-(${Z}-1)*(t-${c})/${inT}, `);
    cx.unshift(`if(between(t,${a},${d}), ${nx.toFixed(4)}, `);
    cy.unshift(`if(between(t,${a},${d}), ${ny.toFixed(4)}, `);
  }
  const close = (arr) => arr.join('') + ')'.repeat((arr.length - 1) * 3);
  expr.push({ z: close(z), cx: cx.join('') + ')'.repeat(cx.length - 1),
              cy: cy.join('') + ')'.repeat(cy.length - 1) });
}

/**
 * Сборка одной командой ffmpeg.
 *
 * Промежуточные файлы соблазнительны — каждый шаг было бы видно — но каждая
 * перекодировка теряет качество, а их тут было бы четыре. Один граф: масштаб,
 * камера, курсор, титры, виньетка.
 */
/**
 * Картинку-накладку подключаем как ЗАЦИКЛЕННЫЙ поток, а не одиночный кадр.
 *
 * PNG — это один кадр в момент t=0. Наложение его переживает (ffmpeg повторяет
 * последний кадр), но фильтр fade — нет: он гасит альфу единственного кадра, и
 * дальше повторяется уже погасшая картинка. Титр при этом не появляется никогда,
 * причём ffmpeg не жалуется — просто ничего не видно.
 */
const still = (file) => ['-loop', '1', '-framerate', String(FPS), '-t', DUR.toFixed(2), '-i', file];

const inputs = ['-i', master];
const filters = [];
let v = '[0:v]';

// 1. Приводим запись к 1080p с полями (запись 1440×810 — не 16:9 ровно).
filters.push(`${v}scale=${W}:${H}:force_original_aspect_ratio=decrease,`
  + `pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:color=0x0b0e14,setsar=1,fps=${FPS}[base]`);
v = '[base]';

/**
 * 2. Камера — zoompan.
 *
 * Соблазнительно сделать наезд через crop с выражением от времени: код читается
 * прямее. Но crop вычисляет размер окна ОДИН РАЗ, при инициализации фильтра —
 * выходной кадр не может менять размер покадрово. Выражение при этом принимается
 * без единой жалобы, просто зум не происходит: кадр застывает на масштабе первого
 * кадра. zoompan для этого и сделан.
 *
 * Время внутри zoompan — номер выходного кадра, поэтому все `t` пересчитываются
 * в `on/fps`.
 */
if (expr.length) {
  const asFrames = (e) => e.replace(/\bt\b/g, `(on/${FPS})`);
  const { z, cx, cy } = expr[0];
  filters.push(`${v}zoompan=z='${asFrames(z)}':`
    + `x='(iw-iw/zoom)*(${asFrames(cx)})':y='(ih-ih/zoom)*(${asFrames(cy)})':`
    + `d=1:s=${W}x${H}:fps=${FPS},setsar=1[cam]`);
  v = '[cam]';
}

// 3. Курсор: появляется, «нажимает», гаснет. Позиция пересчитана в кадр 1080p.
if (hits.length && !noZoom) {
  inputs.push(...still(overlays.cursor));
  const idx = inputs.filter((x) => x === '-i').length - 1;
  const scaleY = H / vh, scaleX = W / vw;
  const cond = hits.map((h) => {
    const x = Math.round(h.x * scaleX) - 10;
    const y = Math.round(h.y * scaleY) - 10;
    return { h, x, y };
  });
  // Одна накладка на все клики: показываем её, когда пришло время, и двигаем в точку.
  const enable = cond.map(({ h }) => `between(t,${(h.t - 0.5).toFixed(2)},${(h.t + 0.8).toFixed(2)})`).join('+');
  const xExpr = cond.map(({ h, x }) => `if(between(t,${(h.t - 0.5).toFixed(2)},${(h.t + 0.8).toFixed(2)}),${x},`).join('')
    + '-999' + ')'.repeat(cond.length);
  const yExpr = cond.map(({ h, y }) => `if(between(t,${(h.t - 0.5).toFixed(2)},${(h.t + 0.8).toFixed(2)}),${y},`).join('')
    + '-999' + ')'.repeat(cond.length);
  filters.push(`[${idx}:v]format=rgba[cur]`);
  filters.push(`${v}[cur]overlay=x='${xExpr}':y='${yExpr}':enable='${enable}'[withcur]`);
  v = '[withcur]';
}

// 4. Титры — каждый на своём отрезке.
for (const [i, c] of overlays.captions.entries()) {
  inputs.push(...still(c.file));
  const idx = inputs.filter((x) => x === '-i').length - 1;
  const fadeIn = 0.35;
  filters.push(`[${idx}:v]format=rgba,`
    + `fade=t=in:st=${c.from.toFixed(2)}:d=${fadeIn}:alpha=1,`
    + `fade=t=out:st=${(c.to - 0.35).toFixed(2)}:d=0.35:alpha=1[t${i}]`);
  filters.push(`${v}[t${i}]overlay=0:0:enable='between(t,${c.from.toFixed(2)},${c.to.toFixed(2)})'[c${i}]`);
  v = `[c${i}]`;
}

// 5. Виньетка поверх всего.
inputs.push(...still(overlays.vignette));
const vigIdx = inputs.filter((x) => x === '-i').length - 1;
filters.push(`[${vigIdx}:v]format=rgba[vig]`);
filters.push(`${v}[vig]overlay=0:0[vout]`);
v = '[vout]';

const body = path.join(work, 'body.mp4');
console.log('  собираю картинку…');
await ff([...inputs, '-filter_complex', filters.join(';'), '-map', v,
          '-c:v', 'libx264', '-preset', 'medium', '-crf', '19',
          '-pix_fmt', 'yuv420p', '-r', String(FPS), body]);

/**
 * Заставка и финальная плашка.
 *
 * Ролик без начала и конца выглядит куском чужой записи: непонятно, что это было и
 * куда идти. Две с половиной секунды в начале и две в конце — цена узнаваемости.
 *
 * Клеим кроссфейдом, а не встык: резкая склейка на чёрном читается как обрыв файла.
 */
const SLATE = 2.6, END = 2.2, X = 0.5;
console.log('  клею заставку и финал…');

const makeCard = async (png, seconds, file) => {
  await ff(['-f', 'lavfi', '-t', seconds.toFixed(2), '-i', `color=c=0x0b0e14:s=${W}x${H}:r=${FPS}`,
            '-loop', '1', '-framerate', String(FPS), '-t', seconds.toFixed(2), '-i', png,
            '-filter_complex', '[1:v]format=rgba[c];[0:v][c]overlay=0:0,'
              + `fade=t=in:st=0:d=0.4,fade=t=out:st=${(seconds - 0.5).toFixed(2)}:d=0.5[o]`,
            '-map', '[o]', '-c:v', 'libx264', '-preset', 'medium', '-crf', '19',
            '-pix_fmt', 'yuv420p', file]);
  return file;
};

const slateFile = await makeCard(overlays.slate, SLATE, path.join(work, 'slate.mp4'));
const endFile = await makeCard(overlays.end, END, path.join(work, 'end.mp4'));

const silentOut = path.join(work, 'picture.mp4');
await ff(['-i', slateFile, '-i', body, '-i', endFile,
          '-filter_complex',
          `[0:v][1:v]xfade=transition=fade:duration=${X}:offset=${(SLATE - X).toFixed(2)}[a];`
          + `[a][2:v]xfade=transition=fade:duration=${X}:`
          + `offset=${(SLATE - X + DUR - X).toFixed(2)}[o]`,
          '-map', '[o]', '-c:v', 'libx264', '-preset', 'medium', '-crf', '19',
          '-pix_fmt', 'yuv420p', silentOut]);

// Заставка сдвинула всё содержимое — щелчки должны переехать вместе с картинкой.
const SHIFT = SLATE - X;
const soundHits = hits.map((h) => ({ ...h, t: h.t + SHIFT }));
const TOTAL = SLATE - X + DUR - X + END;

// 6. Звук.
let out = inProject('movie-cut.mp4');
if (silent) {
  fs.copyFileSync(silentOut, out);
} else {
  console.log('  накладываю звук…');
  await buildSound({ video: silentOut, out, hits: soundHits, duration: TOTAL, work });
}

const { stdout: sizeOut } = await run('ffprobe', ['-v', 'error', '-show_entries',
  'format=duration,size', '-of', 'json', out]);
const meta = JSON.parse(sizeOut).format;

console.log(JSON.stringify({
  ok: true, out,
  duration: Number(meta.duration).toFixed(1),
  megabytes: Math.round(Number(meta.size) / 1024 / 1024 * 10) / 10,
  shots: shots.length, captions: captions.length,
}, null, 1));
