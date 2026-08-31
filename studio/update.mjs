/**
 * takt update — обновить код скилла и перезапустить студию.
 *
 * Способ обновления определяется способом установки: git-клон тянется через git,
 * копия от skills CLI — через npx skills update. Данные ($TAKT_HOME) не трогаются
 * вовсе: ролики, голоса и venv живут вне каталога кода.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, studioStatus, stopStudio, ensureDeps, migrateVenvs, launchStudio }
  from './bootstrap.mjs';
import { findSkill, syncSkill } from './lib/skill.mjs';

const git = (args) => spawnSync('git', args, { cwd: ROOT, encoding: 'utf8' });

const wasAlive = (await studioStatus()) === 'alive';

if (fs.existsSync(path.join(ROOT, '.git'))) {
  // Правки поверх обновления молча не переживают ни merge, ни reset — останавливаемся.
  const dirty = git(['status', '--porcelain']).stdout.trim();
  if (dirty) {
    console.error('В каталоге скилла локальные правки — обновлять поверх них не буду:\n');
    console.error(git(['status', '--short']).stdout);
    process.exit(1);
  }
  const before = git(['rev-parse', 'HEAD']).stdout.trim();
  const pull = spawnSync('git', ['pull', '--ff-only'], { cwd: ROOT, stdio: 'inherit' });
  if (pull.status !== 0) process.exit(pull.status ?? 1);
  const after = git(['rev-parse', 'HEAD']).stdout.trim();
  console.log(before === after
    ? 'Уже последняя версия.'
    : git(['log', '--oneline', `${before}..${after}`]).stdout.trim());
} else {
  const up = spawnSync('npx', ['skills', 'update', 'takt', '-y'], { stdio: 'inherit' });
  if (up.status !== 0) {
    console.error('\nskills CLI не смог обновить. Вручную: npx skills update takt');
    process.exit(1);
  }
}

/* Скилл обновляется вместе с кодом только если он на него ссылается. Копия
   отстала бы молча: ничего не падает, просто агент читает вчерашнюю инструкцию —
   ровно та болезнь, ради которой скилл ужимался до стаба. */
const скилл = findSkill(ROOT);
if (скилл.needsCopy) {
  const части = syncSkill(ROOT, скилл.dir);
  console.log(`Скилл обновлён копированием (${скилл.dir}): ${части.join(', ')}`);
} else if (скилл.kind === 'link') {
  console.log(`Скилл ссылается на этот каталог — обновился вместе с кодом.`);
}

migrateVenvs();
await ensureDeps();

if (wasAlive) {
  await stopStudio();
  const { url } = await launchStudio();
  console.log(`Студия перезапущена: ${url} — открытая страница переподключится сама.`);
} else {
  console.log('Студия не работала — поднимется при следующем takt start.');
}
