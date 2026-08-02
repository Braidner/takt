import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildFilm, buildHighlightFilm, visibleSticky } from '../studio/compose/film.mjs';
import { normalizeStoryboard } from '../studio/compose/storyboard.mjs';
import { directStoryboard } from '../studio/compose/director.mjs';

const VIEWPORT = { width: 1440, height: 810 };

/** Состояние как его пишет съёмка: снимок вдвое плотнее, страница в семь экранов. */
const state = (over = {}) => ({
  id: 'p01', mode: 'static',
  body: 'states/p01-body.jpg', layer: 'states/p01-layer.jpg',
  size: { w: 2880, h: 6152 }, viewport: VIEWPORT, scale: 2,
  sticky: [], anchors: [], settle: { waitedMs: 100, reason: null },
  ...over,
});

const anchor = (selector, rect) => ({ selector, rect });

/** Раскадровка с расставленными эффектами — как она приходит из студии. */
const board = (plans, states) =>
  directStoryboard(normalizeStoryboard({ title: 'Демо', slate: false, plans }), states);

const manifest = (states) => ({ viewport: VIEWPORT, live: null, states });

test('плёнка: планы встык, частота и хронометраж из раскадровки', () => {
  const states = [state(), state({ id: 'p02' })];
  const sb = board([
    { title: { text: 'Лента' }, action: { kind: 'hold', seconds: 4 } },
    { title: { text: 'Поиск' }, action: { kind: 'hold', seconds: 2 } },
  ], states);
  const film = buildFilm(manifest(states), sb);

  assert.equal(film.fps, 30);
  assert.equal(film.seconds, sb.seconds);
  assert.deepEqual(film.plans.map((p) => [p.from, p.to]), [[0, 7.2], [7.2, 12.4]]);
  assert.equal(film.plans[1].title.text, 'Поиск');
});

test('камера: наезд получает координаты, разрешив селектор по снятому состоянию', () => {
  // Одно место, где якорь превращается в цель: селектор живёт в эффекте,
  // прямоугольник — в состоянии, и встречаются они здесь.
  const states = [state({ anchors: [anchor('text=Жанры', { x: 2000, y: 1200, w: 200, h: 80 })] })];
  const sb = board([{ title: { text: 'Клик' },
                      action: { kind: 'click', selector: 'text=Жанры' } }], states);
  const cam = buildFilm(manifest(states), sb).plans[0].camera;

  assert.equal(cam.kind, 'push');
  assert.equal(cam.cx, 1050);        // (2000 + 200/2) / 2 — из шкалы снимка в CSS
  assert.equal(cam.cy, 620);
  assert.equal(cam.depth, 1.26);
  assert.equal(cam.from, 0.6);
});

test('камера: якорь вне снимка не даёт наезда в пустоту, а называет план', () => {
  // Ровно тот дефект, ради которого всё затевалось: камера наезжала туда,
  // где уже другой экран, и ни одной ошибки при этом не было.
  const states = [state({ anchors: [anchor('text=Жанры', null)] })];
  const sb = board([{ title: { text: 'Клик мимо' },
                      action: { kind: 'click', selector: 'text=Жанры' } }], states);
  const film = buildFilm(manifest(states), sb);

  assert.equal(film.plans[0].camera.kind, 'drift');
  assert.equal(film.plans[0].cursor, null);
  assert.equal(film.issues.length, 1);
  assert.match(film.issues[0].text, /Клик мимо/);
});

test('панорама: дистанция считается из скорости и окна движения', () => {
  const states = [state()];
  const sb = board([{ title: { text: 'Лента' }, action: { kind: 'hold', seconds: 4 } }], states);
  const cam = buildFilm(manifest(states), sb).plans[0].camera;

  assert.equal(cam.kind, 'pan');
  // Окно 0.6…4.6 при 600 px/с — 2400, но страница даёт проехать только 2266.
  assert.equal(cam.distance, 2266);
});

test('панорама: правка окна человеком меняет дистанцию, а не игнорируется', () => {
  const states = [state()];
  const sb = normalizeStoryboard({ title: 'Демо', slate: false,
    plans: [{ title: { text: 'Лента' }, action: { kind: 'hold', seconds: 4 } }],
    effects: [{ id: 'мой', plan: 'p01', kind: 'camera', at: { from: 0.6, to: 2.6 },
                anchor: null, params: { move: 'pan', speed: 300 }, source: 'manual' }] });
  const cam = buildFilm(manifest(states), sb).plans[0].camera;

  assert.equal(cam.distance, 600);   // 300 px/с × 2 с
  assert.equal(cam.to, 2.6);
});

test('курсор: появляется у цели действия и щёлкает внутри плана', () => {
  const states = [state({ anchors: [anchor('input', { x: 400, y: 600, w: 800, h: 60 })] })];
  const sb = board([{ title: { text: 'Ввод' },
                      action: { kind: 'type', selector: 'input', text: 'одиссея' } }], states);
  const film = buildFilm(manifest(states), sb);

  assert.equal(film.plans[0].cursor.x, 400);   // (400 + 800/2) / 2
  assert.ok(film.plans[0].cursor.at > 0.6 && film.plans[0].cursor.at < film.plans[0].to);
  assert.deepEqual(film.clicks, [{ t: film.plans[0].cursor.at }]);
});

