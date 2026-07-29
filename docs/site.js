/*
 * Страница-презентация Takt: словарь двух языков и хореография.
 *
 * Порядок намеренный: сначала язык, потом движение. Русский — язык по умолчанию,
 * английский — полноправная версия, переключается без перезагрузки; выбор помнится.
 *
 * Вся хореография живёт за классом .motion-ok: без JS и при reduced-motion страница
 * полностью видима и просто статична — скрытого по умолчанию контента здесь нет.
 */

const RU = {
  rec: "Идёт съёмка",
  h1a: "Опишите ролик словами.",
  h1b: "Агент снимет, смонтирует и озвучит.",
  sub: "Takt — студия демонстрационных роликов для веб-интерфейсов. Сценарий собирает "
    + "ИИ-агент, разведав ваш интерфейс; человек правит и принимает результат.",
  ctaInstall: "Поставить скилл",
  ctaSource: "Исходники",
  altStudio: "Студия Takt: слева сценарий с таймкодами, в центре снятый ролик с титром, "
    + "внизу таймлайн с дорожками шагов, схем, правок и голоса",
  capStudio: "Живая студия: сценарий, снятый ролик, дорожки таймлайна",

  t1: "Как снимается",
  s1h: "Задача — одним сообщением",
  s1p: "«Показать, как создать домен, добавить маршрут и запустить». Агент разведывает "
    + "интерфейс и собирает сценарий: шаги, титры, хронометраж. Вы правите его до съёмки — "
    + "перетаскиванием, без ожидания.",
  s2h: "Съёмка — headless, с живым экраном",
  s2p: "Playwright проходит сценарий в браузере и пишет телеметрию: что нажато и когда. "
    + "В студии виден живой экран и прогресс по шагам — видно, что происходит и где "
    + "застряло. Машина остаётся свободной.",
  s3h: "Правки — метками на таймлайне",
  s3p: "Смотрите ролик и ставите замечания по таймкодам: «пауза длинная», «переозвучить», "
    + "«показать схему». Агент разбирает их по стоимости и показывает план до работы: "
    + "монтаж — минуты, пересъёмка — только если меняется кадр.",
  s4h: "Озвучка — клонированным голосом",
  s4p: "Голос диктора записывается прямо в браузере — с согласия его обладателя. Реплики "
    + "раскладываются по титрам и проверяются на укладку до синтеза. Два движка: Qwen3-TTS "
    + "и Chatterbox, сравниваются на одной реплике.",

  t2: "Ролик — артефакт сборки",
  lead2: "Титры, схемы и дикторский текст лежат данными, а не выжигаются в видео. Поэтому "
    + "правка не равна пересъёмке — пересобирается только то, что изменилось.",
  tr1n: "Титр", tr1w: "переписали формулировку", tr1c: "пересборка · секунды",
  tr2n: "Реплика", tr2w: "«звучит скомканно»", tr2c: "пересинтез одной фразы",
  tr3n: "Схема", tr3w: "врезка поверх паузы", tr3c: "сборка без съёмки",
  tr4n: "Кадр", tr4w: "меняется происходящее на экране", tr4c: "пересъёмка одной сцены",
  altTimeline: "Таймлайн студии: дорожки шагов, схем, правок и голоса с плейхедом",
  capTimeline: "Дорожки таймлайна: шаги — факт съёмки, остальное — намерения",

  t3: "Установка",
  lead3: "Takt — скилл для Claude Code. Код живёт в репозитории, ваши ролики, голоса и "
    + "разведанные системы — отдельно, в ~/takt, и переживают любое обновление.",
  termTitle: "три команды",
  c1: "скилл целиком, одной командой",
  c2: "зависимости и браузер для съёмки",
  c4: "студия на localhost:4173",
  termAfter: "Дальше — скажите агенту «сними демо по …» и откройте студию. Озвучка "
    + "ставится отдельно и по желанию: takt install покажет, что и сколько весит, до загрузки.",
  altEnv: "Панель «Окружение»: возможности со статусом — съёмка, сборка, монтаж, два "
    + "движка озвучки; вес загрузки показан до установки",
  capEnv: "Панель окружения: вес загрузки — до кнопки, а не после",

  finCut: "Снято.",
  finSub: "Один вечер — и ваш продукт рассказывает о себе сам.",
  finBtn: "Открыть репозиторий",
  footLic: "MIT · движки синтеза Apache 2.0 / MIT",
  footVoice: "Голос человека охраняется законом: клонирование — только с согласия обладателя.",

  m0: "Идея", m1: "Съёмка", m2: "Правки", m3: "Установка", m4: "Снято",
  copied: "Скопировано",
  typed: "сними демо по mc.braidner.org",
  reply: "сценарий готов · 7 шагов · 1:07 — правьте до съёмки",
};

