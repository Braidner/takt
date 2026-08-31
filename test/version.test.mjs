/**
 * Версия: что Takt знает о себе, не выходя в сеть.
 *
 * Проверку обновлений ведёт страница студии — она спрашивает GitHub и сравнивает
 * коммит. Здесь проверяется только то, что читается с диска: сам факт версии,
 * источник установки и адрес репозитория, по которому страница пойдёт спрашивать.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { describeVersion, repoSlug } from '../studio/lib/version.mjs';

test('версия несёт и полный коммит, и короткий', () => {
  // Полный нужен странице для сравнения с GitHub, короткий — человеку в шапке.
  const v = describeVersion({ commit: '45fbe0b1c2d3e4f5', subject: 'Справочник знает про размер окна' });
  assert.equal(v.sha, '45fbe0b1c2d3e4f5');
  assert.equal(v.commit, '45fbe0b');
  assert.equal(v.subject, 'Справочник знает про размер окна');
});

test('локальные правки видно: обновление их затрёт', () => {
  assert.equal(describeVersion({ dirty: ' M studio/live.js' }).dirty, true);
  assert.equal(describeVersion({ dirty: '' }).dirty, false);
});

test('копия описывает себя версией пакета, а не коммитом', () => {
  const v = describeVersion({ source: 'skills', version: '1.4.0', commit: null });
  assert.equal(v.source, 'skills');
  assert.equal(v.version, '1.4.0');
  assert.equal(v.commit, null);
});

test('адрес репозитория берётся из package.json, а не зашит в коде', () => {
  // По нему страница спрашивает GitHub, поэтому ошибка здесь тихо выключила бы
  // проверку обновлений целиком.
  assert.equal(repoSlug({ repository: { url: 'https://github.com/Braidner/takt' } }), 'Braidner/takt');
  assert.equal(repoSlug({ repository: 'git+https://github.com/Braidner/takt.git' }), 'Braidner/takt');
  assert.equal(repoSlug({ repository: { url: 'git@github.com:Braidner/takt.git' } }), 'Braidner/takt');
  assert.equal(repoSlug({}), null);
});
