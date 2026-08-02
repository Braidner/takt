import { test } from 'node:test';
import assert from 'node:assert/strict';
import { autoEffects, directStoryboard } from '../studio/compose/director.mjs';
import { normalizeStoryboard } from '../studio/compose/storyboard.mjs';

const VIEWPORT = { width: 1440, height: 810 };

/** Состояние, снятое съёмкой: страница вдвое плотнее и в семь экранов длиной. */
const state = (over = {}) => ({
  id: 'p01', plan: 1, mode: 'static', size: { w: 2880, h: 6152 },
  viewport: VIEWPORT, scale: 2, sticky: [], anchors: [], ...over,
});

const plan = (action, over = {}) => normalizeStoryboard({
  plans: [{ title: { text: 'План' }, action, ...over }],
}).plans[0];

test('клик: камера наезжает на цель, а цель названа селектором', () => {
  // Селектор, а не координаты: координаты появятся при сборке плёнки из снятого
  // состояния. Эффект переживает пересъёмку, координаты — нет.
  const [cam] = autoEffects(plan({ kind: 'click', selector: 'text=Дискавери' }), state(), {});
  assert.equal(cam.kind, 'camera');
  assert.equal(cam.params.move, 'push');
  assert.equal(cam.params.depth, 1.26);
  assert.equal(cam.anchor, 'text=Дискавери');
  assert.equal(cam.source, 'auto');
  assert.equal(cam.plan, 'p01');
});

test('ввод: наезд на поле ввода', () => {
  const [cam] = autoEffects(plan({ kind: 'type', selector: 'input', text: 'кино' }), state(), {});
  assert.equal(cam.params.move, 'push');
  assert.equal(cam.anchor, 'input');
});

test('наезд начинается после подводки и укладывается в план', () => {
  const p = plan({ kind: 'click', selector: 'x' });
  const [cam] = autoEffects(p, state(), {});
  assert.equal(cam.at.from, 0.6);
  assert.ok(cam.at.to <= p.duration.seconds, `${cam.at.to} > ${p.duration.seconds}`);
});

test('длинная страница без цели: панорама во всё окно движения', () => {
  const p = plan({ kind: 'hold', seconds: 4 });
  const [cam] = autoEffects(p, state(), {});
  assert.equal(cam.params.move, 'pan');
  assert.equal(cam.params.speed, 600);
  assert.equal(cam.at.from, 0.6);
  // Окно движения — от подводки до удержания: 7.2 − 2.6.
  assert.equal(cam.at.to, 4.6);
});

test('страница в один экран: дрейф, потому что стоп-кадр читается как сбой', () => {
  const [cam] = autoEffects(plan({ kind: 'hold', seconds: 2 }),
                            state({ size: { w: 2880, h: 1620 } }), {});
  assert.equal(cam.params.move, 'drift');
});

test('до съёмки камера не выдумывается: без состояния только дрейф', () => {
  // Раскадровку утверждают ДО съёмки, и обещать там панораму нельзя — неизвестно,
  // есть ли на странице куда ехать.
  const [cam] = autoEffects(plan({ kind: 'hold', seconds: 3 }), null, {});
  assert.equal(cam.params.move, 'drift');
});

test('склейка ставится на конец плана, кроме последнего', () => {
  const p = plan({ kind: 'click', selector: 'x' });
  const mid = autoEffects(p, state(), { last: false });
  const cut = mid.find((e) => e.kind === 'transition');
  assert.equal(cut.params.style, 'dissolve');
  assert.equal(cut.at.to, p.duration.seconds);
  assert.equal(Math.round((cut.at.to - cut.at.from) * 100) / 100, 0.35);

  assert.equal(autoEffects(p, state(), { last: true }).some((e) => e.kind === 'transition'), false);
});

const two = () => normalizeStoryboard({ plans: [
  { title: { text: 'Первый' }, action: { kind: 'click', selector: 'a' } },
  { title: { text: 'Второй' }, action: { kind: 'hold', seconds: 3 } },
] });

test('режиссёр расставляет эффекты по всей раскадровке', () => {
  const sb = directStoryboard(two(), [state({ id: 'p01' }), state({ id: 'p02' })]);
  assert.deepEqual(sb.effects.map((e) => `${e.plan}:${e.kind}`),
                   ['p01:camera', 'p01:transition', 'p02:camera']);
});

test('ручной эффект переживает работу режиссёра, автоматический — нет', () => {
  // Иначе перегенерация молча стирает то, что человек правил руками час назад.
  const sb = two();
  const manual = { id: 'мой', plan: 'p01', kind: 'camera', at: { from: 0, to: 2 },
                   params: { move: 'closeup' }, source: 'manual' };
  const next = directStoryboard({ ...sb, effects: [manual] },
                                [state({ id: 'p01' }), state({ id: 'p02' })]);
  assert.deepEqual(next.effects.filter((e) => e.plan === 'p01'), [manual]);
  // У соседа своей ручной правки не было — он получает автоматику.
  assert.ok(next.effects.some((e) => e.plan === 'p02' && e.source === 'auto'));
});

test('состояние ищется по идентификатору плана, а не по порядку', () => {
  // После пересъёмки одного плана порядок в манифесте может не совпасть.
  const sb = directStoryboard(two(), [state({ id: 'p02', size: { w: 2880, h: 1620 } })]);
  const cam2 = sb.effects.find((e) => e.plan === 'p02' && e.kind === 'camera');
  assert.equal(cam2.params.move, 'drift');
});