const EN = {
  rec: "Recording",
  h1a: "Describe the demo in plain words.",
  h1b: "The agent shoots, edits and voices it.",
  sub: "Takt is a demo-video studio for web interfaces. An AI agent scouts your UI and "
    + "drafts the script; you refine and approve the result.",
  ctaInstall: "Install the skill",
  ctaSource: "Source",
  altStudio: "Takt studio: script with timecodes on the left, the finished take with a "
    + "caption in the center, timeline tracks for steps, diagrams, notes and voice below",
  capStudio: "The live studio: script, finished take, timeline tracks",

  t1: "How it shoots",
  s1h: "The task — one message",
  s1p: "“Show how to create a domain, add a route and start it.” The agent scouts the "
    + "interface and drafts the script: steps, captions, timing. You edit it before the "
    + "shoot — by dragging, with no waiting.",
  s2h: "Shooting — headless, with a live screen",
  s2p: "Playwright walks the script in a browser and records telemetry: what was clicked "
    + "and when. The studio shows a live screen and per-step progress — you see what's "
    + "happening and where it got stuck. Your machine stays free.",
  s3h: "Edits — as timeline markers",
  s3p: "Watch the take and drop notes at timecodes: “pause too long”, “re-voice this”, "
    + "“show a diagram”. The agent sorts them by cost and shows the plan before working: "
    + "editing takes minutes; reshooting only when the frame itself changes.",
  s4h: "Voice-over — with a cloned voice",
  s4p: "The narrator's voice is recorded right in the browser — with the owner's consent. "
    + "Lines are laid out against captions and fit-checked before synthesis. Two engines: "
    + "Qwen3-TTS and Chatterbox, compared on a single line.",

  t2: "The video is a build artifact",
  lead2: "Captions, diagrams and narration live as data — they are not burned into the "
    + "video. So an edit is not a reshoot: only what changed gets rebuilt.",
  tr1n: "Caption", tr1w: "rewrote the wording", tr1c: "rebuild · seconds",
  tr2n: "Line", tr2w: "“sounds mumbled”", tr2c: "re-synth one phrase",
  tr3n: "Diagram", tr3w: "an inset over a pause", tr3c: "build, no shooting",
  tr4n: "Frame", tr4w: "what happens on screen changes", tr4c: "reshoot one scene",
  altTimeline: "Studio timeline: tracks for steps, diagrams, notes and voice, with a playhead",
  capTimeline: "Timeline tracks: steps are the fact of the shoot, the rest are intents",

  t3: "Install",
  lead3: "Takt is a Claude Code skill. The code lives in the repo; your takes, voices and "
    + "scouted systems live separately in ~/takt and survive any update.",
  termTitle: "three commands",
  c1: "the whole skill, one command",
  c2: "dependencies and the shooting browser",
  c4: "the studio at localhost:4173",
  termAfter: "Then tell the agent “shoot a demo of …” and open the studio. Voice-over is "
    + "optional and installs separately: takt install shows what it weighs before downloading.",
  altEnv: "The Environment panel: capabilities with status — shooting, build, editing, two "
    + "voice engines; download size shown before installing",
  capEnv: "The environment panel: download size before the button, not after",

  finCut: "Cut.",
  finSub: "One evening — and your product tells its own story.",
  finBtn: "Open the repository",
  footLic: "MIT · synthesis engines Apache 2.0 / MIT",
  footVoice: "A person's voice is protected by law: cloning only with the owner's consent.",

  m0: "Idea", m1: "Shoot", m2: "Edits", m3: "Install", m4: "Cut",
  copied: "Copied",
  typed: "shoot a demo of mc.braidner.org",
  reply: "script ready · 7 steps · 1:07 — edit before the shoot",
};

