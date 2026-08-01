/**
 * Съёмка по утверждённому сценарию.
 *
 *   node studio/shoot.mjs            снять весь сценарий
 *   node studio/shoot.mjs --from 3   переснять начиная с третьего шага
 *
 * Два потока данных, и это не одно и то же:
 *   * ЗАПИСЬ — полноценное видео, из него потом монтируется ролик. Пишет Playwright
 *     в файл, с полной частотой кадров;
 *   * ЖИВОЙ ЭКРАН — редкие кадры в студию, чтобы человек видел, что происходит и где
 *     застряло. Здесь важна не плавность, а свежесть: три кадра в секунду достаточно,
 *     а полноценный поток забил бы канал и замедлил саму съёмку.
 *
 * Шаг описывается действиями, которые агент проставил при разведке. Шаг без действий —
 * это пауза на экране: так снимаются планы, где ничего не происходит, но зрителю нужно
 * успеть прочитать.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { inProject } from './project.mjs';
import { chromium } from 'playwright';
import { login } from '../capture/lib/stend.mjs';
import { readConfig } from './resolve-stend.mjs';
import { dismissDevOverlay } from './dismiss-overlay.mjs';
import { loadPreset } from './preset.mjs';
import { explainFailure } from './explain-failure.mjs';
import { SERVER_INFO } from './home.mjs';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const info = JSON.parse(fs.readFileSync(SERVER_INFO, 'utf8'));
const base = `http://localhost:${info.port}`;

const api = (route, payload) =>
  fetch(`${base}${route}?token=${info.token}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }).then((r) => r.json()).catch(() => null);

const setStep = (n, patch) => api('/api/step', { n, ...patch });
const setStatus = (patch) => api('/api/status', patch);
const shouldStop = () =>
  fetch(`${base}/api/control?token=${info.token}`).then((r) => r.json())
    .then((d) => Boolean(d.stop)).catch(() => false);

const scenario = await fetch(`${base}/api/scenario`).then((r) => r.json());
if (!scenario?.steps?.length) {
  console.error('Сценарий пуст: снимать нечего');
  process.exit(1);
}
if (scenario.status !== 'ready') {
  // Черновик снимать нельзя намеренно: прогон стоит минут, а сценарий ещё правят.
  console.error('Сценарий не утверждён — нажмите «Снимать» в студии');
  process.exit(2);
}

const fromArg = process.argv.indexOf('--from');
const from = fromArg !== -1 ? Number(process.argv[fromArg + 1]) : 1;

const cfg = readConfig();
const OUT = inProject('takes');
fs.mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: 1440, height: 810 },
  locale: 'ru-RU',
  colorScheme: 'dark',
  recordVideo: { dir: OUT, size: { width: 1440, height: 810 } },
});
const page = await context.newPage();
await page.addInitScript((p) => {
  if (p.language) window.localStorage.setItem(p.language.key, p.language.value);
  if (p.theme) window.localStorage.setItem(p.theme.key, p.theme.value);
}, loadPreset());

// Живой экран идёт своим ритмом и не ждёт шагов: иначе на длинном шаге картинка
// замирает, и человек не может отличить «идёт работа» от «всё повисло».
let alive = true;
const streamFrames = async () => {
  while (alive) {
    try {
      const shot = await page.screenshot({ type: 'jpeg', quality: 45 });
      await api('/api/frame', { frame: `data:image/jpeg;base64,${shot.toString('base64')}` });
    } catch { /* страница между переходами — пропускаем кадр */ }
    await new Promise((r) => setTimeout(r, 350));
  }
};

