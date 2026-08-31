/**
 * Как установлен скилл — и почему это решает, что делает обновление.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { classifySkill } from '../studio/lib/skill.mjs';

test('ссылка на каталог кода обновляется вместе с ним', () => {
  const v = classifySkill({ exists: true, link: '/code/takt', root: '/code/takt' });
  assert.equal(v.kind, 'link');
  assert.equal(v.needsCopy, false);
});

test('ссылка внутрь каталога кода — тоже он', () => {
  const v = classifySkill({ exists: true, link: path.join('/code/takt', 'skills', 'takt'), root: '/code/takt' });
  assert.equal(v.kind, 'link');
});

test('копия отстанет молча, поэтому её надо переписать', () => {
  // Ничего не падает: агент просто читает вчерашнюю инструкцию и не знает об этом.
  const v = classifySkill({ exists: true, link: null, root: '/code/takt' });
  assert.equal(v.kind, 'copy');
  assert.equal(v.needsCopy, true);
});

test('ссылка в чужое место — тоже не наша, обновляем как копию', () => {
  const v = classifySkill({ exists: true, link: '/somewhere/else', root: '/code/takt' });
  assert.equal(v.kind, 'link-elsewhere');
  assert.equal(v.needsCopy, true);
});

test('скилла нет — обновлять нечего', () => {
  assert.deepEqual(classifySkill({ exists: false }), { kind: 'none', needsCopy: false });
});
