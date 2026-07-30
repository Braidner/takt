# `takt start` / `takt update` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Одна команда `takt start` — добутстрап, студия в фоне, открытый сайт; одна команда `takt update` — обновление кода и перезапуск. Venv озвучки переезжают в `$TAKT_HOME/venvs/`, чтобы переживать обновления.

**Architecture:** Общая механика (добутстрап, миграция venv, запуск/остановка студии, открытие сайта) — в новом модуле `studio/bootstrap.mjs`; `studio/start.mjs` и `studio/update.mjs` — тонкие оркестраторы поверх него. Пути venv задаются в одном месте (`registry.mjs`, поверх `home.mjs`), остальные читают оттуда.

**Tech Stack:** Node 20+ (ESM, node:child_process), без новых зависимостей. Тестовой инфраструктуры в репозитории нет — проверка ручными командами с ожидаемым выводом, как принято здесь.

## Global Constraints

- Комментарии и сообщения пользователю — по-русски, в стиле репозитория: объясняют «почему», а не «что».
- Шаги установки — argv-массивы, не строки шелла (см. `studio/registry.mjs`).
- Данные живут в `$TAKT_HOME` (по умолчанию `~/takt`), код — в каталоге скилла; ничего из данных не коммитится.
- Порт студии: `TAKT_PORT` || 4173.
- Спека: `specs/2026-07-30-takt-start-design.md`.

---

### Task 1: Venv переезжают в `$TAKT_HOME/venvs/` (пути)

**Files:**
- Modify: `studio/home.mjs` (после строки 40, `SERVER_INFO`)
- Modify: `studio/registry.mjs:9-19` (импорты и константы venv)
- Modify: `studio/registry.mjs:50-57` (pip через `python -m pip`)
- Modify: `studio/registry.mjs:67-70` (то же для chatterbox)
- Modify: `studio/doctor.mjs:67-71` (пути venv из registry)
- Modify: `cli.mjs:99-101` (выбор интерпретатора для `.py`)
- Modify: `studio/engines/chatterbox.py:24-27` (путь к venv-chatterbox)

**Interfaces:**
- Produces: `home.mjs` экспортирует `VENVS` (string, `$TAKT_HOME/venvs`); `registry.mjs` экспортирует `VENV_TTS`, `VENV_CHATTERBOX` — теперь под `VENVS`. Task 2 (`migrateVenvs`) и Task 3+ полагаются на эти константы.

- [ ] **Step 1: `home.mjs` — экспорт `VENVS`**

После строки `export const SERVER_INFO = ...`:

```js
// Окружения озвучки. Это данные, а не код: обновление скилла может перезаписать
// каталог кода целиком, а переустановка гигабайтов синтеза этого пережить не должна.
export const VENVS = path.join(HOME, 'venvs');
```

- [ ] **Step 2: `registry.mjs` — venv под `VENVS`, pip через `-m pip`**

Заменить импорты и константы (строки 9–19):

```js
import fs from 'node:fs';
import path from 'node:path';
import { VENVS } from './home.mjs';

export const APPLE = process.platform === 'darwin' && process.arch === 'arm64';
export const BIN = process.platform === 'win32' ? 'Scripts' : 'bin';
export const PY = process.platform === 'win32' ? 'python.exe' : 'python3';
// Внутри $TAKT_HOME, а не рядом с кодом: см. комментарий у VENVS в home.mjs.
export const VENV_TTS = path.join(VENVS, 'venv-tts');
export const VENV_CHATTERBOX = path.join(VENVS, 'venv-chatterbox');
```

(`fileURLToPath` и `DIR` из registry.mjs удалить — больше не нужны.)

В `voice-qwen.steps` заменить вызов pip-бинаря на `python -m pip` — после переноса
venv шебанги её скриптов указывают на старый путь, а собственный python работает от
своего расположения:

```js
    steps: (py) => {
      const pip = [path.join(VENV_TTS, BIN, PY), '-m', 'pip', 'install', '--quiet'];
      const пакеты = APPLE
        ? ['mlx-audio', 'faster-whisper']
        : ['torch', 'qwen3-tts', 'faster-whisper', 'soundfile'];
      return [
        fs.existsSync(VENV_TTS) ? null : [py, '-m', 'venv', VENV_TTS],
        [...pip, ...пакеты],
      ].filter(Boolean);
    },
```

В `voice-chatterbox.steps` — так же:

