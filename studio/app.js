/**
 * Takt — прототип интерфейса. Демонстрирует состояния, не бизнес-логику.
 *
 * Строки вынесены с первого дня: продукт двуязычный, и захардкоженный текст в
 * разметке — то, что потом вычищается неделями. Перевод берётся по data-i.
 *
 * Строки живого клиента лежат здесь же. Разговор идёт об одном интерфейсе, и второй
 * словарь на стороне live.js означал бы две правды об одной кнопке: переключение языка
 * чинило бы половину экрана, а вторая оставалась бы на языке того, кто её писал.
 */

const RU = {
  pageTitle: "Takt — студия демонстрационных роликов",
  project: "Ассистент: от задачи до интеграции",
  agentBusy: "Снимает сцену",
  agentProgress: " — {step} из {of}",
  agentListening: "Слушает",
  agentOffline: "Не подключён",
  themeLight: "Светлая",
  themeDark: "Тёмная",
  scriptTitle: "Сценарий",
  s1: "Пустой домен, интеграции ещё нет",
  s2: "Открываем ассистента со страницы домена",
  s3: "Задача одним сообщением",
  s4: "Режим планирования: система не меняется",
  s4n: "Врезка-схема · 22 с",
  s5: "Уточняющий вопрос вместо догадки",
  s6: "План готов: шаги и критерии приёмки",
  s7: "Подтверждение изменения конфигурации",
  s8: "Маршрут создан и запущен",
  live: "Идёт съёмка",
  framePlaceholder: "Экран браузера, который ведёт агент. Видно каждое действие — и где оно застряло.",
  frameAlt: "Экран браузера, который ведёт агент",
  play: "Воспроизвести",
  stop: "Остановить",
  retake: "Переснять сцену",
  trackSteps: "Шаги",
  trackDiagrams: "Схемы",
  trackNotes: "Правки",
  trackVoice: "Голос",
  trackStepsTitle: "Границы шагов сценария",
  trackDiagramsTitle: "Врезки-схемы",
  trackNotesTitle: "Замечания",
  trackVoiceTitle: "Дикторские реплики",
  notesTitle: "Замечания",
  kindDiagram: "Схема",
  kindEdit: "Монтаж",
  kindVoice: "Озвучка",
  kindApplied: "Применено",
  n1: "Здесь показать схему режима планирования — три блока, снизу вверх.",
  n2: "Пауза слишком длинная, подрезать до двух секунд.",
  n3: "Переозвучить: «маршрут создан и запущен» звучит скомканно.",
  n4: "Убрать наезд камеры на панель — она не влезает целиком.",
  composerPh: "Что поправить в этот момент? Метка встанет на {t}",
  pin: "Метка на {t}",
  send: "Отправить агенту",
  voiceTitle: "Голос диктора",
  v1meta: "28 с · чистая запись",
  v2meta: "41 с · из ролика",
  record: "Записать сейчас",
  upload: "Загрузить файл",
  connectHead: "Куда снимаем",
  connectUrl: "Адрес",
  connectUser: "Логин",
  connectUserPh: "если нужен вход",
  connectPassword: "Пароль",
  connectPasswordPh: "сохранён — оставьте пустым",
  connectNoteBefore: "Пароль хранится на этой машине в",
  connectNoteAfter: "и не попадает ни в репозиторий, ни обратно в браузер. "
    + "Оставьте поле пустым, чтобы сохранить прежний.",
  connectCancel: "Отмена",
  connectSave: "Сохранить и проверить",

  // ── Проекты
  projectLabel: "Проект",
  projectNew: "Новый ролик",
  projectPrompt: "Название ролика",

  // ── Стенд. Состояния приходят с сервера ключом: проверку ведёт check-stend.mjs,
  //    а читает результат человек — и на своём языке.
  stendSetup: "Настроить подключение",
  stendUnchecked: "Стенд не проверен",
  stendNoAddress: "Адрес стенда не задан",
  stendChecking: "Проверяю доступ",
  stendOk: "Стенд подключён",
  stendAuthFailed: "Логин не принят",
  stendHttpError: "Стенд отвечает ошибкой {status}",
  stendNoUi: "Интерфейс не загрузился",
  stendTimeout: "Стенд не отвечает",
  stendOpenFailed: "Не удалось открыть стенд",
  stendSrcForm: "{url}\nисточник: форма",
  stendSrcManual: "{url}\nисточник: указан вручную",
  stendSrcEnv: "{url}\nисточник: переменная TAKT_STEND",
  stendSrcConfig: "{url}\nисточник: takt.json",
  stendSrcPreset: "{url}\nисточник: цель «{name}» из пресета",

  // ── Состояния агента во время съёмки
  agentOpening: "Открываю стенд",
  agentStopped: "Съёмка остановлена",
  agentStepFailed: "Шаг {n} не прошёл",
  agentDone: "Съёмка завершена",

  // ── Сценарий: пустая панель, правка шагов, съёмка
  scriptEmpty: "Опишите, что показать в ролике. Обычными словами — на них соберётся "
    + "сценарий, который можно будет поправить до съёмки.",
  taskPh: "Например: показать, как создать домен, добавить в него маршрут на очередь и запустить",
  taskSend: "Собрать сценарий",
  scenarioNotePh: "Опишите изменение, которое хотите увидеть в сценарии",
  scenarioNoteSend: "Передать агенту",
  stepDiagram: "Врезка-схема · {sec} с",
  clipDiagram: "Схема «{name}» · {sec} с",
  toolFrom: "снять отсюда",
  toolDrag: "⠿ переставить",
  toolDragTitle: "Перетащите строку, чтобы переставить",
  toolEdit: "подпись",
  toolDel: "убрать",
  statusReady: "утверждён",
  statusDraft: "черновик",
  shootRun: "Снимать",
  cutRun: "Смонтировать",
  cutRunTitle: "Камера по действиям, курсор, титры и звук — из снятого материала",
  shortRun: "Хайлайты",
  shortRunTitle: "Короткая версия из лучших моментов, ≈25 секунд",
  evCut: "Монтаж",
  evShort: "Хайлайты",
  movieFull: "Полный",
  movieShort: "Хайлайты",
  movieCut: "Смонтированный",
  movieVoiced: "С озвучкой",
  movieVertical: "Вертикальный",
  shootDone: "Снято по этому сценарию",
  shootOffline: "Агент не подключён",

  // ── Отправлено и ещё не выполнено
  evScenarioNote: "Правка сценария",
  evTask: "Сборка сценария",
  evNote: "Замечание",
  evApply: "Применение замечаний",
  evRetake: "Пересъёмка",
  evShoot: "Съёмка",
  evStop: "Остановка",
  evNarrate: "Озвучка",
  evCheckStend: "Проверка стенда",
  evVoicePrepare: "Подготовка голоса",
  evWorking: "в работе",
  evWaiting: "ждёт",

  // ── План работ. Вид работы приходит ключом (kind), а не текстом: разбор делает
  //    classify-notes.mjs, но называть его результат человеку — дело интерфейса.
  planTitle: "Применить замечания",
  planCost: "≈ {min} мин",
  planCostUnknown: "срок неясен",
  planApply: "Применить",
  planApplyShoot: "Применить и переснять",
  planShoot: "Пересъёмка",
  planShootWhy: "меняется то, что происходит в кадре",
  planVoice: "Озвучка",
  planVoiceWhy: "пересинтез затронутых реплик, остальные не трогаем",
  planDiagram: "Врезка-схема",
  planDiagramWhy: "собрать схему и пересобрать ролик",
  planEdit: "Монтаж",
  planEditWhy: "пересборка ролика без новой съёмки",
  planUnclear: "Непонятно",
  planUnclearWhy: "формулировка не даёт понять, что менять — уточнить у автора",

  // ── Голос диктора
  voiceReady: "{sec} с · чистая запись",
  voiceFromFile: "{sec} с · из файла",
  voicePreparing: "готовится…",
  recShort: "Запись {sec} с — мало",
  recEnough: "Запись {sec} с — хватит, нажмите чтобы остановить",
  voiceEngineTitle: "Каким движком синтезировать этот голос. Клик переключает; уже собранные дорожки не трогаются",
  envOpen: "Окружение",
  envOpenTitle: "Что установлено и что можно доставить",
  envHead: "Окружение",
  envNote: "Установку выполняет агент — кнопка ставит задачу в его очередь. "
    + "Ставится только перечисленное самим Takt; вес загрузки показан до начала.",
  envClose: "Закрыть",
  envInstall: "Установить",
  envQueued: "В очереди у агента",
  envFailed: "Не удалось опросить окружение — запущена ли студия командой takt serve?",
  voiceAskRecord: "Чей это голос? Имя появится в каталоге",
  voiceAskFile: "Чей голос в файле?",
  voiceConsent: "Подтвердите: {name} согласен, что этим голосом будет говорить синтез.\n\n"
    + "Голос человека охраняется законом — записывать чужой голос без его разрешения нельзя.",
  voiceNoMic: "Микрофон недоступен. Разрешите доступ в настройках браузера.",
  voiceTooShort: "Слишком коротко: {sec} с. Нужно хотя бы {min}, а лучше около {good} — "
    + "от этого сходство зависит сильнее всего.",

  // ── Дикторский текст
  narrationTitle: "Дикторский текст",
  narrationClose: "Закрыть",
  narrationVoice: "Озвучить",
  narrationTotal: "{n} реплик · речи ≈ {time}",
  narrationVoiced: " · озвучено {n}",
  fitEst: "≈ {est} с",
  fitOver: "≈ {est} с — не влезает в {hold} с",
  fitTight: "≈ {est} с из {hold} с — впритык",
  fitOk: "≈ {est} с из {hold} с",
  fitRecorded: "{sec} с записано",
  fitRecordedOf: "{sec} с записано из {hold}",
};

