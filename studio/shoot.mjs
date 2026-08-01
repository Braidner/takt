/**
 * Съёмка по утверждённому сценарию.
 *
 *   node studio/shoot.mjs            снять весь сценарий
 *   node studio/shoot.mjs --from 3   переснять начиная с третьего шага
 *
 * Два потока данных, и это не одно и то же:
 *   * СОСТОЯНИЯ — снимки страницы целиком в двойном разрешении. Прокрутка, наезд и
 *     удержание из них потом СОБИРАЮТСЯ композицией, а не снимаются: кадр вычисляется
 *     из своего номера, и терять его негде. Поток пишется только там, где движение
 *     интерфейса и есть содержание плана — такой шаг помечается mode: live;
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
import { waitUntilSettled } from './lib/settle.mjs';
import { smoothScroll } from './lib/scroll.mjs';
import { captureState } from './lib/state.mjs';
import { checkStates } from './lib/inspect.mjs';

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
const STATES = inProject('states');
fs.mkdirSync(OUT, { recursive: true });
fs.mkdirSync(STATES, { recursive: true });

/**
 * Живые планы требуют записи потока, а её нельзя включить после создания контекста.
 * Поэтому смотрим сценарий заранее: есть хоть один live — пишем весь прогон.
 */
const hasLive = scenario.steps.some((st) => st.mode === 'live');

const VIEWPORT = { width: 1440, height: 810 };
const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: VIEWPORT,
  // Поток пишем только ради живых планов. Для статичных он лишний вес и лишний риск.
  ...(hasLive ? { recordVideo: { dir: OUT, size: VIEWPORT } } : {}),
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
//
// Снимок через API Playwright, а не сырым CDP. Сырой цикл идёт мимо планировщика и
// конкурирует со снимками состояний на той же странице — проверено дважды, оба раза
// захват вставал намертво без единой ошибки.
let alive = true;
const streamFrames = async () => {
  while (alive) {
    try {
      const shot = await page.screenshot({ type: 'jpeg', quality: 40 });
      await api('/api/frame', { frame: `data:image/jpeg;base64,${shot.toString('base64')}` });
    } catch { /* страница между переходами — пропускаем кадр */ }
    await new Promise((r) => setTimeout(r, 500));
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
    noteAnchor(a.click);
    await page.click(a.click, { timeout: 15000 });
    // Проба СРАЗУ ПОСЛЕ клика, а не до: перед кликом Playwright сам прокручивает страницу
    // к элементу, и снятая заранее координата относится к экрану, которого уже нет.
    // Именно так в mc-медиа появилось y=3673 при высоте кадра 810.
  }
  if (a.type) {
    noteAnchor(a.type.selector);
    await page.fill(a.type.selector, a.type.text, { timeout: 15000 });
  }
  if (a.press && !['PageDown', 'PageUp', 'Home', 'End'].includes(a.press)) {
    await page.keyboard.press(a.press);
  }
  // Пауза по часам осталась только там, где её поставили руками: ожидание готовности
  // экрана теперь делает waitUntilSettled после всех действий шага.
  if (a.wait) await page.waitForTimeout(a.wait);
  if (a.waitFor) await page.waitForSelector(a.waitFor, { timeout: 30000 });
}

const timeline = { scene: 'take', fps: 30, viewport: VIEWPORT, events: [], hits: [] };
const hits = timeline.hits;
const started = Date.now();

/**
 * Снятые состояния и отчёт по шагам. Состояние снимается один раз на план и потом
 * используется композицией сколько угодно — прокрутка и наезд собираются из него.
 */
const states = [];
/** Живые отрезки: их границы в шкале записи, чтобы композиция взяла нужный кусок. */
const liveRanges = [];

/** Часы съёмки в секундах. Простой отсчёт — у состояний своей шкалы нет. */
const sinceStart = () => (recordingFrom ? (Date.now() - recordingFrom) / 1000 : 0);

/** Якоря текущего шага: селекторы, в которые будет целиться камера. */
let stepAnchors = [];
const noteAnchor = (selector) => {
  if (selector && !stepAnchors.includes(selector)) stepAnchors.push(selector);
};

