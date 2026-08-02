import { setupVoice } from './voice.js';
import { setupNarration } from './narration.js';

/**
 * Связь страницы с агентом.
 *
 * Главное правило этого файла: интерфейс обязан честно показывать, слышит ли его
 * кто-нибудь. Худший сценарий такого инструмента — человек полчаса расставляет
 * замечания, а на том конце никого нет. Поэтому состояние агента приходит потоком,
 * а не запрашивается по кнопке, и при обрыве связи страница сама переходит в
 * «не подключён», не дожидаясь неудачной отправки.
 */

const el = {
  agent: document.querySelector('.agent:not(.stend)'),
  agentText: document.querySelector('.agent-text'),
  agentProgress: document.querySelector('.agent-progress'),
  stend: document.querySelector('.stend'),
  stendText: document.querySelector('.stend-text'),
  frame: document.querySelector('.frame'),
  notes: document.querySelector('.note-list'),
  notesCount: document.querySelector('.notes .panel-count'),
  composer: document.querySelector('.composer textarea'),
  send: document.querySelector('.composer .primary'),
  pin: document.querySelector('.composer .ghost'),
  stop: document.querySelector('[data-i="stop"]'),
  retake: document.querySelector('[data-i="retake"]'),
  playhead: document.querySelector('.playhead'),
  steps: document.querySelector('.steps'),
  scriptEmpty: document.querySelector('.script-empty'),
  scriptHead: document.querySelector('.script .panel-head'),
  scriptCount: document.querySelector('.script .panel-count'),
  taskInput: document.querySelector('.task-input'),
  taskSend: document.querySelector('.task-send'),
  scriptActions: document.querySelector('.script-actions'),
  scenarioNote: document.querySelector('.scenario-note'),
  scenarioNoteSend: document.querySelector('.scenario-note-send'),
  shoot: document.querySelector('.script-shoot'),
  cut: document.querySelector('.cut-run'),
  cuts: document.querySelector('.cuts'),
  sources: document.querySelector('.sources'),
  inspector: document.querySelector('.inspector'),
  composeFrame: document.querySelector('.compose-frame'),
  short: document.querySelector('.short-run'),
  play: document.querySelector('.play'),
  caption: document.querySelector('.caption'),
  plan: document.querySelector('.plan'),
  planList: document.querySelector('.plan-list'),
  planCost: document.querySelector('.plan-cost'),
  planApply: document.querySelector('.plan-apply'),
  inflight: document.querySelector('.script-actions .inflight'),
  inflightNotes: document.querySelector('.inflight-notes'),
  projectSelect: document.querySelector('.project-select'),
  projectNew: document.querySelector('.project-new'),
  connect: document.querySelector('.connect'),
  connectUrl: document.querySelector('.connect-url'),
  connectUser: document.querySelector('.connect-user'),
  connectPassword: document.querySelector('.connect-password'),
  connectSave: document.querySelector('.connect-save'),
  connectCancel: document.querySelector('.connect-cancel'),
  connectTargets: document.querySelector('#connect-targets'),
};

let DURATION = 287;                   // длительность, пока сценарий не пришёл
let movie = null;                     // готовый ролик, когда он собран
let notesData = [];                   // замечания, чтобы рисовать их на дорожке
let narrationData = null;             // дикторский текст для дорожки голоса
let video = null;                     // элемент <video> создаётся при первом ролике
let token = null;
let cursor = 47;                      // текущая позиция, секунды
let stream = null;

const mmss = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

/**
 * Разметка узла для словаря.
 *
 * Ключ строки и подстановки к ней остаются на самом узле, а не растворяются в готовом
 * тексте. Поэтому при переключении языка строка собирается заново — сама, без повторной
 * отрисовки панели и без второго словаря на этой стороне. Иначе всё, что вставлено
 * отсюда, застывало бы на языке, который стоял в момент вставки.
 *
 * Ключ null снимает разметку: там, где стоит имя стенда, подпись шага или текст
 * замечания, переводить нечего — это данные, а не интерфейс.
 *
 * Подстановки на узле одни на все ключи, поэтому текст и подсказка одного узла не могут
 * требовать разных значений. Пока и не требуют: где нужны оба, они без подстановок.
 */
function say(node, slot, key, args) {
  if (!node) return node;
  if (key) node.dataset[slot] = key; else delete node.dataset[slot];
  if (args) node.dataset.iArgs = JSON.stringify(args); else delete node.dataset.iArgs;
  return node;
}

/** Текст узла по ключу словаря. Без ключа — оставляем что было: это данные. */
function tr(node, key, args = null) {
  say(node, 'i', key, args);
  const text = window.taktText?.(key, args);
  if (node && text != null) node.textContent = text;
  return node;
}

/** То же для подсказки: она такой же текст интерфейса, только читают её реже. */
function trTitle(node, key, args = null) {
  say(node, 'iTitle', key, args);
  const text = window.taktText?.(key, args);
  if (node && text != null) node.title = text;
  return node;
}

/** И для приглашения в поле ввода. */
function trPh(node, key, args = null) {
  say(node, 'iPh', key, args);
  const text = window.taktText?.(key, args);
  if (node && text != null) node.placeholder = text;
  return node;
}

function setAgent(status, alive) {
  if (!el.agent) return;
  const state = !alive ? 'offline' : (status?.state === 'busy' ? 'busy' : 'listening');
  el.agent.dataset.state = state;

  // Что показывает агент, знает только агент: часть его состояний — наши фразы (приходят
  // ключом), часть — подписи шагов сценария, которые написал человек и переводить нельзя.
  if (el.agentText) {
    if (!alive) tr(el.agentText, 'agentOffline');
    else if (status?.key) tr(el.agentText, status.key, status.args);
    else if (status?.text) { tr(el.agentText, null); el.agentText.textContent = status.text; }
    else tr(el.agentText, 'agentListening');
  }
  // «2 из 5» вынесено в отдельный узел: числа приходят из данных, а порядок слов вокруг
  // них у каждого языка свой, и склеивать их в одну строку значит потерять перевод.
  if (el.agentProgress) {
    const counted = state === 'busy' && status?.step && status?.of;
    el.agentProgress.hidden = !counted;
    if (counted) tr(el.agentProgress, 'agentProgress', { step: status.step, of: status.of });
  }
  // Отправлять некуда, пока никто не слушает: кнопка блокируется, а не молча глотает клик.
  if (el.send) el.send.disabled = !alive;
}

/** Откуда взялся адрес стенда — ключ на каждый источник: подстановка внутрь подстановки
    не переводится, а собранная из двух строк подсказка застыла бы на языке сборки. */
const STEND_SOURCES = {
  form: 'stendSrcForm',
  manual: 'stendSrcManual',
  env: 'stendSrcEnv',
  config: 'stendSrcConfig',
  preset: 'stendSrcPreset',
};

