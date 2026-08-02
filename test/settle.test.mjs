import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { settleVerdict, waitUntilSettled, STABLE_ENOUGH } from '../studio/lib/settle.mjs';

test('всё сошлось — экран готов', () => {
  const v = settleVerdict({ selectorOk: true, networkIdle: true, diff: 0 });
  assert.equal(v.settled, true);
  assert.equal(v.reason, null);
});

test('селектор не появился — ждём его, что бы ни говорила картинка', () => {
  const v = settleVerdict({ selectorOk: false, networkIdle: true, diff: 0 });
  assert.equal(v.settled, false);
  assert.equal(v.reason, 'селектор');
});

test('сеть ещё работает — ждём', () => {
  const v = settleVerdict({ selectorOk: true, networkIdle: false, diff: 0 });
  assert.equal(v.settled, false);
  assert.equal(v.reason, 'сеть');
});

test('картинка ещё меняется — ждём', () => {
  // Ровно этот случай давал скелетоны в кадре: сеть молчит, селектор есть,
  // а постеры ещё дорисовываются.
  const v = settleVerdict({ selectorOk: true, networkIdle: true, diff: 0.2 });
  assert.equal(v.settled, false);
  assert.equal(v.reason, 'картинка');
});

test('порог стабильности — половина процента', () => {
  assert.equal(STABLE_ENOUGH, 0.005);
  assert.equal(settleVerdict({ selectorOk: true, networkIdle: true, diff: 0.004 }).settled, true);
  assert.equal(settleVerdict({ selectorOk: true, networkIdle: true, diff: 0.006 }).settled, false);
});

test('без признака готовности в плане его условие не блокирует', () => {
  const v = settleVerdict({ selectorOk: null, networkIdle: true, diff: 0 });
  assert.equal(v.settled, true);
});

test('причина называется самая содержательная из невыполненных', () => {
  // Не сошлось всё сразу — человеку полезнее «селектор», чем «картинка».
  const v = settleVerdict({ selectorOk: false, networkIdle: false, diff: 0.9 });
  assert.equal(v.reason, 'селектор');
});

test('ждёт, пока экран действительно догрузится, и говорит сколько ждал', async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 400, height: 300 } });
  // Страница дорисовывает содержимое через 800 мс — это и есть скелетон в кадре.
  await page.setContent(`
    <body style="margin:0;background:#111">
      <div id="skeleton" style="width:400px;height:300px;background:#222"></div>
      <script>
        setTimeout(() => {
          document.getElementById('skeleton').remove();
          const d = document.createElement('div');
          d.id = 'ready';
          d.textContent = 'ГОТОВО';
          d.style.cssText = 'color:#fff;font:48px sans-serif;background:#fff;width:400px;height:300px';
          document.body.appendChild(d);
        }, 800);
      </script>
    </body>`);

  const t0 = Date.now();
  const r = await waitUntilSettled(page, { waitFor: '#ready', timeout: 10000 });
  const elapsed = Date.now() - t0;

  assert.equal(r.reason, null, 'ожидание не сошлось');
  assert.ok(elapsed >= 800, `вернулся за ${elapsed} мс — раньше, чем экран догрузился`);
  assert.ok(r.waitedMs >= 800);
  assert.equal(await page.locator('#ready').isVisible(), true);

  await browser.close();
});

test('не сошлось за отведённое время — возвращает причину, а не бросает', async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 200, height: 150 } });
  await page.setContent('<body style="background:#000"></body>');

  const r = await waitUntilSettled(page, { waitFor: '#никогда-не-появится', timeout: 1500 });
  assert.match(r.reason, /таймаут/);
  assert.match(r.reason, /селектор/);

  await browser.close();
});

test('живая сеть не блокирует навсегда: после грации условие снимается', async () => {
  // Mission Control держит постоянные соединения — networkidle у него не наступает
  // никогда. Первая версия висела на этом по тридцать секунд на каждом шаге.
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 300, height: 200 } });
  await page.setContent(`
    <body style="margin:0;background:#111">
      <div id="ready" style="width:300px;height:200px;background:#2a2a2a"></div>
      <script>
        // Бесконечный поток запросов — ровно то, что делает живое приложение.
        setInterval(() => fetch('data:text/plain,тик').catch(() => {}), 60);
      </script>
    </body>`);

  const t0 = Date.now();
  const r = await waitUntilSettled(page, { waitFor: '#ready', timeout: 12000 });
  const elapsed = Date.now() - t0;

  assert.equal(r.reason, null, `не сошлось: ${r.reason}`);
  assert.ok(elapsed < 6000, `ждал ${elapsed} мс — сеть всё ещё блокирует`);

  await browser.close();
});
