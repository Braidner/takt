/**
 * Съёмка по утверждённой раскадровке.
 *
 *   node studio/shoot.mjs            снять всю раскадровку
 *   node studio/shoot.mjs --from 3   переснять начиная с третьего плана
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
 * План описывает НАМЕРЕНИЕ и одно типизированное действие: куда попасть, по какому
 * признаку видно, что экран готов, и что на нём сделать. Из этого же выводится
 * длительность и строится камера — потому действие и типизировано, а не задано
 * списком команд браузеру.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { inProject } from './project.mjs';
import { chromium } from 'playwright';
import { login } from './lib/stend.mjs';
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

const setStep = (plan, patch) => api('/api/step', { plan, ...patch });
const setStatus = (patch) => api('/api/status', patch);
const shouldStop = () =>
  fetch(`${base}/api/control?token=${info.token}`).then((r) => r.json())
    .then((d) => Boolean(d.stop)).catch(() => false);
const storyboard = await fetch(`${base}/api/storyboard`).then((r) => r.json());
if (!storyboard?.plans?.length) {
  console.error('Раскадровка пуста: снимать нечего');
  process.exit(1);
}
if (storyboard.status !== 'ready') {
  // Черновик снимать нельзя намеренно: прогон стоит минут, а раскадровку ещё правят.
  console.error('Раскадровка не утверждена — нажмите «Снимать» в студии');
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
const hasLive = storyboard.plans.some((pl) => pl.mode === 'live');

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

/**
 * Исполнение плана: попасть на экран, дождаться готовности, сделать одно действие.
 *
 * Набор действий закрыт намеренно. Пока шаг был списком команд браузеру, из него нельзя
 * было вывести ни длительность, ни цель камеры: в `[{press},{wait},{click},{wait}]` не
 * сказано, что здесь содержание, а что подпорка под запись потока.
 */
