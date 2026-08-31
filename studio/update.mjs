/**
 * takt update — обновить Takt и перезапустить студию.
 *
 * Обновление делегируется skills CLI и только ему. Своя реализация поверх git
 * выглядела дешёвой, но врала о своей области: `git pull` работает лишь там, где
 * Takt стоит рабочим клоном, ломается о любой незакоммиченный файл — в том числе
 * о рабочую переписку, к коду отношения не имеющую, — и ничего не знает про то,
 * как скилл разложен по каталогам агентов. Всё это знает skills CLI, потому что
 * он же и ставил.
 *
 * У рабочего клона обновлять нечего: там источник — локальный каталог, и человек
 * обновляется своим git сам. Команда это говорит прямо, вместо того чтобы делать
 * вид, будто сходила куда-то.
 *
 * Данные ($TAKT_HOME) не трогаются вовсе: ролики, голоса и venv живут вне кода.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, studioStatus, stopStudio, ensureDeps, migrateVenvs, launchStudio }
  from './bootstrap.mjs';
import { findSkill, syncSkill } from './lib/skill.mjs';
import { readVersion } from './lib/version.mjs';

const wasAlive = (await studioStatus()) === 'alive';
const версия = readVersion();

if (fs.existsSync(path.join(ROOT, '.git'))) {
  console.log('Takt стоит рабочим клоном — обновлять его нечем, кроме вашего git.');
  console.log(`Сейчас: ${версия.commit} · ${версия.subject || ''}`);
  console.log('Обновиться: git pull в каталоге кода. Дальше takt update перезапустит студию.');
} else {
  const up = spawnSync('npx', ['-y', 'skills', 'update', 'takt', '-y'], { stdio: 'inherit' });
  if (up.status !== 0) {
    console.error('\nskills CLI не смог обновить. Вручную: npx skills update takt');
    process.exit(1);
  }
  /* Скилл, поставленный копией, живёт отдельно от кода: skills обновит свою копию,
     но если каталог кода и каталог скилла разные, второй останется вчерашним. */
  const скилл = findSkill(ROOT);
  if (скилл.needsCopy) {
    const части = syncSkill(ROOT, скилл.dir);
    console.log(`Скилл обновлён копированием (${скилл.dir}): ${части.join(', ')}`);
  }
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
