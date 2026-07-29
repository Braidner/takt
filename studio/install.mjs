/**
 * Установка возможностей.
 *
 *   takt install                  что можно поставить и сколько это весит
 *   takt install voice-qwen      поставить озвучку Qwen
 *
 * Ставится ТОЛЬКО перечисленное здесь. Реестр зашит в код намеренно: кнопка «Установить»
 * в студии кладёт агенту событие, и если бы команда приезжала в событии или бралась из
 * конфига, любой, кто может писать в очередь или в конфиг, получил бы исполнение своих
 * команд от имени человека. Событие несёт только идентификатор; что за ним стоит —
 * решает этот файл.
 *
 * Вес называется до начала. Гигабайты не должны приезжать неожиданно: человек нажимает
 * кнопку между делом, а не подписывается на получасовую загрузку. Цифры замерены на
 * живой установке; модели докачиваются при первом синтезе, и это тоже сказано заранее.
 */
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { REGISTRY } from './registry.mjs';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(DIR, '..');

/**
 * Python для синтеза. Не всякий подходит: MLX живёт и на свежих версиях, а torch и
 * chatterbox отстают от Python на версию-две. Поэтому venv два и у каждого свой
 * интерпретатор — втискивать torch в рабочую MLX-venv значило бы сломать её.
 */
function findPython(versions) {
  for (const v of versions) {
    const name = v === '3' ? 'python3' : `python${v}`;
    if (spawnSync(name, ['--version'], { stdio: 'ignore' }).status === 0) return name;
  }
  return null;
}


const id = process.argv[2];

if (!id || id === '--list') {
  console.log('Что можно поставить:\n');
  for (const [key, r] of Object.entries(REGISTRY)) {
    console.log(`  takt install ${key.padEnd(18)} ${r.name}`);
    console.log(`  ${' '.repeat(31)}${r.size}${r.note ? `; ${r.note}` : ''}`);
  }
  process.exit(id ? 0 : 1);
}

const entry = REGISTRY[id];
if (!entry) {
  // Реестр закрытый: неизвестный идентификатор — это отказ, а не попытка угадать.
  console.error(`Не знаю возможности «${id}». Список: takt install --list`);
  process.exit(1);
}

let py = null;
if (entry.python) {
  py = findPython(entry.python);
  if (!py) {
    const версии = entry.python.filter((v) => v !== '3').join(' / ');
    console.error(`${entry.name}: нужен Python ${версии}, в системе его нет.\n`
      + `Поставьте, например: brew install python@${entry.python[0]}`);
    process.exit(1);
  }
}

console.log(`${entry.name}\n${entry.size}${entry.note ? `\n${entry.note}` : ''}\n`);

const runStep = (argv) => new Promise((resolve, reject) => {
  console.log('  $', argv.join(' '));
  const child = spawn(argv[0], argv.slice(1), { stdio: 'inherit', cwd: ROOT });
  child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`код ${code}`))));
  child.on('error', reject);
});

try {
  for (const step of entry.steps(py)) await runStep(step);
  console.log(`\nГотово. Проверить: takt doctor`);
} catch (e) {
  console.error(`\nУстановка «${id}» не завершилась: ${e.message}`);
  console.error('Состояние покажет takt doctor; шаги можно повторить — они идемпотентны.');
  process.exit(1);
}
