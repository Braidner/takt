/**
 * Съёмка по утверждённому сценарию.
 *
 *   node studio/shoot.mjs            снять весь сценарий
 *   node studio/shoot.mjs --from 3   переснять начиная с третьего шага
 *
 * Два потока данных, и это не одно и то же:
 *   * ЗАПИСЬ — полноценное видео в двойном разрешении, из него потом монтируется ролик.
 *     Пишет Recorder снимками экрана, а не Playwright: встроенная запись отдаёт VP8 на
 *     600 кбит/с в CSS-пикселях, и на мелком тексте интерфейса этого мало;
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
import { inProject, currentTarget } from './project.mjs';
import { chromium } from 'playwright';
import { login } from '../capture/lib/stend.mjs';
import { readConfig } from './resolve-stend.mjs';
import { dismissDevOverlay } from './dismiss-overlay.mjs';
import { loadPreset } from './preset.mjs';
import { explainFailure } from './explain-failure.mjs';
import { SERVER_INFO } from './home.mjs';
import { Recorder } from './lib/recorder.mjs';
import { AnchorTracker } from './lib/anchors.mjs';
import { waitUntilSettled } from './lib/settle.mjs';
import { smoothScroll } from './lib/scroll.mjs';
import { inspect } from './lib/inspect.mjs';

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

const VIEWPORT = { width: 1440, height: 810 };

const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: VIEWPORT,
  // Вёрстка остаётся прежней, растёт только плотность отрисовки. Поднимать вместо этого
  // сам вьюпорт нельзя: интерфейс разложится как на широком мониторе, и после сжатия
  // в 1080p текст станет мельче, чем сейчас.
  deviceScaleFactor: 2,
  locale: 'ru-RU',
  colorScheme: 'dark',
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
    await dismissDevOverlay(page);
    return;
  }

  // Прокрутка — приём, а не перемещение курсора по документу. Клавиши оставлены ради
  // сценариев, снятых до этой правки: PageDown в них означал именно «проехать экран»,
  // и переводить его в прыжок было бы точным исполнением неверного намерения.
  if (a.scroll !== undefined) {
    await smoothScroll(page, { distance: a.scroll, speed: a.speed });
    return;
  }
  if (a.press === 'PageDown' || a.press === 'PageUp') {
    const dir = a.press === 'PageDown' ? 1 : -1;
    await smoothScroll(page, { distance: dir * Math.round(VIEWPORT.height * 0.9) });
    return;
  }
  if (a.press === 'Home' || a.press === 'End') {
    const to = await page.evaluate((k) => (k === 'Home'
      ? -window.scrollY
      : document.body.scrollHeight - window.innerHeight - window.scrollY), a.press);
    await smoothScroll(page, { distance: to });
    return;
  }

  if (a.click) {
    watchFor(a.click);
    await page.click(a.click, { timeout: 15000 });
    // Проба СРАЗУ ПОСЛЕ клика, а не до: перед кликом Playwright сам прокручивает страницу
    // к элементу, и снятая заранее координата относится к экрану, которого уже нет.
    // Именно так в mc-медиа появилось y=3673 при высоте кадра 810.
    await tracker.sampleNow(a.click);
  }
  if (a.type) {
    watchFor(a.type.selector);
    await page.fill(a.type.selector, a.type.text, { timeout: 15000 });
    await tracker.sampleNow(a.type.selector);
  }
  if (a.press && !['PageDown', 'PageUp', 'Home', 'End'].includes(a.press)) {
    await page.keyboard.press(a.press);
  }
  // Пауза по часам осталась только там, где её поставили руками: ожидание готовности
  // экрана теперь делает waitUntilSettled после всех действий шага.
  if (a.wait) await page.waitForTimeout(a.wait);
  if (a.waitFor) await page.waitForSelector(a.waitFor, { timeout: 30000 });
}

const timeline = { scene: 'take', fps: 30, viewport: VIEWPORT,
                   events: [], hits: [] };
/** Точки действий: куда и когда пришёлся клик или ввод. Монтаж наводит по ним камеру. */
const hits = timeline.hits;
const started = Date.now();

// Запись и треки живут в одной шкале времени — шкале рекордера. Отдельный отсчёт
// разъезжался бы с кадрами тем сильнее, чем дольше идёт съёмка.
// Масштаб не задаём: рекордер подбирает его замером на этой же странице —
// цена снимка зависит от приложения, и константа тут врёт (см. lib/recorder.mjs).
const rec = new Recorder(page, { dir: OUT, fps: 30, viewport: VIEWPORT });
const stamp = () => rec.now();
const tracker = new AnchorTracker(page, VIEWPORT, stamp);

