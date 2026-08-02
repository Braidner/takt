import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkStates } from '../studio/lib/inspect.mjs';

const STATE_OK = {
  id: 's1', label: 'Медиатека',
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
  assert.equal(issues[0].plan, 's1');
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
  const bad = { ...STATE_OK, id: 's2', settle: { waitedMs: 30000, reason: 'таймаут: сеть' } };
  const issues = checkStates([STATE_OK, bad]);
  assert.equal(issues.length, 1);
  assert.equal(issues[0].plan, 's2');
});
