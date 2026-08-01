/**
 * Титры и рамка кадра — картинками с прозрачностью.
 *
 * Рисуем браузером, а не ffmpeg. Причина не только в том, что местная сборка ffmpeg
 * собрана без libfreetype и фильтра drawtext в ней нет. Даже там, где drawtext есть,
 * он умеет строчку системным шрифтом — без переносов, без разной насыщенности в одной
 * строке, без скруглений и теней. Титр — типографика, а не подпись поверх картинки;
 * браузер её умеет, и заодно берёт те же шрифты и цвета, что и сама студия.
 *
 * Каждый титр — PNG с альфой, который монтаж накладывает поверх видео на своём отрезке.
 * Такой титр можно переписать и пересобрать ролик за секунды — перекодировать заново
 * ничего не нужно.
 */
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

const FONT = "'Golos Text', -apple-system, system-ui, sans-serif";
const MONO = "'JetBrains Mono', ui-monospace, monospace";

/** Разметка одного титра. Держим её здесь, а не в шаблоне-файле: титр — часть монтажа. */
const captionHTML = (label, tc, kind) => `
<!doctype html><meta charset="utf-8">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Golos+Text:wght@500;600&family=JetBrains+Mono:wght@600&display=swap" rel="stylesheet">
<style>
  html, body { margin: 0; background: transparent; }
  body { width: 1920px; height: 1080px; position: relative; }
  .cap {
    position: absolute; left: 96px; bottom: ${kind === 'lower' ? '96px' : '120px'};
    display: inline-flex; align-items: center; gap: 18px;
    padding: 20px 30px;
    border-radius: 14px;
    /* Плашка, а не голый текст: интерфейсы бывают любой яркости, и белый титр на
       светлом разделе исчезает. Полупрозрачная подложка держит контраст всегда. */
    background: rgba(9, 11, 16, 0.82);
    border: 1px solid rgba(255, 255, 255, 0.10);
    box-shadow: 0 24px 60px -20px rgba(0, 0, 0, 0.8);
    backdrop-filter: blur(8px);
    max-width: 1400px;
  }
  .tc {
    font: 600 26px/1 ${MONO};
    color: #56b6ff;
    letter-spacing: 0.02em;
    flex: none;
  }
  .sep { width: 1px; height: 30px; background: rgba(255,255,255,0.16); flex: none; }
  .label {
    font: 600 36px/1.25 ${FONT};
    color: #f4f6fa;
    letter-spacing: -0.01em;
  }
</style>
<div class="cap">
  <span class="tc">${tc}</span><span class="sep"></span>
  <span class="label">${label.replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]))}</span>
</div>`;

/** Заставка: имя ролика на чёрном. Первый кадр решает, будут ли смотреть дальше. */
const slateHTML = (title, subtitle) => `
<!doctype html><meta charset="utf-8">
<link href="https://fonts.googleapis.com/css2?family=Unbounded:wght@600;800&family=Golos+Text:wght@500&display=swap" rel="stylesheet">
<style>
  html, body { margin: 0; background: transparent; }
  body { width: 1920px; height: 1080px; display: grid; place-content: center;
         text-align: center; gap: 24px; }
  h1 { margin: 0; font: 800 96px/1.05 'Unbounded', sans-serif; color: #f4f6fa;
       letter-spacing: -0.03em; max-width: 1500px; }
  p  { margin: 0; font: 500 34px/1.4 'Golos Text', sans-serif; color: #aab3c2; }
  .rule { width: 120px; height: 3px; margin: 8px auto 0;
          background: linear-gradient(96deg, #0162e4, #089efb 45%, #00e0b8); border-radius: 2px; }
</style>
<h1>${title}</h1>
${subtitle ? `<p>${subtitle}</p>` : ''}
<div class="rule"></div>`;

/**
 * Рамка кадра: виньетка и мягкая тень по краям.
 *
 * Одна картинка на весь ролик — накладывается поверх всего и собирает разнородные
 * экраны в один визуальный ряд. Дешевле фильтра vignette и точнее: края гасим
 * ровно настолько, чтобы взгляд шёл в центр, но интерфейс по углам оставался читаем.
 */