const EN = {
  pageTitle: "Takt — a studio for demo videos",
  project: "Assistant: from task to integration",
  agentBusy: "Recording scene",
  agentProgress: " — {step} of {of}",
  agentListening: "Listening",
  agentOffline: "Disconnected",
  themeLight: "Light",
  themeDark: "Dark",
  scriptTitle: "Script",
  s1: "Empty domain, no integration yet",
  s2: "Opening the assistant from the domain page",
  s3: "One message states the task",
  s4: "Planning mode: nothing is changed",
  s4n: "Diagram inset · 22 s",
  s5: "It asks instead of guessing",
  s6: "Plan ready: steps and acceptance criteria",
  s7: "Configuration change needs confirmation",
  s8: "Route created and started",
  live: "Recording",
  framePlaceholder: "The browser the agent drives. Every action is visible — including where it got stuck.",
  frameAlt: "The browser the agent drives",
  play: "Play",
  stop: "Stop",
  retake: "Retake scene",
  trackSteps: "Steps",
  trackDiagrams: "Diagrams",
  trackNotes: "Notes",
  trackVoice: "Voice",
  trackStepsTitle: "Boundaries between script steps",
  trackDiagramsTitle: "Diagram insets",
  trackNotesTitle: "Notes",
  trackVoiceTitle: "Narrator lines",
  notesTitle: "Notes",
  kindDiagram: "Diagram",
  kindEdit: "Editing",
  kindVoice: "Voice-over",
  kindApplied: "Applied",
  n1: "Show the planning-mode diagram here — three blocks, bottom up.",
  n2: "Pause runs too long, trim to two seconds.",
  n3: "Re-record: “route created and started” sounds rushed.",
  n4: "Drop the zoom on the panel — it doesn't fit the frame.",
  composerPh: "What should change at this moment? The marker lands at {t}",
  pin: "Marker at {t}",
  send: "Send to agent",
  voiceTitle: "Narrator voice",
  v1meta: "28 s · clean take",
  v2meta: "41 s · from a recording",
  record: "Record now",
  upload: "Upload file",
  connectHead: "Where we record",
  connectUrl: "Address",
  connectUser: "Login",
  connectUserPh: "if sign-in is required",
  connectPassword: "Password",
  connectPasswordPh: "saved — leave empty to keep it",
  connectNoteBefore: "The password stays on this machine in",
  connectNoteAfter: "and reaches neither the repository nor the browser. "
    + "Leave the field empty to keep the saved one.",
  connectCancel: "Cancel",
  connectSave: "Save and check",

  projectLabel: "Project",
  projectNew: "New video",
  projectPrompt: "Video title",

  stendSetup: "Set up the connection",
  stendUnchecked: "Environment not checked",
  stendNoAddress: "No environment address set",
  stendChecking: "Checking access",
  stendOk: "Environment connected",
  stendAuthFailed: "Sign-in was rejected",
  stendHttpError: "Environment answers with error {status}",
  stendNoUi: "The interface did not load",
  stendTimeout: "Environment is not responding",
  stendOpenFailed: "Could not open the environment",
  stendSrcForm: "{url}\nsource: the form",
  stendSrcManual: "{url}\nsource: entered by hand",
  stendSrcEnv: "{url}\nsource: TAKT_STEND variable",
  stendSrcConfig: "{url}\nsource: takt.json",
  stendSrcPreset: "{url}\nsource: target “{name}” from the preset",

  agentOpening: "Opening the environment",
  agentStopped: "Recording stopped",
  agentStepFailed: "Step {n} failed",
  agentDone: "Recording finished",

  scriptEmpty: "Describe what the video should show. In plain words — they turn into a "
    + "script you can correct before recording starts.",
  taskPh: "For example: show how to create a domain, add a route to a queue and start it",
  taskSend: "Build the script",
  scenarioNotePh: "Describe the change you want to see in the script",
  scenarioNoteSend: "Send to the agent",
  stepDiagram: "Diagram inset · {sec} s",
  clipDiagram: "Diagram “{name}” · {sec} s",
  toolFrom: "record from here",
  toolDrag: "⠿ reorder",
  toolDragTitle: "Drag the row to reorder it",
  toolEdit: "label",
  toolDel: "remove",
  statusReady: "approved",
  statusDraft: "draft",
  shootRun: "Record",
  shootDone: "Recorded from this script",
  shootOffline: "The agent is not connected",

  evScenarioNote: "Script edit",
  evTask: "Building the script",
  evNote: "Note",
  evApply: "Applying notes",
  evRetake: "Retake",
  evShoot: "Recording",
  evStop: "Stop",
  evNarrate: "Voice-over",
  evCheckStend: "Environment check",
  evVoicePrepare: "Preparing the voice",
  evWorking: "in progress",
  evWaiting: "waiting",

  planTitle: "Apply the notes",
  planCost: "≈ {min} min",
  planCostUnknown: "estimate unclear",
  planApply: "Apply",
  planApplyShoot: "Apply and re-record",
  planShoot: "Retake",
  planShootWhy: "what happens on screen changes",
  planVoice: "Voice-over",
  planVoiceWhy: "re-synthesis of the affected lines, the rest stay untouched",
  planDiagram: "Diagram inset",
  planDiagramWhy: "build the diagram and re-assemble the video",
  planEdit: "Editing",
  planEditWhy: "re-assembly without a new recording",
  planUnclear: "Unclear",
  planUnclearWhy: "the wording doesn't say what to change — ask the author",

  voiceReady: "{sec} s · clean take",
  voiceFromFile: "{sec} s · from a file",
  voicePreparing: "preparing…",
  recShort: "Recording {sec} s — too short",
  recEnough: "Recording {sec} s — enough, click to stop",
  voiceEngineTitle: "Which engine synthesizes this voice. Click to switch; existing tracks are untouched",
  envOpen: "Environment",
  envOpenTitle: "What is installed and what can be added",
  envHead: "Environment",
  envNote: "Installation is done by the agent — the button queues a task for it. "
    + "Only what Takt itself lists can be installed; download size is shown up front.",
  envClose: "Close",
  envInstall: "Install",
  envQueued: "Queued for the agent",
  envFailed: "Could not query the environment — is the studio running (takt serve)?",
  voiceAskRecord: "Whose voice is this? The name will show up in the catalogue",
  voiceAskFile: "Whose voice is in the file?",
  voiceConsent: "Confirm: {name} agrees that synthesis may speak in this voice.\n\n"
    + "A person's voice is protected by law — recording someone else's voice without "
    + "their permission is not allowed.",
  voiceNoMic: "The microphone is unavailable. Allow access in the browser settings.",
  voiceTooShort: "Too short: {sec} s. At least {min} is needed, and about {good} is better — "
    + "similarity depends on this more than on anything else.",

  narrationTitle: "Narration script",
  narrationClose: "Close",
  narrationVoice: "Synthesize",
  narrationTotal: "{n} lines · speech ≈ {time}",
  narrationVoiced: " · {n} voiced",
  fitEst: "≈ {est} s",
  fitOver: "≈ {est} s — does not fit into {hold} s",
  fitTight: "≈ {est} s of {hold} s — tight",
  fitOk: "≈ {est} s of {hold} s",
  fitRecorded: "{sec} s recorded",
  fitRecordedOf: "{sec} s recorded of {hold}",
};

