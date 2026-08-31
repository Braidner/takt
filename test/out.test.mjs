/**
 * Ответ команды: что печатается, а что нет.
 *
 * Библиотека кодирует `undefined` как `null`, и без очистки в ответе появлялись бы
 * строки про поля, которых у записи нет вовсе. Для агента это разные вещи: «чинить
 * нечего» и «чинить не пробовали».
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ok, fail } from '../studio/lib/out.mjs';

/** Перехват вывода: команда печатает в stdout, проверять надо именно его. */
function напечатано(fn) {
  const было = console.log;
  const строки = [];
  console.log = (s) => строки.push(s);
  try { fn(); } finally { console.log = было; }
  return строки.join('\n');
}

test('поле без значения не печатается', () => {
  const вывод = напечатано(() => ok({ ok: true, out: 'movie.mp4', fix: undefined }));
  assert.equal(вывод, 'ok: true\nout: movie.mp4');
});

test('пропуски вычищаются и внутри записей списка', () => {
  const вывод = напечатано(() => ok({ plans: [{ id: 'p01', error: undefined }] }));
  assert.equal(вывод, 'plans[1]{id}:\n  p01');
});

test('подсказки идут последней строкой, а без них строки нет', () => {
  assert.match(напечатано(() => ok({ ok: true }, ['собрать: takt build'])),
               /\nhelp\[1\]: "собрать: takt build"$/);
  assert.equal(напечатано(() => ok({ ok: true })), 'ok: true');
});

test('отказ называет причину машинным словом и человеческой фразой', () => {
  const вывод = напечатано(() => fail('no_studio', 'студия не запущена',
                                      { help: ['поднять: takt serve'] }));
  assert.match(вывод, /^ok: false\nerror: no_studio\ntext: студия не запущена/);
  process.exitCode = 0;   // fail() ставит код возврата — тесту он не нужен
});
