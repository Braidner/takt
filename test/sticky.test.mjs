import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { findSticky, hideSticky, showSticky, stickyBands, MIN_SIZE } from '../studio/lib/sticky.mjs';

/** Страница с липкой шапкой сверху, липкой панелью слева и обычным содержимым. */
const PAGE = `
  <body style="margin:0;background:#111;color:#eee;font:14px sans-serif">
    <header style="position:sticky;top:0;height:48px;background:#222">шапка</header>
    <div style="display:flex">
      <aside style="position:sticky;top:48px;width:70px;height:600px;background:#191919">панель</aside>
      <main style="flex:1">
        <div style="height:3000px;padding:20px">содержимое</div>
      </main>
    </div>
    <span style="position:sticky;top:0;width:10px;height:10px;background:red"></span>
  </body>`;

async function open() {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 800, height: 500 } });
  await page.setContent(PAGE);
  return { browser, page };
}

test('находит липкие элементы и отсеивает мелкие', async () => {
  const { browser, page } = await open();
  const found = await findSticky(page);
  await browser.close();

  const tags = found.map((f) => f.tag).sort();
  assert.deepEqual(tags, ['aside', 'header']);
  // Красный span 10×10 — липкий, но мелкий: наезжать и накладывать там нечего.
  assert.ok(!found.some((f) => f.tag === 'span'), 'мелкий элемент не отсеян');
});

test('порог объявлен явно, а не спрятан в коде', () => {
  assert.equal(MIN_SIZE.w, 40);
  assert.equal(MIN_SIZE.h, 20);
});

test('шапка относится к верхнему краю, панель — к левому', async () => {
  const { browser, page } = await open();
  const found = await findSticky(page);
  await browser.close();

  const bands = stickyBands(found, { width: 800, height: 500 });
  const header = bands.find((b) => b.h < 100);
  const aside = bands.find((b) => b.w < 100);
  assert.equal(header.edge, 'top');
  assert.equal(aside.edge, 'left');
});

test('скрытие не меняет высоту документа — вёрстка не должна съезжать', async () => {
  const { browser, page } = await open();
  const before = await page.evaluate(() => document.documentElement.scrollHeight);

  const hidden = await hideSticky(page);
  const during = await page.evaluate(() => document.documentElement.scrollHeight);
  const visible = await page.evaluate(() =>
    getComputedStyle(document.querySelector('header')).visibility);

  await showSticky(page);
  const after = await page.evaluate(() => document.documentElement.scrollHeight);
  const back = await page.evaluate(() =>
    getComputedStyle(document.querySelector('header')).visibility);
  await browser.close();

  assert.equal(hidden, 2, `скрыто ${hidden} элементов вместо двух`);
  assert.equal(during, before, 'высота изменилась — использован display вместо visibility');
  assert.equal(visible, 'hidden');
  assert.equal(after, before);
  assert.equal(back, 'visible', 'видимость не восстановлена');
});

test('на странице без липких находить нечего и прятать нечего', async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 400, height: 300 } });
  await page.setContent('<body><div style="height:900px">просто длинная страница</div></body>');
  assert.deepEqual(await findSticky(page), []);
  assert.equal(await hideSticky(page), 0);
  await showSticky(page);   // не должно бросать
  await browser.close();
});

test('край берётся по растянутости, а не по расстоянию', () => {
  const vp = { width: 800, height: 500 };
  // Панель выше вьюпорта: до нижнего края «расстояние» отрицательное и обмануло бы выбор.
  const aside = stickyBands([{ tag: 'aside', rect: { x: 0, y: 48, w: 70, h: 600 } }], vp)[0];
  assert.equal(aside.edge, 'left');

  // Шапка во всю ширину — верх, футер во всю ширину внизу — низ.
  const head = stickyBands([{ tag: 'header', rect: { x: 0, y: 0, w: 800, h: 48 } }], vp)[0];
  assert.equal(head.edge, 'top');
  const foot = stickyBands([{ tag: 'footer', rect: { x: 0, y: 452, w: 800, h: 48 } }], vp)[0];
  assert.equal(foot.edge, 'bottom');

  // Ни вдоль чего не растянут — ближний край.
  const chip = stickyBands([{ tag: 'div', rect: { x: 700, y: 200, w: 80, h: 40 } }], vp)[0];
  assert.equal(chip.edge, 'right');
});
