import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { scrollOffset, scrollDuration, smoothScroll, DEFAULT_SPEED } from '../studio/lib/scroll.mjs';

test('в начале не сдвинулись, в конце пришли ровно', () => {
  assert.equal(scrollOffset(0, 1000, 2000), 0);
  assert.equal(scrollOffset(2000, 1000, 2000), 1000);
});

test('после конца не уезжаем дальше', () => {
  assert.equal(scrollOffset(5000, 1000, 2000), 1000);
});

test('движение монотонное', () => {
  let prev = -1;
  for (let t = 0; t <= 2000; t += 50) {
    const y = scrollOffset(t, 1000, 2000);
    assert.ok(y >= prev, `на ${t} мс поехали назад: ${y} после ${prev}`);
    prev = y;
  }
});

test('разгон и торможение: середина проходится быстрее краёв', () => {
  // Это и отличает движение камеры от перекладывания страницы.
  const start = scrollOffset(200, 1000, 2000) - scrollOffset(100, 1000, 2000);
  const middle = scrollOffset(1050, 1000, 2000) - scrollOffset(950, 1000, 2000);
  const end = scrollOffset(1900, 1000, 2000) - scrollOffset(1800, 1000, 2000);
  assert.ok(middle > start * 2, `середина ${middle} не быстрее начала ${start}`);
  assert.ok(middle > end * 2, `середина ${middle} не быстрее конца ${end}`);
});

test('длительность считается из дистанции и скорости', () => {
  assert.equal(scrollDuration(1200, 600), 2000);
  assert.equal(scrollDuration(600, DEFAULT_SPEED), 1000);
});

test('скорость по умолчанию — 600 пикселей в секунду', () => {
  assert.equal(DEFAULT_SPEED, 600);
});

test('очень короткая прокрутка всё равно занимает заметное время', () => {
  // Прокрутка на 40 пикселей за 66 мс — тот же прыжок, только маленький.
  assert.ok(scrollDuration(40, 600) >= 400);
});

test('обратное направление считается по модулю дистанции', () => {
  assert.equal(scrollDuration(-1200, 600), 2000);
  assert.equal(scrollOffset(2000, -1000, 2000), -1000);
});

test('страница действительно едет плавно, а не прыгает', async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 400, height: 300 } });
  await page.setContent('<body style="margin:0"><div style="height:4000px"></div></body>');

  // Пишем позицию на каждом кадре анимации — это и есть то, что увидит запись.
  await page.evaluate(() => {
    window.__positions = [];
    const tick = () => { window.__positions.push(window.scrollY); requestAnimationFrame(tick); };
    requestAnimationFrame(tick);
  });

  await smoothScroll(page, { distance: 900, speed: 600 });
  const positions = await page.evaluate(() => window.__positions);
  await browser.close();

  const moved = positions.filter((p) => p > 0);
  assert.ok(moved.length > 20, `кадров с движением всего ${moved.length} — это прыжок`);
  assert.equal(await Promise.resolve(Math.round(positions.at(-1))), 900);

  // Ни одного скачка больше четверти пути за кадр: PageDown дал бы ровно один такой.
  for (let i = 1; i < positions.length; i++) {
    const jump = positions[i] - positions[i - 1];
    assert.ok(jump <= 225, `скачок ${jump} px за кадр на позиции ${i}`);
  }
});
