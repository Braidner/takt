#!/usr/bin/env node
/**
 * Takt — единая точка входа.
 *
 * Команды существуют не ради красоты. Инструкция агента (SKILL.md) описывает работу
 * командами, а не путями к файлам: пока она знала внутренности вроде `node
 * studio/shoot.mjs`, любая перестановка файлов молча ломала документацию — а заметно это
 * становилось в тот момент, когда агент по ней уже работал.
 *
 * Команда — граница. Внутри всё можно двигать, снаружи договор держится.
 *
 * Скрипты запускаются дочерним процессом, а не импортом: каждый из них рассчитан на
 * самостоятельный запуск, читает свои аргументы и завершается своим кодом возврата.
 * Импорт превратил бы `process.exit` в середине чужого скрипта в остановку всего CLI.
 */
import { spawn } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const DIR = path.dirname(fileURLToPath(import.meta.url));

// studio: команда разговаривает с запущенной студией. Такие скрипты пишут в неё прогресс
// и читают текущий проект, поэтому без неё осмысленно работать не могут.
const COMMANDS = {
  start:    { file: 'studio/start.mjs',       help: 'поставить недостающее, поднять студию в фоне, открыть сайт' },
  update:   { file: 'studio/update.mjs',      help: 'обновить скилл и перезапустить студию' },
  serve:    { file: 'studio/server.mjs',      help: 'поднять студию (http://localhost:4173)' },
  poll:     { file: 'studio/poll.mjs',        help: 'ждать событий от человека (длинный опрос)', studio: true },
  check:    { file: 'studio/check-stend.mjs', help: 'проверить доступ к системе и вход', studio: true },
  probe:    { file: 'studio/probe-stend.mjs', help: 'разведать интерфейс: разделы, кнопки, скриншот', studio: true },
  scenario: { file: 'studio/scenario.mjs',    help: 'отправить сценарий в студию', studio: true },
  shoot:    { file: 'studio/shoot.mjs',       help: 'снять по утверждённому сценарию', studio: true },
  build:    { file: 'studio/build.mjs',       help: 'собрать ролик из последнего дубля', studio: true },
  track:    { file: 'studio/build-track.mjs', help: 'собрать дикторскую дорожку и подмешать в ролик', studio: true },
  narrate:  { file: 'studio/narrate.py',      help: 'синтезировать реплики клонированным голосом', studio: true },
  voice:    { file: 'studio/prepare-voice.mjs', help: 'подготовить добавленный голос', studio: true },
  target:   { file: 'studio/target.mjs',      help: 'что известно про снимаемую систему' },
  export:   { file: 'studio/export.mjs',      help: 'выгрузить ролик со сценарием и текстом' },
  doctor:   { file: 'studio/doctor.mjs',      help: 'что установлено и что для чего не хватает' },
  install:  { file: 'studio/install.mjs',     help: 'поставить возможность (список: takt install --list)' },
};

/**
 * Студия запущена? Проверяем до запуска команды, потому что иначе человек получает
 * простыню стека undici из недр fetch вместо ответа на свой вопрос. Причина при этом
 * тривиальная и чинится одной командой.
 */
async function studioAlive() {
  const { SERVER_INFO } = await import('./studio/home.mjs');
  if (!fs.existsSync(SERVER_INFO)) return false;
  try {
    const { port } = JSON.parse(fs.readFileSync(SERVER_INFO, 'utf8'));
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 1500);
    const r = await fetch(`http://localhost:${port}/api/hello`, { signal: ctrl.signal });
    clearTimeout(t);
    return r.ok;
  } catch {
    return false;   // файл остался от прошлого запуска, а сервера уже нет
  }
}

const [, , command, ...args] = process.argv;

if (!command || command === 'help' || command === '--help' || command === '-h') {
  const width = Math.max(...Object.keys(COMMANDS).map((c) => c.length));
  console.log('Takt — студия демонстрационных роликов\n\n  takt <команда> [аргументы]\n');
  for (const [name, { help }] of Object.entries(COMMANDS)) {
    console.log(`  ${name.padEnd(width)}  ${help}`);
  }
  console.log('\nДанные лежат в $TAKT_HOME (по умолчанию ~/takt) и переживают переустановку.');
  process.exit(command ? 0 : 1);
}

const entry = COMMANDS[command];
if (!entry) {
  // Опечатка в команде не должна выглядеть как поломка: показываем, что рядом.
  const близкие = Object.keys(COMMANDS).filter((c) => c.startsWith(command[0]));
  console.error(`Нет команды «${command}».`
    + (близкие.length ? ` Может быть: ${близкие.join(', ')}?` : '')
    + '\nСписок команд: takt help');
  process.exit(1);
}

const file = path.join(DIR, entry.file);
if (!fs.existsSync(file)) {
  console.error(`Команда «${command}» есть, а её исполнитель ${entry.file} — нет.`
    + '\nПохоже, установка неполная: проверьте takt doctor.');
  process.exit(1);
}

if (entry.studio && !(await studioAlive())) {
  console.error(`Команда «${command}» работает через студию, а она не запущена.\n`
    + 'Запустите её в отдельном окне: takt serve');
  process.exit(1);
}

// Python-часть (озвучка) ставится отдельно и необязательна: инструмент снимает ролики и
// без неё. Поэтому её отсутствие — не поломка, а понятное сообщение.
const python = file.endsWith('.py');
let runner = process.execPath;
if (python) {
  const { VENV_TTS, BIN, PY } = await import('./studio/registry.mjs');
  const venvPy = path.join(VENV_TTS, BIN, PY);
  runner = fs.existsSync(venvPy) ? venvPy : 'python3';
}

// Каталог данных выбирает home.mjs, но питоновской части он недоступен: импортировать
// модуль Node оттуда нельзя. Разрешённый путь передаётся окружением — но ТОЛЬКО питону:
// Node-скрипты разрешают его сами, а навязанная переменная заставила бы их же врать о
// её источнике («задан переменной», хотя человек ничего не задавал).
const env = { ...process.env };
if (python) {
  const { HOME } = await import('./studio/home.mjs');
  env.TAKT_HOME = HOME;
}

const child = spawn(runner, [file, ...args], { stdio: 'inherit', cwd: DIR, env });
child.on('error', (e) => {
  console.error(e.code === 'ENOENT' && python
    ? 'Python не найден. Озвучка ставится отдельно: takt doctor покажет, чего не хватает.'
    : `Не удалось запустить «${command}»: ${e.message}`);
  process.exit(1);
});
child.on('exit', (code, signal) => process.exit(signal ? 1 : code ?? 0));
