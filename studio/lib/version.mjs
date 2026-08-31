/**
 * Какая версия работает.
 *
 * Только чтение с диска: ни git fetch, ни походов в сеть. Проверку обновлений
 * ведёт страница студии — она спрашивает GitHub напрямую и сравнивает коммит.
 * Так это работает одинаково и у рабочего клона, и у копии, поставленной skills
 * CLI, и не заставляет сервер ждать сеть.
 *
 * Коммит читается из git, если Takt стоит клоном; у копии его взять неоткуда,
 * поэтому там остаётся отметка, которую пишет обновление, и версия из package.json.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { findSkill } from './skill.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const ОТМЕТКА = path.join(ROOT, '.takt-version.json');

/** Owner/repo источника — из package.json, чтобы адрес не был зашит в коде. */
export function repoSlug(pkg) {
  const url = pkg?.repository?.url || pkg?.repository || '';
  const m = String(url).match(/github\.com[/:]([^/]+)\/([^/.]+)/);
  return m ? `${m[1]}/${m[2]}` : null;
}

/** Разбор сырых данных в то, что показывают человеку и агенту. */
export function describeVersion({
  source = 'git', commit = null, date = null, branch = null, subject = null,
  dirty = '', version = null, repo = null, skill = null,
} = {}) {
  return {
    source,
    version,
    repo,
    skill,
    // Полный sha нужен странице для сравнения с GitHub, короткий — человеку.
    sha: commit || null,
    commit: commit ? String(commit).slice(0, 7) : null,
    branch, date, subject,
    dirty: Boolean(String(dirty).trim()),
  };
}

const git = (...args) => spawnSync('git', args, { cwd: ROOT, encoding: 'utf8' });

const пакет = () => {
  try { return JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')); }
  catch { return {}; }
};

export function readVersion() {
  const pkg = пакет();
  const общее = { version: pkg.version || null, repo: repoSlug(pkg), skill: findSkill(ROOT).kind };

  if (!fs.existsSync(path.join(ROOT, '.git'))) {
    // Копия: коммит знает только отметка, которую оставило обновление.
    let отметка = {};
    try { отметка = JSON.parse(fs.readFileSync(ОТМЕТКА, 'utf8')); } catch { /* её ещё не было */ }
    return describeVersion({ source: 'skills', commit: отметка.sha || null,
                             date: отметка.at || null, ...общее });
  }

  const строка = git('log', '-1', '--format=%H%n%cI%n%s').stdout.trim().split('\n');
  return describeVersion({
    source: 'git', commit: строка[0], date: строка[1], subject: строка[2],
    branch: git('rev-parse', '--abbrev-ref', 'HEAD').stdout.trim(),
    dirty: git('status', '--porcelain').stdout,
    ...общее,
  });
}

/** Отметку пишет обновление: у копии это единственный след того, что установлено. */
export function stampVersion(sha) {
  if (!sha) return;
  fs.writeFileSync(ОТМЕТКА, JSON.stringify({ sha, at: new Date().toISOString() }, null, 2));
}