async function runPlan(plan) {
  // Сравнение с null, а не проверка на истинность: route: "" — это возврат на главную,
  // самый обычный план обзорного ролика. Как ложное значение он молча пропускался бы,
  // съёмка оставалась на прежнем разделе, и падал уже следующий план.
  if (plan.screen.route !== null && plan.screen.route !== undefined) {
    await page.goto(cfg.stend.replace(/#.*$/, '') + plan.screen.route,
                    { waitUntil: 'domcontentloaded' });
    await dismissDevOverlay(page);
  }

  const a = plan.action;
  if (!a) return;
  if (a.selector) noteAnchor(a.selector);

  switch (a.kind) {
    case 'click':
      await page.click(a.selector, { timeout: 15000 });
      // Проба якоря снимается ПОСЛЕ действия: перед кликом Playwright сам прокручивает
      // страницу к элементу, и снятая заранее координата относится к экрану, которого
      // уже нет. Именно так в mc-медиа появилось y=3673 при высоте кадра 810.
      break;
    case 'type':
      await page.fill(a.selector, a.text, { timeout: 15000 });
      break;
    case 'scroll':
      await smoothScroll(page, { distance: a.distance, speed: a.speed });
      break;
    // Пауза — полноценное действие, а не досиживание до длительности: план с hold
    // ставят там, где экрану нужно время. Выбросив её, съёмка упирается в таймаут
    // ожидания на медленном разделе — проверено на стенде.
    case 'hold':
      await page.waitForTimeout((a.seconds || 0) * 1000);
      break;
    // Переход своего действия не имеет: он уже выполнен выше.
    case 'goto':
      break;
    default:
      throw new Error(`неизвестное действие «${a.kind}»`);
  }
  if (a.press) await page.keyboard.press(a.press);
}

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
                    step: 0, of: storyboard.plans.length });
  await page.goto(cfg.stend, { waitUntil: 'domcontentloaded', timeout: 90000 });
  await page.waitForTimeout(3000);
  await login(page, cfg.creds || {});
  await dismissDevOverlay(page);
  // Вход и первая загрузка в кадр не попадают: запись начинается после них.
  await waitUntilSettled(page, { waitFor: cfg.ready || null, timeout: 30000 });
  recordingFrom = Date.now();
  if (rec) rec.started = recordingFrom;
  streamFrames();

  for (const plan of storyboard.plans) {
    if (plan.n < from) continue;
    /* Вставка снимается ничем: у неё нет ни экрана, ни действия — только своя
       графика, которую композиция рисует сама. Помечаем её снятой сразу, иначе
       она вечно висит «в ожидании» и вся раскадровка читается недоснятой. */
    if (plan.mode === 'insert') {
      await setStep(plan.id, { state: 'done', took: 0 });
      continue;
    }
    // Проверяем между планами: прерывать посреди действия — значит оставить браузер
    // в середине формы и получить кадр, который потом никому не объяснить.
    if (await shouldStop()) { stopped = true; break; }
    stepAnchors = [];
    await setStep(plan.id, { state: 'running' });
    await setStatus({ state: 'busy', text: plan.title.text, step: plan.n,
                      of: storyboard.plans.length });
    const t0 = Date.now();
    try {
      await runPlan(plan);

      // Проверка результата — не перестраховка. Клик по пункту меню, который на самом
      // деле раскрывает подменю, проходит без ошибки: элемент найден, клик выполнен,
      // шаг «успешен» — а в кадре осталась прежняя страница. Ролик при этом снимется
      // целиком и покажет не то, что обещали подписи. Поэтому шаг, который заявляет
      // переход, обязан назвать признак, по которому переход виден.
      // Ждём готовности содержимым, а не часами. Раньше здесь стоял waitForSelector,
      // и он проверял признак ПОСЛЕ паузы шага — то есть ничем не управлял: пауза всё
      // равно отсчитывалась по часам, и скелетоны успевали попасть в кадр.
      const mode = plan.mode === 'live' ? 'live' : 'static';
      const liveFrom = sinceStart();

      if (mode === 'static') {
        // Состояние снимается ПОСЛЕ действия: камере нужен результат, а не подводка.
        // Ожидание готовности, догрузка ленивых картинок и слой липких — внутри.
        // Идентификатор состояния — идентификатор плана: по нему их и сводит композиция.
        const state = await captureState(page, {
          id: plan.id,
          dir: STATES,
          waitFor: plan.screen.waitFor,
          anchors: stepAnchors,
        });
        states.push({ ...state, label: plan.title.text, mode });
      } else {
        // Живому плану снимок не поможет: содержание в самом движении. Ждём готовности
        // и запоминаем границы отрезка — композиция возьмёт из записи именно его.
        const settle = await waitUntilSettled(page, { waitFor: plan.screen.waitFor, timeout: 30000 });
        states.push({ id: plan.id, label: plan.title.text, mode, settle,
                      viewport: VIEWPORT, scale: 1,
                      sticky: [], anchors: [], layer: null, size: null });
      }

      // Живому плану длительность задаёт запись, статичному — композиция: держать
      // браузер лишние секунды после снимка незачем, кадры всё равно вычисляются.
      if (mode === 'live') {
        const left = plan.duration.seconds * 1000 - (Date.now() - t0);
        if (left > 0) await page.waitForTimeout(left);
        liveRanges.push({ plan: plan.id, from: liveFrom, to: sinceStart() });
      }
      await setStep(plan.id, { state: 'done', took: Math.round((Date.now() - t0) / 1000) });
    } catch (e) {
      failed = await explainFailure(page, plan, e);
      await setStep(plan.id, { state: 'failed', error: failed.error, fix: failed.fix });
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

  /**
   * Сдвиг между шкалой записи и часами съёмки.
   *
   * recordVideo пишет с момента создания контекста, то есть захватывает открытие
   * стенда и вход в систему; часы съёмки идут с первого плана. Разницу знает только
   * кодировщик — по временам кадров, — поэтому спрашиваем длительность у ffprobe.
   *
   * Это та самая разъехавшаяся шкала, на которой конвейер обжигался дважды: сначала
   * титры уезжали на длину входа, потом монтаж вырезал не те куски. Считаем её один
   * раз и здесь, а не в каждом потребителе.
   */
  const снято = recordingFrom ? (Date.now() - recordingFrom) / 1000 : 0;

  /**
   * Живые отрезки вырезаются из записи в отдельные файлы — по одному на план.
   *
   * Иначе никак: Playwright пишет webm потоком, без индекса, и браузер по такому
   * файлу перематываться НЕ УМЕЕТ вовсе — `seekable` у него пустой, а присваивание
   * currentTime молча даёт ноль. Композиция получала бы первый кадр записи вместо
   * нужного момента: на дымовом прогоне это дало экран входа в систему посреди
   * ролика, одинаковый во всех кадрах плана.
   *
   * Заодно исчезает и разъезд шкал: вырезанный отрезок начинается со своего нуля,
   * и сдвиг записи больше никому не нужно знать.
   */
  if (file && liveRanges.length) {
    const run = promisify(execFile);
    let offset = 0;
    try {
      const { stdout } = await run('ffprobe', ['-v', 'error', '-show_entries',
        'format=duration', '-of', 'csv=p=0', file]);
      const raw = Number(stdout.trim());
      if (Number.isFinite(raw) && raw > снято) offset = raw - снято;
    } catch {
      console.error('ffprobe не ответил: живые отрезки могут поехать на длину входа');
    }

    for (const r of liveRanges) {
      const out = path.join(STATES, `${r.plan}.mp4`);
      const длина = Math.max(0.4, r.to - r.from);
      try {
        await run('ffmpeg', ['-v', 'error', '-y',
          // -ss после -i: перекодирование всё равно идёт, а точность здесь важнее
          // скорости — отрезок короткий, и промах в полсекунды виден.
          '-i', file, '-ss', (offset + r.from).toFixed(2), '-t', длина.toFixed(2),
          '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20',
          // Ключевой кадр каждые полсекунды: по такому файлу композиция мотает точно.
          '-g', '12', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-an', out]);
        const st = states.find((s) => s.id === r.plan);
        if (st) {
          st.video = out;
          st.seconds = Math.round(длина * 100) / 100;
        }
      } catch (e) {
        console.error(`не вырезал живой отрезок ${r.plan}: ${(e.stderr || e.message).slice(0, 120)}`);
      }
    }
  }

  // Пути к снимкам — относительные: проект переносится между машинами вместе с данными,
  // а абсолютный путь пережил бы перенос ровно до первого открытия.
  const rel = (f) => (f ? path.relative(inProject('.'), f) : null);
  const manifest = {
    viewport: VIEWPORT,
    seconds: Number((снято).toFixed(2)),
    states: states.map((st) => ({ ...st, body: rel(st.body), layer: rel(st.layer),
                                  video: rel(st.video) })),
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
    console.log(JSON.stringify({ ok: true, plans: storyboard.plans.length,
                                 seconds: Math.round((Date.now() - started) / 1000), video: file }));
  }
}