// Рекордер нужен только живым планам — и только чтобы знать шкалу времени записи.
const rec = hasLive ? { started: null } : null;
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
  recordingFrom = Date.now();
  if (rec) rec.started = recordingFrom;
  streamFrames();

  for (const step of scenario.steps) {
    if (step.n < from) continue;
    // Проверяем между шагами: прерывать посреди действия — значит оставить браузер
    // в середине формы и получить кадр, который потом никому не объяснить.
    if (await shouldStop()) { stopped = true; break; }
    stepAnchors = [];
    await setStep(step.n, { state: 'running' });
    await setStatus({ state: 'busy', text: step.label, step: step.n, of: scenario.steps.length });
    timeline.events.push({ t: sinceStart(), kind: 'caption', label: step.label, n: step.n,
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
      const mode = step.mode === 'live' ? 'live' : 'static';
      const liveFrom = sinceStart();

      if (mode === 'static') {
        // Состояние снимается ПОСЛЕ действий: камере нужен результат, а не подводка.
        // Ожидание готовности, догрузка ленивых картинок и слой липких — внутри.
        const state = await captureState(page, {
          id: `p${String(step.n).padStart(2, '0')}`,
          dir: STATES,
          waitFor: step.expect,
          anchors: stepAnchors,
        });
        states.push({ ...state, plan: step.n, label: step.label, mode });
      } else {
        // Живому плану снимок не поможет: содержание в самом движении. Ждём готовности
        // и запоминаем границы отрезка — композиция возьмёт из записи именно его.
        const settle = await waitUntilSettled(page, { waitFor: step.expect, timeout: 30000 });
        states.push({ id: `p${String(step.n).padStart(2, '0')}`, plan: step.n,
                      label: step.label, mode, settle, viewport: VIEWPORT, scale: 1,
                      sticky: [], anchors: [], layer: null, size: null });
      }

      const left = step.seconds * 1000 - (Date.now() - t0);
      if (left > 0) await page.waitForTimeout(left);
      if (mode === 'live') liveRanges.push({ plan: step.n, from: liveFrom, to: sinceStart() });
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

  // Живая запись дописывается только после закрытия контекста — забрать путь надо до.
  const video = hasLive ? page.video() : null;
  await context.close();
  await browser.close();
  const file = video ? await video.path() : null;

  // hits остаются ради нынешнего монтажа, который ещё работает на них: берём центр
  // якоря из снятого состояния, приведённый к шкале вьюпорта.
  for (const st of states) {
    for (const a of st.anchors || []) {
      if (!a.rect) continue;
      const k = st.scale || 1;
      hits.push({
        t: 0, plan: st.plan,
        x: Math.round((a.rect.x + a.rect.w / 2) / k),
        y: Math.round((a.rect.y + a.rect.h / 2) / k),
        w: Math.round(a.rect.w / k), h: Math.round(a.rect.h / k),
      });
    }
  }

  timeline.durationInSeconds = recordingFrom ? (Date.now() - recordingFrom) / 1000 : 0;
  timeline.video = file;
  timeline.states = states.length;
  fs.writeFileSync(inProject('timeline.json'), JSON.stringify(timeline, null, 2));

  // Пути к снимкам — относительные: проект переносится между машинами вместе с данными,
  // а абсолютный путь пережил бы перенос ровно до первого открытия.
  const rel = (f) => (f ? path.relative(inProject('.'), f) : null);
  const manifest = {
    viewport: VIEWPORT,
    seconds: Number(timeline.durationInSeconds.toFixed(2)),
    live: file ? { video: rel(file), ranges: liveRanges } : null,
    states: states.map((st) => ({ ...st, body: rel(st.body), layer: rel(st.layer) })),
  };
  const issues = checkStates(states);
  manifest.issues = issues;
  fs.writeFileSync(inProject('states.json'), JSON.stringify(manifest, null, 2));

  const staticCount = states.filter((st) => st.mode === 'static').length;
  console.log(`состояний: ${staticCount} статичных`
    + (states.length - staticCount ? `, ${states.length - staticCount} живых` : ''));
  if (issues.length) {
    console.error('Замечания к съёмке:');
    for (const i of issues) console.error(`  · ${i.text}`);
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
