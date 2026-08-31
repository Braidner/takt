/**
 * Версия и обновление.
 *
 * Разбор git-вывода — чистая функция, и проверяется она здесь; сетевая часть
 * (fetch у origin) живёт снаружи, потому что на ней нечего проверять, кроме сети.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { describeVersion } from '../studio/lib/version.mjs';

test('версия называет коммит коротко и датой', () => {
  const v = describeVersion({
    commit: '45fbe0b1c2d3e4f5', date: '2026-08-04T10:20:00+03:00',
    branch: 'main', dirty: '', behind: 0, subject: 'Справочник знает про размер окна',
  });
  assert.equal(v.commit, '45fbe0b');
  assert.equal(v.branch, 'main');
  assert.equal(v.subject, 'Справочник знает про размер окна');
  assert.equal(v.dirty, false);
  assert.equal(v.update.available, false);
});

test('отставание от origin — это доступное обновление с числом коммитов', () => {
  const v = describeVersion({ commit: 'abc1234', behind: 3 });
  assert.equal(v.update.available, true);
  assert.equal(v.update.commits, 3);
});

test('локальные правки видно: поверх них обновляться нельзя', () => {
  // takt update на грязном дереве останавливается, и человек должен понимать почему
  // до того, как нажмёт кнопку.
  const v = describeVersion({ commit: 'abc1234', behind: 2, dirty: ' M studio/live.js\n?? tmp.txt' });
  assert.equal(v.dirty, true);
  assert.equal(v.update.available, true);
  assert.equal(v.update.blocked, true);
});

test('чистое дерево без отставания ничего не обещает', () => {
  const v = describeVersion({ commit: 'abc1234', behind: 0, dirty: '' });
  assert.equal(v.update.blocked, false);
  assert.equal(v.update.available, false);
});

test('установка не из git описывает себя иначе', () => {
  // Копия от skills CLI коммита не знает: версию ей даёт package.json.
  const v = describeVersion({ source: 'skills', version: '1.4.0' });
  assert.equal(v.source, 'skills');
  assert.equal(v.version, '1.4.0');
  assert.equal(v.commit, null);
  // Проверить обновление у skills можно только запуском самого skills — значит
  // «неизвестно», а не «нет».
  assert.equal(v.update.available, null);
});