test('склейка: длительность берётся из эффекта, а не из константы', () => {
  const states = [state(), state({ id: 'p02' })];
  const sb = board([
    { title: { text: 'Первый' }, action: { kind: 'hold', seconds: 2 } },
    { title: { text: 'Второй' }, action: { kind: 'hold', seconds: 2 } },
  ], states);
  assert.equal(Math.round(sb.effects.find((e) => e.kind === 'transition').params.style === 'dissolve'), 1);

  const film = buildFilm(manifest(states), sb);
  assert.equal(Math.round((film.plans[0].transition.to - film.plans[0].transition.from) * 100) / 100, 0.35);
  assert.equal(film.plans[1].transition, null);   // последнему склеиваться не с чем
});

test('липкие: контейнер во весь экран и полоса за краем отброшены', () => {
  const bands = [
    { edge: 'top', x: 0, y: 0, w: 1440, h: 49, tag: 'header' },
    { edge: 'top', x: 0, y: 0, w: 1440, h: 810, tag: 'div' },
    { edge: 'right', x: 1440, y: 0, w: 420, h: 810, tag: 'aside' },
  ];
  assert.deepEqual(visibleSticky(bands, VIEWPORT).map((b) => b.tag), ['header']);
});

test('плёнка: план без снятого состояния пропускается с замечанием', () => {
  const states = [state()];
  const sb = board([
    { title: { text: 'Снятый' }, action: { kind: 'hold', seconds: 2 } },
    { title: { text: 'Неснятый' }, action: { kind: 'hold', seconds: 2 } },
  ], states);
  const film = buildFilm(manifest(states), sb);

  assert.deepEqual(film.plans.map((p) => p.id), ['p01']);
  assert.match(film.issues.find((i) => /Неснятый/.test(i.text)).text, /не снят/);
});

test('хайлайты: действие важнее пейзажа, бюджет соблюдён', () => {
  const states = [state(),
                  state({ id: 'p02', anchors: [anchor('x', { x: 400, y: 600, w: 80, h: 40 })] }),
                  state({ id: 'p03' })];
  const sb = board([
    { title: { text: 'Лента' }, action: { kind: 'hold', seconds: 4 } },
    { title: { text: 'Клик' }, action: { kind: 'click', selector: 'x' } },
    { title: { text: 'Финал' }, action: { kind: 'hold', seconds: 2 } },
  ], states);
  const hl = buildHighlightFilm(buildFilm(manifest(states), sb), { seconds: 7 });

  assert.deepEqual(hl.plans.map((p) => p.id), ['p01', 'p02']);
  assert.deepEqual(hl.plans.map((p) => [p.from, p.to]), [[0, 3.2], [3.2, 6.4]]);
});

test('хайлайты: укороченный план едет меньше, а не быстрее', () => {
  const states = [state()];
  const sb = board([{ title: { text: 'Лента' }, action: { kind: 'hold', seconds: 4 } }], states);
  const hl = buildHighlightFilm(buildFilm(manifest(states), sb), { seconds: 4 });

  // Окно клипа 3.2 − 0.6 − 2.6 = 0 … панорама сжимается до нуля и уступает дрейфу.
  assert.ok(hl.plans[0].camera.distance <= 600, `distance=${hl.plans[0].camera.distance}`);
});

test('заставка и финал встают по краям и входят в хронометраж', () => {
  const states = [state()];
  const sb = board([{ title: { text: 'Лента' }, action: { kind: 'hold', seconds: 2 } }], states);
  const film = buildFilm(manifest(states), { ...sb, title: 'Демо', slate: true, task: 'о чём ролик' });

  assert.deepEqual(film.plans.map((p) => p.id), ['slate', 'p01', 'end']);
  assert.equal(film.plans[0].kind, 'card');
  assert.equal(film.plans[0].text, 'Демо');
  assert.equal(film.plans[0].subtitle, 'о чём ролик');
  assert.equal(film.plans[2].card, 'end');
  // Заставка входит в хронометраж: иначе таймкоды замечаний разъедутся с картинкой.
  assert.equal(film.plans[1].from, 2.6);
  assert.equal(film.seconds, 2.6 + sb.seconds + 2.2);
});

test('заставка склеивается с первым планом, финал ни с чем', () => {
  const states = [state()];
  const film = buildFilm(manifest(states),
    { ...board([{ title: { text: 'Лента' }, action: null }], states),
      title: 'Демо', slate: true });
  assert.equal(film.plans[0].transition.style, 'dissolve');
  assert.equal(film.plans.at(-1).transition, null);
});

test('без названия карточек нет: обложке неоткуда взяться', () => {
  const states = [state()];
  const sb = board([{ title: { text: 'Лента' }, action: null }], states);
  const film = buildFilm(manifest(states), { ...sb, title: '', slate: true });
  assert.deepEqual(film.plans.map((p) => p.id), ['p01']);
});

