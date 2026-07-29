/**
 * Откуда берётся адрес стенда.
 *
 * Спрашивать человека о том, что можно вывести из проекта, — плохой первый экран: он уже
 * сказал, что снимать, и ждёт результата, а не анкету. Поэтому адрес ищется по цепочке и
 * вопрос задаётся только тогда, когда его нет нигде.
 *
 * Порядок намеренно такой:
 *   1. переменная TAKT_STEND — разовый перекрыв для одной съёмки, ничего не записывает;
 *   2. ЦЕЛЬ ТЕКУЩЕГО ПРОЕКТА — ролик знает, про какую систему он снят, и адрес берётся
 *      оттуда. Это главный путь, когда роликов несколько и системы разные: без него
 *      переключение проекта оставляло бы прежний стенд, и второй ролик снимался бы не
 *      про то, что заявлено в его названии;
 *   3. takt.json — общая настройка, когда система всего одна и цель заводить незачем;
 *   4. цели из пресета — проверяем, что из описанного уже поднято локально.
 *
 * Найденное записывается, чтобы вопрос не повторялся.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadPreset } from './preset.mjs';
import { HOME } from './home.mjs';
import { currentTarget } from './project.mjs';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const CONFIG = path.join(HOME, 'takt.json');
const LEGACY_CONFIG = path.join(DIR, 'takt.json');

// Раскладка первых версий держала настройки рядом с кодом. Переносим один раз и молча:
// человек в этот момент занят роликом, а не переездом файлов.
if (!fs.existsSync(CONFIG) && fs.existsSync(LEGACY_CONFIG)) {
  fs.mkdirSync(path.dirname(CONFIG), { recursive: true });
  fs.copyFileSync(LEGACY_CONFIG, CONFIG);
}

async function localAlive(url) {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 2500);
    const r = await fetch(url, { signal: ctrl.signal, redirect: 'manual' });
    clearTimeout(t);
    return r.status < 500;
  } catch { return false; }
}

export function readConfig() {
  const base = (() => {
    try { return JSON.parse(fs.readFileSync(CONFIG, 'utf8')); } catch { return {}; }
  })();

  // Цель перекрывает общую настройку: у каждой системы свой адрес и свой вход, и путать
  // их между роликами — самая дорогая ошибка, потому что обнаруживается она уже в кадре.
  const target = currentTarget();
  if (!target?.url) return base;
  return { ...base, stend: target.url, creds: { ...(base.creds || {}), ...(target.creds || {}) } };
}

export function saveConfig(patch) {
  const stored = (() => {
    try { return JSON.parse(fs.readFileSync(CONFIG, 'utf8')); } catch { return {}; }
  })();
  const next = { ...stored, ...patch };
  fs.mkdirSync(path.dirname(CONFIG), { recursive: true });
  fs.writeFileSync(CONFIG, JSON.stringify(next, null, 2) + '\n');
  return next;
}

/**
 * Источник адреса едет до интерфейса ключом, а не фразой: показывает его студия, а она
 * двуязычная. Готовая строка остаётся рядом — её читают в консоли и в журнале, где
 * словаря нет.
 */
export async function resolveStend() {
  if (process.env.TAKT_STEND) {
    return { url: process.env.TAKT_STEND, from: 'переменная TAKT_STEND', fromKey: 'env', saved: false };
  }

  const target = currentTarget();
  if (target?.url) {
    return { url: target.url, from: `цель «${target.name || target.slug}»`, fromKey: 'target',
             fromArgs: { name: target.name || target.slug }, saved: true, creds: target.creds };
  }

  const cfg = readConfig();
  if (cfg.stend) {
    return { url: cfg.stend, from: 'takt.json', fromKey: 'config', saved: true, creds: cfg.creds };
  }

  // Цели из пресета проверяем по очереди: если что-то из описанного уже поднято,
  // это почти наверняка то, что человек и собирался снимать.
  const preset = loadPreset();
  for (const [name, url] of Object.entries(preset.targets || {})) {
    if (await localAlive(url)) {
      saveConfig({ stend: url });
      return { url, from: `цель «${name}» из пресета`, fromKey: 'preset', fromArgs: { name }, saved: true };
    }
  }

  return null;   // спросить у человека — единственный оставшийся вариант
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const found = await resolveStend();
  console.log(JSON.stringify(found ?? { error: 'не найден' }, null, 1));
}
