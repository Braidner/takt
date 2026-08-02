import { test } from 'node:test';
import assert from 'node:assert/strict';
import { composeFrame } from '../studio/compose/frame.mjs';
import { buildFilm } from '../studio/compose/film.mjs';
import { normalizeStoryboard } from '../studio/compose/storyboard.mjs';
import { directStoryboard } from '../studio/compose/director.mjs';

const VIEWPORT = { width: 1440, height: 810 };
const state = (over = {}) => ({
  id: 'p01', mode: 'static',
  body: 'states/p01-body.jpg', layer: 'states/p01-layer.jpg',
  size: { w: 2880, h: 6152 }, viewport: VIEWPORT, scale: 2,
  sticky: [{ edge: 'top', x: 0, y: 0, w: 1440, h: 49, tag: 'header' }],
  anchors: [], settle: {},
  ...over,
});

const film = (plans, states) => buildFilm(
  { viewport: VIEWPORT, live: null, states },
  directStoryboard(normalizeStoryboard({ title: 'Демо', slate: false, plans }), states),
);

/** План на 7,2 с: панорама едет с 0,6 до 4,6 на дистанцию 2266. */
const panFilm = () => film([{ title: { text: 'Лента' }, action: { kind: 'hold', seconds: 4 } }],
                           [state()]);

test('панорама: до подводки стоим, к концу окна доехали', () => {
  const f = panFilm();
  assert.equal(composeFrame(f, 0).screens[0].scrollY, 0);
  assert.equal(composeFrame(f, Math.round(0.6 * 30)).screens[0].scrollY, 0);
  assert.equal(composeFrame(f, Math.round(4.6 * 30)).screens[0].scrollY, 2266);
});

test('панорама: в середине едем, а не стоим и не телепортируемся', () => {
  const y = composeFrame(panFilm(), Math.round(2.6 * 30)).screens[0].scrollY;
  assert.ok(y > 0 && y < 2266, `scrollY=${y}`);
});

test('панорама: липкий слой отдан кадру как есть', () => {
  assert.deepEqual(composeFrame(panFilm(), 60).screens[0].sticky,
                   [{ x: 0, y: 0, w: 1440, h: 49 }]);
});

const pushFilm = () => film(
  [{ title: { text: 'Клик' }, action: { kind: 'click', selector: 'text=Жанры' } }],
  [state({ anchors: [{ selector: 'text=Жанры', rect: { x: 2000, y: 1200, w: 200, h: 80 } }] })],
);

test('наезд: масштаб дошёл до глубины, окно притянуто к якорю', () => {
  const cam = composeFrame(pushFilm(), Math.round(2.0 * 30)).screens[0].camera;
  assert.equal(cam.scale, 1.26);
  // Якорь (1050, 620) CSS: окно шириной 1440/1.26 сдвинуто на долю свободного хода.
  assert.ok(Math.abs(cam.x - 179.2) < 0.5, `x=${cam.x}`);
  assert.ok(Math.abs(cam.y - 103.5) < 0.5, `y=${cam.y}`);
});

test('наезд: якорь у края экрана остаётся в окне, а не утягивается за кадр', () => {
  // Клик по пункту липкой шапки: центр якоря на y=22 CSS. Притяжение к центру
  // поставило бы верх окна ниже якоря, и клик происходил бы за кадром.
  const f = film([{ title: { text: 'Шапка' }, action: { kind: 'click', selector: 'x' } }],
                 [state({ anchors: [{ selector: 'x', rect: { x: 700, y: 40, w: 100, h: 8 } }] })]);
  const cam = composeFrame(f, Math.round(2.0 * 30)).screens[0].camera;
  assert.equal(cam.y, 0);
  assert.ok(cam.x > 0 && cam.x < 375, `x=${cam.x}`);
});

test('курсор: до подводки нет, в момент щелчка нажат, потом гаснет', () => {
  const f = pushFilm();
  const at = f.plans[0].cursor.at;
  assert.equal(composeFrame(f, 0).screens[0].cursor, null);
  const click = composeFrame(f, Math.round((at + 0.05) * 30)).screens[0].cursor;
  assert.ok(click.pressed);
  assert.ok(Math.abs(click.x - 1050) < 2 && Math.abs(click.y - 620) < 2);
  assert.equal(composeFrame(f, Math.round((at + 1.4) * 30)).screens[0].cursor, null);
});

const twoPlans = () => film([
  { title: { text: 'Лента' }, action: { kind: 'hold', seconds: 4 } },
  { title: { text: 'Поиск' }, action: { kind: 'hold', seconds: 2 } },
], [state(), state({ id: 'p02' })]);

test('кроссфейд: внутри окна два экрана, входящий набирает непрозрачность', () => {
  // Первый план длится 7.2 с, склейка занимает последние 0.35 с.
  const f = twoPlans();
  const fr = composeFrame(f, Math.round(7.05 * 30));
  assert.equal(fr.screens.length, 2);
  assert.equal(fr.screens[0].plan, 'p01');
  assert.equal(fr.screens[1].plan, 'p02');
  assert.ok(fr.screens[1].opacity > 0 && fr.screens[1].opacity < 1,
            `opacity=${fr.screens[1].opacity}`);
});

test('кроссфейд: вне окна экран один', () => {
  const f = twoPlans();
  assert.equal(composeFrame(f, Math.round(3 * 30)).screens.length, 1);
  assert.equal(composeFrame(f, Math.round(9 * 30)).screens.length, 1);
  assert.equal(composeFrame(f, Math.round(9 * 30)).screens[0].plan, 'p02');
});

test('титр: поднимается от начала СВОЕГО плана, а не от начала ролика', () => {
  const f = twoPlans();
  assert.equal(composeFrame(f, Math.round(2 * 30)).caption.text, 'Лента');
  assert.equal(composeFrame(f, Math.round(2 * 30)).caption.progress, 1);
  // Второй план начинается на 7.2, титр трогается на 0.15 — на 7.45 он ещё едет.
  assert.ok(composeFrame(f, Math.round(7.45 * 30)).caption.progress < 1);
  assert.equal(composeFrame(f, Math.round(9 * 30)).caption.text, 'Поиск');
});

test('последний кадр не выпадает за плёнку', () => {
  const f = twoPlans();
  assert.equal(composeFrame(f, Math.round(f.seconds * f.fps) - 1).screens.length, 1);
});