let lang = "ru";

/**
 * Подстановка в строку словаря: «Шаг {n} не прошёл».
 *
 * Значения приходят из данных, а не из словаря, поэтому хранятся на самом узле
 * (data-i-args). Иначе собранная строка застыла бы на языке, на котором её собрали:
 * подставлять при переключении было бы уже нечего.
 */
function fill(str, args) {
  if (!args) return str;
  return String(str).replace(/\{(\w+)\}/g, (m, k) => (k in args ? args[k] : m));
}

/** Куда ложится строка: текст узла и те атрибуты, которые человек читает. */
const SLOTS = [
  ["i", (el, s) => { el.textContent = s; }],
  ["iPh", (el, s) => { el.placeholder = s; }],
  ["iTitle", (el, s) => { el.title = s; }],
  ["iAria", (el, s) => el.setAttribute("aria-label", s)],
  ["iAlt", (el, s) => el.setAttribute("alt", s)],
];

const MARKED = "[data-i],[data-i-ph],[data-i-title],[data-i-aria],[data-i-alt]";

function apply(dict) {
  document.querySelectorAll(MARKED).forEach((el) => {
    let args = null;
    if (el.dataset.iArgs) { try { args = JSON.parse(el.dataset.iArgs); } catch { args = null; } }
    for (const [slot, set] of SLOTS) {
      const key = el.dataset[slot];
      if (key && dict[key]) set(el, fill(dict[key], args));
    }
  });
  document.documentElement.lang = lang;
}