/** Что случилось на каждом шаге: сколько ждали готовности и чем ожидание кончилось. */
const stepReport = [];
/** Какому шагу принадлежит якорь — чтобы замечание называло шаг, а не селектор. */
const selectorStep = new Map();
let currentStepN = 0;
const watchFor = (selector) => {
  if (!selector) return;
  if (!selectorStep.has(selector)) selectorStep.set(selector, currentStepN);
  tracker.watch(selector);
};
let recordingFrom = null;
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
  // Вход и первая загрузка в кадр не попадают: запись начинается после них.
  await waitUntilSettled(page, { waitFor: cfg.ready || null, timeout: 30000 });
  await rec.start();
  tracker.start();
  recordingFrom = Date.now();
  streamFrames();

  for (const step of scenario.steps) {
    if (step.n < from) continue;
    // Проверяем между шагами: прерывать посреди действия — значит оставить браузер
    // в середине формы и получить кадр, который потом никому не объяснить.
    if (await shouldStop()) { stopped = true; break; }
    currentStepN = step.n;
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
      // Ждём готовности содержимым, а не часами. Раньше здесь стоял waitForSelector,
      // и он проверял признак ПОСЛЕ паузы шага — то есть ничем не управлял: пауза всё
      // равно отсчитывалась по часам, и скелетоны успевали попасть в кадр.
      const settleFrom = stamp();
      const settle = await waitUntilSettled(page, { waitFor: step.expect, timeout: 30000 });
      stepReport.push({
        n: step.n, label: step.label, settle,
        loadingFrom: settleFrom, loadingTo: stamp(),
      });

      // Шаг обязан занять свою длительность: по ней посчитан хронометраж и разложена
      // озвучка. Действия обычно быстрее — остаток доигрываем паузой. В стадии 1
      // длительность ещё назначается человеком; выводить её из действия будет
      // раскадровка, см. specs/2026-08-01-production-design.md.
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

  const anchors = tracker.stop();
  const take = recordingFrom ? await rec.stop() : null;
  await context.close();
  await browser.close();
  const file = take ? take.file : null;

  // Треки якорей — новые данные; hits остаются ради нынешнего монтажа, который ещё
  // работает на них. Берём первое положение, реально попавшее в кадр: раньше сюда
  // писалась координата до прокрутки, и камера наезжала мимо.
  for (const a of anchors) {
    const seen = a.rects.find((r) => r.w > 0 && r.h > 0
      && r.x < VIEWPORT.width && r.y < VIEWPORT.height && r.x + r.w > 0 && r.y + r.h > 0);
    if (seen) {
      hits.push({ t: seen.t, x: Math.round(seen.x + seen.w / 2),
                  y: Math.round(seen.y + seen.h / 2),
                  w: Math.round(seen.w), h: Math.round(seen.h) });
    }
  }
  hits.sort((a, b) => a.t - b.t);

  if (take?.scalePick) {
    console.log(`масштаб съёмки ${take.scalePick.scale}× `
      + `(${take.scalePick.ms} мс на кадр при бюджете ${take.scalePick.budget})`);
  }
  timeline.scale = take ? take.scale : 1;
  timeline.durationInSeconds = take ? take.seconds : 0;
  timeline.frames = take ? take.frames : 0;
  timeline.video = file;
  fs.writeFileSync(inProject('timeline.json'), JSON.stringify(timeline, null, 2));

  if (take) {
    // currentTarget() отдаёт разобранную цель съёмки, а не имя каталога.
    const target = currentTarget() || {};
    const takeData = {
      ...take,
      steps: stepReport,
      anchors: anchors.map((a) => ({ ...a, step: selectorStep.get(a.selector) ?? null })),
      diffs: [],
      cuts: [],
      jumpThreshold: target.jumpThreshold,
      loading: stepReport
        .filter((r) => r.settle.waitedMs > 400)
        .map((r) => ({ from: r.loadingFrom, to: r.loadingTo, step: r.n })),
    };
    fs.writeFileSync(inProject('take.json'), JSON.stringify(takeData, null, 2));

    const report = inspect(takeData);
    if (!report.ok) {
      console.error('Замечания к дублю:');
      for (const i of report.issues) console.error(`  · ${i.text}`);
    }
    timeline.issues = report.issues;
    fs.writeFileSync(inProject('timeline.json'), JSON.stringify(timeline, null, 2));
  }

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
