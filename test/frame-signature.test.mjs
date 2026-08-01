import { test } from 'node:test';
import assert from 'node:assert/strict';
import { differenceRatio, signature, SIGNATURE_LENGTH } from '../studio/lib/frame-signature.mjs';

test('одинаковые сигнатуры не различаются', () => {
  const a = new Uint8Array([10, 20, 30, 40]);
  assert.equal(differenceRatio(a, a), 0);
});

test('противоположные сигнатуры различаются целиком', () => {
  const a = new Uint8Array([0, 0, 0, 0]);
  const b = new Uint8Array([255, 255, 255, 255]);
  assert.equal(differenceRatio(a, b), 1);
});

test('шум сжатия не считается изменением', () => {
  // JPEG шевелит яркость на единицы даже в полностью неподвижном кадре.
  // Без порога любой статичный экран выглядел бы как непрерывное движение.
  const a = new Uint8Array([100, 100, 100, 100]);
  const b = new Uint8Array([102, 98, 101, 100]);
  assert.equal(differenceRatio(a, b), 0);
});

test('различие — доля, а не количество', () => {
  const a = new Uint8Array([0, 0, 0, 0]);
  const b = new Uint8Array([255, 0, 0, 0]);
  assert.equal(differenceRatio(a, b), 0.25);
});

test('сигнатуры разной длины — ошибка, а не молчаливое сравнение', () => {
  assert.throws(
    () => differenceRatio(new Uint8Array(3), new Uint8Array(4)),
    /длины/,
  );
});

test('сигнатура настоящего кадра имеет объявленную длину', async () => {
  // Однотонный кадр: проверяем и длину, и то, что ffmpeg отдал именно яркость.
  const png = await makeSolidPng(64, 36, 'gray');
  const sig = await signature(png);
  assert.equal(sig.length, SIGNATURE_LENGTH);
  assert.ok(sig.every((v) => Math.abs(v - sig[0]) <= 2), 'однотонный кадр дал разброс');
});

test('два разных кадра различаются заметно', async () => {
  const black = await signature(await makeSolidPng(64, 36, 'black'));
  const white = await signature(await makeSolidPng(64, 36, 'white'));
  assert.ok(differenceRatio(black, white) > 0.9);
});

/** Однотонная картинка через ffmpeg — чтобы не тащить в тесты генератор изображений. */
async function makeSolidPng(w, h, color) {
  const { execFile } = await import('node:child_process');
  const { promisify } = await import('node:util');
  const run = promisify(execFile);
  const { stdout } = await run('ffmpeg', [
    '-v', 'error', '-f', 'lavfi', '-i', `color=c=${color}:s=${w}x${h}`,
    '-frames:v', '1', '-f', 'image2', '-c:v', 'png', 'pipe:1',
  ], { encoding: 'buffer', maxBuffer: 1 << 22 });
  return stdout;
}