```js
    steps: (py) => [
      fs.existsSync(VENV_CHATTERBOX) ? null : [py, '-m', 'venv', VENV_CHATTERBOX],
      [path.join(VENV_CHATTERBOX, BIN, PY), '-m', 'pip', 'install', '--quiet', 'chatterbox-tts'],
    ].filter(Boolean),
```

- [ ] **Step 3: `doctor.mjs` — пути из registry**

Заменить строки 67–71:

```js
import { REGISTRY, VENV_TTS, VENV_CHATTERBOX, BIN, PY } from './registry.mjs';
```

(вместо `import { REGISTRY } from './registry.mjs';` на строке 22; локальные `const BIN`,
`const PY` на строках 67–68 удалить) и:

```js
const venvPython = path.join(VENV_TTS, BIN, PY);
// У Chatterbox своя venv с более старым Python: в рабочую MLX-venv он не встаёт.
const chatterPython = path.join(VENV_CHATTERBOX, BIN, PY);
```

- [ ] **Step 4: `cli.mjs` — интерпретатор из нового пути**

Заменить строки 99–101:

```js
const python = file.endsWith('.py');
let runner = process.execPath;
if (python) {
  const { VENV_TTS, BIN, PY } = await import('./studio/registry.mjs');
  const venvPy = path.join(VENV_TTS, BIN, PY);
  runner = fs.existsSync(venvPy) ? venvPy : 'python3';
}
```

- [ ] **Step 5: `chatterbox.py` — venv из `$TAKT_HOME`**

Заменить строки 24–27 (cli.mjs передаёт питону `TAKT_HOME` окружением — см. его
строки 103–111):

```python
DIR = os.path.dirname(os.path.abspath(__file__))
BIN = "Scripts" if os.name == "nt" else "bin"
_HOME = os.environ.get("TAKT_HOME", os.path.expanduser(os.path.join("~", "takt")))
WORKER_PY = os.path.join(_HOME, "venvs", "venv-chatterbox", BIN,
                         "python.exe" if os.name == "nt" else "python3")
```

- [ ] **Step 6: Проверить doctor**

Run: `node cli.mjs doctor`
Expected: отчёт печатается без ошибок; озвучка показана как недоступная (venv ещё в старом месте — миграция в Task 2) или доступная, если её не было вовсе. Ошибок импорта нет.

- [ ] **Step 7: Commit**

```bash
git add studio/home.mjs studio/registry.mjs studio/doctor.mjs cli.mjs studio/engines/chatterbox.py
git commit -m "Venv озвучки: пути переезжают в \$TAKT_HOME/venvs"
```

---

### Task 2: `studio/bootstrap.mjs` — общая механика

**Files:**
- Create: `studio/bootstrap.mjs`

**Interfaces:**
- Consumes: `home.mjs` (`VENVS`, `SERVER_INFO`, `ensureHome`, `inHome`), Task 1.
- Produces (для Task 3 и 4):
  - `ROOT: string` — корень скилла;
  - `URL: string` — `http://localhost:<порт>`;
  - `studioStatus(): Promise<'alive'|'foreign'|'down'>`;
  - `ensureDeps(): Promise<void>` — npm install + Chromium, идемпотентно;
  - `migrateVenvs(): void` — перенос старых `studio/venv-*`;
  - `launchStudio(): Promise<{url: string, reused: boolean}>` — поднять или переиспользовать; при чужом порте или таймауте печатает причину и `process.exit(1)`;
  - `stopStudio(): Promise<boolean>` — остановить по pid;
  - `openSite(url: string): void`.

- [ ] **Step 1: Написать модуль целиком**

```js
/**
 * Общая механика start и update: добутстрап, миграция venv, студия в фоне.
 *
 * Вынесено в модуль, потому что update — это «обнови код и сделай то же, что start,
 * не открывая браузер»: дублировать запуск с его таймаутами и диагностикой в двух
 * скриптах значило бы чинить каждый баг дважды.
 */
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { VENVS, SERVER_INFO, ensureHome, inHome } from './home.mjs';

const DIR = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.join(DIR, '..');
const PORT = Number(process.env.TAKT_PORT || 4173);
export const URL = `http://localhost:${PORT}`;

/**
 * Кто на порту. Отличаем свою студию от чужого процесса по форме ответа /api/hello:
 * занятый порт — это не «студия не поднялась», и совет человеку разный.
 */