/** Действия шага. Набор намеренно маленький: всё, что нужно для показа интерфейса. */
async function runAction(a) {
  // Сравнение с undefined, а не проверка на истинность: goto: "" — это возврат на
  // главную, самый обычный шаг обзорного ролика. Как ложное значение он молча
  // пропускался, съёмка оставалась на прежнем разделе, и падал уже следующий шаг —
  // с жалобой на селектор, которого на этом экране и не должно быть.
  if (a.goto !== undefined) {
    await page.goto(cfg.stend.replace(/#.*$/, '') + a.goto, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1500);
    await dismissDevOverlay(page);
    return;
  }
  if (a.click) {
    // Координаты клика — сырьё для монтажа: по ним камера наезжает точно на место
    // действия и рисуется курсор. Без них зум пришлось бы угадывать эвристикой,
    // как это делают экранные рекордеры, и промахи были бы видны в каждом ролике.
    const box = await page.locator(a.click).first().boundingBox().catch(() => null);
    if (box) {
      hits.push({ t: stamp(), x: Math.round(box.x + box.width / 2),
                  y: Math.round(box.y + box.height / 2),
                  w: Math.round(box.width), h: Math.round(box.height) });
    }
    await page.click(a.click, { timeout: 15000 });
  }
  if (a.type) {
    const box = await page.locator(a.type.selector).first().boundingBox().catch(() => null);
    if (box) {
      hits.push({ t: stamp(), x: Math.round(box.x + box.width / 2),
                  y: Math.round(box.y + box.height / 2),
                  w: Math.round(box.width), h: Math.round(box.height), typing: true });
    }
    await page.fill(a.type.selector, a.type.text, { timeout: 15000 });
  }
  if (a.press) await page.keyboard.press(a.press);
  if (a.wait) await page.waitForTimeout(a.wait);
  if (a.waitFor) await page.waitForSelector(a.waitFor, { timeout: 30000 });
}

const timeline = { scene: 'take', fps: 30, viewport: { width: 1440, height: 810 },
                   events: [], hits: [] };
/** Точки действий: куда и когда пришёлся клик или ввод. Монтаж наводит по ним камеру. */
const hits = timeline.hits;
const started = Date.now();
// Отсчёт ведётся от момента, когда запись реально пошла, а не от старта процесса:
// открытие стенда и вход занимают секунды, и они в кадр не попадают.
let recordingFrom = null;
const stamp = () => (recordingFrom ? (Date.now() - recordingFrom) / 1000 : 0);
let failed = null;
let stopped = false;

// Флаг мог остаться от прошлой остановки — иначе новая съёмка прервалась бы на первом
// же шаге, не показав причины.
await fetch(`${base}/api/control?token=${info.token}`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ stop: false }),
});

try {
  await setStatus({ state: 'busy', text: 'Открываю стенд', key: 'agentOpening',
                    step: 0, of: scenario.steps.length });
  await page.goto(cfg.stend, { waitUntil: 'domcontentloaded', timeout: 90000 });
  await page.waitForTimeout(3000);
  await login(page, cfg.creds || {});
  await dismissDevOverlay(page);
  recordingFrom = Date.now();
  streamFrames();

  for (const step of scenario.steps) {
    if (step.n < from) continue;
    // Проверяем между шагами: прерывать посреди действия — значит оставить браузер
    // в середине формы и получить кадр, который потом никому не объяснить.
    if (await shouldStop()) { stopped = true; break; }
    await setStep(step.n, { state: 'running' });
    await setStatus({ state: 'busy', text: step.label, step: step.n, of: scenario.steps.length });
    timeline.events.push({ t: stamp(), kind: 'caption', label: step.label, n: step.n,
                           diagram: step.diagram || null });
    const t0 = Date.now();
    try {
      for (const a of step.actions || []) await runAction(a);

      // Проверка результата — не перестраховка. Клик по пункту меню, который на самом
      // деле раскрывает подменю, проходит без ошибки: элемент найден, клик выполнен,
      // шаг «успешен» — а в кадре осталась прежняя страница. Ролик при этом снимется
      // целиком и покажет не то, что обещали подписи. Поэтому шаг, который заявляет
      // переход, обязан назвать признак, по которому переход виден.
      if (step.expect) {
        await page.waitForSelector(step.expect, { timeout: 15000 });
      }

      // Шаг обязан занять свою длительность: по ней посчитан хронометраж и разложена
      // озвучка. Действия обычно быстрее — остаток доигрываем паузой.
      const left = step.seconds * 1000 - (Date.now() - t0);
      if (left > 0) await page.waitForTimeout(left);
      await setStep(step.n, { state: 'done', took: Math.round((Date.now() - t0) / 1000) });
    } catch (e) {
      failed = await explainFailure(page, step, e);
      await setStep(step.n, { state: 'failed', error: failed.error, fix: failed.fix });
      break;
    }
  }
} finally {
  alive = false;
  await new Promise((r) => setTimeout(r, 400));
  const video = page.video();
  await context.close();          // видео дописывается только после закрытия контекста
  await browser.close();
  const file = video ? await video.path() : null;

  timeline.durationInSeconds = recordingFrom ? (Date.now() - recordingFrom) / 1000 : 0;
  timeline.frames = Math.round(timeline.durationInSeconds * timeline.fps);
  timeline.video = file;
  fs.writeFileSync(inProject('timeline.json'), JSON.stringify(timeline, null, 2));

  if (stopped) {
    await setStatus({ state: 'listening', text: 'Съёмка остановлена', key: 'agentStopped',
                      step: null, of: null });
    console.log(JSON.stringify({ ok: false, stopped: true, video: file }));
  } else if (failed) {
    await setStatus({ state: 'listening', text: `Шаг ${failed.n} не прошёл`,
                      key: 'agentStepFailed', args: { n: failed.n }, step: null, of: null });
    console.log(JSON.stringify({ ok: false, failed, video: file }));
  } else {
    await setStatus({ state: 'listening', text: 'Съёмка завершена', key: 'agentDone',
                      step: null, of: null });
    console.log(JSON.stringify({ ok: true, steps: scenario.steps.length,
                                 seconds: Math.round((Date.now() - started) / 1000), video: file }));
  }
}
