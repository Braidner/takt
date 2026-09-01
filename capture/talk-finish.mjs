import { chromium } from 'playwright';
import fs from 'node:fs';

/**
 * Дожать подтверждение сохранения навыка в треде «Сообщения не доходят…» (решение Braidner
 * «подтвердил обе карточки» — карточка перевыставилась), снять финальные кадры треда,
 * затем раскрыть дифф «Изменено объектов → Проверить» в треде «Собери маршрут…» и снять его.
 * Запуск: node capture/talk-finish.mjs
 */

const OUT = '/Users/braidner/IdeaProjects/fesb/brainstorms/2026-09-01-assistant-talk/frames';
fs.mkdirSync(OUT, { recursive: true });

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

const visibleIn = (selector) => `
  (() => {
    const nodes = [...document.querySelectorAll(${JSON.stringify(selector)})];
    return nodes.some((el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; });
  })()
`;

async function openThread(needle) {
  const panelOpen = () => page.getByText('Новый чат', { exact: true }).first().isVisible().catch(() => false);
  for (let attempt = 0; attempt < 3 && !(await panelOpen()); attempt++) {
    await page.locator('button[aria-label="Панель разговоров"]:visible').first().click();
    await page.waitForTimeout(1500);
  }
  const item = page.getByText(needle, { exact: false }).last();
  await item.waitFor({ state: 'visible', timeout: 10000 });
  await item.click();
  await page.waitForTimeout(2500);
  if (await panelOpen()) {
    await page.locator('button[aria-label="Панель разговоров"]:visible').first().click();
    await page.waitForTimeout(800);
  }
}

async function shot(name) {
  const box = await page.locator('.assistant-workspace-primary').first().boundingBox();
  await page.screenshot({ path: `${OUT}/${name}.png`, clip: box });
  console.log('кадр:', name);
}

await page.goto('http://localhost:3000/#/', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(6000);
await page.locator('.page-assistant-icon').first().click();
await page.locator('.assistant-skill-composer-input').first().waitFor({ state: 'visible', timeout: 20000 });
await page.waitForTimeout(1200);

// ── Тред 2: дожать подтверждение сохранения навыка ──
await openThread('Сообщения не доходят');
const CONFIRM = '.assistant-confirm-block:not(.assistant-confirm-block-resolved)';
for (let round = 0; round < 4; round++) {
  const hasConfirm = await page.evaluate(visibleIn(`${CONFIRM} .assistant-option-list-item`));
  if (!hasConfirm) break;
  await shot(`t2-confirm-r${round}`);
  const sendBtn = page.locator('button:has-text("Отправить")').last();
  if (await sendBtn.isVisible().catch(() => false)) await sendBtn.click({ timeout: 5000 }).catch(async () => {
    await page.keyboard.press('Enter');
  });
  else await page.keyboard.press('Enter');
  console.log(`подтверждение отправлено (раунд ${round})`);
  // ждать: либо новый confirm, либо конец хода
  for (let t = 0; t < 60; t++) {
    await page.waitForTimeout(2000);
    const again = await page.evaluate(visibleIn(`${CONFIRM} .assistant-option-list-item`));
    const running = await page.evaluate(visibleIn('button[aria-label="Остановить"]'));
    if (again || !running) break;
  }
}
await page.waitForTimeout(3000);
// финальные кадры Т2: прокрутить в самый низ
await page.evaluate(() => {
  const b = document.querySelector('.assistant-chat-body');
  if (b) b.scrollTop = b.scrollHeight;
});
await page.waitForTimeout(600);
await shot('t2-final');

// ── Тред 3: раскрыть дифф «Проверить» ──
await openThread('Собери маршрут');
await page.evaluate(() => {
  const b = document.querySelector('.assistant-chat-body');
  if (b) b.scrollTop = b.scrollHeight;
});
await page.waitForTimeout(600);
const check = page.getByText('Проверить', { exact: true }).last();
if (await check.isVisible().catch(() => false)) {
  await check.click();
  await page.waitForTimeout(2500);
  await page.screenshot({ path: `${OUT}/k3-diff-full.png` });
  const box = await page.locator('.assistant-workspace-primary').first().boundingBox();
  await page.screenshot({ path: `${OUT}/k3-diff.png`, clip: box });
  console.log('кадр: k3-diff (+full)');
} else {
  console.log('Кнопка «Проверить» не видна');
  await shot('t3-final');
}

await browser.close();