export async function studioStatus() {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 1500);
  try {
    const r = await fetch(`${URL}/api/hello`, { signal: ctrl.signal });
    clearTimeout(t);
    if (!r.ok) return 'foreign';
    const data = await r.json().catch(() => null);
    return data && typeof data.token === 'string' ? 'alive' : 'foreign';
  } catch {
    clearTimeout(t);
    return 'down';
  }
}

function step(argv) {
  console.log('  $', argv.join(' '));
  const r = spawnSync(argv[0], argv.slice(1), { stdio: 'inherit', cwd: ROOT });
  if (r.status !== 0) {
    console.error(`\n«${argv.join(' ')}» не завершилась (код ${r.status ?? r.signal}). `
      + 'Студию не поднимаю: без этого она не работает.');
    process.exit(1);
  }
}

/**
 * Обязательные зависимости. skills CLI умеет только копировать файлы, поэтому
 * установка живёт здесь: первый запуск доставляет недостающее, повторные проходят
 * проверки мгновенно и ничего не качают.
 */
export async function ensureDeps() {
  if (!fs.existsSync(path.join(ROOT, 'node_modules', 'playwright'))) {
    step(['npm', 'install', '--no-audit', '--no-fund']);
  }
  let chromiumOk = false;
  try {
    const { chromium } = await import('playwright');
    chromiumOk = fs.existsSync(chromium.executablePath());
  } catch { /* пакет не встал — step выше уже отчитался бы; падаем на установку браузера */ }
  if (!chromiumOk) step(['npx', 'playwright', 'install', 'chromium']);
}

/**
 * Venv переезжают из кода в данные. Обновление через skills CLI может перезаписать
 * каталог кода целиком — установленная на полчаса озвучка этого пережить обязана.
 * Перенесённой venv можно пользоваться: python разрешает prefix от своего
 * расположения, а pip мы зовём через «python -m pip», не через шебанги скриптов.
 */
export function migrateVenvs() {
  for (const name of ['venv-tts', 'venv-chatterbox']) {
    const old = path.join(DIR, name);
    const now = path.join(VENVS, name);
    if (!fs.existsSync(old) || fs.existsSync(now)) continue;
    fs.mkdirSync(VENVS, { recursive: true });
    try {
      fs.renameSync(old, now);
      console.log(`Озвучка переехала: studio/${name} → ${now}`);
    } catch {
      console.error(`Не удалось перенести studio/${name} в ${now} (другой диск?).\n`
        + 'Переставьте озвучку из панели «Окружение», старый каталог после этого можно удалить.');
    }
  }
}

/** Поднять студию в фоне или переиспользовать живую. */
export async function launchStudio() {
  const status = await studioStatus();
  if (status === 'alive') return { url: URL, reused: true };
  if (status === 'foreign') {
    console.error(`Порт ${PORT} занят не студией. Освободите его или задайте другой: `
      + 'TAKT_PORT=5000 takt start');
    process.exit(1);
  }
  ensureHome();
  const log = inHome('logs', 'studio.log');
  const fd = fs.openSync(log, 'a');
  const child = spawn(process.execPath, [path.join(DIR, 'server.mjs')],
    { detached: true, stdio: ['ignore', fd, fd], cwd: ROOT });
  child.unref();
  fs.closeSync(fd);
  for (let i = 0; i < 40; i++) {          // до ~10 секунд
    await new Promise((r) => setTimeout(r, 250));
    if (await studioStatus() === 'alive') return { url: URL, reused: false };
  }
  console.error(`Студия не ответила за 10 секунд. Хвост лога (${log}):\n`);
  try {
    console.error(fs.readFileSync(log, 'utf8').trimEnd().split('\n').slice(-15).join('\n'));
  } catch { /* лога нет — сервер не дожил даже до него */ }
  process.exit(1);
}

/** Остановить студию по pid из server.json — для перезапуска после обновления. */
export async function stopStudio() {
  if (!fs.existsSync(SERVER_INFO)) return false;
  let pid;
  try { ({ pid } = JSON.parse(fs.readFileSync(SERVER_INFO, 'utf8'))); } catch { return false; }
  if (!pid) return false;
  try { process.kill(pid); } catch { return false; }   // процесса уже нет
  for (let i = 0; i < 20; i++) {
    await new Promise((r) => setTimeout(r, 250));
    try { process.kill(pid, 0); } catch { return true; }
  }
  try { process.kill(pid, 'SIGKILL'); } catch { /* успел умереть сам */ }
  return true;
}

