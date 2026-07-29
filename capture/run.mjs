import { chromium } from 'playwright';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Recorder } from './lib/recorder.mjs';
import { makeActor } from './lib/actions.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// Вьюпорт — честные 1440x810, плотность 2x, кадр скринкаста — 2880x1620 (maxWidth в рекордере).
// Прежний трюк с document.zoom=2 давал резкость, но ломал геометрию antd Drawer:
// единицы vh не масштабируются зумом, панель ассистента становилась вдвое выше экрана
// и тело чата уезжало на 1400px вверх — в кадр попадал только композер.
const LAYOUT = { width: 1440, height: 810 };
const ZOOM = 2;
const VIEWPORT = { width: LAYOUT.width, height: LAYOUT.height };
const FPS = 30;

const sceneName = process.argv[2] ?? '01-domains';
const { meta, play } = await import(`./scenes/${sceneName}.mjs`);

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: VIEWPORT,
  deviceScaleFactor: ZOOM,
  locale: 'ru-RU',
  colorScheme: 'dark',
  reducedMotion: 'no-preference',
});
const page = await context.newPage();
// язык UI фиксируем до первого рендера — иначе поймаем английскую версию
await page.addInitScript(() => {
  window.localStorage.setItem('lang', 'ru');
  // тёмная тема: на записи она читается лучше и не спорит со схемами
  window.localStorage.setItem('AppThemeConfig', JSON.stringify({ isLightSelected: false }));
});

await page.goto(meta.url, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForTimeout(7000);
// скроллбары и мигающий фокус в кадре не нужны
await page.addStyleTag({
  content: `::-webkit-scrollbar { display: none !important; }
            *:focus { outline: none !important; }
            /* На съёмке вьюпорт 2880 со zoom:2 — при таком масштабе браузер считает
               содержимое сообщений «нерелевантным» и пропускает отрисовку: в кадр
               попадает пустой чат. Продуктовую оптимизацию отключаем только для записи. */
            .assistant-chat-bubbles > *,
            .assistant-bubble-assistant > * { content-visibility: visible !important; }`,
});
await page.waitForTimeout(500);

const rec = new Recorder(page, { scene: meta.id, fps: FPS, root: ROOT, viewport: VIEWPORT, scale: ZOOM });
const actor = makeActor(page, rec);

await rec.start();
try {
  await play(page, actor);
} finally {
  const timeline = await rec.stop();
  await browser.close();
  console.log(
    `сцена «${meta.title}»: ${timeline.frames} кадров, ${timeline.durationInSeconds}s, ` +
      `${timeline.events.length} событий → public/clips/${meta.id}.mp4`,
  );
}
