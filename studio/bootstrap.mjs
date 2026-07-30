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
  } catch { /* пакет не встал — падаем ниже на установку браузера */ }
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