/** Адрес показываем без схемы и хвоста: в шапке ценно место, а узнаётся стенд по имени. */
function setStend(stend) {
  if (!el.stend || !stend) return;
  el.stend.dataset.state = stend.state || 'unknown';
  const host = stend.url
    ? stend.url.replace(/^https?:\/\//, '').replace(/\/manager\/?$/, '').replace(/\/$/, '')
    : null;
  if (stend.state === 'ok' && host) {
    tr(el.stendText, null);
    el.stendText.textContent = host;
  } else if (stend.key) {
    tr(el.stendText, stend.key, stend.args);
  } else if (stend.text) {
    tr(el.stendText, null);
    el.stendText.textContent = stend.text;
  } else {
    tr(el.stendText, 'stendUnchecked');
  }

  // В подсказке — полный адрес и откуда он взялся: когда стенд не тот, первый вопрос
  // именно этот, и ответ должен быть под рукой, а не в конфиге.
  const source = STEND_SOURCES[stend.fromKey];
  if (source) {
    trTitle(el.stend, source, { url: stend.url, ...(stend.fromArgs || {}) });
  } else {
    // Запись без ключа осталась от журнала прежних съёмок: показываем как есть, а не
    // прячем адрес совсем — устаревшая подсказка полезнее пустой.
    trTitle(el.stend, null);
    el.stend.title = [stend.url, stend.from && `источник: ${stend.from}`].filter(Boolean).join('\n');
  }
}

/**
 * Сценарий в панели. Показывает не только что произойдёт, но и сколько это займёт:
 * хронометраж виден до съёмки, а не после — переснимать пятнадцатиминутный ролик,
 * поняв, что он длинный, дороже, чем сократить план заранее.
 */
let storyboard = null;

/**
 * Правка сценария разделена по стоимости, и это не педантизм.
 *
 * Переписать подпись, поменять длительность, убрать или подвинуть шаг — данные, которые
 * человек знает лучше агента, и гонять ради них модель значит ждать минуту там, где
 * достаточно мгновения. А вот «добавь шаг, где показано X» требует знания интерфейса
 * стенда — это уходит агенту.
 */
/**
 * Перетаскивание шагов. Обработчики висят на списке, а не на строках: строки
 * пересоздаются при каждой перерисовке, и повторное навешивание на них копило бы
 * подписки, пока перестановка не начала бы срабатывать по нескольку раз.
 */
let dragFrom = null;

function setupDragAndDrop(list) {
  list.addEventListener('dragstart', (e) => {
    const row = e.target.closest('.step-row');
    if (!row) return;
    dragFrom = Number(row.dataset.index);
    row.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
    // Firefox не начинает перетаскивание без данных в буфере.
    e.dataTransfer.setData('text/plain', String(dragFrom));
  });

  list.addEventListener('dragover', (e) => {
    const row = e.target.closest('.step-row');
    if (!row || dragFrom === null) return;
    e.preventDefault();
    const r = row.getBoundingClientRect();
    const after = e.clientY > r.top + r.height / 2;
    list.querySelectorAll('.step-row').forEach((x) => x.classList.remove('drop-before', 'drop-after'));
    row.classList.add(after ? 'drop-after' : 'drop-before');
  });

  list.addEventListener('dragleave', (e) => {
    if (e.target.closest('.step-row') === e.relatedTarget?.closest?.('.step-row')) return;
    list.querySelectorAll('.step-row').forEach((x) => x.classList.remove('drop-before', 'drop-after'));
  });

  list.addEventListener('drop', async (e) => {
    const row = e.target.closest('.step-row');
    list.querySelectorAll('.step-row').forEach((x) => x.classList.remove('drop-before', 'drop-after', 'dragging'));
    if (!row || dragFrom === null) return;
    e.preventDefault();
    const r = row.getBoundingClientRect();
    const over = Number(row.dataset.index);
    let to = e.clientY > r.top + r.height / 2 ? over + 1 : over;
    const plans = [...storyboard.plans];
    const [moved] = plans.splice(dragFrom, 1);
    // После выреза индексы ниже сдвигаются на один — иначе план встаёт мимо места.
    if (dragFrom < to) to -= 1;
    plans.splice(to, 0, moved);
    dragFrom = null;
    if (plans.some((x, idx) => x !== storyboard.plans[idx])) await pushBoard({ plans });
  });

  list.addEventListener('dragend', () => {
    dragFrom = null;
    list.querySelectorAll('.step-row').forEach((x) => x.classList.remove('drop-before', 'drop-after', 'dragging'));
  });
}

async function pushBoard(patch = {}) {
  storyboard = { ...storyboard, ...patch };
  await post('/api/storyboard', storyboard);
}

function renderBoard(next) {
  storyboard = next;
  const has = Boolean(storyboard?.plans?.length);
  if (el.scriptEmpty) el.scriptEmpty.hidden = has;
  if (el.steps) el.steps.hidden = !has;
  if (el.scriptActions) el.scriptActions.hidden = !has;
  if (!has) {
    if (el.scriptCount) el.scriptCount.textContent = '';
    return;
  }

  DURATION = storyboard.seconds || DURATION;
  const shooting = storyboard.plans.some((x) => x.state === 'running');
  // Плашка «идёт съёмка» показывается ровно пока съёмка идёт: висящая поверх готового
  // кадра, она врёт о состоянии — а состояние здесь и есть главное, что читает человек.
  const liveBadge = document.querySelector('.live-badge');
  if (liveBadge) liveBadge.hidden = !shooting;
  if (el.frame) el.frame.dataset.live = shooting ? 'true' : 'false';
  const editable = storyboard.status !== 'ready' && !shooting;
  el.steps.innerHTML = '';

  storyboard.plans.forEach((s, i) => {
    const li = document.createElement('li');
    li.className = 'step-row';
    li.dataset.n = String(s.n);
    li.dataset.plan = s.id;
    const b = document.createElement('button');
    b.className = 'step';
    b.type = 'button';
    b.dataset.t = String(s.at);
    if (s.state && s.state !== 'done') b.dataset.state = s.state;
    b.innerHTML = `<span class="step-time">${mmss(s.at)}</span>
      <span class="step-dur"></span>
      <span class="step-label"></span>${s.diagram || s.intent ? '<span class="step-note"></span>' : ''}`;
    b.querySelector('.step-label').textContent = s.title.text;
    // Длительность видна всегда и всегда говорит, откуда взялась: «выведена» и
    // «назначена человеком» — разные вещи, и пересчёт трогает только первую.
    const dur = b.querySelector('.step-dur');
    dur.textContent = `${s.duration.seconds} с`;
    dur.dataset.source = s.duration.source;
    trTitle(dur, s.duration.source === 'manual' ? 'durManual' : 'durDerived');
    const note = b.querySelector('.step-note');
    // Врезку описываем мы, намерение плана — агент: первое переводится, второе нет.
    if (note && s.diagram) tr(note, 'stepDiagram', { sec: s.duration.seconds });
    else if (note) note.textContent = s.intent;
    if (s.state === 'failed' && s.error) {
      const err = document.createElement('span');
      err.className = 'step-error';
      err.textContent = s.error;
      b.append(err);
      // Причина без подсказки оставляет человека наедине с чужим API: он заказывал
      // ролик, а не разбирался с таймаутами селекторов.
      if (s.fix) {
        const fix = document.createElement('span');
        fix.className = 'step-fix';
        fix.textContent = s.fix;
        b.append(fix);
      }
    }
    b.addEventListener('click', () => {
      el.steps.querySelectorAll('.step').forEach((x) => x.removeAttribute('aria-current'));
      b.setAttribute('aria-current', 'true');
      seek(s.at);
    });
    li.append(b);

    if (!editable) {
      const retake = document.createElement('div');
      retake.className = 'step-tools';
      retake.innerHTML = '<button type="button" class="step-tool" data-act="from"></button>';
      tr(retake.firstElementChild, 'toolFrom');
      retake.addEventListener('click', (e) => {
        if (e.target.dataset?.act !== 'from') return;
        post('/api/event', { type: 'retake', from: s.n, label: s.title.text });
      });
      li.append(retake);
    }

    if (editable) {
      li.draggable = true;
      li.dataset.index = String(i);

      // Перетаскивание удобно мышью, но с клавиатуры недоступно вовсе. Alt со стрелками
      // закрывает это, не занимая места в интерфейсе.
      b.addEventListener('keydown', (k) => {
        if (!k.altKey || (k.key !== 'ArrowUp' && k.key !== 'ArrowDown')) return;
        k.preventDefault();
        const to = k.key === 'ArrowUp' ? i - 1 : i + 1;
        if (to < 0 || to >= storyboard.plans.length) return;
        const plans = [...storyboard.plans];
        [plans[i], plans[to]] = [plans[to], plans[i]];
        pushBoard({ plans });
      });

      const tools = document.createElement('div');
      tools.className = 'step-tools';
      tools.innerHTML = `
        <span class="step-tool" data-act="drag"></span>
        <button type="button" class="step-tool" data-act="edit"></button>
        <button type="button" class="step-tool" data-act="time"></button>
        <button type="button" class="step-tool" data-act="del"></button>`;
      const drag = tools.querySelector('[data-act="drag"]');
      tr(drag, 'toolDrag');
      trTitle(drag, 'toolDragTitle');
      tr(tools.querySelector('[data-act="edit"]'), 'toolEdit');
      const timeTool = tools.querySelector('[data-act="time"]');
      tr(timeTool, 'toolTime');
      trTitle(timeTool, 'toolTimeTitle');
      tools.addEventListener('click', async (e) => {
        const act = e.target.dataset?.act;
        if (!act || act === 'drag') return;
        const plans = [...storyboard.plans];
        if (act === 'del') plans.splice(i, 1);
        if (act === 'time') {
          // Время правится на месте, как и титр. Пустая строка возвращает выведенное:
          // отменить своё решение должно быть так же легко, как принять.
          const cell = b.querySelector('.step-dur');
          cell.contentEditable = 'true';
          cell.focus();
          document.getSelection().selectAllChildren(cell);
          let closed = false;
          const commit = async () => {
            if (closed) return;
            closed = true;
            cell.contentEditable = 'false';
            const text = cell.textContent.replace(',', '.').trim();
            const seconds = Number.parseFloat(text);
            plans[i] = { ...plans[i],
              duration: text === '' || !Number.isFinite(seconds) || seconds <= 0
                ? undefined
                : { source: 'manual', seconds: Math.round(seconds * 10) / 10 } };
            await pushBoard({ plans });
          };
          cell.addEventListener('blur', commit, { once: true });
          cell.addEventListener('keydown', (k) => {
            if (k.key === 'Enter') { k.preventDefault(); commit(); }
            if (k.key === 'Escape') {
              closed = true;
              cell.textContent = `${s.duration.seconds} с`;
              cell.contentEditable = 'false';
            }
          });
          return;
        }
        if (act === 'edit') {
          // Правка на месте: подпись — это то, что увидит зритель, и переписывать её
          // удобнее прямо там, где она читается, а не в отдельной форме.
          const label = b.querySelector('.step-label');
          label.contentEditable = 'true';
          label.focus();
          document.getSelection().selectAllChildren(label);
          // Сохранение вызывается напрямую, а не через потерю фокуса: любая замена
          // содержимого узла фокус сбрасывает, и правка молча пропадает.
          let done = false;
          const commit = async () => {
            if (done) return;
            done = true;
            label.contentEditable = 'false';
            const text = label.textContent.trim();
            if (!text) { label.textContent = s.title.text; return; }
            if (text === s.title.text) return;
            plans[i] = { ...plans[i], title: { ...plans[i].title, text } };
            await pushBoard({ plans });
          };
          label.addEventListener('blur', commit, { once: true });
          label.addEventListener('keydown', (k) => {
            if (k.key === 'Enter') { k.preventDefault(); commit(); }
            if (k.key === 'Escape') { done = true; label.textContent = s.title.text; label.contentEditable = 'false'; }
          });
          return;
        }
        await pushBoard({ plans });
      });
      li.append(tools);
    }

    el.steps.append(li);
  });

  if (el.scriptCount) el.scriptCount.textContent = `${storyboard.plans.length} · ${mmss(DURATION)}`;
  renderRuler();
  renderTracks();
  // Открытый инспектор перечитывается: сервер нормализовал правку, и показывать
  // человеку его же ввод вместо принятого значения — самый тихий способ соврать.
  if (openEffect) {
    if (effectById(openEffect)) openInspector(openEffect);
    else closeInspector();
  }

  // Статус рядом с заголовком: пока черновик — съёмка не стартует, и человек должен
  // понимать, почему, не заглядывая в документацию.
  let badge = el.scriptHead.querySelector('.script-status');
  if (!badge) {
    badge = document.createElement('span');
    badge.className = 'script-status';
    el.scriptHead.querySelector('span').after(badge);
  }
  badge.dataset.state = storyboard.status;
  tr(badge, storyboard.status === 'ready' ? 'statusReady' : 'statusDraft');

  if (el.shoot) {
    el.shoot.hidden = false;
    const ready = storyboard.status === 'ready';
    tr(el.shoot, ready ? 'shootDone' : 'shootRun');
    // Съёмку выполняет агент: без него кнопка обещала бы то, чего не произойдёт.
    el.shoot.disabled = ready || el.agent?.dataset.state === 'offline';
    if (el.shoot.disabled && !ready) trTitle(el.shoot, 'shootOffline');
    else { trTitle(el.shoot, null); el.shoot.title = ''; }
  }
}

/**
 * Инспектор эффекта.
 *
 * Правка идёт в раскадровку, сервер её нормализует, композиция перечитывается —
 * секунды вместо минут, потому что съёмка при этом не запускается. Любая правка
 * помечает эффект ручным: перегенерация обязана обходить его стороной, иначе
 * следующий заход режиссёра молча сотрёт работу человека.
 */
let openEffect = null;

const MOVE_FIELDS = { push: ['depth'], pan: ['speed'], drift: [] };

function effectById(id) {
  return (storyboard?.effects || []).find((e) => e.id === id) || null;
}

function openInspector(id) {
  const e = effectById(id);
  if (!e || !el.inspector) return;
  openEffect = id;
  const plan = (storyboard?.plans || []).find((x) => x.id === e.plan);
  el.inspector.hidden = false;
  tr(el.inspector.querySelector('.inspector-title'), 'fxOn', { plan: plan?.title.text || e.plan });

  const move = e.kind === 'transition' ? 'drift' : (e.params?.move || 'drift');
  el.inspector.querySelector('.fx-move').value = move;
  el.inspector.querySelector('.fx-depth').value = e.params?.depth ?? 1.26;
  el.inspector.querySelector('.fx-speed').value = e.params?.speed ?? 600;
  el.inspector.querySelector('.fx-from').value = e.at?.from ?? 0;
  el.inspector.querySelector('.fx-to').value = e.at?.to ?? 0;
  // Склейка своего движения не имеет: показывать ей поля камеры значит обещать
  // правку, которой не будет.
  el.inspector.querySelector('.fx-move').disabled = e.kind === 'transition';
  el.inspector.querySelector('.inspector-auto').hidden = e.source !== 'manual';
  syncInspectorFields();
  renderTracks();
}

function closeInspector() {
  openEffect = null;
  if (el.inspector) el.inspector.hidden = true;
  renderTracks();
}

/** Поля показываются по виду движения: у панорамы нет глубины, у наезда — скорости. */
function syncInspectorFields() {
  if (!el.inspector) return;
  const move = el.inspector.querySelector('.fx-move').value;
  const нужные = MOVE_FIELDS[move] || [];
  el.inspector.querySelector('.fx-depth-row').hidden = !нужные.includes('depth');
  el.inspector.querySelector('.fx-speed-row').hidden = !нужные.includes('speed');
}

async function saveInspector() {
  const e = effectById(openEffect);
  if (!e) return;
  const move = el.inspector.querySelector('.fx-move').value;
  const num = (sel) => Number(el.inspector.querySelector(sel).value);
  const params = e.kind === 'transition'
    ? { ...e.params }
    : { move, ...(move === 'push' ? { depth: num('.fx-depth') } : {}),
                ...(move === 'pan' ? { speed: num('.fx-speed') } : {}) };
  const next = { ...e, params, source: 'manual',
                 at: { from: num('.fx-from'), to: num('.fx-to') } };
  const effects = (storyboard.effects || []).map((x) => (x.id === e.id ? next : x));
  await pushBoard({ effects });
}

/** Вернуть автоматический: ручной эффект убирается, режиссёр ставит свой. */
async function dropManualEffect() {
  const e = effectById(openEffect);
  if (!e) return;
  closeInspector();
  await pushBoard({ effects: (storyboard.effects || []).filter((x) => x.id !== e.id) });
}

/**
 * Дорожки таймлайна строятся из данных.
 *
 * Раньше они были зашиты в разметку макетными засечками и не менялись никогда: верхняя
 * дорожка показывала шесть случайных чёрточек независимо от того, сколько в сценарии
 * шагов, а клипы голоса стояли там, где их нарисовали при вёрстке. Выглядело живо и
 * врало полностью — таймлайн должен показывать снятое, а не образец.
 */
function renderTracks() {
  const pct = (t) => `${Math.max(0, Math.min(100, (t / DURATION) * 100))}%`;
  const track = (name) => document.querySelector(`.track[data-track="${name}"]`);

  // Шаги: сегменты, как клипы в монтажке. Граница шага читается стыком сегментов,
  // состояние — цветом; зазор в пиксель с каждой стороны и делает стык видимым.
  const steps = track('steps');
  if (steps) {
    steps.querySelectorAll('.step-seg').forEach((x) => x.remove());
    for (const s of storyboard?.plans || []) {
      const seg = document.createElement('span');
      seg.className = 'step-seg';
      seg.dataset.state = s.state || 'pending';
      seg.style.left = `calc(${pct(s.at)} + 1px)`;
      seg.style.width = `calc(${pct(s.duration.seconds)} - 2px)`;
      seg.title = `${s.n}. ${s.title.text}`;
      steps.append(seg);
    }
  }

  /**
   * Эффекты: камера и склейки — то, что решил режиссёр.
   *
   * До этой дорожки решение композиции было неисправимым: человек видел результат,
   * но не имел, что править. Клип ведёт на начало своего эффекта, потому что смотреть
   * наезд имеет смысл с того кадра, где он начинается, а не с начала плана.
   */
  const fx = track('effects');
  if (fx) {
    fx.innerHTML = '';
    const byId = new Map((storyboard?.plans || []).map((x) => [x.id, x]));
    for (const e of storyboard?.effects || []) {
      const plan = byId.get(e.plan);
      if (!plan) continue;
      const from = plan.at + (e.at?.from || 0);
      const to = plan.at + (e.at?.to ?? plan.duration.seconds);
      const clip = document.createElement('span');
      clip.className = 'clip';
      clip.dataset.kind = e.kind === 'transition' ? 'cut' : 'camera';
      if (e.source === 'manual') clip.dataset.source = 'manual';
      clip.style.left = pct(from);
      clip.style.width = pct(Math.max(0.25, to - from));
      const move = e.kind === 'transition' ? e.params?.style : e.params?.move;
      tr(clip, `fx_${move}`);
      trTitle(clip, e.source === 'manual' ? 'fxManual' : `fx_${move}`);
      clip.dataset.fx = e.id;
      if (e.id === openEffect) clip.setAttribute('aria-current', 'true');
      clip.addEventListener('click', (ev) => {
        ev.stopPropagation();
        seek(from);
        // Клик по эффекту ставит плейхед на его начало и открывает правку: смотреть
        // наезд имеет смысл с того кадра, где он начинается.
        openInspector(e.id);
      });
      fx.append(clip);
    }
  }

  // Схемы: врезка занимает время, поэтому это отрезок, а не точка.
  const diagrams = track('diagrams');
  if (diagrams) {
    diagrams.innerHTML = '';
    for (const s of (storyboard?.plans || []).filter((x) => x.diagram)) {
      const clip = document.createElement('span');
      clip.className = 'clip';
      clip.dataset.kind = 'diagram';
      clip.style.left = pct(s.at);
      clip.style.width = pct(s.duration.seconds);
      clip.textContent = s.diagram;
      clip.dataset.step = s.id;
      trTitle(clip, 'clipDiagram', { name: s.diagram, sec: s.duration.seconds });
      // Клик ведёт к шагу, на котором схема показывается: врезка живёт не сама по
      // себе, а поверх конкретной паузы, и смотреть её нужно там же.
      clip.addEventListener('click', (e) => {
        e.stopPropagation();
        seek(s.at);
        litStep(s.n);
      });
      dragMark(clip, {
        onDrop: async (t) => {
          const to = (storyboard?.plans || [])
            .find((x) => t >= x.at && t < x.at + x.duration.seconds);
          if (to && to.id !== s.id) await post('/api/diagram-move', { from: s.id, to: to.id });
          else renderTracks();      // не попали в план — вернуть метку на место
        },
      });
      diagrams.append(clip);
    }
  }

  // Правки: точка на моменте замечания, цвет по виду работы.
  const notesTrack = track('notes');
  if (notesTrack) {
    notesTrack.innerHTML = '';
    for (const n of notesData) {
      const m = document.createElement('span');
      m.className = 'marker';
      if (n.kind) m.dataset.kind = n.kind;
      m.style.left = pct(n.t);
      m.title = n.text;
      m.dataset.id = n.id;
      m.addEventListener('click', (e) => {
        e.stopPropagation();
        seek(n.t);
        litNote(n.id);
      });
      dragMark(m, { onDrop: (t) => post('/api/note-move', { id: n.id, t }) });
      notesTrack.append(m);
    }
  }

  // Голос: реплика занимает столько, сколько её записали. Пока не озвучена — оценка
  // по длине текста, и это видно по приглушённому виду.
  const voiceTrack = track('voice');
  if (voiceTrack) {
    voiceTrack.innerHTML = '';
    for (const l of narrationData?.lines || []) {
      const seconds = l.seconds || l.text.trim().length / 13;
      const clip = document.createElement('span');
      clip.className = 'clip';
      clip.style.left = pct(l.at);
      clip.style.width = pct(seconds);
      clip.style.opacity = l.seconds ? '1' : '0.5';
      clip.textContent = l.text.slice(0, 40);
      clip.title = l.text;
      clip.dataset.n = String(l.n);
      clip.addEventListener('click', (e) => {
        e.stopPropagation();
        seek(l.at);
        narrationPanel?.open(l.n);
      });
      dragMark(clip, {
        onDrop: async (t) => {
          // Реплика переезжает — окна пересчитываются: у каждой оно до следующей
          // метки, и без пересчёта проверка укладки врала бы про соседей.
          const lines = narrationData.lines
            .map((x) => (x.n === l.n ? { ...x, at: t } : x))
            .sort((a, b) => a.at - b.at)
            // Округляем: разность плавающих даёт 3.8000000000000007, и это число
            // потом видно человеку в проверке укладки.
            .map((x, i, arr) => ({ ...x, n: i + 1,
                                   hold: arr[i + 1] ? Math.round((arr[i + 1].at - x.at) * 10) / 10 : null }));
          await post('/api/narration', { ...narrationData, lines });
        },
      });
      voiceTrack.append(clip);
    }
  }
}

/** Линейка строится из длительности сценария: зашитая в разметку, она врёт после
    первой же правки — показывает 4:47 на ролике в полминуты. */
function renderRuler() {
  const ruler = document.querySelector('.ruler');
  if (!ruler) return;
  ruler.innerHTML = '';
  for (let i = 0; i <= 4; i++) {
    const span = document.createElement('span');
    span.style.left = `${i * 25}%`;
    span.textContent = mmss((DURATION * i) / 4);
    ruler.append(span);
  }
  const total = document.querySelector('.clock');
  if (total) total.innerHTML = `<b>${mmss(cursor)}</b> / ${mmss(DURATION)}`;
}

const EVENT_TITLES = {
  scenario_note: 'evScenarioNote',
  task: 'evTask',
  note: 'evNote',
  apply: 'evApply',
  retake: 'evRetake',
  shoot: 'evShoot',
  stop: 'evStop',
  narrate: 'evNarrate',
  check_stend: 'evCheckStend',
  voice_prepare: 'evVoicePrepare',
  cut: 'evCut',
  short: 'evShort',
};

/**
 * Что отправлено и ещё не выполнено.
 *
 * Разделено по панелям: правка сценария показывается там, откуда её отправляли, а
 * команды съёмки — рядом с замечаниями. Общий список в одном углу заставлял бы искать
 * свою строку среди чужих.
 */
function renderInFlight(list = []) {
  const paint = (host, items) => {
    if (!host) return;
    host.hidden = items.length === 0;
    host.innerHTML = '';
    for (const e of items) {
      const li = document.createElement('li');
      li.dataset.state = e.state;
      const span = document.createElement('span');
      span.className = 'inflight-text';
      // Название события переводится, текст замечания — нет, поэтому они разными узлами:
      // склеенные в один, они переводились бы вместе с чужой строкой внутри.
      const title = document.createElement('span');
      title.textContent = e.type;
      tr(title, EVENT_TITLES[e.type]);
      span.append(title);
      if (e.text) span.append(`: ${e.text}`);
      const state = document.createElement('span');
      tr(state, e.state === 'working' ? 'evWorking' : 'evWaiting');
      li.append(span, state);
      host.append(li);
    }
  };
  paint(el.inflight, list.filter((e) => e.type === 'scenario_note' || e.type === 'task'));
  paint(el.inflightNotes, list.filter((e) => e.type !== 'scenario_note' && e.type !== 'task'));
}

/**
 * Готовый ролик занимает место живого экрана.
 *
 * Кадр съёмки и смонтированный ролик — это одна и та же область, а не две: пока идёт
 * работа, там видно, что происходит; когда работа кончилась, там видно результат.
 * Держать их рядом значило бы делить и без того тесный центр между двумя картинками,
 * из которых в каждый момент осмысленна ровно одна.
 */
/**
 * Версии ролика: мастер, смонтированный, хайлайты.
 *
 * Переключатель показывает только собранное. Вертикальную версию плеер студии
 * покажет как есть — с полями по бокам: подгонять окно под 9:16 значило бы
 * перестраивать всё рабочее место ради предпросмотра.
 */
function renderCuts(cuts) {
  if (!el.cuts) return;
  el.cuts.hidden = cuts.length < 2;
  if (cuts.length < 2) return;

  const текущий = video?.src ? decodeURIComponent(video.src).split('/').pop() : null;
  el.cuts.innerHTML = '';
  for (const c of cuts) {
    const b = document.createElement('button');
    b.className = 'cut-btn';
    b.type = 'button';
    b.setAttribute('aria-pressed', String(c.file === текущий));
    tr(b, c.key);
    // Размер — в подсказку, а не в кнопку: он нужен раз в жизни, перед отправкой
    // файла, а место в панели транспорта занимает постоянно.
    b.title = `${c.size} МБ`;
    b.addEventListener('click', () => {
      if (!video) return;
      const было = video.currentTime;
      video.src = c.url;
      // Позицию сохраняем: человек сравнивает версии в одном месте ролика, и
      // сброс в ноль заставлял бы каждый раз доматывать заново.
      video.addEventListener('loadedmetadata', () => {
        video.currentTime = Math.min(было, video.duration || было);
      }, { once: true });
      renderCuts(cuts);
    });
    el.cuts.append(b);
  }
}

function renderMovie(next) {
  movie = next;
  // Монтировать можно только снятое: до первой съёмки эти кнопки — обещание,
  // которое некуда исполнить.
  const снято = Boolean(movie?.url);
  if (el.cut) el.cut.hidden = !снято;
  if (el.short) el.short.hidden = !снято;
  renderCuts(movie?.cuts || []);
  if (!movie?.url || !el.frame) return;

  if (!video) {
    video = document.createElement('video');
    video.className = 'movie';
    video.preload = 'metadata';
    video.addEventListener('timeupdate', () => {
      if (!video.seeking) syncCursor(video.currentTime);
    });
    video.addEventListener('loadedmetadata', () => {
      DURATION = video.duration || DURATION;
      renderRuler();
    });
    el.frame.append(video);
  }
  if (!video.src.endsWith(movie.url)) video.src = movie.url;

  const img = el.frame.querySelector('img');
  if (img) img.hidden = true;
  renderSources();
  // Готовый файл не выталкивает композицию из кадра: человек смотрит то, что выбрал.
  video.hidden = source === 'compose' && compose.ready;
  if (source === 'video') DURATION = movie.duration || DURATION;
  renderRuler();
  renderTracks();
  // Позиция могла остаться от прежней длительности и оказаться за концом нового ролика:
  // тогда титр показывает последний кадр сценария ещё до нажатия «играть».
  if (cursor > DURATION) seek(0);
  else renderCaption(cursor);
}

/**
 * Композиция во врезке — главный инструмент студии.
 *
 * Ролик смотрится без единого рендера: кадр вычисляется из позиции плейхеда той же
 * страницей, которой он потом снимается покадрово в файл. Предпросмотр и вывод не
 * могут разойтись, потому что это один код.
 *
 * Источник в кадре один за раз: композиция ИЛИ собранное видео. Показывать оба
 * бессмысленно — это одно и то же с точностью до времени рендера, — а вот путать их
 * опасно: правку эффекта видно только в композиции, и человек решил бы, что она не
 * применилась.
 */
let compose = { ready: false, seconds: 0, playing: null };
let source = 'compose';

function setupCompose() {
  if (!el.composeFrame) return;
  addEventListener('message', (e) => {
    if (e.data?.source !== 'takt-compose') return;
    if (e.data.type === 'takt:ready') {
      compose = { ...compose, ready: true, seconds: e.data.seconds || 0 };
      if (e.data.issues?.length) console.warn('замечания композиции:', e.data.issues);
    }
    if (e.data.type === 'takt:error') compose = { ...compose, ready: false, seconds: 0 };
    renderSources();
    if (source === 'compose') setSource('compose');
  });
  reloadCompose();
}

/**
 * Перечитать композицию. Вызывается на каждую правку раскадровки: «правка параметра
 * видна сразу» — это обещание студии, и выполняет его именно перезагрузка врезки.
 * Метка времени в адресе нужна против кеша снимков: имена файлов состояний не меняются.
 */
function reloadCompose() {
  if (!el.composeFrame) return;
  el.composeFrame.src = `/compose/player.html?embed=1&v=${Date.now()}`;
}

/** Показывать переключатель есть смысл, только когда есть между чем выбирать. */
function renderSources() {
  if (!el.sources) return;
  const хоть_что_то = compose.ready || Boolean(movie?.url);
  el.sources.hidden = !хоть_что_то;
  for (const b of el.sources.querySelectorAll('.source-btn')) {
    const свой = b.dataset.source;
    b.disabled = свой === 'compose' ? !compose.ready : !movie?.url;
    b.setAttribute('aria-pressed', String(source === свой));
    trTitle(b, свой === 'compose' ? 'sourceComposeTitle' : 'sourceVideoTitle');
  }
}

function setSource(next) {
  source = next;
  const показываем_композицию = next === 'compose' && compose.ready;
  if (el.composeFrame) el.composeFrame.hidden = !показываем_композицию;
  if (video) video.hidden = показываем_композицию;
  const img = el.frame?.querySelector('img');
  if (img && (показываем_композицию || movie?.url)) img.hidden = true;
  // Титры композиции выжжены в самом кадре — накладывать их поверх значит показать
  // каждый дважды.
  if (el.caption) el.caption.hidden = показываем_композицию;

  const длина = показываем_композицию ? compose.seconds : (movie?.duration || DURATION);
  if (длина) { DURATION = длина; renderRuler(); renderTracks(); }
  stopPlaying();
  renderSources();
  syncCursor(Math.min(cursor, DURATION));
}

/** Композицию проигрывает студия: у врезки нет своих органов управления намеренно. */
function stopPlaying() {
  if (compose.playing) { clearInterval(compose.playing); compose.playing = null; }
  if (el.play) el.play.setAttribute('aria-pressed', 'false');
  video?.pause?.();
}

function togglePlay() {
  if (source === 'video') {
    if (!video) return;
    if (video.paused) video.play(); else video.pause();
    return;
  }
  if (compose.playing) return stopPlaying();
  if (!compose.ready) return;
  if (cursor >= DURATION - 0.05) seek(0);
  el.play?.setAttribute('aria-pressed', 'true');
  // Шаг в 1/25 секунды: врезка всё равно вычисляет кадр по времени, а более частая
  // отправка сообщений ничего не добавляет к плавности просмотра.
  const шаг = 0.04;
  compose.playing = setInterval(() => {
    if (cursor + шаг >= DURATION) { seek(DURATION); return stopPlaying(); }
    seek(cursor + шаг);
  }, шаг * 1000);
}

/** Титр текущего момента: последний, чьё время уже наступило. */
function renderCaption(t) {
  if (!el.caption) return;
  const list = movie?.captions || [];
  const current = [...list].reverse().find((c) => t >= c.t);
  el.caption.hidden = !current;
  if (current) el.caption.textContent = current.label;
}

/** Перемещение позиции без обратного дёрганья видео. */
function syncCursor(t) {
  cursor = Math.max(0, Math.min(DURATION, t));
  const head = document.querySelector('.playhead');
  if (head) head.style.left = `${(cursor / DURATION) * 100}%`;
  const clock = document.querySelector('.clock');
  if (clock) clock.innerHTML = `<b>${mmss(cursor)}</b> / ${mmss(DURATION)}`;
  tr(el.pin, 'pin', { t: mmss(cursor) });
  trPh(el.composer, 'composerPh', { t: mmss(cursor) });
  renderCaption(cursor);
  // Плейхед и кадр композиции — одна позиция, а не две синхронизируемые.
  if (source === 'compose' && compose.ready && el.composeFrame?.contentWindow) {
    el.composeFrame.contentWindow.postMessage({ type: 'takt:seek', t: cursor }, '*');
  }
}

/**
 * План работ по накопленным замечаниям.
 *
 * Показывается до нажатия, а не после: «поправь титр» и «покажи другой раздел» выглядят
 * одинаково — две строчки текста, — но стоят двух минут и двадцати. Человек должен
 * увидеть эту разницу прежде, чем согласится ждать.
 */
const PLAN_KINDS = {
  shoot: 'planShoot',
  voice: 'planVoice',
  diagram: 'planDiagram',
  edit: 'planEdit',
  unclear: 'planUnclear',
};

async function renderPlan() {
  if (!el.plan) return;
  const plan = await fetch('/api/plan').then((r) => r.json()).catch(() => null);
  const items = plan?.items || [];
  el.plan.hidden = items.length === 0;
  if (!items.length) return;

  el.planList.innerHTML = '';
  for (const it of items) {
    const li = document.createElement('li');
    li.dataset.kind = it.kind;
    const kind = document.createElement('span');
    kind.className = 'plan-kind';
    // Разбор пришёл с сервера видом работы, а не только готовой строкой: вид — это
    // те же пять значений, что и в дорожках, и назвать их — работа интерфейса.
    kind.textContent = it.title;
    tr(kind, PLAN_KINDS[it.kind]);
    const why = document.createElement('span');
    why.textContent = it.why;
    tr(why, PLAN_KINDS[it.kind] && `${PLAN_KINDS[it.kind]}Why`);
    li.append(kind, why);
    el.planList.append(li);
  }

  if (plan.minutes) tr(el.planCost, 'planCost', { min: plan.minutes });
  else tr(el.planCost, 'planCostUnknown');
  // Пересъёмка — единственное, что стоит десятки минут: об этом говорим прямо в кнопке.
  tr(el.planApply, plan.needsShooting ? 'planApplyShoot' : 'planApply');
  el.planApply.disabled = el.agent?.dataset.state === 'offline';
}

/**
 * Форма подключения.
 *
 * Пароль в форму не подставляется никогда: сервер его не отдаёт, а пустое поле означает
 * «оставить прежний». Иначе правка адреса вслепую сбрасывала бы сохранённые данные, а сам
 * пароль оседал бы в истории браузера и на скриншотах.
 */
/**
 * Панель окружения: возможности со статусом, недостающие — с кнопкой установки.
 *
 * Кнопка кладёт агенту событие install с одним идентификатором. Что за ним стоит —
 * решает реестр внутри Takt (studio/install.mjs); прислать агенту произвольную команду
 * через эту панель нельзя по построению.
 */
async function openEnv() {
  const dlg = document.querySelector('.env');
  const list = dlg.querySelector('.env-list');
  const plat = dlg.querySelector('.env-platform');
  dlg.showModal();
  list.textContent = '…';

  const d = await fetch('/api/doctor').then((r) => r.json()).catch(() => null);
  if (!d) { list.textContent = window.taktText?.('envFailed') ?? ''; return; }

  plat.textContent = `${d.platform.os}/${d.platform.arch}`
    + (d.platform.apple ? ' · Apple Silicon' : d.platform.nvidia ? ' · NVIDIA' : '')
    + ` · ${d.home.dir}`;

  list.innerHTML = '';
  for (const c of d.capabilities) {
    const row = document.createElement('div');
    row.className = 'env-row';
    row.dataset.state = c.ready ? 'ok' : c.optional ? 'off' : 'missing';
    const кнопка = !c.ready && c.fix?.startsWith('takt install ')
      ? `<button type="button" class="primary env-install"
                 data-capability="${c.fix.replace('takt install ', '')}"></button>` : '';
    row.innerHTML = `<span class="env-dot" aria-hidden="true"></span>
      <span class="env-name"></span><span class="env-note"></span>${кнопка}`;
    row.querySelector('.env-name').textContent = c.name;
    row.querySelector('.env-note').textContent = c.ready
      ? (c.note || '') : (c.size ? c.size : (c.note || ''));
    const btn = row.querySelector('.env-install');
    if (btn) {
      btn.textContent = window.taktText?.('envInstall') ?? '';
      btn.addEventListener('click', async () => {
        btn.disabled = true;
        await post('/api/event', { type: 'install', capability: btn.dataset.capability });
        // Панель не изображает прогресс, которого не знает: установка идёт у агента, её
        // статус виден в шапке. Здесь — только что задача поставлена.
        btn.textContent = window.taktText?.('envQueued') ?? '';
      });
    }
    list.append(row);
  }
}

async function openConnect() {
  const cfg = await fetch('/api/connection').then((r) => r.json()).catch(() => null);
  if (!cfg) return;

  el.connectUrl.value = cfg.stend || '';
  el.connectUser.value = cfg.user || '';
  el.connectPassword.value = '';
  // Подсказку «пароль уже сохранён» ставим ключом, а не текстом: тогда она переведётся
  // вместе со всем остальным, в том числе если язык переключат при открытой форме.
  if (cfg.hasPassword) el.connectPassword.dataset.iPh = 'connectPasswordPh';
  else { delete el.connectPassword.dataset.iPh; el.connectPassword.placeholder = ''; }
  window.taktApply?.();

  el.connectTargets.innerHTML = '';
  for (const t of cfg.targets || []) {
    const o = document.createElement('option');
    o.value = t.url;
    o.label = t.name;
    el.connectTargets.append(o);
  }
  el.connect.showModal();
}

/** Список проектов в шапке: переключение меняет корень всего состояния. */
function renderProjects(current, projects = []) {
  if (!el.projectSelect) return;
  el.projectSelect.innerHTML = '';
  for (const p of projects) {
    const o = document.createElement('option');
    o.value = p.id;
    o.textContent = p.title;
    o.selected = p.id === current;
    el.projectSelect.append(o);
  }
}

function renderNotes(notes) {
  notesData = notes || [];
  renderTracks();
  if (!el.notes) return;
  el.notes.innerHTML = '';
  const kinds = { diagram: 'kindDiagram', edit: 'kindEdit', voice: 'kindVoice' };
  for (const n of notes) {
    const art = document.createElement('article');
    art.className = 'note';
    art.dataset.id = n.id;
    if (n.status === 'applied') art.dataset.status = 'applied';
    art.innerHTML = `<div class="note-head">
        <button class="time-chip" type="button">${mmss(n.t)}</button>
        <span class="note-kind"></span>
      </div><p class="note-body"></p>`;
    tr(art.querySelector('.note-kind'),
       n.status === 'applied' ? 'kindApplied' : (kinds[n.kind] || 'kindEdit'));
    art.querySelector('.note-body').textContent = n.text;
    art.querySelector('.time-chip').addEventListener('click', () => seek(n.t));
    el.notes.append(art);
  }
  if (el.notesCount) el.notesCount.textContent = String(notes.length);
  renderPlan();
}

/** Подсветить шаг сценария: клик по схеме должен показать, где она играет. */
function litStep(n) {
  const row = el.steps?.querySelector(`.step-row[data-n="${n}"]`);
  if (!row) return;
  row.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  row.classList.add('lit');
  setTimeout(() => row.classList.remove('lit'), 1400);
}

/** То же для замечания: метка на дорожке и карточка справа — одно и то же. */
function litNote(id) {
  const card = el.notes?.querySelector(`.note[data-id="${id}"]`);
  if (!card) return;
  card.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  card.classList.add('lit');
  setTimeout(() => card.classList.remove('lit'), 1400);
}

/**
 * Перетаскивание метки по времени.
 *
 * Метки правок, схем и реплик — это НАМЕРЕНИЯ: где показать схему, к какому моменту
 * относится замечание, когда вступает реплика. Их человек двигает. Дорожка шагов
 * сюда не подключена намеренно: шаги — факт состоявшейся съёмки, и таскать их
 * значило бы предлагать управление, которого нет.
 *
 * Позиция считается от дорожки, а не от экрана: дорожка и есть шкала времени.
 * Пока тащим, метка едет за курсором, но данные не трогаются — запись один раз,
 * на отпускании, иначе сервер получал бы десятки записей на одно движение.
 */
function dragMark(node, { onDrop }) {
  node.style.cursor = 'grab';
  node.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    e.stopPropagation();
    const lane = node.parentElement;
    const rect = lane.getBoundingClientRect();
    const startX = e.clientX;
    let moved = false;
    let t = null;

    node.setPointerCapture(e.pointerId);
    node.style.cursor = 'grabbing';
    node.classList.add('dragging');

    const move = (ev) => {
      if (!moved && Math.abs(ev.clientX - startX) < 3) return;   // клик, а не перенос
      moved = true;
      const x = Math.max(0, Math.min(rect.width, ev.clientX - rect.left));
      t = (x / rect.width) * DURATION;
      node.style.left = `${(t / DURATION) * 100}%`;
      syncCursor(t);
    };

    const up = () => {
      node.removeEventListener('pointermove', move);
      node.removeEventListener('pointerup', up);
      node.style.cursor = 'grab';
      node.classList.remove('dragging');
      if (moved && t !== null) onDrop(Math.round(t * 10) / 10);
    };

    node.addEventListener('pointermove', move);
    node.addEventListener('pointerup', up);
  });
}

