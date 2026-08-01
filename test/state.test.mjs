import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { captureState } from '../studio/lib/state.mjs';

const run = promisify(execFile);
const VIEWPORT = { width: 600, height: 400 };

/** Длинная страница: липкая шапка, якорь глубоко внизу, счётчик максимальной прокрутки. */
const PAGE = `
  <body style="margin:0;background:#0e1116;color:#eee;font:14px sans-serif">
    <header id="шапка" style="position:sticky;top:0;height:44px;background:#232a35">шапка</header>
    <div style="height:1800px;padding:16px">верхняя часть</div>
    <button id="цель" style="height:36px;width:180px">Жанры</button>
    <div style="height:1800px;padding:16px">нижняя часть</div>
    <script>
      window.__maxScroll = 0;
      addEventListener('scroll', () => {
        window.__maxScroll = Math.max(window.__maxScroll, Math.round(window.scrollY));
      });
    </script>
  </body>`;

async function open() {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: VIEWPORT, deviceScaleFactor: 2 });
  await page.setContent(PAGE);
  return { browser, page };
}

const sizeOf = async (file) => {
  const { stdout } = await run('ffprobe', ['-v', 'error', '-show_entries',
    'stream=width,height', '-of', 'csv=p=0', file]);
  const [w, h] = stdout.trim().replace(/,$/, '').split(',').map(Number);
  return { w, h };
};

test('отдаёт тело страницы и слой липких отдельными файлами', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'takt-state-'));
  const { browser, page } = await open();

  const state = await captureState(page, { id: 's1', dir, anchors: ['#цель'] });
  await browser.close();

  assert.ok(fs.existsSync(state.body), 'нет снимка тела');
  assert.ok(fs.existsSync(state.layer), 'нет снимка слоя');

  const body = await sizeOf(state.body);
  const layer = await sizeOf(state.layer);

  assert.equal(body.w, VIEWPORT.width * 2, 'тело снято не в двойном разрешении');
  assert.ok(body.h > VIEWPORT.height * 2 * 5, `тело всего ${body.h} — страница не целиком`);
  assert.equal(layer.w, VIEWPORT.width * 2);
  assert.equal(layer.h, VIEWPORT.height * 2, 'слой должен быть ровно вьюпортом');
  assert.deepEqual(state.size, body);

  fs.rmSync(dir, { recursive: true, force: true });
});

test('перед снимком проходит страницу до низа — иначе ленивые картинки не догрузятся', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'takt-state-'));
  const { browser, page } = await open();

  await captureState(page, { id: 's1', dir });
  const max = await page.evaluate(() => window.__maxScroll);
  const finalY = await page.evaluate(() => Math.round(window.scrollY));
  const reachable = await page.evaluate(() =>
    Math.round(document.documentElement.scrollHeight - window.innerHeight));
  await browser.close();

  assert.ok(max >= reachable - 5, `дошли только до ${max} из ${reachable}`);
  assert.equal(finalY, 0, 'страница не возвращена наверх — снимок слоя будет не тот');

  fs.rmSync(dir, { recursive: true, force: true });
});

test('якорь ниже сгиба записан в координатах снимка тела', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'takt-state-'));
  const { browser, page } = await open();

  const expected = await page.evaluate(() => {
    const r = document.querySelector('#цель').getBoundingClientRect();
    return Math.round(r.y + window.scrollY);
  });
  const state = await captureState(page, { id: 's1', dir, anchors: ['#цель'] });
  await browser.close();

  assert.equal(state.anchors.length, 1);
  const a = state.anchors[0];
  assert.equal(a.selector, '#цель');
  // Координаты — в шкале снимка тела, то есть умножены на плотность.
  assert.ok(Math.abs(a.rect.y - expected * 2) < 6,
    `y=${a.rect.y}, ожидалось около ${expected * 2}`);
  assert.ok(a.rect.y > VIEWPORT.height * 2, 'якорь оказался в пределах первого экрана');

  fs.rmSync(dir, { recursive: true, force: true });
});

test('липкие найдены, описаны краем и не попали в тело', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'takt-state-'));
  const { browser, page } = await open();
  const state = await captureState(page, { id: 's1', dir });

  // После съёмки липкие обязаны быть видимы снова: съёмка не должна портить страницу.
  const visibility = await page.evaluate(() =>
    getComputedStyle(document.querySelector('#шапка')).visibility);
  await browser.close();

  assert.equal(state.sticky.length, 1);
  assert.equal(state.sticky[0].edge, 'top');
  assert.equal(visibility, 'visible', 'страница осталась испорченной после съёмки');

  fs.rmSync(dir, { recursive: true, force: true });
});

test('отсутствующий якорь не ломает съёмку, а попадает в состояние как ненайденный', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'takt-state-'));
  const { browser, page } = await open();
  const state = await captureState(page, { id: 's1', dir, anchors: ['#нет-такого'] });
  await browser.close();

  assert.equal(state.anchors.length, 1);
  assert.equal(state.anchors[0].rect, null);

  fs.rmSync(dir, { recursive: true, force: true });
});
