import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyNote, planFor } from '../studio/classify-notes.mjs';

test('однозначная просьба сменить действие — пересъёмка', () => {
  assert.equal(classifyNote('Покажи вместо этого раздел настроек').kind, 'shoot');
});

test('правка титра — монтаж, а не съёмка', () => {
  assert.equal(classifyNote('Поправить титр: лишняя запятая').kind, 'edit');
});

test('замечание без адреса и без опознанных слов остаётся непонятным', () => {
  assert.equal(classifyNote('Что-то не то').kind, 'unclear');
});

test('замечание на плане — работа режиссёра, даже если слова обычные', () => {
  // «Слишком долго висит пустой экран» не содержит ни одного признака из правил,
  // но адрес говорит всё: это про конкретный план, и переделывать его раскадровку.
  const note = { text: 'Слишком долго висит пустой экран', plan: 'p04' };
  assert.equal(classifyNote(note).kind, 'direct');
  assert.match(classifyNote(note).why, /раскадров/);
});

test('замечание на эффекте — тоже режиссёр', () => {
  assert.equal(classifyNote({ text: 'слишком резко', effect: 'p04-cam' }).kind, 'direct');
});

test('знакомое слово важнее адреса: «наезд» — это монтаж, и человек правит его сам', () => {
  assert.equal(classifyNote({ text: 'наезд слишком резкий', effect: 'p02-cam' }).kind, 'edit');
});

test('адрес не перебивает просьбу переснять', () => {
  // «Открой другой раздел» на плане — всё равно новая съёмка: раскадровкой этого
  // не добьёшься, там нет нужного состояния.
  assert.equal(classifyNote({ text: 'Открой вкладку прав', plan: 'p02' }).kind, 'shoot');
});

test('план работ считает перегенерацию одной строкой на все адресные замечания', () => {
  const plan = planFor([
    { text: 'Долго висит пустой экран', plan: 'p01', status: 'open' },
    { text: 'здесь всё слишком спешит', effect: 'p02-cam', status: 'open' },
  ]);
  assert.equal(plan.needsShooting, false);
  assert.equal(plan.minutes, 3);
  assert.ok(plan.items.every((i) => i.kind === 'direct'));
});

test('применённые замечания в план не попадают', () => {
  const plan = planFor([{ text: 'Поправить титр', status: 'applied' }]);
  assert.equal(plan.items.length, 0);
  assert.equal(plan.minutes, 0);
});

test('строка вместо объекта по-прежнему принимается', () => {
  // Старые вызовы передают текст: ломать их ради нового поля нельзя.
  assert.equal(classifyNote('озвучить заново').kind, 'voice');
});
