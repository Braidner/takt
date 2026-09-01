import { chromium } from 'playwright';
import fs from 'node:fs';

/**
 * Live-дубль для двух кадров: активация свежесозданного навыка fesb-queue-incident-diagnosis
 * на профильном вопросе и карточка уточнения симптома (выбор из вариантов).
 * Прогон читающий: подтверждений мутаций не предполагается, отвечаем только на choice.
 * Запуск: node capture/talk-live.mjs
 */

const OUT = '/Users/braidner/IdeaProjects/fesb/brainstorms/2026-09-01-assistant-talk/frames';
fs.mkdirSync(OUT, { recursive: true });

const QUESTION = 'Сообщения не доходят до очереди IN.ORDERS в домене Демонстрация. Разберись, в чём причина.';

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

// Новый чат
await page.locator('button[aria-label="Новый чат"]:visible').first().click();
await page.waitForTimeout(1500);

// Вопрос
const composer = page.locator('.assistant-skill-composer-input').first();
await composer.click();
await composer.fill(QUESTION).catch(async () => {
  await page.keyboard.type(QUESTION, { delay: 5 });
});
await page.waitForTimeout(400);
await page.keyboard.press('Enter');
console.log('вопрос отправлен');

// Ждём активацию навыка (бейдж) и снимаем верх треда
await page
  .waitForFunction(visibleIn('.assistant-bubble-tool, .assistant-skill-chip, [class*="skill"]'), null, {
    timeout: 60000,
    polling: 500,
  })
  .catch(() => {});
await page.waitForTimeout(5000);
await shot('k5-activation');

// Цикл: ждём либо choice (кадр + ответ последним вариантом), либо конец хода
let choiceShot = false;
for (let t = 0; t < 150; t++) {
  const hasChoice = await page.evaluate(visibleIn('.assistant-choice-block .assistant-option-list-item'));
  if (hasChoice) {
    await page.waitForTimeout(800);
    if (!choiceShot) {
      // прокрутить вниз, чтобы карточка была в кадре целиком
      await page.evaluate(() => {
        const b = document.querySelector('.assistant-chat-body');
        if (b) b.scrollTop = b.scrollHeight;
      });
      await page.waitForTimeout(400);
      await shot('k2-choice');
      choiceShot = true;
    }
    await page.locator('.assistant-choice-block .assistant-option-list-item').last().click().catch(() => {});
    await page.waitForTimeout(400);
    const sendBtn = page.locator('button:has-text("Отправить")').last();
    if (await sendBtn.isVisible().catch(() => false)) await sendBtn.click().catch(() => page.keyboard.press('Enter'));
    else await page.keyboard.press('Enter');
    console.log('ответ на уточнение отправлен');
    await page.waitForTimeout(3000);
    continue;
  }
  const running = await page.evaluate(visibleIn('button[aria-label="Остановить"]'));
  if (!running) break;
  await page.waitForTimeout(2000);
}

await page.waitForTimeout(2000);
await page.evaluate(() => {
  const b = document.querySelector('.assistant-chat-body');
  if (b) b.scrollTop = b.scrollHeight;
});
await page.waitForTimeout(500);
await shot('k5-verdict');
await browser.close();