const DICTS = { ru: RU, en: EN };

let lang = localStorage.getItem("takt-site-lang")
  || (navigator.language?.startsWith("ru") ? "ru" : "en");
if (!DICTS[lang]) lang = "ru";

const t = (key) => DICTS[lang][key] ?? DICTS.ru[key] ?? "";

function applyLang() {
  document.documentElement.lang = lang;
  for (const node of document.querySelectorAll("[data-i]")) {
    node.textContent = t(node.dataset.i);
  }
  for (const node of document.querySelectorAll("[data-i-alt]")) {
    node.alt = t(node.dataset.iAlt);
  }
  const btn = document.getElementById("lang");
  btn.textContent = lang === "ru" ? "EN" : "RU";
  document.title = lang === "ru"
    ? "Takt — агент снимает демо-ролики по вашему интерфейсу"
    : "Takt — an agent that shoots demo videos of your interface";
}

document.getElementById("lang").addEventListener("click", () => {
  lang = lang === "ru" ? "en" : "ru";
  localStorage.setItem("takt-site-lang", lang);
  applyLang();
});

applyLang();

/* ── Хореография ──────────────────────────────────────────────────────────
   Класс .motion-ok включает скрытые стартовые состояния, поэтому ставится
   только когда JS жив и движение уместно. Порядок обязателен: сначала класс,
   потом наблюдатель — иначе элементы над сгибом мигнут. */

const motionOk = !matchMedia("(prefers-reduced-motion: reduce)").matches;

if (motionOk) {
  document.documentElement.classList.add("motion-ok");

  const io = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      // Ступенька внутри группы: шаги сценария и дорожки входят очередью,
      // как реплики по таймкодам, а не разом.
      const group = e.target.closest("[data-reveal-group]");
      if (group) {
        const siblings = [...group.querySelectorAll("[data-reveal]")];
        e.target.style.transitionDelay = `${siblings.indexOf(e.target) * 90}ms`;
      }
      e.target.classList.add("in");
      io.unobserve(e.target);
    }
  }, { rootMargin: "0px 0px -12% 0px", threshold: 0.1 });

  for (const node of document.querySelectorAll("[data-reveal]")) io.observe(node);
}

/* ── Плёнка и плейхед ─────────────────────────────────────────────────────
   Один мотор на всё: вертикальный прогресс скролла двигает ленту кадров,
   плейхед и подсветку меток. Лента включается только там, где ей место —
   широкий экран, движение разрешено; иначе тот же код обслуживает обычную
   вертикальную страницу, и никакой второй ветки вёрстки нет. */

const fill = document.getElementById("fill");
const head = document.getElementById("head");
const marks = [...document.querySelectorAll(".bar-marks a")];
const sceneEls = [...document.querySelectorAll(".scene")];
const strip = document.getElementById("strip");

const FILM = motionOk && matchMedia("(min-width: 900px)").matches;

/* Кадр живёт в двух фазах, как в презентациях Apple: DWELL — кадр стоит на месте
   и раскрывается изнутри (его локальный прогресс --d идёт 0→1 по скроллу, поэтому
   назад крутишь — раскрытие честно откатывается), TRAVEL — проезд к следующему.
   Доли в «кадровых единицах»: у последнего кадра проезда нет. */
const DWELL = 0.72;
const TRAVEL = 0.28;
const UNITS = sceneEls.length * DWELL + (sceneEls.length - 1) * TRAVEL;
const easeTravel = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

if (FILM) {
  document.documentElement.classList.add("filmed");
  // Высота плёнки задаёт темп. Почти два экрана на кадровую единицу: на трекпаде
  // ниже — и вся лента пролетается одним свайпом, стоянки не успевают раскрыться.
  document.documentElement.style.setProperty("--film-len", `${Math.round(UNITS * 185)}vh`);
  // Плавный якорный скролл в ленте дезориентирует: прыжок точнее.
  document.documentElement.style.scrollBehavior = "auto";
}