const vignetteHTML = () => `
<!doctype html><meta charset="utf-8">
<style>
  html, body { margin: 0; background: transparent; }
  body { width: 1920px; height: 1080px; position: relative; }
  .v { position: absolute; inset: 0;
       background: radial-gradient(130% 105% at 50% 45%,
         rgba(0,0,0,0) 55%, rgba(0,0,0,0.28) 82%, rgba(0,0,0,0.52) 100%); }
</style><div class="v"></div>`;

/**
 * Финальная плашка: логотип продукта и адрес.
 *
 * Ролик уезжает в чужую ленту, где его смотрят без контекста. Кадр, на котором
 * видно, о чём это было и куда идти, стоит двух секунд хронометража.
 */
const endHTML = (title, url) => `
<!doctype html><meta charset="utf-8">
<link href="https://fonts.googleapis.com/css2?family=Unbounded:wght@700&family=JetBrains+Mono:wght@500&display=swap" rel="stylesheet">
<style>
  html, body { margin: 0; background: transparent; }
  body { width: 1920px; height: 1080px; display: grid; place-content: center;
         justify-items: center; gap: 26px; background: rgba(9,11,16,0.92); }
  h2 { margin: 0; font: 700 84px/1.1 'Unbounded', sans-serif; color: #f4f6fa;
       letter-spacing: -0.03em; text-align: center; max-width: 1500px; }
  .url { font: 500 34px/1 'JetBrains Mono', monospace; color: #56b6ff; }
  .rule { width: 140px; height: 4px; border-radius: 2px;
          background: linear-gradient(96deg, #0162e4, #089efb 45%, #00e0b8); }
</style>
<h2>${title}</h2><div class="rule"></div>${url ? `<div class="url">${url}</div>` : ''}`;

/** Курсор: рисуем сами, потому что headless-съёмка его не пишет. */
const cursorHTML = () => `
<!doctype html><meta charset="utf-8">
<style>
  html, body { margin: 0; background: transparent; }
  body { width: 120px; height: 120px; display: grid; place-content: center; }
  .halo { position: absolute; width: 96px; height: 96px; border-radius: 50%;
          background: radial-gradient(circle, rgba(86,182,255,0.34), rgba(86,182,255,0) 68%); }
  svg { position: relative; filter: drop-shadow(0 4px 10px rgba(0,0,0,0.65)); }
</style>
<div class="halo"></div>
<svg width="34" height="46" viewBox="0 0 24 32" fill="none">
  <path d="M2 1.5 L2 25.5 L8 20 L12 29.5 L16 27.5 L12 18.5 L20 18 Z"
        fill="#ffffff" stroke="#0b0e14" stroke-width="1.6" stroke-linejoin="round"/>
</svg>`;

/**
 * Отрисовать набор картинок одним браузером.
 *
 * Один запуск на весь ролик: подъём Chromium стоит секунду, и делать это на каждый
 * титр значило бы платить её десять раз подряд.
 */
export async function renderOverlays({ dir, captions, slate, end, viewport }) {
  fs.mkdirSync(dir, { recursive: true });
  const browser = await chromium.launch();
  const page = await browser.newPage({
    viewport: { width: 1920, height: 1080 },
    deviceScaleFactor: 1,
  });

  const shot = async (html, file, clip) => {
    await page.setContent(html, { waitUntil: 'networkidle' });
    await page.waitForTimeout(160);   // веб-шрифты успевают применитьcя
    await page.screenshot({ path: file, omitBackground: true, clip });
    return file;
  };

  const out = { captions: [], slate: null, vignette: null, cursor: null };

  for (const [i, c] of captions.entries()) {
    const file = path.join(dir, `cap-${String(i + 1).padStart(2, '0')}.png`);
    await shot(captionHTML(c.label, c.tc, c.kind), file);
    out.captions.push({ ...c, file });
  }

  if (slate) {
    out.slate = path.join(dir, 'slate.png');
    await shot(slateHTML(slate.title, slate.subtitle), out.slate);
  }

  if (end) {
    out.end = path.join(dir, 'end.png');
    await shot(endHTML(end.title, end.url), out.end);
  }

  out.vignette = path.join(dir, 'vignette.png');
  await shot(vignetteHTML(), out.vignette);

  out.cursor = path.join(dir, 'cursor.png');
  await page.setViewportSize({ width: 120, height: 120 });
  await shot(cursorHTML(), out.cursor, { x: 0, y: 0, width: 120, height: 120 });

  await browser.close();
  return out;
}
