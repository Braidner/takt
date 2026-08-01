import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  checkLoading, checkJumps, checkAnchors, checkDrops, inspect, JUMP_THRESHOLD,
} from '../studio/lib/inspect.mjs';

const VIEWPORT = { width: 1440, height: 810 };

test('шаг, где ожидание не сошлось, попадает в отчёт', () => {
  const issues = checkLoading([
    { n: 1, label: 'Медиатека', settle: { waitedMs: 900, reason: null } },
    { n: 4, label: 'Дискавери', settle: { waitedMs: 30000, reason: 'таймаут: картинка' } },
  ]);
  assert.equal(issues.length, 1);
  assert.equal(issues[0].step, 4);
  assert.match(issues[0].text, /картинка/);
  assert.match(issues[0].text, /Дискавери/);
});

test('чистый дубль не даёт замечаний по загрузке', () => {
  assert.deepEqual(checkLoading([{ n: 1, settle: { waitedMs: 500, reason: null } }]), []);
});

test('шаг без данных об ожидании замечания не даёт', () => {
  assert.deepEqual(checkLoading([{ n: 1 }]), []);
});

test('скачок содержимого вне склейки — замечание', () => {
  const diffs = [{ t: 1.0, diff: 0.02 }, { t: 2.0, diff: 0.9 }];
  const issues = checkJumps(diffs, [], JUMP_THRESHOLD);
  assert.equal(issues.length, 1);
  assert.equal(issues[0].at, 2.0);
});

test('запланированная склейка скачком не считается', () => {
  const diffs = [{ t: 2.0, diff: 0.9 }];
  assert.deepEqual(checkJumps(diffs, [{ from: 1.8, to: 2.2 }], JUMP_THRESHOLD), []);
});

test('порог скачка настраивается', () => {
  const diffs = [{ t: 1.0, diff: 0.5 }];
  assert.equal(checkJumps(diffs, [], 0.35).length, 1);
  assert.equal(checkJumps(diffs, [], 0.8).length, 0);
});

test('порог по умолчанию — тридцать пять процентов', () => {
  assert.equal(JUMP_THRESHOLD, 0.35);
});

test('якорь вне кадра — замечание с номером шага', () => {
  const anchors = [{
    step: 6, selector: 'button.genre',
    rects: [{ t: 37.0, x: 177, y: 3673, w: 90, h: 28 }],
  }];
  const issues = checkAnchors(anchors, VIEWPORT);
  assert.equal(issues.length, 1);
  assert.equal(issues[0].step, 6);
  assert.match(issues[0].text, /не попала в кадр/);
});

test('якорь, побывавший в кадре хоть раз, замечания не даёт', () => {
  const anchors = [{
    step: 6, selector: 'button.genre',
    rects: [
      { t: 37.0, x: 177, y: 3673, w: 90, h: 28 },
      { t: 37.4, x: 177, y: 420, w: 90, h: 28 },
    ],
  }];
  assert.deepEqual(checkAnchors(anchors, VIEWPORT), []);
});

test('якорь без единой пробы — замечание: элемента не нашли', () => {
  const issues = checkAnchors([{ step: 3, selector: '.нет-такого', rects: [] }], VIEWPORT);
  assert.equal(issues.length, 1);
});

test('пропуск кадров виден по интервалу', () => {
  // 30 к/с — период 33 мс, полтора периода это 50 мс.
  const issues = checkDrops([0, 33, 66, 200, 233], 30);
  assert.equal(issues.length, 1);
  assert.match(issues[0].text, /кадр/);
});

test('ровная запись пропусков не даёт', () => {
  assert.deepEqual(checkDrops([0, 33, 66, 99, 132], 30), []);
});

