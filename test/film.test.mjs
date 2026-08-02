import { test } from 'node:test';
import assert from 'node:assert/strict';
import { filmFps, visibleSticky, planCamera, buildFilm, buildHighlightFilm }
  from '../studio/compose/film.mjs';

const VIEWPORT = { width: 1440, height: 810 };

/** Состояние как его пишет shoot.mjs; высота страницы задаётся в пикселях снимка (2×). */
const state = (over = {}) => ({
  id: 'p01', plan: 1, label: 'Ваша медиатека', mode: 'static',
  body: 'states/p01-body.jpg', layer: 'states/p01-layer.jpg',
  size: { w: 2880, h: 6152 }, viewport: VIEWPORT, scale: 2,
  sticky: [], anchors: [], settle: { waitedMs: 100, reason: null },
  ...over,
});

const scenario = { title: 'Демо', steps: [
  { n: 1, label: 'Ваша медиатека', seconds: 8 },
  { n: 2, label: 'Поиск', seconds: 6 },
] };

test('частота: все статичные — 30', () => {
  assert.equal(filmFps([state(), state({ id: 'p02', plan: 2 })]), 30);
});

test('частота: один живой — весь ролик 25', () => {
  // Пересчёт 25 в 30 дублированием — та судорога, ради которой всё затевалось.
  assert.equal(filmFps([state(), state({ id: 'p02', plan: 2, mode: 'live' })]), 25);
});

test('липкие: контейнер во весь экран отфильтрован', () => {
  // В mc-медиа есть fixed-div 1440×810 — портал для тостов. Нарисовать его слоем
  // значит накрыть панораму неподвижной копией экрана.
  const bands = [
    { edge: 'top', x: 0, y: 0, w: 1440, h: 49, tag: 'header', position: 'sticky' },
    { edge: 'top', x: 0, y: 0, w: 1440, h: 810, tag: 'div', position: 'fixed' },
  ];
  assert.deepEqual(visibleSticky(bands, VIEWPORT).map((b) => b.tag), ['header']);
});

test('липкие: полоса за правым краем вьюпорта отфильтрована', () => {
  // Выдвижная панель стоит на x=1440 — в кадре её нет, кроп из слоя был бы пустым.
  const bands = [
    { edge: 'right', x: 1440, y: 0, w: 420, h: 810, tag: 'aside', position: 'fixed' },
    { edge: 'left', x: 0, y: 49, w: 76, h: 762, tag: 'aside', position: 'sticky' },
  ];
  assert.deepEqual(visibleSticky(bands, VIEWPORT).map((b) => b.edge), ['left']);
});

test('камера: якорь → наезд в CSS-координатах', () => {
  const st = state({ anchors: [
    { selector: 'text=БОЕВИКИ', rect: { x: 2000, y: 1200, w: 200, h: 80 } },
  ] });
  const cam = planCamera(st, 8);
  assert.equal(cam.kind, 'push');
  // Центр якоря из шкалы снимка (2×) в CSS-шкалу вьюпорта.
  assert.equal(cam.anchor.cx, 1050);   // (2000 + 200/2) / 2
  assert.equal(cam.anchor.cy, 620);    // (1200 + 80/2) / 2
  assert.equal(cam.depth, 1.26);
});

test('камера: длинная страница без якоря → панорама, дистанция ограничена страницей', () => {
  const cam = planCamera(state(), 8);
  assert.equal(cam.kind, 'pan');
  // Страница 6152/2 = 3076 CSS px, вьюпорт 810 → дальше 2266 ехать некуда,
  // хотя 600 px/с за окно движения успели бы больше.
  assert.equal(cam.to, 2266);
});

test('камера: короткий план едет медленнее, а не столько же', () => {
  const cam = planCamera(state(), 4);
  // Окно движения 4 − 0.6 − 1.6 = 1.8 с → 600 px/с × 1.8 = 1080.
  assert.equal(cam.to, 1080);
});

