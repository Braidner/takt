import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clamp, interpolate, cubicBezier, ride } from '../studio/compose/curves.mjs';

test('interpolate: середина диапазона линейна', () => {
  assert.equal(interpolate(5, [0, 10], [0, 100]), 50);
});

test('interpolate: за краями прижимается, а не экстраполирует', () => {
  // Камера за границей плана должна стоять, а не улетать дальше цели.
  assert.equal(interpolate(-1, [0, 10], [0, 100]), 0);
  assert.equal(interpolate(11, [0, 10], [0, 100]), 100);
});

test('interpolate: вырожденный диапазон — левое значение, а не NaN', () => {
  assert.equal(interpolate(3, [3, 3], [7, 9]), 7);
});

test('interpolate: убывающий выход', () => {
  assert.equal(interpolate(2.5, [0, 10], [100, 0]), 75);
});

test('cubicBezier(0,0,1,1) — прямая', () => {
  const lin = cubicBezier(0, 0, 1, 1);
  for (const x of [0, 0.25, 0.5, 0.75, 1]) {
    assert.ok(Math.abs(lin(x) - x) < 1e-4, `x=${x} → ${lin(x)}`);
  }
});

test('ride: края точные, между ними — монотонный разгон и торможение', () => {
  assert.equal(ride(0), 0);
  assert.equal(ride(1), 1);
  let prev = 0;
  for (let x = 0.05; x <= 0.95; x += 0.05) {
    const v = ride(x);
    assert.ok(v > prev, `кривая не монотонна на x=${x}`);
    prev = v;
  }
  // Разгон: первая десятая часть пути даёт меньше десятой части дистанции.
  assert.ok(ride(0.1) < 0.1);
});

test('clamp', () => {
  assert.equal(clamp(5, 0, 10), 5);
  assert.equal(clamp(-1, 0, 10), 0);
  assert.equal(clamp(99, 0, 10), 10);
});