// Живой клиент (live.js) добавляет и переразмечает элементы уже после загрузки: у него
// свои данные и свои состояния. Чтобы не заводить второй словарь, он переводит через
// эти две точки: taktText собирает строку сразу, taktApply переводит разметку заново.
window.taktText = (key, args) => {
  const dict = lang === "ru" ? RU : EN;
  return key && dict[key] ? fill(dict[key], args) : null;
};
window.taktApply = () => apply(lang === "ru" ? RU : EN);

document.getElementById("lang").addEventListener("click", (e) => {
  lang = lang === "ru" ? "en" : "ru";
  e.currentTarget.textContent = lang === "ru" ? "EN" : "RU";
  apply(lang === "ru" ? RU : EN);
});

const themeBtn = document.getElementById("theme");

// Кнопка называет то, куда переключит, а не текущую тему. Ключ ставится на узел, а
// подставляет строку общий механизм: иначе после смены темы надпись на другом языке
// пережила бы переключение и вернулась бы только со следующим щелчком по теме.
function syncThemeLabel() {
  const dark = document.documentElement.dataset.theme === "dark";
  themeBtn.dataset.i = dark ? "themeLight" : "themeDark";
  window.taktApply();
}

themeBtn.addEventListener("click", () => {
  const root = document.documentElement;
  root.dataset.theme = root.dataset.theme === "dark" ? "light" : "dark";
  syncThemeLabel();
});
