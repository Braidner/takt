/**
 * Состояние — единица съёмки.
 *
 * Раньше съёмка писала поток и упиралась в потолок браузера: выше CSS-пикселей headless
 * поднимается только покадровыми снимками, а они стоят 59 мс у самого Chromium — это
 * 17 кадров в секунду в лучшем случае и 6 на живой странице.
 *
 * Состояние снимается один раз и используется композицией сколько угодно. Прокрутка,
 * наезд и удержание после этого не снимаются, а собираются: камера едет по снимку, кадр
 * вычисляется из своего номера. Замер: вся страница 2880×8278 за 224 мс, а панорама по
 * ней идёт ровно 30 кадров в секунду и не теряет ни одного — их неоткуда терять.
 *
 * Порядок внутри существенный, и каждый шаг оплачен ошибкой:
 *   1. дождаться, пока экран успокоится — иначе в снимок попадёт скелетон;
 *   2. пройти страницу до низа и обратно — иначе ленивые картинки останутся пустыми
 *      местами ровно там, куда потом поедет камера;
 *   3. дождаться снова — прокрутка сама вызывает догрузку;
 *   4. снять слой липких по вьюпорту сверху страницы;
 *   5. спрятать липкие и снять тело целиком;
 *   6. снять прямоугольники якорей в шкале снимка тела.
 */
import path from 'node:path';
import { waitUntilSettled } from './settle.mjs';
import { findSticky, hideSticky, showSticky, stickyBands } from './sticky.mjs';

/** Шаг предварительной прокрутки в долях экрана: мельче — дольше, крупнее — не догрузит. */
const PREFETCH_STEP = 0.8;
/** Пауза на каждом шаге прокрутки: столько нужно наблюдателю пересечений, чтобы сработать. */
const PREFETCH_PAUSE = 260;

export async function captureState(page, { id, dir, waitFor = null, anchors = [] } = {}) {
  const settle = await waitUntilSettled(page, { waitFor, timeout: 30000 });

  await prefetchLazy(page);
  await waitUntilSettled(page, { waitFor, timeout: 15000 });

  const viewport = page.viewportSize();
  const scale = await page.evaluate(() => window.devicePixelRatio);

  // Слой снимается ДО скрытия и сверху страницы: липкие должны быть на своих местах.
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(200);
  const found = await findSticky(page);
  const layer = path.join(dir, `${id}-layer.jpg`);
  await page.screenshot({ path: layer, type: 'jpeg', quality: 92 });

  await hideSticky(page);
  const body = path.join(dir, `${id}-body.jpg`);
  await page.screenshot({ path: body, type: 'jpeg', quality: 92, fullPage: true });
  await showSticky(page);

  const size = await page.evaluate((s) => ({
    w: Math.round(document.documentElement.scrollWidth * s),
    h: Math.round(document.documentElement.scrollHeight * s),
  }), scale);

  return {
    id,
    body,
    layer,
    size,
    viewport,
    scale,
    sticky: stickyBands(found, viewport),
    anchors: await anchorRects(page, anchors, scale),
    settle,
  };
}

/**
 * Прогон страницы до низа и обратно.
 *
 * Без него ленивые картинки попадут в снимок пустыми местами — и это будет видно именно
 * там, куда поедет камера, потому что камера едет по интересному. В записи эту проблему
 * лечили паузой в сценарии: в подсказке седьмого шага mc-медиа так и написано
 * «постеры успевают догрузиться».
 */
async function prefetchLazy(page) {
  await page.evaluate(async ({ step, pause }) => {
    const h = () => document.documentElement.scrollHeight;
    const view = window.innerHeight;
    for (let y = 0; y < h(); y += view * step) {
      window.scrollTo(0, y);
      await new Promise((r) => setTimeout(r, pause));
    }
    window.scrollTo(0, Math.max(0, h() - view));
    await new Promise((r) => setTimeout(r, pause));
    window.scrollTo(0, 0);
  }, { step: PREFETCH_STEP, pause: PREFETCH_PAUSE });
  await page.waitForTimeout(PREFETCH_PAUSE);
}

/**
 * Прямоугольники якорей в шкале снимка тела.
 *
 * Координаты документа, а не вьюпорта: снимок тела — вся страница, и камера целится
 * в место на странице. Локаторами Playwright, а не querySelector: сценарии написаны
 * селекторами вида `text=Дискавери`, и querySelector на них бросает.
 */
async function anchorRects(page, selectors, scale) {
  const out = [];
  for (const selector of selectors) {
    const rect = await page.locator(selector).first().evaluate((el) => {
      const r = el.getBoundingClientRect();
      return { x: r.x + window.scrollX, y: r.y + window.scrollY, w: r.width, h: r.height };
    }).catch(() => null);

    out.push({
      selector,
      rect: rect ? {
        x: Math.round(rect.x * scale), y: Math.round(rect.y * scale),
        w: Math.round(rect.w * scale), h: Math.round(rect.h * scale),
      } : null,
    });
  }
  return out;
}