test('полный отчёт собирает все четыре проверки и говорит, чист ли дубль', () => {
  const clean = inspect({
    viewport: VIEWPORT, fps: 30,
    steps: [{ n: 1, settle: { waitedMs: 400, reason: null } }],
    diffs: [{ t: 1, diff: 0.01 }],
    anchors: [{ step: 1, selector: 'button', rects: [{ t: 1, x: 10, y: 10, w: 40, h: 20 }] }],
    frameTimes: [0, 33, 66],
  });
  assert.equal(clean.ok, true);
  assert.equal(clean.issues.length, 0);

  const dirty = inspect({
    viewport: VIEWPORT, fps: 30,
    steps: [{ n: 2, label: 'Жанры', settle: { waitedMs: 30000, reason: 'таймаут: сеть' } }],
    diffs: [{ t: 5, diff: 0.9 }],
    anchors: [{ step: 2, selector: 'button', rects: [{ t: 5, x: 10, y: 5000, w: 40, h: 20 }] }],
    frameTimes: [0, 33, 400],
  });
  assert.equal(dirty.ok, false);
  assert.equal(dirty.issues.length, 4, 'сработали не все четыре проверки');
  assert.deepEqual(
    [...new Set(dirty.issues.map((i) => i.kind))].sort(),
    ['загрузка', 'пропуск', 'скачок', 'якорь'],
  );
});

test('отчёт по пустому дублю не падает', () => {
  const r = inspect({ viewport: VIEWPORT });
  assert.equal(r.ok, true);
});

/* ── проверки состояний ─────────────────────────────────────────────── */

import { checkStates } from '../studio/lib/inspect.mjs';

const STATE_OK = {
  id: 's1', plan: 1, label: 'Медиатека',
  size: { w: 2880, h: 8278 }, viewport: { width: 1440, height: 810 }, scale: 2,
  sticky: [{ edge: 'top', w: 2880, h: 98 }],
  layer: 'states/s1-layer.jpg',
  anchors: [{ selector: 'button', rect: { x: 100, y: 4000, w: 180, h: 72 } }],
  settle: { waitedMs: 600, reason: null },
};

test('чистое состояние замечаний не даёт', () => {
  assert.deepEqual(checkStates([STATE_OK]), []);
});

test('ожидание не сошлось — замечание с причиной и планом', () => {
  const s = { ...STATE_OK, settle: { waitedMs: 30000, reason: 'таймаут: картинка' } };
  const issues = checkStates([s]);
  assert.equal(issues.length, 1);
  assert.equal(issues[0].kind, 'загрузка');
  assert.equal(issues[0].step, 1);
  assert.match(issues[0].text, /картинка/);
});

test('якорь не найден — наезжать не на что', () => {
  const s = { ...STATE_OK, anchors: [{ selector: '.нет', rect: null }] };
  const issues = checkStates([s]);
  assert.equal(issues.length, 1);
  assert.equal(issues[0].kind, 'якорь');
  assert.match(issues[0].text, /не найдена/);
});

test('якорь за пределами снимка — тоже замечание', () => {
  // Такое бывает, когда элемент виден только после раскрытия меню.
  const s = { ...STATE_OK, anchors: [{ selector: 'button', rect: { x: 100, y: 9000, w: 180, h: 72 } }] };
  const issues = checkStates([s]);
  assert.equal(issues.length, 1);
  assert.match(issues[0].text, /за пределами/);
});

test('страница короче экрана — подозрение, что не догрузилась', () => {
  const s = { ...STATE_OK, size: { w: 2880, h: 900 }, anchors: [] };
  const issues = checkStates([s]);
  assert.equal(issues.length, 1);
  assert.equal(issues[0].kind, 'пусто');
});

test('короткая страница заодно выбрасывает якоря за свои пределы — сообщаем обо всём', () => {
  // Не «одна беда — одно замечание»: человеку нужны все следствия сразу, иначе он
  // починит первое, переснимет и наткнётся на второе.
  const s = { ...STATE_OK, size: { w: 2880, h: 900 } };
  const kinds = checkStates([s]).map((i) => i.kind).sort();
  assert.deepEqual(kinds, ['пусто', 'якорь']);
});

test('липкие есть, а слоя нет — панорама поедет вместе с шапкой', () => {
  const s = { ...STATE_OK, layer: null };
  const issues = checkStates([s]);
  assert.equal(issues.length, 1);
  assert.equal(issues[0].kind, 'слой');
});

test('несколько состояний проверяются независимо', () => {
  const bad = { ...STATE_OK, id: 's2', plan: 2, settle: { waitedMs: 30000, reason: 'таймаут: сеть' } };
  const issues = checkStates([STATE_OK, bad]);
  assert.equal(issues.length, 1);
  assert.equal(issues[0].step, 2);
});
