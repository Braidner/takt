import { chromium } from 'playwright';
import fs from 'node:fs';

/**
 * Нарезка чистовых PNG для доклада «Агент внутри шины» из уже отснятых тредов ассистента.
 * Сегментный режим: открыть тред, свернуть панель чатов, отлистать историю, снять кадры
 * секции чата (без списка чатов). Запуск: node capture/talk-frames.mjs <подстрока> <префикс>
 */

const OUT = '/Users/braidner/IdeaProjects/fesb/brainstorms/2026-09-01-assistant-talk/frames';
fs.mkdirSync(OUT, { recursive: true });

const [, , threadNeedle = 'Собери маршрут', prefix = 'probe'] = process.argv;

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: 2,
  locale: 'ru-RU',
  colorScheme: 'dark',
});
const page = await context.newPage();
await page.addInitScript(() => {
  localStorage.setItem('lang', 'ru');
  localStorage.setItem('AppThemeConfig', JSON.stringify({ isLightSelected: false }));
});

await page.goto('http://localhost:3000/#/', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(6000);

await page.locator('.page-assistant-icon').first().click();
await page.locator('.assistant-skill-composer-input').first().waitFor({ state: 'visible', timeout: 20000 });
await page.waitForTimeout(1200);

// Открыть панель разговоров (с ретраем: кнопка — переключатель), выбрать тред, закрыть панель
const panelOpen = () => page.getByText('Новый чат', { exact: true }).first().isVisible().catch(() => false);
for (let attempt = 0; attempt < 3 && !(await panelOpen()); attempt++) {
  await page.locator('button[aria-label="Панель разговоров"]:visible').first().click();
  await page.waitForTimeout(1500);
}
if (!(await panelOpen())) {
  await page.screenshot({ path: `${OUT}/${prefix}-debug.png` });
  throw new Error('Панель разговоров не открылась');
}
const item = page.getByText(threadNeedle, { exact: false }).last();
await item.waitFor({ state: 'visible', timeout: 10000 });
await item.click();
await page.waitForTimeout(2500);
if (await panelOpen()) {
  await page.locator('button[aria-label="Панель разговоров"]:visible').first().click();
  await page.waitForTimeout(800);
}

// Косметика кадра: спрятать плавающую стрелку «вниз» и кнопку помощи
await page.addStyleTag({
  content: '.assistant-chat-scroll-down, .assistant-scroll-down, [class*="scroll-down"] { display: none !important; }',
});

// Рамка секции чата (без панели разговоров)
const primary = page.locator('.assistant-workspace-primary').first();
const box = await primary.boundingBox();
console.log('primary box:', JSON.stringify(box));

const scrollInfo = await page.evaluate(() => {
  const body = document.querySelector('.assistant-chat-body');
  if (!body) return { found: false };
  body.setAttribute('data-talk-scroll', '1');
  return { found: true, scrollHeight: body.scrollHeight, clientHeight: body.clientHeight };
});
console.log('scroll:', JSON.stringify(scrollInfo));
if (!scrollInfo.found) {
  await page.screenshot({ path: `${OUT}/${prefix}-0.png`, clip: box });
  await browser.close();
  process.exit(0);
}

const step = Math.round(scrollInfo.clientHeight * 0.8);
const segments = Math.min(16, Math.ceil((scrollInfo.scrollHeight - scrollInfo.clientHeight) / step) + 1);
for (let i = 0; i < segments; i++) {
  await page.evaluate(
    ([top]) => { document.querySelector('[data-talk-scroll]').scrollTop = top; },
    [i * step],
  );
  await page.waitForTimeout(450);
  await page.screenshot({ path: `${OUT}/${prefix}-${String(i).padStart(2, '0')}.png`, clip: box });
}
console.log(`Снято сегментов: ${segments}`);
await browser.close();