function seek(t) {
  syncCursor(t);
  if (video && Number.isFinite(video.duration)) video.currentTime = cursor;
}

async function post(route, payload) {
  const r = await fetch(`${route}?token=${token}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return r.json();
}

function connect() {
  stream = new EventSource(`/api/stream?token=${token}`);
  stream.onmessage = (m) => {
    const msg = JSON.parse(m.data);
    if (msg.type === 'status') { setAgent(msg.status, msg.agent); renderInFlight(msg.inFlight); }
    if (msg.type === 'stend') setStend(msg.stend);
    if (msg.type === 'project') renderProjects(msg.current, msg.projects);
    if (msg.type === 'storyboard') { renderBoard(msg.storyboard); reloadCompose(); }
    if (msg.type === 'movie') renderMovie(msg.movie);
    if (msg.type === 'voices') voicePanel?.render(msg.voices);
    if (msg.type === 'narration') { narrationData = msg.narration; narrationPanel?.render(msg.narration); renderTracks(); }
    if (msg.type === 'notes') renderNotes(msg.notes);
    if (msg.type === 'frame' && el.frame) {
      let img = el.frame.querySelector('img');
      if (!img) { img = document.createElement('img'); el.frame.append(img); }
      img.src = msg.frame;
      // Признак «идёт съёмка» ставит только состояние шагов: последний кадр приходит и
      // при открытии страницы, и рамка иначе горит на давно законченном прогоне.
    }
  };
  // Обрыв SSE означает, что связи нет прямо сейчас: показываем это немедленно,
  // а не оставляем висеть последнее известное состояние.
  stream.onerror = () => {
    setAgent(null, false);
    stream.close();
    setTimeout(connect, 3000);
  };
}

let voicePanel = null;
let narrationPanel = null;

async function boot() {
  const hello = await fetch('/api/hello').then((r) => r.json());
  token = hello.token;
  voicePanel = setupVoice({ post, getToken: () => token });
  voicePanel.render(hello.voices || []);
  narrationPanel = setupNarration({ post });
  narrationData = hello.narration;
  narrationPanel.render(hello.narration);
  setAgent(hello.status, hello.agent);
  renderInFlight(hello.inFlight);
  setStend(hello.stend);
  renderProjects(hello.project, hello.projects);
  setupDragAndDrop(el.steps);
  setupCompose();
  renderBoard(hello.storyboard);
  renderMovie(hello.movie);
  renderNotes(hello.notes || []);
  seek(cursor);
  connect();

  el.send?.addEventListener('click', async (e) => {
    e.preventDefault();
    const text = el.composer.value.trim();
    if (!text) return;
    await post('/api/event', { type: 'note', t: cursor, text, kind: 'edit' });
    el.composer.value = '';
  });

  // Постановка задачи — событие агенту, а не локальное действие: сценарий собирает он,
  // разведав реальный интерфейс стенда.
  el.taskSend?.addEventListener('click', async () => {
    const text = el.taskInput.value.trim();
    if (!text) return;
    el.taskSend.disabled = true;
    await post('/api/event', { type: 'task', text });
  });

  // Замечание про весь сценарий, а не про строку: «сократи вступление», «добавь шаг
  // про очередь». Это требует знания стенда, поэтому уходит агенту целиком.
  const sendScenarioNote = async () => {
    const text = el.scenarioNote.value.trim();
    if (!text) return;
    el.scenarioNote.value = '';
    await post('/api/event', { type: 'scenario_note', text });
  };
  el.scenarioNoteSend?.addEventListener('click', sendScenarioNote);
  el.scenarioNote?.addEventListener('keydown', (e) => {
    // Enter переносит строку, отправка — по Ctrl/Cmd+Enter: замечание бывает длинным.
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); sendScenarioNote(); }
  });

  el.shoot?.addEventListener('click', async () => {
    await pushBoard({ status: 'ready' });
    await post('/api/event', { type: 'shoot' });
  });

  // Монтаж и хайлайты — работа агента: считается минуты, поэтому кнопка ставит задачу
  // в очередь и сразу гаснет, а не изображает прогресс, которого страница не знает.
  el.cut?.addEventListener('click', () => post('/api/event', { type: 'cut' }));
  el.short?.addEventListener('click', () => post('/api/event', { type: 'short' }));

  el.stend?.addEventListener('click', openConnect);
  document.querySelector('.env-open')?.addEventListener('click', openEnv);
  document.querySelector('.env-close')?.addEventListener('click',
    () => document.querySelector('.env').close());
  el.connectCancel?.addEventListener('click', () => el.connect.close());
  el.connectSave?.addEventListener('click', async () => {
    const url = el.connectUrl.value.trim();
    if (!url) return;
    el.connectSave.disabled = true;
    await post('/api/connection', {
      stend: url,
      user: el.connectUser.value.trim(),
      password: el.connectPassword.value,   // пусто — сервер оставит прежний
      check: true,
    });
    el.connectPassword.value = '';
    el.connectSave.disabled = false;
    el.connect.close();
  });

  el.projectSelect?.addEventListener('change', async () => {
    await post('/api/projects', { open: el.projectSelect.value });
    // Перезагружаем страницу: смена проекта меняет всё состояние разом, и половина
    // старого рядом с половиной нового хуже короткой паузы.
    location.reload();
  });

  el.projectNew?.addEventListener('click', async () => {
    const title = prompt(window.taktText('projectPrompt'));
    if (!title) return;
    await post('/api/projects', { title });
    location.reload();
  });

  el.planApply?.addEventListener('click', async () => {
    el.planApply.disabled = true;
    await post('/api/event', { type: 'apply' });
  });

  el.play?.addEventListener('click', togglePlay);
  el.inspector?.addEventListener('change', (e) => {
    if (e.target.classList.contains('fx-move')) syncInspectorFields();
    saveInspector();
  });
  el.inspector?.querySelector('.inspector-close')
    ?.addEventListener('click', closeInspector);
  el.inspector?.querySelector('.inspector-auto')
    ?.addEventListener('click', dropManualEffect);
  el.sources?.addEventListener('click', (e) => {
    const b = e.target.closest('.source-btn');
    if (b && !b.disabled) setSource(b.dataset.source);
  });

  el.stop?.addEventListener('click', () => post('/api/event', { type: 'stop' }));
  el.retake?.addEventListener('click', () => post('/api/event', { type: 'retake', t: cursor }));

  // Клик по дорожке переносит позицию — с неё же встанет следующая метка.
  document.querySelectorAll('.track').forEach((track) => {
    track.addEventListener('click', (e) => {
      const r = track.getBoundingClientRect();
      seek(((e.clientX - r.left) / r.width) * DURATION);
    });
  });
}

boot();
