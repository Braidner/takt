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
  termTitle: "четыре команды",
  c1: "код студии",
  c2: "зависимости и браузер для съёмки",
  c3: "теперь это скилл Claude Code",
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
  termTitle: "four commands",
  c1: "the studio code",
  c2: "dependencies and the shooting browser",
  c3: "now it's a Claude Code skill",
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

/* ── Плейхед: прокрутка страницы и есть просмотр ролика ─────────────────── */

const fill = document.getElementById("fill");
const head = document.getElementById("head");
const marks = [...document.querySelectorAll(".bar-marks a")];
const scenes = marks.map((a) => document.querySelector(a.getAttribute("href")));

let ticking = false;
function playhead() {
  ticking = false;
  const max = document.documentElement.scrollHeight - innerHeight;
  const p = max > 0 ? Math.min(1, scrollY / max) : 0;
  fill.style.width = `${p * 100}%`;
  head.style.left = `${p * 100}%`;

  // Текущая сцена — последняя, чей верх прошёл середину экрана.
  let current = 0;
  scenes.forEach((s, i) => {
    if (s && s.getBoundingClientRect().top < innerHeight * 0.5) current = i;
  });
  marks.forEach((a, i) => {
    if (i === current) a.setAttribute("aria-current", "true");
    else a.removeAttribute("aria-current");
  });
}
addEventListener("scroll", () => {
  if (!ticking) { ticking = true; requestAnimationFrame(playhead); }
}, { passive: true });
playhead();

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
