/**
 * Разведка интерфейса перед написанием сценария.
 *
 * Разделение здесь принципиальное: скрипт собирает ФАКТЫ (что реально есть на экране), а
 * сценарий по ним пишет модель. Обратный порядок — писать сценарий по памяти и надеяться,
 * что элементы совпадут — даёт падение съёмки на середине, а это минуты ожидания впустую.
 *
 * Интерфейс не угадывается: разделы называются не так, как пункты меню, списки бывают и
 * таблицей, и карточками, а половина кнопок появляется только после клика в нужное место.
 *
 *   node studio/probe-stend.mjs                 корень стенда
 *   node studio/probe-stend.mjs '#/broker'      конкретный раздел
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { login } from '../capture/lib/stend.mjs';
import { readConfig } from './resolve-stend.mjs';
import { dismissDevOverlay } from './dismiss-overlay.mjs';
import { loadPreset } from './preset.mjs';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const cfg = readConfig();
if (!cfg.stend) {
  console.error('Стенд не выбран: node studio/check-stend.mjs <адрес>');
  process.exit(1);
}

const hash = process.argv[2] || '';
const url = cfg.stend.replace(/#.*$/, '') + hash;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 810 } });
await page.addInitScript((p) => {
  if (p.language) window.localStorage.setItem(p.language.key, p.language.value);
  if (p.theme) window.localStorage.setItem(p.theme.key, p.theme.value);
}, loadPreset());
await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 90000 });
await page.waitForTimeout(4000);
await login(page, cfg.creds || {});
await page.waitForTimeout(2500);
// Оверлей ошибок dev-сервера закрывает собой всё приложение: без этого разведка
// возвращает пустоту, а причина не видна.
const hadOverlay = await dismissDevOverlay(page);
await page.waitForTimeout(500);

const facts = await page.evaluate(() => {
  const text = (el) => (el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 80);
  const visible = (el) => {
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };
  // textContent захватывает и содержимое <style> внутри встроенных SVG-иконок:
  // в списке меню появляются куски CSS вместо названий разделов.
  const looksLikeCss = (t) => /[{;]\s*[a-z-]+\s*:/i.test(t) || t.startsWith('.');
  const uniq = (arr) => [...new Set(arr.filter((t) => t && !looksLikeCss(t)))];

  return {
    title: document.title,
    menu: uniq([...document.querySelectorAll('nav a, .ant-menu-item, .ant-menu-submenu-title')]
      .filter(visible).map(text)).slice(0, 30),
    headings: uniq([...document.querySelectorAll('h1, h2, h3, .ant-card-head-title, .ant-page-header-heading-title')]
      .filter(visible).map(text)).slice(0, 20),
    buttons: uniq([...document.querySelectorAll('button, .ant-btn')]
      .filter(visible).map(text).filter((t) => t.length > 1)).slice(0, 30),
    tabs: uniq([...document.querySelectorAll('.ant-tabs-tab')].filter(visible).map(text)).slice(0, 15),
    columns: uniq([...document.querySelectorAll('th')].filter(visible).map(text)).slice(0, 20),
    rows: [...document.querySelectorAll('tbody tr')].filter(visible).length,
    cards: [...document.querySelectorAll('.ant-card')].filter(visible).length,
    inputs: uniq([...document.querySelectorAll('input[placeholder]')]
      .filter(visible).map((i) => i.placeholder)).slice(0, 15),
  };
});

// Скриншот обязателен: текстовые факты не показывают, ЧТО из этого крупное и заметное в
// кадре, а сценарий пишется для зрителя, а не для парсера.
const shot = path.join(DIR, 'journal', 'probe.png');
await page.screenshot({ path: shot });
await browser.close();

console.log(JSON.stringify({ url, devOverlay: hadOverlay, ...facts, screenshot: shot }, null, 1));
