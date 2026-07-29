/**
 * Takt — прототип интерфейса. Демонстрирует состояния, не бизнес-логику.
 *
 * Строки вынесены с первого дня: продукт двуязычный, и захардкоженный текст в
 * разметке — то, что потом вычищается неделями. Перевод берётся по data-i.
 */

const RU = {
  project: "Ассистент: от задачи до интеграции",
  agentBusy: "Снимает сцену — 2 из 5",
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
  stop: "Остановить",
  retake: "Переснять сцену",
  trackSteps: "Шаги",
  trackNotes: "Правки",
  trackVoice: "Голос",
  notesTitle: "Замечания",
  kindDiagram: "Схема",
  kindEdit: "Монтаж",
  kindVoice: "Озвучка",
  kindApplied: "Применено",
  n1: "Здесь показать схему режима планирования — три блока, снизу вверх.",
  n2: "Пауза слишком длинная, подрезать до двух секунд.",
  n3: "Переозвучить: «маршрут создан и запущен» звучит скомканно.",
  n4: "Убрать наезд камеры на панель — она не влезает целиком.",
  composerPh: "Что поправить в этот момент? Метка встанет на 0:47",
  pin: "Метка на 0:47",
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
};

const EN = {
  project: "Assistant: from task to integration",
  agentBusy: "Recording scene — 2 of 5",
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
  stop: "Stop",
  retake: "Retake scene",
  trackSteps: "Steps",
  trackNotes: "Notes",
  trackVoice: "Voice",
  notesTitle: "Notes",
  kindDiagram: "Diagram",
  kindEdit: "Editing",
  kindVoice: "Voice-over",
  kindApplied: "Applied",
  n1: "Show the planning-mode diagram here — three blocks, bottom up.",
  n2: "Pause runs too long, trim to two seconds.",
  n3: "Re-record: “route created and started” sounds rushed.",
  n4: "Drop the zoom on the panel — it doesn't fit the frame.",
  composerPh: "What should change at this moment? The marker lands at 0:47",
  pin: "Marker at 0:47",
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
};

let lang = "ru";

function apply(dict) {
  document.querySelectorAll("[data-i]").forEach((el) => {
    const key = el.dataset.i;
    if (dict[key]) el.textContent = dict[key];
  });
  document.querySelectorAll("[data-i-ph]").forEach((el) => {
    const key = el.dataset.iPh;
    if (dict[key]) el.placeholder = dict[key];
  });
  document.documentElement.lang = lang;
}

// Живой клиент (live.js) добавляет и переразмечает элементы уже после загрузки: у него
// свои данные и свои состояния. Чтобы не заводить второй словарь, он переводит через
// эту точку — проставляет data-i у нового узла и просит перевести всё заново.
window.taktApply = () => apply(lang === "ru" ? RU : EN);

document.getElementById("lang").addEventListener("click", (e) => {
  lang = lang === "ru" ? "en" : "ru";
  e.currentTarget.textContent = lang === "ru" ? "EN" : "RU";
  apply(lang === "ru" ? RU : EN);
  syncThemeLabel();
});

const themeBtn = document.getElementById("theme");

function syncThemeLabel() {
  const dark = document.documentElement.dataset.theme === "dark";
  const dict = lang === "ru" ? RU : EN;
  themeBtn.textContent = dark ? dict.themeLight : dict.themeDark;
}

themeBtn.addEventListener("click", () => {
  const root = document.documentElement;
  root.dataset.theme = root.dataset.theme === "dark" ? "light" : "dark";
  syncThemeLabel();
});

// Шаг сценария ведёт по времени — в этом и смысл привязки к таймлайну.
document.querySelectorAll(".step").forEach((step) => {
  step.addEventListener("click", () => {
    document.querySelectorAll(".step").forEach((s) => s.removeAttribute("aria-current"));
    step.setAttribute("aria-current", "true");
    const pct = (parseFloat(step.dataset.t) / 287) * 100;
    document.querySelector(".playhead").style.left = `${pct}%`;
  });
});
