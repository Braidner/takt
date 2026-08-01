import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { visible, rectAt, AnchorTracker } from '../studio/lib/anchors.mjs';

const VIEWPORT = { width: 1440, height: 810 };

test('элемент внутри кадра виден', () => {
  assert.equal(visible({ x: 100, y: 200, w: 80, h: 32 }, VIEWPORT), true);
});

test('элемент ниже кадра не виден', () => {
  // Ровно этот случай убил третий план mc-медиа: y=3673 при высоте кадра 810.
  assert.equal(visible({ x: 177, y: 3673, w: 90, h: 28 }, VIEWPORT), false);
});

test('элемент, наполовину вышедший за край, ещё виден', () => {
  assert.equal(visible({ x: 1400, y: 400, w: 80, h: 32 }, VIEWPORT), true);
});

test('элемент, вышедший целиком, не виден', () => {
  assert.equal(visible({ x: 1441, y: 400, w: 80, h: 32 }, VIEWPORT), false);
});

test('элемент выше кадра не виден', () => {
  assert.equal(visible({ x: 100, y: -60, w: 80, h: 32 }, VIEWPORT), false);
});

test('элемент нулевого размера не виден', () => {
  // Скрытый display:none отдаёт нули, и наезжать на него нельзя.
  assert.equal(visible({ x: 0, y: 0, w: 0, h: 0 }, VIEWPORT), false);
});

test('отсутствующего прямоугольника достаточно, чтобы не строить наезд', () => {
  assert.equal(visible(null, VIEWPORT), false);
});

const TRACK = [
  { t: 1.0, x: 100, y: 100, w: 50, h: 20 },
  { t: 2.0, x: 200, y: 100, w: 50, h: 20 },
];

test('выборка между пробами интерполируется', () => {
  assert.equal(rectAt(TRACK, 1.5).x, 150);
});

test('выборка до начала трека берёт первую пробу', () => {
  assert.equal(rectAt(TRACK, 0.2).x, 100);
});

test('выборка после конца трека берёт последнюю пробу', () => {
  assert.equal(rectAt(TRACK, 9).x, 200);
});

test('пустой трек не даёт цели', () => {
  assert.equal(rectAt([], 1), null);
  assert.equal(rectAt(null, 1), null);
});

test('трек снимается после прокрутки, а не до — и потому попадает в кадр', async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 400, height: 300 } });
  await page.setContent(`
    <body style="margin:0">
      <div style="height:2000px"></div>
      <button id="цель" style="height:30px">Жанры</button>
      <div style="height:2000px"></div>
    </body>`);

  const t0 = Date.now();
  const tracker = new AnchorTracker(page, { width: 400, height: 300 }, () => (Date.now() - t0) / 1000);
  tracker.watch('#цель');
  tracker.start();

  // До прокрутки элемент далеко за кадром — как в mc-медиа.
  const before = await page.evaluate(() => document.querySelector('#цель').getBoundingClientRect().y);
  assert.ok(before > 300, `элемент и так в кадре (${before}) — тест ничего не проверяет`);

  await page.locator('#цель').scrollIntoViewIfNeeded();
  await page.waitForTimeout(400);
  const tracks = tracker.stop();
  await browser.close();

  assert.equal(tracks.length, 1);
  assert.equal(tracks[0].selector, '#цель');
  assert.ok(tracks[0].rects.length >= 2, `проб всего ${tracks[0].rects.length}`);

  const inFrame = tracks[0].rects.filter((r) => visible(r, { width: 400, height: 300 }));
  assert.ok(inFrame.length > 0, 'элемент ни разу не попал в кадр — трек бесполезен');
});
