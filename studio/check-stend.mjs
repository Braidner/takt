/**
 * Проверка стенда перед всякой съёмкой: открыть, войти, снять кадр.
 *
 * Это самая дешёвая проверка во всём конвейере и она ловит три разные поломки, которые
 * иначе всплывут через несколько минут — уже посреди прогона, когда человек ждёт ролик:
 * стенд не отвечает, приложение отдаёт SPA, но бэкенд ещё не поднялся, учётные данные не
 * подходят. Каждая лечится по-своему, поэтому и различаются в ответе, а не сводятся к
 * общему «не удалось подключиться».
 *
 *   node studio/check-stend.mjs [адрес]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { login, stendUrl } from '../capture/lib/stend.mjs';
import { readConfig, resolveStend, saveConfig } from './resolve-stend.mjs';
import { dismissDevOverlay } from './dismiss-overlay.mjs';
import { loadPreset } from './preset.mjs';
import { SERVER_INFO } from './home.mjs';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const info = JSON.parse(fs.readFileSync(SERVER_INFO, 'utf8'));
const api = (route, payload) =>
  fetch(`http://localhost:${info.port}${route}?token=${info.token}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }).then((r) => r.json());

/**
 * Состояние уходит в студию парой: готовая фраза и ключ словаря к ней. Фразу читают в
 * журнале и в консоли, ключ — интерфейс, который двуязычен и собирает строку сам.
 * Отправлять только текст значило бы оставить шапку студии на русском при английском
 * интерфейсе, а только ключ — сделать журнал нечитаемым без словаря.
 */
const report = (patch) => api('/api/stend', patch);
const where = () => ({ url: target.url, from: target.from, fromKey: target.fromKey,
                       fromArgs: target.fromArgs });

const arg = process.argv[2];
let target = arg
  ? { url: stendUrl(arg), from: 'указан вручную', fromKey: 'manual' }
  : await resolveStend();

if (!target) {
  await report({ state: 'unknown', text: 'Адрес стенда не задан', key: 'stendNoAddress',
                 url: null, from: null, fromKey: null });
  console.log(JSON.stringify({ ok: false, reason: 'no_address' }));
  process.exit(2);
}
if (arg) saveConfig({ stend: target.url });

await report({ state: 'checking', text: 'Проверяю доступ', key: 'stendChecking', ...where() });

const creds = readConfig().creds || {};
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 810 } });
await page.addInitScript((p) => {
  if (p.language) window.localStorage.setItem(p.language.key, p.language.value);
  if (p.theme) window.localStorage.setItem(p.theme.key, p.theme.value);
}, loadPreset());

let result;
try {
  // networkidle не наступает никогда: приложения с живыми соединениями в это состояние
  // не приходят. Холодная система после деплоя отвечает не сразу — отсюда запас.
  const response = await page.goto(target.url, { waitUntil: 'domcontentloaded', timeout: 90000 });
  await page.waitForTimeout(4000);
  await login(page, creds);

  // Панель ошибок dev-сервера состоит из блоков и прошла бы проверку «есть живое
  // дерево», выдав сломанный стенд за рабочий. Снимаем её до проверки и до кадра.
  const hadOverlay = await dismissDevOverlay(page);
  await page.waitForTimeout(400);

  const shot = await page.screenshot({ type: 'jpeg', quality: 62 });
  await api('/api/frame', { frame: `data:image/jpeg;base64,${shot.toString('base64')}` });

  // Успех подтверждается наличием интерфейса, а не отсутствием формы входа. Разница не
  // теоретическая: система, отдающая 500 на странице входа, показывает голый JSON ошибки —
  // поля пароля там тоже нет, и проверка «нет формы, значит вошли» рапортует об успехе,
  // пока в кадре стоит ошибка.
  const status = response?.status() ?? 0;
  const stillLogin = await page.locator('input[type="password"]:visible').count();
  const hasUi = await page.evaluate((ready) => {
    const root = document.querySelector(ready);
    // Страница ошибки — это body с одним <pre>: считаем интерфейсом только живое дерево.
    return Boolean(root && root.children.length > 0 && document.querySelectorAll('div').length > 5);
  }, loadPreset().ready);

  if (status >= 400) {
    const text = `Стенд отвечает ошибкой ${status}`;
    result = { ok: false, reason: 'http_error', status, text };
    await report({ state: 'error', text, key: 'stendHttpError', args: { status }, ...where() });
  } else if (stillLogin) {
    result = { ok: false, reason: 'auth_failed', text: 'Логин не принят' };
    await report({ state: 'error', text: 'Логин не принят', key: 'stendAuthFailed', ...where() });
  } else if (!hasUi) {
    const text = 'Интерфейс не загрузился';
    result = { ok: false, reason: 'no_ui', text };
    await report({ state: 'error', text, key: 'stendNoUi', ...where() });
  } else {
    result = { ok: true, url: target.url, from: target.from, devOverlay: hadOverlay };
    await report({ state: 'ok', text: 'Стенд подключён', key: 'stendOk', ...where() });
  }
} catch (e) {
  const timeout = /Timeout|timeout/.test(e.message);
  const text = timeout ? 'Стенд не отвечает' : 'Не удалось открыть стенд';
  result = { ok: false, reason: timeout ? 'timeout' : 'open_failed', text, detail: e.message.slice(0, 160) };
  await report({ state: 'error', text, key: timeout ? 'stendTimeout' : 'stendOpenFailed', ...where() });
} finally {
  await browser.close();
}

console.log(JSON.stringify(result));
process.exit(result.ok ? 0 : 1);