test('хайлайты карточек не берут', () => {
  const states = [state(), state({ id: 'p02' })];
  const sb = board([
    { title: { text: 'Первый' }, action: { kind: 'hold', seconds: 2 } },
    { title: { text: 'Второй' }, action: { kind: 'hold', seconds: 2 } },
  ], states);
  const film = buildFilm(manifest(states), { ...sb, title: 'Демо', slate: true });
  const hl = buildHighlightFilm(film, { seconds: 25 });
  assert.deepEqual(hl.plans.map((p) => p.id), ['p01', 'p02']);
});

const liveManifest = (states) => ({ viewport: VIEWPORT, live: null, states });

/** Живой план — это состояние с вырезанным куском записи вместо снимка. */
const liveState = (over = {}) => state({ id: 'p02', mode: 'live',
  video: 'states/p02.mp4', seconds: 4, ...over });

const liveBoard = () => directStoryboard(normalizeStoryboard({
  title: 'Демо', slate: false,
  plans: [
    { title: { text: 'Статичный' }, action: { kind: 'hold', seconds: 2 } },
    { title: { text: 'Живой' }, mode: 'live', action: { kind: 'hold', seconds: 3 } },
  ],
}), [state()]);

test('живой план играет свой вырезанный отрезок с нуля', () => {
  const film = buildFilm(liveManifest([state(), liveState()]), liveBoard());

  assert.equal(film.fps, 25, 'один живой план переводит весь ролик в 25 кадров');
  const живой = film.plans.find((p) => p.id === 'p02');
  assert.equal(живой.kind, 'live');
  assert.equal(живой.video, 'states/p02.mp4');
  // По сплошной записи браузер мотать не умеет — там нет индекса, поэтому съёмка
  // режет отрезок в свой файл, и он начинается со своего нуля.
  assert.equal(живой.videoFrom, 0);
});

test('живой план без отрезка записи пропускается с замечанием', () => {
  const film = buildFilm(liveManifest([state(), state({ id: 'p02', mode: 'live' })]), liveBoard());
  assert.deepEqual(film.plans.map((p) => p.id), ['p01']);
  assert.match(film.issues[0].text, /Живой/);
});

test('камера по живому отрезку не ездит', () => {
  // В кадре и так движение: наезд поверх него читается как тряска.
  const film = buildFilm(liveManifest([state(), liveState()]), liveBoard());
  assert.equal(film.plans.find((p) => p.id === 'p02').camera.kind, 'drift');
});

test('длительность живого плана задаёт запись, а не раскадровка', () => {
  // Снятое движение нельзя растянуть: показывать после него застывший последний
  // кадр значит выдать за живой план стоп-кадр.
  const film = buildFilm(liveManifest([state(), liveState()]), liveBoard());
  const живой = film.plans.find((p) => p.id === 'p02');
  assert.ok(Math.abs((живой.to - живой.from) - 4) < 0.01);   // столько записалось
});

const withOverlay = (what, extra = {}) => normalizeStoryboard({
  title: 'Демо', slate: false,
  plans: [{ title: { text: 'Клик' }, action: { kind: 'click', selector: 'text=Жанры' } }],
  effects: [{ id: 'o1', plan: 'p01', kind: 'overlay', at: { from: 1, to: 3 },
              anchor: 'text=Жанры', params: { what, ...extra }, source: 'manual' }],
});

const anchored = () => state({
  anchors: [anchor('text=Жанры', { x: 2000, y: 1200, w: 200, h: 80 })],
});

test('наложение целится селектором и получает прямоугольник, а не точку', () => {
  // Подсветить и размыть можно только область: центр для этого не годится.
  const states = [anchored()];
  const film = buildFilm(manifest(states), withOverlay('spotlight'));
  const [o] = film.plans[0].overlays;

  assert.equal(o.what, 'spotlight');
  assert.deepEqual(o.rect, { x: 1000, y: 600, w: 100, h: 40 });
  assert.equal(o.from, 1);
  assert.equal(o.to, 3);
});

test('выноска несёт свой текст', () => {
  const states = [anchored()];
  const film = buildFilm(manifest(states), withOverlay('callout', { text: 'вот сюда' }));
  assert.equal(film.plans[0].overlays[0].text, 'вот сюда');
});

test('наложение без найденной цели не строится, а называет план', () => {
  // Стрелка, указывающая в пустоту, хуже, чем её отсутствие.
  const states = [state({ anchors: [anchor('text=Жанры', null)] })];
  const film = buildFilm(manifest(states), withOverlay('arrow'));

  assert.deepEqual(film.plans[0].overlays, []);
  assert.ok(film.issues.some((i) => /наложения/.test(i.text)));
});

test('план без наложений получает пустой список, а не отсутствие поля', () => {
  const states = [state()];
  const sb = board([{ title: { text: 'Лента' }, action: null }], states);
  assert.deepEqual(buildFilm(manifest(states), sb).plans[0].overlays, []);
});