/** Раскладка плёнки по фазам: где какой кадр стоит и едет. */
function filmAt(u) {
  let acc = 0;
  for (let i = 0; i < sceneEls.length; i++) {
    if (u < acc + DWELL || i === sceneEls.length - 1) {
      return { x: i, frame: i, d: Math.max(0, Math.min(1, (u - acc) / DWELL)) };
    }
    acc += DWELL;
    if (u < acc + TRAVEL) {
      const t = easeTravel((u - acc) / TRAVEL);
      return { x: i + t, frame: t < 0.5 ? i : i + 1, d: t < 0.5 ? 1 : 0 };
    }
    acc += TRAVEL;
  }
  return { x: sceneEls.length - 1, frame: sceneEls.length - 1, d: 1 };
}

/** Вертикальная позиция скролла, при которой кадр n стоит раскрытым. */
const frameTop = (n) => {
  if (FILM) {
    const travel = document.documentElement.scrollHeight - innerHeight;
    const u = n * (DWELL + TRAVEL) + DWELL * 0.85;   // почти конец раскрытия
    return (u / UNITS) * travel;
  }
  const el = sceneEls[n];
  return el ? el.getBoundingClientRect().top + scrollY - 84 : 0;
};

/* Инерция: scrollY — цель, лента догоняет её экспоненциальным лерпом. Трекпад
   отдаёт позицию скачками, и без сглаживания кадры щёлкают; с ним лента ведёт
   себя как физический носитель с массой. Цикл живёт только пока есть куда
   догонять — на неподвижной странице rAF не крутится и батарею не ест. */
const SMOOTH = 10;            // 1/с: выше — отзывчивее, ниже — тяжелее
let uCurrent = 0;
let running = false;
let lastT = 0;

function targetU() {
  const max = document.documentElement.scrollHeight - innerHeight;
  const p = max > 0 ? Math.min(1, scrollY / max) : 0;
  return p * UNITS;
}

function apply(u) {
  const max = document.documentElement.scrollHeight - innerHeight;
  const p = UNITS > 0 ? u / UNITS : 0;
  fill.style.width = `${p * 100}%`;
  head.style.left = `${p * 100}%`;

  let current = 0;
  if (FILM) {
    const at = filmAt(u);
    strip.style.transform = `translate3d(${-at.x * 100}vw, 0, 0)`;
    current = at.frame;
    sceneEls.forEach((s, i) => {
      s.style.setProperty("--p", Math.max(-1, Math.min(1, at.x - i)));
      s.style.setProperty("--d", i === at.frame ? at.d : (i < at.frame ? 1 : 0));
    });
  } else {
    sceneEls.forEach((s, i) => {
      if (s.getBoundingClientRect().top < innerHeight * 0.5) current = i;
    });
  }
  marks.forEach((a) => {
    const n = sceneEls.indexOf(document.querySelector(a.getAttribute("href")));
    if (n === current) a.setAttribute("aria-current", "true");
    else a.removeAttribute("aria-current");
  });
}

function loop(now) {
  const dt = Math.min(0.05, (now - lastT) / 1000 || 0.016);
  lastT = now;
  const target = targetU();
  // Экспоненциальное догоняние, независимое от частоты кадров.
  uCurrent += (target - uCurrent) * (1 - Math.exp(-SMOOTH * dt));
  if (Math.abs(target - uCurrent) < 0.0004) {
    uCurrent = target;
    apply(uCurrent);
    running = false;
    return;
  }
  apply(uCurrent);
  requestAnimationFrame(loop);
}

function wake() {
  if (running) return;
  running = true;
  lastT = performance.now();
  requestAnimationFrame(loop);
}

addEventListener("scroll", wake, { passive: true });
addEventListener("resize", wake);
if (!FILM) {
  // Без ленты сглаживать нечего: плейхед пишется сразу, без цикла.
  addEventListener("scroll", () => apply(targetU()), { passive: true });
}
uCurrent = targetU();
apply(uCurrent);

/* Якоря: в ленте кадр адресуется вертикальной позицией, а не своим смещением
   в DOM — браузерный переход по хешу увёз бы страницу мимо. Перехват нужен
   всем внутристраничным ссылкам, включая CTA героя. */