test('камера: страница в один экран → дрейф', () => {
  const st = state({ size: { w: 2880, h: 1620 } });
  assert.equal(planCamera(st, 6).kind, 'drift');
});

test('плёнка: планы встык, длительности из сценария', () => {
  const film = buildFilm(
    { viewport: VIEWPORT, live: null, states: [state(), state({ id: 'p02', plan: 2, label: 'Поиск' })] },
    scenario,
  );
  assert.equal(film.fps, 30);
  assert.equal(film.seconds, 14);
  assert.deepEqual(film.plans.map((p) => [p.from, p.to]), [[0, 8], [8, 14]]);
  assert.equal(film.plans[1].title.text, 'Поиск');
});

test('плёнка: план с якорем получает курсор и щелчок для звука', () => {
  const st = state({ anchors: [{ selector: 'x', rect: { x: 2000, y: 1200, w: 200, h: 80 } }] });
  const film = buildFilm({ viewport: VIEWPORT, live: null, states: [st] },
                         { title: 'Демо', steps: [{ n: 1, label: 'Клик', seconds: 6 }] });
  assert.equal(film.plans[0].cursor.x, 1050);
  assert.equal(film.plans[0].cursor.at, 1.5);       // CLICK_AT от начала плана
  assert.deepEqual(film.clicks, [{ t: 1.5 }]);
});

test('плёнка: живой план — отказ с объяснением, а не молчаливый пропуск', () => {
  const manifest = { viewport: VIEWPORT, live: { video: 'x.webm', ranges: [] },
                     states: [state({ mode: 'live' })] };
  assert.throws(() => buildFilm(manifest, scenario), /старым монтажом/);
});

test('плёнка: шаг без seconds получает 6 по умолчанию', () => {
  const film = buildFilm({ viewport: VIEWPORT, live: null, states: [state()] },
                         { title: 'Демо', steps: [{ n: 1, label: 'Без секунд' }] });
  assert.equal(film.plans[0].to, 6);
});

const longFilm = () => buildFilm(
  { viewport: VIEWPORT, live: null, states: [
    state(),                                                          // панорама
    state({ id: 'p02', plan: 2, label: 'Клик',
            anchors: [{ selector: 'x', rect: { x: 2000, y: 1200, w: 200, h: 80 } }] }),
    state({ id: 'p03', plan: 3, label: 'Финал', size: { w: 2880, h: 1620 } }),
  ] },
  { title: 'Демо', steps: [
    { n: 1, label: 'Лента', seconds: 8 },
    { n: 2, label: 'Клик', seconds: 6 },
    { n: 3, label: 'Финал', seconds: 7 },
  ] },
);

test('хайлайты: действие важнее пейзажа, бюджет соблюдён', () => {
  const hl = buildHighlightFilm(longFilm(), { seconds: 7 });
  // Бюджет на два клипа по 3.2 c: действие + первый план; финал не влез.
  assert.deepEqual(hl.plans.map((p) => p.id), ['p01', 'p02']);
  assert.ok(hl.seconds <= 7 + 0.01);
  // Планы перенумерованы встык.
  assert.deepEqual(hl.plans.map((p) => [p.from, p.to]), [[0, 3.2], [3.2, 6.4]]);
});

test('хайлайты: щелчки пересчитаны в новую шкалу', () => {
  const hl = buildHighlightFilm(longFilm(), { seconds: 7 });
  // Клик был на CLICK_AT от начала своего плана; план p02 теперь начинается на 3.2.
  assert.deepEqual(hl.clicks, [{ t: 3.2 + 1.5 }]);
});

test('хайлайты: панорама укорочена — дистанция пересчитана под 3.2 секунды', () => {
  const hl = buildHighlightFilm(longFilm(), { seconds: 7 });
  const pan = hl.plans[0].camera;
  assert.equal(pan.kind, 'pan');
  // Окно 3.2 − 0.6 − 1.6 = 1.0 c → 600 px.
  assert.equal(pan.to, 600);
});
