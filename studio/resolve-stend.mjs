/**
 * Откуда берётся адрес стенда.
 *
 * Спрашивать человека о том, что можно вывести из проекта, — плохой первый экран: он уже
 * сказал, что снимать, и ждёт результата, а не анкету. Поэтому адрес ищется по цепочке и
 * вопрос задаётся только тогда, когда его нет нигде.
 *
 * Порядок намеренно такой:
 *   1. переменная TAKT_STEND — разовый перекрыв для одной съёмки, ничего не записывает;
 *   2. studio/takt.json — то, что человек однажды подтвердил; самый частый случай;
 *   3. цели из пресета — если система описана в takt.preset.json, адрес известен оттуда;
 *   4. что-то уже запущенное локально — проверяем адреса из пресета по очереди.
 *
 * Найденное записывается в takt.json, чтобы вопрос не повторялся.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadPreset } from './preset.mjs';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const CONFIG = path.join(DIR, 'takt.json');

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
  try { return JSON.parse(fs.readFileSync(CONFIG, 'utf8')); } catch { return {}; }
}

export function saveConfig(patch) {
  const next = { ...readConfig(), ...patch };
  fs.writeFileSync(CONFIG, JSON.stringify(next, null, 2) + '\n');
  return next;
}

export async function resolveStend() {
  if (process.env.TAKT_STEND) {
    return { url: process.env.TAKT_STEND, from: 'переменная TAKT_STEND', saved: false };
  }

  const cfg = readConfig();
  if (cfg.stend) return { url: cfg.stend, from: 'takt.json', saved: true, creds: cfg.creds };

  // Цели из пресета проверяем по очереди: если что-то из описанного уже поднято,
  // это почти наверняка то, что человек и собирался снимать.
  const preset = loadPreset();
  for (const [name, url] of Object.entries(preset.targets || {})) {
    if (await localAlive(url)) {
      saveConfig({ stend: url });
      return { url, from: `цель «${name}» из пресета`, saved: true };
    }
  }

  return null;   // спросить у человека — единственный оставшийся вариант
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const found = await resolveStend();
  console.log(JSON.stringify(found ?? { error: 'не найден' }, null, 1));
}