if (FILM) {
  document.addEventListener("click", (e) => {
    const a = e.target.closest('a[href^="#"]');
    if (!a) return;
    const n = sceneEls.indexOf(document.querySelector(a.getAttribute("href")));
    if (n < 0) return;
    e.preventDefault();
    scrollTo({ top: frameTop(n), behavior: "smooth" });
  });
}

/* ── Копирование команд ──────────────────────────────────────────────────── */

for (const btn of document.querySelectorAll(".copy")) {
  btn.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(btn.dataset.cmd);
      btn.classList.add("done");
      btn.title = t("copied");
      setTimeout(() => btn.classList.remove("done"), 1600);
    } catch { /* буфер недоступен — например, file:// */ }
  });
}

/* ── Диалог с агентом: строка печатается, ответ приходит ─────────────────
   Смена языка перезапускает печать: замерший хвост чужого языка выглядел бы
   как поломка. При reduced-motion текст появляется целиком и сразу. */

let typeTimer = null;
function playDialog() {
  const target = document.getElementById("typed");
  const reply = document.getElementById("reply");
  const caret = document.querySelector(".caret");
  if (!target) return;
  clearTimeout(typeTimer);
  reply.classList.remove("in");
  caret.classList.remove("off");
  const text = t("typed");

  if (!motionOk) {
    target.textContent = text;
    caret.classList.add("off");
    reply.classList.add("in");
    return;
  }

  target.textContent = "";
  let i = 0;
  const tick = () => {
    target.textContent = text.slice(0, ++i);
    if (i < text.length) {
      typeTimer = setTimeout(tick, 34 + Math.random() * 46);
    } else {
      typeTimer = setTimeout(() => { caret.classList.add("off"); reply.classList.add("in"); }, 420);
    }
  };
  typeTimer = setTimeout(tick, 1100);   // после того, как титр героя встал
}
playDialog();
document.getElementById("lang").addEventListener("click", playDialog);

/* ── Аврора: свет проектора в аппаратной ─────────────────────────────────
   Крошечный буфер (64×40) растягивается на весь герой — размытие достаётся
   бесплатно от масштабирования, и телефон не греется. Пятна дрейфуют по
   синусам с несоизмеримыми периодами: рисунок не зацикливается заметно.
   При reduced-motion рисуется один кадр и всё замирает. */

(() => {
  const cv = document.getElementById("aurora");
  if (!cv) return;
  const ctx = cv.getContext("2d");
  const W = cv.width = 64;
  const H = cv.height = 40;

  const blobs = [
    { c: [1, 98, 228],  r: 26, x: 0.22, y: 0.30, ax: 0.13, ay: 0.09,  px: 0.00011, py: 0.00007 },
    { c: [8, 158, 251], r: 21, x: 0.62, y: 0.18, ax: 0.16, ay: 0.11,  px: 0.00008, py: 0.00013 },
    { c: [3, 198, 212], r: 18, x: 0.82, y: 0.52, ax: 0.10, ay: 0.14,  px: 0.00014, py: 0.00006 },
    { c: [0, 224, 184], r: 14, x: 0.42, y: 0.62, ax: 0.12, ay: 0.08,  px: 0.00006, py: 0.00012 },
  ];

  function frame(now) {
    ctx.clearRect(0, 0, W, H);
    ctx.globalCompositeOperation = "lighter";
    for (const b of blobs) {
      const x = (b.x + Math.sin(now * b.px) * b.ax) * W;
      const y = (b.y + Math.cos(now * b.py) * b.ay) * H;
      const g = ctx.createRadialGradient(x, y, 0, x, y, b.r);
      g.addColorStop(0, `rgb(${b.c[0]} ${b.c[1]} ${b.c[2]} / 0.55)`);
      g.addColorStop(1, "rgb(0 0 0 / 0)");
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);
    }
  }

  frame(0);
  if (motionOk) {
    let visible = true;
    new IntersectionObserver((e) => { visible = e[0].isIntersecting; }).observe(cv);
    (function loop(now) {
      if (visible) frame(now);
      requestAnimationFrame(loop);
    })(0);
  }
})();
