import { test } from 'node:test';
import assert from 'node:assert/strict';
import { composeFrame } from '../studio/compose/frame.mjs';
import { buildFilm } from '../studio/compose/film.mjs';

const VIEWPORT = { width: 1440, height: 810 };
const state = (over = {}) => ({
  id: 'p01', plan: 1, label: 'Лента', mode: 'static',
  body: 'states/p01-body.jpg', layer: 'states/p01-layer.jpg',
  size: { w: 2880, h: 6152 }, viewport: VIEWPORT, scale: 2,
  sticky: [{ edge: 'top', x: 0, y: 0, w: 1440, h: 49, tag: 'header', position: 'sticky' }],
  anchors: [], settle: {},
  ...over,
});

const panFilm = () => buildFilm(
  { viewport: VIEWPORT, live: null, states: [state()] },
  { title: 'Демо', steps: [{ n: 1, label: 'Лента', seconds: 8 }] },
);

test('панорама: до подводки стоим, к началу удержания доехали', () => {
  const film = panFilm();
  assert.equal(composeFrame(film, 0).screens[0].scrollY, 0);
  // t = 0.6 — камера ещё не тронулась.
  assert.equal(composeFrame(film, Math.round(0.6 * 30)).screens[0].scrollY, 0);
  // t = 6.4 = 8 − 1.6 — приехали: вся дистанция 2266 (объяснение числа — в тестах плёнки).
  assert.equal(composeFrame(film, Math.round(6.4 * 30)).screens[0].scrollY, 2266);
});

test('панорама: в середине едем, а не стоим и не телепортируемся', () => {
  const y = composeFrame(panFilm(), Math.round(3.5 * 30)).screens[0].scrollY;
  assert.ok(y > 0 && y < 2266, `scrollY=${y}`);
});

test('панорама: липкий слой отдан кадру как есть', () => {
  const fr = composeFrame(panFilm(), 90);
  assert.deepEqual(fr.screens[0].sticky, [{ x: 0, y: 0, w: 1440, h: 49 }]);
});

const pushFilm = () => buildFilm(
  { viewport: VIEWPORT, live: null,
    states: [state({ anchors: [{ selector: 'x', rect: { x: 2000, y: 1200, w: 200, h: 80 } }] })] },
  { title: 'Демо', steps: [{ n: 1, label: 'Клик', seconds: 6 }] },
);

test('наезд: масштаб дошёл до глубины, окно камеры притянуто к якорю', () => {
  const fr = composeFrame(pushFilm(), Math.round(2.0 * 30));
  const cam = fr.screens[0].camera;
  assert.equal(cam.scale, 1.26);
  // Якорь (1050, 620) CSS. Окно шириной 1440/1.26 сдвинуто на долю
  // 0.5 + (1050/1440 − 0.5)·0.45 от свободного хода 1440 − 1440/1.26.
  assert.ok(Math.abs(cam.x - 179.2) < 0.5, `x=${cam.x}`);
  assert.ok(Math.abs(cam.y - 103.5) < 0.5, `y=${cam.y}`);
});

test('наезд: якорь у края экрана остаётся в окне, а не утягивается за кадр', () => {
  // Клик по пункту липкой шапки: центр якоря на y=22 CSS. Притяжение к центру
  // поставило бы верх окна на ~48 — выше якоря, и клик происходил бы за кадром.
  const film = buildFilm(
    { viewport: VIEWPORT, live: null,
      states: [state({ anchors: [{ selector: 'x', rect: { x: 700, y: 40, w: 100, h: 8 } }] })] },
    { title: 'Демо', steps: [{ n: 1, label: 'Клик в шапке', seconds: 6 }] },
  );
  const cam = composeFrame(film, Math.round(2.0 * 30)).screens[0].camera;
  assert.equal(cam.y, 0);
  // Верх окна прижат к краю, якорь внутри окна по обеим осям.
  assert.ok(cam.x > 0 && cam.x < 375, `x=${cam.x}`);
});

test('курсор: до подводки нет, в момент щелчка нажат, потом гаснет', () => {
  const film = pushFilm();
  assert.equal(composeFrame(film, 0).screens[0].cursor, null);
  const click = composeFrame(film, Math.round(1.55 * 30)).screens[0].cursor;
  assert.ok(click.pressed);
  assert.ok(Math.abs(click.x - 1050) < 2 && Math.abs(click.y - 620) < 2);
  assert.equal(composeFrame(film, Math.round(3.0 * 30)).screens[0].cursor, null);
});

const twoPlans = () => buildFilm(
  { viewport: VIEWPORT, live: null,
    states: [state(), state({ id: 'p02', plan: 2, label: 'Поиск' })] },
  { title: 'Демо', steps: [
    { n: 1, label: 'Лента', seconds: 8 }, { n: 2, label: 'Поиск', seconds: 6 },
  ] },
);

test('кроссфейд: внутри окна два экрана, входящий набирает непрозрачность', () => {
  // t = 7.9, окно [7.65, 8]: прошло 0.25 из 0.35.
  const fr = composeFrame(twoPlans(), Math.round(7.9 * 30));
  assert.equal(fr.screens.length, 2);
  assert.equal(fr.screens[0].plan, 'p01');
  assert.equal(fr.screens[1].plan, 'p02');
  assert.ok(Math.abs(fr.screens[1].opacity - 0.25 / 0.35) < 0.05);
});

test('кроссфейд: вне окна экран один', () => {
  assert.equal(composeFrame(twoPlans(), Math.round(5 * 30)).screens.length, 1);
  assert.equal(composeFrame(twoPlans(), Math.round(9 * 30)).screens.length, 1);
  assert.equal(composeFrame(twoPlans(), Math.round(9 * 30)).screens[0].plan, 'p02');
});

test('титр: поднимается после начала плана и живёт до его конца', () => {
  const film = twoPlans();
  assert.ok(composeFrame(film, Math.round(0.2 * 30)).caption.progress < 1);
  assert.equal(composeFrame(film, Math.round(2 * 30)).caption.progress, 1);
  assert.equal(composeFrame(film, Math.round(2 * 30)).caption.text, 'Лента');
  assert.equal(composeFrame(film, Math.round(9 * 30)).caption.text, 'Поиск');
});

test('последний кадр не выпадает за плёнку', () => {
  const film = twoPlans();
  const last = Math.round(film.seconds * film.fps) - 1;
  assert.equal(composeFrame(film, last).screens.length, 1);
});
