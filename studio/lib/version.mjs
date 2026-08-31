/**
 * Какая версия работает и есть ли новее.
 *
 * Человек смотрит ролики в студии неделями, а код за это время уезжает. Пока
 * версии не было видно, вопрос «у меня свежий Takt?» решался чтением git log в
 * другом окне — то есть не решался. Теперь номер коммита стоит в шапке, и там же
 * видно, что вышло обновление.
 *
 * Разбор git-вывода — чистая функция, отделённая от самого git: на ней и держатся
 * тесты, а сетевая часть остаётся тонкой.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/** Разбор сырых данных в то, что показывают человеку и агенту. */
export function describeVersion({
  source = 'git', commit = null, date = null, branch = null, subject = null,
  dirty = '', behind = 0, version = null,
} = {}) {
  // Не git — значит копия от skills CLI: коммита у неё нет, а про обновление
  // честный ответ «неизвестно»: узнать это можно только запуском самого skills.
  if (source !== 'git') {
    return { source, version, commit: null, branch: null, date: null, subject: null,
             dirty: false, update: { available: null, commits: 0, blocked: false } };
  }
  const грязно = Boolean(String(dirty).trim());
  return {
    source: 'git',
    version,
    commit: commit ? String(commit).slice(0, 7) : null,
    branch, date, subject,
    dirty: грязно,
    update: {
      available: behind > 0,
      commits: behind,
      // Обновление поверх локальных правок не пройдёт: takt update на грязном
      // дереве останавливается. Человек должен знать это до нажатия кнопки.
      blocked: behind > 0 && грязно,
    },
  };
}

const git = (...args) => spawnSync('git', args, { cwd: ROOT, encoding: 'utf8' });

/**
 * Текущая версия. `check` включает поход в сеть за обновлениями — без него
 * функция дешёвая и её можно звать на каждый запрос страницы.
 */
export function readVersion({ check = false } = {}) {
  if (!fs.existsSync(path.join(ROOT, '.git'))) {
    let version = null;
    try { version = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version; }
    catch { /* нет и нет: версия — не то, ради чего стоит падать */ }
    return describeVersion({ source: 'skills', version });
  }

  const строка = git('log', '-1', '--format=%H%n%cI%n%s').stdout.trim().split('\n');
  const branch = git('rev-parse', '--abbrev-ref', 'HEAD').stdout.trim();
  const dirty = git('status', '--porcelain').stdout;

  let behind = 0;
  if (check) {
    // Сеть может не ответить, и это не повод ломать страницу: тогда обновлений
    // просто «не видно», а не «их нет».
    git('fetch', '--quiet', '--no-tags');
    const счёт = git('rev-list', '--count', `HEAD..@{upstream}`).stdout.trim();
    behind = Number(счёт) || 0;
  }

  return describeVersion({
    source: 'git', commit: строка[0], date: строка[1], subject: строка[2], branch, dirty, behind,
  });
}
