import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planDuration, MIN, MAX } from '../studio/compose/duration.mjs';

const plan = (action, over = {}) => ({ id: 'p01', title: { text: 'План' }, action, ...over });

test('клик: подводка, действие, удержание', () => {
  // 0.6 подводки + 0.2 клика + 2.6 удержания = 3.4 — меньше минимума, добирается до 3.5.
  const d = planDuration(plan({ kind: 'click', selector: 'text=Дискавери' }));
  assert.equal(d.seconds, 3.5);
  assert.equal(d.source, 'derived');
  assert.equal(d.over, false);
});

test('ввод: время считается по длине текста, а не по секундомеру', () => {
  // «одиссея» — 7 знаков при 12 знаках в секунду.
  const d = planDuration(plan({ kind: 'type', selector: 'input', text: 'одиссея' }));
  assert.equal(d.seconds, 3.8);
});

test('ввод: длинный текст растягивает план', () => {
  const d = planDuration(plan({ kind: 'type', selector: 'input', text: 'а'.repeat(36) }));
  assert.equal(d.seconds, 6.2);   // 0.6 + 3 + 2.6
});

test('прокрутка: дистанция делится на скорость', () => {
  const d = planDuration(plan({ kind: 'scroll', distance: 1200 }));
  assert.equal(d.seconds, 5.2);   // 0.6 + 2 + 2.6
});

test('прокрутка: своя скорость плана уважается', () => {
  const d = planDuration(plan({ kind: 'scroll', distance: 1200, speed: 300 }));
  assert.equal(d.seconds, 7.2);   // 0.6 + 4 + 2.6
});

test('прокрутка вверх считается по длине пути, а не по знаку', () => {
  const d = planDuration(plan({ kind: 'scroll', distance: -1200 }));
  assert.equal(d.seconds, 5.2);
});

test('удержание: секунды заданы явно — это и есть смысл плана', () => {
  const d = planDuration(plan({ kind: 'hold', seconds: 4.5 }));
  assert.equal(d.seconds, 7.7);   // 0.6 + 4.5 + 2.6
});

test('переход: загрузка в кадр не попадает, остаётся только минимум', () => {
  const d = planDuration(plan({ kind: 'goto' }));
  assert.equal(d.seconds, MIN);
});

test('план без действия — это пауза на экране, а не ошибка', () => {
  const d = planDuration(plan(null));
  assert.equal(d.seconds, MIN);
});

test('длинный план обрезается по границе и сообщает об этом', () => {
  // Спека: вышло больше девяти — режиссёр обязан разбить план надвое.
  // Молча растянуть значит спрятать от него эту работу.
  const d = planDuration(plan({ kind: 'hold', seconds: 20 }));
  assert.equal(d.seconds, MAX);
  assert.equal(d.over, true);
});

test('ручная длительность пересчётом не затирается', () => {
  const d = planDuration(plan({ kind: 'click', selector: 'x' },
                              { duration: { source: 'manual', seconds: 12 } }));
  assert.equal(d.seconds, 12);
  assert.equal(d.source, 'manual');
  // Даже за границей: человек видел, что делал, и его решение сильнее правила.
  assert.equal(d.over, false);
});

test('неизвестный вид действия не роняет расчёт', () => {
  // Раскадровку пишет агент, и опечатка в kind не должна валить хронометраж:
  // за неё отвечает checkStoryboard, называя план по имени.
  const d = planDuration(plan({ kind: 'зум' }));
  assert.equal(d.seconds, MIN);
});