/** Открыть сайт в браузере человека. */
export function openSite(url) {
  const [cmd, args] = process.platform === 'darwin' ? ['open', [url]]
    : process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]]
    : ['xdg-open', [url]];
  spawn(cmd, args, { detached: true, stdio: 'ignore' }).unref();
}
```

- [ ] **Step 2: Проверить, что модуль загружается**

Run: `node -e "import('./studio/bootstrap.mjs').then(m => console.log(Object.keys(m).join(' ')))"`
Expected: `ROOT URL ensureDeps launchStudio migrateVenvs openSite stopStudio studioStatus` (порядок может отличаться).

- [ ] **Step 3: Commit**

```bash
git add studio/bootstrap.mjs
git commit -m "Bootstrap: общая механика запуска, добутстрапа и миграции venv"
```

---

### Task 3: `takt start`

**Files:**
- Create: `studio/start.mjs`
- Modify: `cli.mjs:25-40` (регистрация команды)

**Interfaces:**
- Consumes: всё из `bootstrap.mjs` (Task 2).
- Produces: команда `takt start [--no-open]`; последняя строка stdout — JSON `{ok, url, studio: 'started'|'reused'}` (агент читает её, человеку выше — человеческий текст).

- [ ] **Step 1: Написать `studio/start.mjs`**

```js
/**
 * takt start — единственная команда, которую нужно знать.
 *
 * Ставит недостающее (npm-зависимости, браузер), поднимает студию в фоне, открывает
 * сайт. Повторный запуск при живой студии мгновенен и второй не поднимает.
 *
 * --no-open — не открывать браузер: для повторных вызовов агентом, когда вкладка
 * у человека уже открыта.
 */
import { ensureDeps, migrateVenvs, launchStudio, openSite } from './bootstrap.mjs';

const noOpen = process.argv.includes('--no-open');

migrateVenvs();
await ensureDeps();
const { url, reused } = await launchStudio();
if (!noOpen) openSite(url);

console.log(reused ? `Студия уже работает: ${url}` : `Студия поднята: ${url}`);
console.log(JSON.stringify({ ok: true, url, studio: reused ? 'reused' : 'started' }));
```

- [ ] **Step 2: Зарегистрировать в `cli.mjs`**

В `COMMANDS` первой строкой (перед `serve`):

```js
  start:    { file: 'studio/start.mjs',       help: 'поставить недостающее, поднять студию в фоне, открыть сайт' },
```

- [ ] **Step 3: Проверить повторный запуск при живой студии**

Run: `node cli.mjs start --no-open && node cli.mjs start --no-open`
Expected: обе команды завершаются быстро; первая — `Студия поднята` (или `уже работает`, если была), вторая — `Студия уже работает`; JSON-строка в конце каждой.

- [ ] **Step 4: Проверить чистый запуск**

Остановить студию (pid из `~/takt/server.json`), затем:

Run: `node cli.mjs start`
Expected: студия поднята, браузер открыл `http://localhost:4173`, команда завершилась (сервер жив: `node cli.mjs poll --help` или повторный `start` говорит `уже работает`).

- [ ] **Step 5: Проверить `poll` сразу после `start`**

Run: `node cli.mjs start --no-open && node cli.mjs target`
Expected: `target` (команда с флагом `studio:`) не жалуется «студия не запущена».

- [ ] **Step 6: Commit**

```bash
git add studio/start.mjs cli.mjs
git commit -m "takt start: добутстрап, студия в фоне, открытый сайт"
```

---

### Task 4: `takt update`

**Files:**
- Create: `studio/update.mjs`
- Modify: `cli.mjs:25-40` (регистрация команды)

**Interfaces:**
- Consumes: `ROOT`, `studioStatus`, `stopStudio`, `ensureDeps`, `migrateVenvs`, `launchStudio` из `bootstrap.mjs` (Task 2).
- Produces: команда `takt update`; выходной код 0 при успехе (включая «уже последняя»), 1 при локальных правках или упавшем обновлении.

- [ ] **Step 1: Написать `studio/update.mjs`**

```js
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

migrateVenvs();
await ensureDeps();

if (wasAlive) {
  await stopStudio();
  const { url } = await launchStudio();
  console.log(`Студия перезапущена: ${url} — открытая страница переподключится сама.`);
} else {
  console.log('Студия не работала — поднимется при следующем takt start.');
}
```

- [ ] **Step 2: Зарегистрировать в `cli.mjs`**

В `COMMANDS` после `start`:

```js
  update:   { file: 'studio/update.mjs',      help: 'обновить скилл и перезапустить студию' },
```

