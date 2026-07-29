import { chromium } from 'playwright';
import fs from 'node:fs';

const URL = process.argv[2] ?? 'http://localhost:3000/';

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: { width: 1440, height: 810 },
  deviceScaleFactor: 2,
  locale: 'ru-RU',
});
const page = await context.newPage();
await page.addInitScript(() => window.localStorage.setItem('lang', 'ru'));

const errors = [];
page.on('console', (m) => m.type() === 'error' && errors.push(m.text().slice(0, 200)));

// networkidle недостижим: HMR-сокет dev-сервера и стриминг ассистента держат соединения
await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForTimeout(6000);

const menu = await page.evaluate(() =>
  [...document.querySelectorAll('.ant-menu-item, .ant-menu-submenu-title, [class*="menu"] a')]
    .map((el) => el.textContent.trim())
    .filter(Boolean)
    .slice(0, 60),
);
const headings = await page.evaluate(() =>
  [...document.querySelectorAll('h1,h2,h3,.ant-page-header-heading-title,.ant-typography')]
    .map((el) => el.textContent.trim())
    .filter(Boolean)
    .slice(0, 30),
);

fs.mkdirSync('out', { recursive: true });
await page.screenshot({ path: 'out/probe.png', fullPage: false });

console.log(JSON.stringify({ url: page.url(), title: await page.title(), menu, headings, errors }, null, 2));
await browser.close();