- [ ] **Step 3: Проверить стоп при локальных правках**

Run: `touch _probe && node cli.mjs update; echo "exit=$?"; rm _probe`
Expected: сообщение про локальные правки, `git status --short` с `?? _probe`, `exit=1`; студия не тронута.

- [ ] **Step 4: Проверить обновление на чистом дереве**

Run: `node cli.mjs start --no-open && node cli.mjs update`
Expected: `Уже последняя версия.` (дерево чистое, upstream совпадает), затем `Студия перезапущена: http://localhost:4173`; открытая вкладка студии переподключилась (SSE) без перезагрузки руками.

- [ ] **Step 5: Commit**

```bash
git add studio/update.mjs cli.mjs
git commit -m "takt update: git pull или skills update, добутстрап, перезапуск студии"
```

---

### Task 5: SKILL.md и README

**Files:**
- Modify: `SKILL.md:44-59` (раздел «Запуск»)
- Modify: `README.md` (раздел «Quick Start», строки ~86-104)

**Interfaces:**
- Consumes: команды `takt start` / `takt update` (Task 3, 4).

- [ ] **Step 1: SKILL.md — раздел «Запуск»**

Заменить текущий блок (строки 44–51):

```markdown
## Запуск

```bash
takt start   # ставит недостающее, поднимает студию в фоне, открывает сайт
takt poll    # сразу после — сесть на события
```

`start` идемпотентен: живую студию он переиспользует, а при первом запуске сам
доставляет npm-зависимости и браузер. Сразу после него уходи в `takt poll` фоновой
задачей — человек должен увидеть «агент на связи», а не инструкцию открыть адрес.

Просят обновить Takt — `takt update`: он подтянет код (git или skills CLI), перезапустит
студию, и после этого снова садись в `takt poll`.
```

(Остальное в разделе — «Первым делом прочитай цель» и далее — без изменений.)

- [ ] **Step 2: README — Quick Start**

Заменить текущий Quick Start (команды и два абзаца после них):

```markdown
## Quick Start

```bash
npx skills add Braidner/takt
```

Then, in Claude Code:

```
/takt start
```

That's it. On first run it installs what's missing (npm dependencies, the capture
browser), starts the studio in the background, opens http://localhost:4173, and the
agent attaches to studio events. Update anytime with `/takt update`.

Running without an agent? `node cli.mjs start` does the same from the terminal.
Optional capabilities — narration engines, Remotion editing — are installed from the
**Environment** panel in the studio, each with its download size shown up front.

The target system's URL and credentials are entered **in the studio itself** — click the
stand chip in the header. The password stays on your machine: it never lands in the repo
and is never echoed back to the browser.
```

(Абзац «From there, everything happens in the studio…» остаётся.)

- [ ] **Step 3: Согласовать раздел Requirements в README**

В разделе Requirements README убрать строку про ручной `npm install`: заменить
`- Node 20+ and \`npm install\`` на `- Node 20+ (everything else is installed by
\`takt start\` on first run)`.

- [ ] **Step 4: Commit**

```bash
git add SKILL.md README.md
git commit -m "Документация: takt start и takt update как единственные точки входа"
```

---

### Task 6: Сквозная проверка по спеке

**Files:** нет новых; сценарии из `specs/2026-07-30-takt-start-design.md`, раздел «Проверка».

- [ ] **Step 1: Чистая установка**

```bash
mv node_modules /tmp/nm-backup 2>/dev/null; node cli.mjs start --no-open
```

Expected: `npm install` и (если браузера нет) установка Chromium отрабатывают с видимым прогрессом, студия поднимается. После проверки при желании вернуть кеш: `rm -rf node_modules && mv /tmp/nm-backup node_modules`.

- [ ] **Step 2: Сценарии 2–6 спеки**

- повторный `node cli.mjs start --no-open` при живой студии → мгновенно, `reused`;
- `node cli.mjs target` после `start` → без «студия не запущена»;
- `node cli.mjs update` на чистом дереве → pull/«последняя версия», студия перезапущена;
- `touch _probe && node cli.mjs update` → стоп с `git status`, `rm _probe`;
- при наличии старой `studio/venv-tts`: `node cli.mjs start --no-open` → каталог оказался в `~/takt/venvs/venv-tts`, `node cli.mjs doctor` показывает озвучку доступной.

Expected: все сценарии сходятся с «Проверкой» из спеки.

- [ ] **Step 3: Финальный коммит (если были правки по итогам) и пуш**

```bash
git push
```
