import { setupVoice } from './voice.js';
import { setupNarration } from './narration.js';
import { SLATE, END } from './compose/duration.mjs';

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
  version: document.querySelector('.version'),
  link: document.querySelector('.link'),
  now: document.querySelector('.now'),
  composeFrame: document.querySelector('.compose-frame'),
  short: document.querySelector('.short-run'),
  play: document.querySelector('.play'),
  caption: document.querySelector('.caption'),
  plan: document.querySelector('.plan'),
  planList: document.querySelector('.plan-list'),
  planCost: document.querySelector('.plan-cost'),
  planApply: document.querySelector('.plan-apply'),
  planRegen: document.querySelector('.plan-regen'),
  stages: document.querySelector('.stages'),
  stagesNow: document.querySelector('.stages-now'),
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
  /* Кнопку больше не блокируем. Событие не пропадает: студия кладёт его в очередь
     и отдаёт агенту, как только тот подключится, — а блокировка выглядела как
     «замечание не отправляется», хотя очередь работала. Подпись говорит правду:
     уйдёт сейчас или подождёт. */
  if (el.send) {
    el.send.disabled = false;
    trTitle(el.send, alive ? 'sendNow' : 'sendQueued');
  }
}

/**
 * Связь страницы со студией.
 *
 * Отдельно от агента намеренно: это разные вещи, и смешивать их — врать дважды.
 * Оборвался поток — агент от этого никуда не делся, он снимает или ждёт; просто
 * мы об этом временно не слышим. Поэтому метка говорит про связь, а состояние
 * агента остаётся последним известным, пока не придёт новое.
 */
function setLink(state) {
  if (!el.link) return;
  el.link.hidden = state === 'ok';
  el.link.dataset.state = state;
  tr(el.link.querySelector('.link-text'), state === 'lost' ? 'linkLost' : 'linkBack');
}

/**
 * Ход работы: чей сейчас ход и что делать.
 *
 * Считает сервер — одно место на студию и на ответ `takt`. Здесь только показ:
 * метка «ваш ход» или «агент», и следующий шаг словами.
 */
function renderNow(next) {
  if (!el.now) return;
  if (!next?.key) { el.now.hidden = true; return; }
  el.now.hidden = false;
  el.now.dataset.who = next.who;
  tr(el.now.querySelector('.now-who'), next.who === 'agent' ? 'nowAgent' : 'nowYou');
  tr(el.now.querySelector('.now-what'), next.key, { count: next.count ?? 0 });
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

/**
 * Карточка в той форме, в какой её ждёт студия.
 *
 * Сервер держит модули в памяти, поэтому после обновления кода он какое-то время
 * отдаёт старую форму — булево вместо записи. Читая его буквально, студия говорила
 * «выключена» про включённую заставку и не рисовала её нигде: ни в списке, ни на
 * дорожке. Разбираться в этом человеку незачем.
 */
const карточкаИз = (v, seconds) => (v && typeof v === 'object'
  ? v
  : { on: v !== false, text: null, subtitle: null, seconds });

function renderBoard(next) {
  storyboard = next
    ? { ...next, slate: карточкаИз(next.slate, SLATE), end: карточкаИз(next.end, END) }
    : next;
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

  /* Заставка и финал стоят в списке всегда, даже выключенные.
     Иначе выключить их можно было бы, а включить обратно — уже нет: клип с дорожки
     исчезает вместе с временем, которое он занимал. */
  const строкаКарточки = (which) => {
    const c = storyboard[which] || {};
    const li = document.createElement('li');
    li.className = 'step-row card-row';
    if (!c.on) li.dataset.off = 'true';
    const b = document.createElement('button');
    b.className = 'step';
    b.type = 'button';
    b.dataset.t = String(which === 'slate' ? 0 : Math.max(0, DURATION - (c.seconds || 0)));
    b.innerHTML = `<span class="step-time"></span>
      <span class="step-dur"></span>
      <span class="step-label"></span>`;
    tr(b.querySelector('.step-label'), which === 'slate' ? 'cardTitleSlate' : 'cardTitleEnd');
    b.querySelector('.step-time').textContent = c.on ? mmss(Number(b.dataset.t)) : '—';
    const dur = b.querySelector('.step-dur');
    if (c.on) dur.textContent = `${c.seconds} с`;
    else tr(dur, 'cardOff');
    b.addEventListener('click', () => {
      if (c.on) seek(Number(b.dataset.t));
      openCardInspector(which);
    });
    li.append(b);
    return li;
  };
  el.steps.append(строкаКарточки('slate'));

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
      <span class="step-label"></span>${s.intent ? '<span class="step-note"></span>' : ''}`;
    b.querySelector('.step-label').textContent = s.title.text;
    if (s.mode === 'insert') {
      li.dataset.insert = 'true';
      // Без титра строка была бы пустой: называем её видом, а не выдуманным именем.
      if (!s.title.text) tr(b.querySelector('.step-label'), 'planInsert');
    }
    // Длительность видна всегда и всегда говорит, откуда взялась: «выведена» и
    // «назначена человеком» — разные вещи, и пересчёт трогает только первую.
    const dur = b.querySelector('.step-dur');
    dur.textContent = `${s.duration.seconds} с`;
    dur.dataset.source = s.duration.source;
    trTitle(dur, s.duration.source === 'manual' ? 'durManual'
      : s.duration.source === 'shot' ? 'durShot' : 'durDerived');
    // Намерение плана пишет агент, поэтому оно не переводится.
    const note = b.querySelector('.step-note');
    if (note) note.textContent = s.intent;
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
      // У вставки нет ни экрана, ни действия: единственное, что в ней можно
      // смотреть, — она сама. Поэтому щелчок сразу открывает её правку.
      if (s.mode === 'insert') openWedgeInspector(s.id);
    });
    li.append(b);

    if (!editable) {
      const retake = document.createElement('div');
      retake.className = 'step-tools';
      retake.innerHTML = '<div class="step-tools-row">'
        + '<button type="button" class="step-tool" data-act="from"></button></div>';
      // Ищем саму кнопку, а не первого потомка: между ними теперь стоит обёртка,
      // и подпись, поставленная ей, затирала кнопку целиком.
      tr(retake.querySelector('[data-act="from"]'), 'toolFrom');
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
        <div class="step-tools-row">
        <span class="step-tool" data-act="drag"></span>
        <button type="button" class="step-tool" data-act="edit"></button>
        <button type="button" class="step-tool" data-act="time"></button>
        <button type="button" class="step-tool" data-act="mark"></button>
        <button type="button" class="step-tool" data-act="insert"></button>
        <button type="button" class="step-tool" data-act="tempo"></button>
        <button type="button" class="step-tool" data-act="wedge"></button>
        <button type="button" class="step-tool" data-act="del"></button></div>`;
      const drag = tools.querySelector('[data-act="drag"]');
      tr(drag, 'toolDrag');
      trTitle(drag, 'toolDragTitle');
      tr(tools.querySelector('[data-act="edit"]'), 'toolEdit');
      const timeTool = tools.querySelector('[data-act="time"]');
      tr(timeTool, 'toolTime');
      trTitle(timeTool, 'toolTimeTitle');
      const markTool = tools.querySelector('[data-act="mark"]');
      tr(markTool, 'toolMark');
      trTitle(markTool, 'toolMarkTitle');
      // Подсветить можно только то, во что план целится: наложение живёт на якоре,
      // а якорь берётся из действия. У вставки действия нет вовсе.
      markTool.disabled = !s.action?.selector;
      const insertTool = tools.querySelector('[data-act="insert"]');
      tr(insertTool, 'toolInsert');
      trTitle(insertTool, 'toolInsertTitle');
      // Вставлять нечего, пока в проекте нет ни одной врезки: их рисует агент.
      insertTool.disabled = !insertsList.length;
      const wedgeTool = tools.querySelector('[data-act="wedge"]');
      tr(wedgeTool, 'toolWedge');
      trTitle(wedgeTool, 'toolWedgeTitle');
      // Как и наложению, вставке нужен файл: пока их нет, обещать нечего.
      wedgeTool.disabled = !insertsList.length;
      const tempoTool = tools.querySelector('[data-act="tempo"]');
      tr(tempoTool, 'toolTempo');
      trTitle(tempoTool, 'toolTempoTitle');
      // Второй темп на одном плане означал бы две правды о ходе времени внутри него.
      tempoTool.disabled = (storyboard.effects || [])
        .some((e) => e.plan === s.id && e.kind === 'tempo');
      tools.addEventListener('click', async (e) => {
        const act = e.target.dataset?.act;
        if (!act || act === 'drag') return;
        const plans = [...storyboard.plans];
        if (act === 'mark') {
          // Наложение всегда ручное: режиссёр не знает, что человек хочет выделить.
          const effects = [...(storyboard.effects || []), {
            id: `${s.id}-mark${(storyboard.effects || [])
              .filter((e) => e.plan === s.id && e.kind === 'overlay').length + 1}`,
            plan: s.id, kind: 'overlay',
            at: { from: 0.6, to: Math.max(1.2, s.duration.seconds - 0.4) },
            anchor: s.action.selector,
            params: { what: 'spotlight', text: '' },
            source: 'manual',
          }];
          await pushBoard({ effects });
          return;
        }
        if (act === 'insert') {
          const effects = [...(storyboard.effects || []), {
            id: `${s.id}-ins${(storyboard.effects || [])
              .filter((e) => e.plan === s.id && e.params?.what === 'insert').length + 1}`,
            plan: s.id, kind: 'overlay',
            at: { from: 0.3, to: Math.max(1, s.duration.seconds - 0.3) },
            anchor: null,
            params: { what: 'insert', src: insertsList[0].file, place: 'cover' },
            source: 'manual',
          }];
          await pushBoard({ effects });
          return;
        }
        if (act === 'tempo') {
          const effects = [...(storyboard.effects || []), {
            id: `${s.id}-tempo`, plan: s.id, kind: 'tempo',
            at: { from: 0, to: s.duration.seconds },
            anchor: null, params: { rate: 0.5 }, source: 'manual',
          }];
          await pushBoard({ effects });
          return;
        }
        /* Вставка встаёт СЛЕДОМ за планом, а не вместо него: она объясняет то, что
           человек только что увидел на экране. Класть её перед планом значило бы
           рассказывать про экран, которого зритель ещё не видел. */
        if (act === 'wedge') {
          /* Титр пустой намеренно: графика объясняет себя сама, а служебное имя,
             выжженное в кадр, — мусор поверх схемы. Захочет подписать — впишет. */
          plans.splice(i + 1, 0, {
            mode: 'insert',
            insert: { src: insertsList[0]?.file || null },
            title: { text: '', style: 'lower' },
          });
          await pushBoard({ plans });
          return;
        }
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
  el.steps.append(строкаКарточки('end'));

  renderScriptCount();
  renderScreenSize();
  renderRuler();
  renderTracks();
  // Открытый инспектор перечитывается: сервер нормализовал правку, и показывать
  // человеку его же ввод вместо принятого значения — самый тихий способ соврать.
  if (openWedge) {
    if ((storyboard.plans || []).some((p) => p.id === openWedge)) openWedgeInspector(openWedge);
    else closeInspector();
  } else if (openCard) openCardInspector(openCard);
  else if (openEffect) {
    if (effectById(openEffect)) openInspector(openEffect);
    else closeInspector();
  }
  // Панель дикторского текста живёт планами: пока их не было, ей нечего было
  // предложить, и кнопка пряталась даже там, где реплики уже можно писать.
  narrationPanel?.render(narrationData);

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
 * Ступени конвейера.
 *
 * Показывают весь путь разом: где мы сейчас и что ниже устарело после правки. Состояние
 * приходит с сервера, где выводится из файлов проекта, — здесь только рисунок и клик.
 * Клик утверждает ступень или снимает утверждение: это единственное решение, которое
 * из файлов не выводится.
 */
const STAGE_KEYS = {
  prompt: 'stagePrompt', recon: 'stageRecon', story: 'stageStory',
  storyboard: 'stageStoryboard', states: 'stageStates', movie: 'stageMovie',
};

async function renderStages() {
  if (!el.stages) return;
  const данные = await fetch('/api/pipeline').then((r) => r.json()).catch(() => null);
  if (!данные?.stages) { el.stages.hidden = true; return; }
  el.stages.hidden = false;
  el.stages.innerHTML = '';

  for (const s of данные.stages) {
    const li = document.createElement('li');
    li.className = 'stage-step';
    li.dataset.state = s.state;
    if (s.stale) li.dataset.stale = 'true';

    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'stage-btn';
    const имя = window.taktText(STAGE_KEYS[s.id]) || s.id;
    b.setAttribute('aria-label', имя);
    // Ступень называет себя: пока имя жило только в подсказке, полоса читалась как
    // ряд разноцветных чёрточек, и понять, какая из них съёмка, можно было лишь
    // наведя мышь на каждую.
    const подпись = document.createElement('span');
    подпись.className = 'stage-name';
    подпись.textContent = имя;
    b.append(подпись);
    // Цвет несёт смысл, поэтому дублируется словами: без подсказки «жёлтая полоска»
    // не читается никак.
    trTitle(b, s.stale ? 'stageStale'
      : s.state === 'ready' ? 'stageReady'
      : s.state === 'draft' ? 'stageDraft' : 'stageMissing', { stage: имя });
    b.disabled = s.state === 'missing';
    b.addEventListener('click', async () => {
      await post('/api/approve', { stage: s.id, approved: s.state !== 'ready' });
      renderStages();
    });

    li.append(b);
    el.stages.append(li);
  }

  /**
   * Где человек сейчас — последняя ступень, которая уже существует.
   *
   * Полоса из шести рисок показывает путь, но сама по себе не отвечает на главный
   * вопрос «что происходит»; ответ и есть эта строка.
   */
  const пройденные = данные.stages.filter((s) => s.state !== 'missing');
  const текущая = пройденные[пройденные.length - 1] || данные.stages[0];
  if (el.stagesNow) {
    el.stagesNow.hidden = false;
    el.stagesNow.dataset.state = текущая.stale ? 'stale' : текущая.state;
    const имя = window.taktText(STAGE_KEYS[текущая.id]) || текущая.id;
    el.stagesNow.innerHTML = '<b></b><span></span>';
    el.stagesNow.firstElementChild.textContent = имя;
    tr(el.stagesNow.lastElementChild,
       текущая.stale ? 'stageNowStale'
       : текущая.state === 'ready' ? 'stageNowReady'
       : текущая.state === 'draft' ? 'stageNowDraft' : 'stageNowMissing');
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
let openCard = null;                  // 'slate' | 'end', когда правится карточка
let openWedge = null;                 // идентификатор плана-вставки, когда правится он
let zoom = 1;                         // во сколько раз шкала шире своей колонки

/**
 * Масштаб шкалы.
 *
 * Клип длиной в полсекунды на сорокасекундном ролике — это два пикселя: попасть
 * в него мышью нельзя, а именно в такие клипы и целятся, когда правят склейку.
 * Приближение растягивает дорожки внутри их колонки и включает прокрутку.
 *
 * Точка, вокруг которой всё растёт, — курсор: человек ставит плейхед туда, куда
 * смотрит, и ждёт, что оно останется на месте.
 */
const ZOOM_MIN = 1;
const ZOOM_MAX = 16;

function setZoom(next) {
  const было = zoom;
  zoom = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, next));
  const tl = document.querySelector('.timeline');
  if (tl) tl.style.setProperty('--zoom', String(zoom));
  for (const b of document.querySelectorAll('.zoom-btn')) {
    b.disabled = b.dataset.zoom === 'in' ? zoom >= ZOOM_MAX : zoom <= ZOOM_MIN;
  }
  if (было !== zoom) { renderRuler(); scrollToCursor(); }
}

/** Держим плейхед в поле зрения: приближение без этого уводит картинку в никуда. */
function scrollToCursor() {
  const scroll = document.querySelector('.lanes-scroll');
  const lanes = document.querySelector('.lanes');
  if (!scroll || !lanes || !DURATION) return;
  const x = (cursor / DURATION) * lanes.clientWidth;
  const поле = scroll.clientWidth / 2;
  scroll.scrollLeft = Math.max(0, x - поле);
}
/** Врезки проекта: их рисует агент, студия только предлагает выбрать. */
let insertsList = [];

async function loadInserts() {
  insertsList = await fetch('/api/inserts').then((r) => r.json())
    .then((d) => d.inserts || []).catch(() => []);
}

const MOVE_FIELDS = { push: ['depth'], pan: ['speed'], drift: [] };
/** Что показывает наложение. Текст нужен только выноске — остальным его негде писать. */
const OVERLAY_FIELDS = { spotlight: [], arrow: [], blur: [], callout: ['text'],
                         insert: ['src', 'place'] };
/** Темп задаётся одним числом: во сколько раз время внутри плана идёт быстрее. */
const TEMPO_RATES = ['0', '0.5', '1', '2', '4'];

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

  const наложение = e.kind === 'overlay';
  const темп = e.kind === 'tempo';
  el.inspector.dataset.kind = e.kind;
  const move = наложение ? (e.params?.what || 'spotlight')
    : темп ? String(e.params?.rate ?? 1)
    : e.kind === 'transition' ? 'drift' : (e.params?.move || 'drift');
  // Один выпадающий список на оба вида: у камеры это движение, у наложения — что
  // именно оно показывает. Два списка рядом означали бы, что один всегда пустой.
  // Подпись поля зависит от вида эффекта: у камеры это движение, у наложения — что
  // именно оно показывает. Одна подпись на оба означала бы, что одна из них врёт.
  tr(el.inspector.querySelector('.fx-move-label'),
     наложение ? 'fxWhat' : темп ? 'fxRate' : 'fxMove');
  const sel = el.inspector.querySelector('.fx-move');
  sel.innerHTML = (наложение
    ? ['spotlight', 'arrow', 'callout', 'blur', 'insert']
    : темп ? TEMPO_RATES
    : ['push', 'pan', 'drift']).map((v) => `<option value="${v}" data-i="fx_${v}"></option>`).join('');
  window.taktApply?.();
  sel.value = move;
  el.inspector.querySelector('.fx-depth').value = e.params?.depth ?? 1.26;
  el.inspector.querySelector('.fx-speed').value = e.params?.speed ?? 600;
  el.inspector.querySelector('.fx-text').value = e.params?.text ?? '';
  // Файл врезки выбирается из того, что лежит в проекте: печатать путь руками —
  // верный способ опечататься и увидеть пустой кадр.
  const src = el.inspector.querySelector('.fx-src');
  src.innerHTML = insertsList.length
    ? insertsList.map((i) => `<option value="${i.file}">${i.name}</option>`).join('')
    : '<option value="">—</option>';
  src.value = e.params?.src || insertsList[0]?.file || '';
  el.inspector.querySelector('.fx-place').value = e.params?.place || 'cover';
  el.inspector.querySelector('.fx-from').value = e.at?.from ?? 0;
  el.inspector.querySelector('.fx-to').value = e.at?.to ?? 0;
  // Склейка своего движения не имеет: показывать ей поля камеры значит обещать
  // правку, которой не будет.
  el.inspector.querySelector('.fx-move').disabled = e.kind === 'transition';
  el.inspector.querySelector('.inspector-auto').hidden = e.source !== 'manual';
  syncInspectorFields();
  renderTracks();
}

/**
 * Инспектор карточки — тот же, что у эффекта.
 *
 * Разные записи внутри, но человеку это знать незачем: он щёлкает по клипу на
 * шкале и правит то, что видит в кадре. Ради этого поля инспектора и переключаются
 * по виду, а не разводятся по разным панелям.
 */
function openCardInspector(which) {
  if (!el.inspector) return;
  const c = storyboard?.[which] || {};
  openCard = which;
  openEffect = null;
  el.inspector.hidden = false;
  el.inspector.dataset.kind = 'card';
  tr(el.inspector.querySelector('.inspector-title'),
     which === 'slate' ? 'cardTitleSlate' : 'cardTitleEnd');
  el.inspector.querySelector('.card-on').checked = c.on !== false;
  // Пустое поле показывает название ролика подсказкой: видно, что подставится,
  // и видно, что своего текста пока нет.
  const текст = el.inspector.querySelector('.fx-text');
  текст.value = c.text || '';
  текст.placeholder = storyboard?.title || '';
  el.inspector.querySelector('.card-sub').value = c.subtitle || '';
  el.inspector.querySelector('.card-url').value = c.url || '';
  el.inspector.querySelector('.card-seconds').value = c.seconds ?? '';
  el.inspector.querySelector('.inspector-auto').hidden = true;
  syncInspectorFields();
  renderTracks();
}

/**
 * Инспектор вставки: файл врезки и сколько она держится.
 *
 * Отдельного окна ей не нужно — это тот же инспектор, что у эффектов и карточек.
 * Человек правит то, что видит в кадре, и видит результат там же.
 */
function openWedgeInspector(id) {
  const plan = (storyboard?.plans || []).find((p) => p.id === id);
  if (!plan || !el.inspector) return;
  openWedge = id;
  openCard = null;
  openEffect = null;
  el.inspector.hidden = false;
  el.inspector.dataset.kind = 'wedge';
  el.inspector.querySelector('.inspector-title').textContent = plan.title.text
    || window.taktText?.('wedgeTitle') || 'Вставка';
  const src = el.inspector.querySelector('.fx-src');
  src.innerHTML = insertsList.length
    ? insertsList.map((i) => `<option value="${i.file}">${i.name}</option>`).join('')
    : '<option value="">—</option>';
  src.value = plan.insert?.src || insertsList[0]?.file || '';
  el.inspector.querySelector('.card-seconds').value = plan.duration.seconds;
  el.inspector.querySelector('.fx-text').value = plan.title.text || '';
  el.inspector.querySelector('.inspector-auto').hidden = true;
  syncInspectorFields();
  renderTracks();
}

function closeInspector() {
  openWedge = null;
  openCard = null;
  openEffect = null;
  if (el.inspector) el.inspector.hidden = true;
  renderTracks();
}

/** Поля показываются по виду движения: у панорамы нет глубины, у наезда — скорости. */
function syncInspectorFields() {
  if (!el.inspector) return;
  const вид = el.inspector.dataset.kind;
  const карточка = вид === 'card';
  // Карточка и эффект делят одну панель, поэтому чужие поля не прячутся сами:
  // оставь их — и у заставки появится «глубина наезда».
  for (const кл of ['fx-move-row', 'fx-from-row', 'fx-to-row']) {
    el.inspector.querySelector(`.${кл}`).hidden = карточка;
  }
  for (const кл of ['card-on-row', 'card-sub-row', 'card-url-row', 'card-seconds-row']) {
    el.inspector.querySelector(`.${кл}`).hidden = !карточка;
  }
  if (вид === 'wedge') {
    for (const кл of ['fx-move-row', 'fx-from-row', 'fx-to-row', 'fx-depth-row',
                      'fx-speed-row', 'fx-place-row', 'card-on-row', 'card-sub-row',
                      'card-url-row']) {
      el.inspector.querySelector(`.${кл}`).hidden = true;
    }
    el.inspector.querySelector('.fx-src-row').hidden = false;
    el.inspector.querySelector('.fx-text-row').hidden = false;
    el.inspector.querySelector('.card-seconds-row').hidden = false;
    return;
  }
  if (карточка) {
    // Подзаголовок бывает только у обложки, ссылка — только у финала: на обложке
    // ссылку читать некогда, а под финалом нет чему быть подзаголовком.
    el.inspector.querySelector('.card-sub-row').hidden = openCard !== 'slate';
    el.inspector.querySelector('.card-url-row').hidden = openCard !== 'end';
    el.inspector.querySelector('.fx-text-row').hidden = false;
    el.inspector.querySelector('.fx-depth-row').hidden = true;
    el.inspector.querySelector('.fx-speed-row').hidden = true;
    el.inspector.querySelector('.fx-src-row').hidden = true;
    el.inspector.querySelector('.fx-place-row').hidden = true;
    return;
  }
  const наложение = вид === 'overlay';
  const move = el.inspector.querySelector('.fx-move').value;
  const нужные = (вид === 'overlay' ? OVERLAY_FIELDS[move]
    : вид === 'tempo' ? []
    : MOVE_FIELDS[move]) || [];
  el.inspector.querySelector('.fx-depth-row').hidden = !нужные.includes('depth');
  el.inspector.querySelector('.fx-speed-row').hidden = !нужные.includes('speed');
  el.inspector.querySelector('.fx-text-row').hidden = !нужные.includes('text');
  el.inspector.querySelector('.fx-src-row').hidden = !нужные.includes('src');
  el.inspector.querySelector('.fx-place-row').hidden = !нужные.includes('place');
}

async function saveInspector() {
  if (openWedge) {
    const seconds = Number(el.inspector.querySelector('.card-seconds').value);
    const текст = el.inspector.querySelector('.fx-text').value.trim();
    const plans = (storyboard.plans || []).map((p) => (p.id === openWedge
      ? { ...p,
          insert: { src: el.inspector.querySelector('.fx-src').value || null },
          title: { ...p.title, text: текст },
          // Пустое поле возвращает выведенное время — как и у обычного плана.
          duration: Number.isFinite(seconds) && seconds > 0
            ? { source: 'manual', seconds: Math.round(seconds * 10) / 10 }
            : undefined }
      : p));
    await pushBoard({ plans });
    return;
  }
  if (openCard) {
    const seconds = Number(el.inspector.querySelector('.card-seconds').value);
    const карточка = {
      on: el.inspector.querySelector('.card-on').checked,
      text: el.inspector.querySelector('.fx-text').value.trim() || null,
      seconds: Number.isFinite(seconds) && seconds > 0 ? seconds : undefined,
      ...(openCard === 'slate'
        ? { subtitle: el.inspector.querySelector('.card-sub').value.trim() || null }
        : { url: el.inspector.querySelector('.card-url').value.trim() || null }),
    };
    await pushBoard({ [openCard]: карточка });
    return;
  }
  const e = effectById(openEffect);
  if (!e) return;
  const move = el.inspector.querySelector('.fx-move').value;
  const num = (sel) => Number(el.inspector.querySelector(sel).value);
  const текст = el.inspector.querySelector('.fx-text').value;
  const params = e.kind === 'tempo'
    ? { rate: Number(move) }
    : e.kind === 'overlay'
    ? { what: move,
        ...(move === 'callout' ? { text: текст } : {}),
        ...(move === 'insert'
          ? { src: el.inspector.querySelector('.fx-src').value,
              place: el.inspector.querySelector('.fx-place').value }
          : {}) }
    : e.kind === 'transition'
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
      if (s.mode === 'insert') seg.dataset.insert = 'true';
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

    /* Заставка и финал живут на дорожке эффектов, рядом с наездами и склейками:
       для человека это такое же решение о том, как ролик выглядит, — правится там
       же и теми же движениями. Планами они не являются: снимать в них нечего. */
    const карточка = (which, at, seconds) => {
      const clip = document.createElement('button');
      clip.type = 'button';
      clip.className = 'clip';
      clip.dataset.kind = 'card';
      clip.style.left = `calc(${pct(at)} + 1px)`;
      clip.style.width = `calc(${pct(seconds)} - 2px)`;
      tr(clip, which === 'slate' ? 'cardTitleSlate' : 'cardTitleEnd');
      trTitle(clip, which === 'slate' ? 'cardTitleSlate' : 'cardTitleEnd');
      if (openCard === which) clip.setAttribute('aria-current', 'true');
      clip.addEventListener('click', () => { seek(at); openCardInspector(which); });
      fx.append(clip);
    };
    if (storyboard?.slate?.on) карточка('slate', 0, storyboard.slate.seconds || SLATE);
    const последний = (storyboard?.plans || []).at(-1);
    if (storyboard?.end?.on && последний) {
      карточка('end', последний.at + последний.duration.seconds,
               storyboard.end.seconds || END);
    }

    const byId = new Map((storyboard?.plans || []).map((x) => [x.id, x]));
    for (const e of storyboard?.effects || []) {
      const plan = byId.get(e.plan);
      if (!plan) continue;
      const from = plan.at + (e.at?.from || 0);
      const to = plan.at + (e.at?.to ?? plan.duration.seconds);
      const clip = document.createElement('span');
      clip.className = 'clip';
      clip.dataset.kind = e.kind === 'transition' ? 'cut'
        : e.kind === 'overlay' ? 'mark'
        : e.kind === 'tempo' ? 'tempo' : 'camera';
      if (e.source === 'manual') clip.dataset.source = 'manual';
      clip.style.left = `calc(${pct(from)} + 1px)`;
      // Зазор в пиксель с каждой стороны: без него соседние клипы сливаются в одну
      // полосу, и границу эффекта не видно вовсе.
      clip.style.width = `calc(${pct(Math.max(0.25, to - from))} - 2px)`;
      const move = e.kind === 'transition' ? e.params?.style
        : e.kind === 'overlay' ? e.params?.what
        : e.kind === 'tempo' ? String(e.params?.rate ?? 1) : e.params?.move;
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
      clip.style.left = `calc(${pct(l.at)} + 1px)`;
      clip.style.width = `calc(${pct(seconds)} - 2px)`;
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
  // Делений столько, сколько влезает читаемо: на приближённой шкале четыре метки
  // на весь ролик оставляли бы человека без ориентиров ровно там, где он целится.
  const делений = Math.min(24, Math.max(4, Math.round(4 * zoom)));
  const шаг = DURATION / делений;
  for (let i = 0; i <= делений; i++) {
    const span = document.createElement('span');
    const t = (DURATION * i) / делений;
    span.style.left = `${(i * 100) / делений}%`;
    // Мельче секунды минуты не нужны, а округление до них превращает соседние
    // метки в одинаковые: приблизил ради точности — и остался без неё.
    span.textContent = шаг >= 1 ? mmss(t) : `${t.toFixed(1)} с`;
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
  regen: 'evRegen',
  insert: 'evInsert',
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
 * Версии ролика: полный, с озвучкой, хайлайты.
 *
 * Переключатель показывает только собранное: обещать версию, которой нет, значит
 * отправить человека искать несуществующий файл.
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
      compose = { ...compose, ready: true, seconds: e.data.seconds || 0,
                  screenFit: e.data.screenFit || null };
      renderScreenSize();
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
  if (длина) { DURATION = длина; renderRuler(); renderTracks(); renderScriptCount(); }
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

  /* Время идёт по часам, а не по числу отрисованных кадров.
     Пока шаг прибавлялся на каждый тик, ролик шёл со скоростью, с какой врезка
     успевала рисовать: наложения и врезки-схемы тяжелее 40 мс, и просмотр полз
     вчетверо медленнее реального времени — часы стояли на 0:00, и кнопка казалась
     сломанной. Теперь позиция считается от момента старта: если кадр не успел,
     он пропускается, а ролик остаётся в своём темпе. Тик остаётся таймером, а не
     кадром отрисовки: в свёрнутой вкладке requestAnimationFrame замирает совсем,
     и вернувшийся к студии человек обнаружил бы ролик там же, где оставил. */
  const старт = performance.now();
  const начало = cursor;
  compose.playing = setInterval(() => {
    const t = начало + (performance.now() - старт) / 1000;
    if (t >= DURATION) { seek(DURATION); return stopPlaying(); }
    seek(t);
  }, 40);
}

/**
 * Счётчик в шапке раскадровки: сколько планов и сколько это по времени.
 *
 * Считается там же, где всё остальное время, и обновляется при каждой смене
 * длины. Пока он рисовался только при перечитывании раскадровки, шапка держала
 * старое число: выключенная заставка укорачивала ролик на своей длине, транспорт
 * показывал новую длину, а шапка — прежнюю, и человек видел два разных ответа
 * на один вопрос.
 */
/** Размер окна в кадре — числом рядом с кнопками: «плюс» без числа ничего не говорит. */
let version = null;

/**
 * Проверка обновлений живёт здесь, а не на сервере.
 *
 * Спрашиваем у GitHub последний коммит ветки и сравниваем с тем, что установлено.
 * Так это работает одинаково у рабочего клона и у копии, поставленной skills CLI,
 * и не заставляет сервер держать в своём цикле таймауты чужой сети.
 *
 * Раз в пятнадцать минут: студия открыта часами, а обновления выходят реже — чаще
 * значило бы дёргать чужой сервис без нужды и упереться в его ограничения.
 */
const ЧАСТОТА_ПРОВЕРКИ = 15 * 60 * 1000;

async function проверитьОбновление() {
  if (!version?.repo || !version?.sha) return null;
  const ветка = version.branch || 'main';
  const r = await fetch(`https://api.github.com/repos/${version.repo}/commits/${ветка}`,
                        { headers: { Accept: 'application/vnd.github+json' } })
    .then((x) => (x.ok ? x.json() : null)).catch(() => null);
  // Сеть промолчала — «не видно», а не «обновлений нет»: прежнее состояние остаётся.
  if (!r?.sha) return null;
  return { available: r.sha !== version.sha, sha: r.sha, subject: r.commit?.message?.split('\n')[0] || '' };
}


/**
 * Версия в шапке.
 *
 * Номер коммита — это ответ на «а что у меня работает»: тема разговора с агентом
 * может идти неделями, а код за это время уезжает. Обновление подсвечивается
 * отдельно, потому что это единственное, что человеку тут нужно сделать.
 */
async function renderVersion({ check = false, данные = null, обновление = null } = {}) {
  if (!el.version) return;
  version = данные || await fetch('/api/version').then((r) => r.json()).catch(() => null);
  if (check && version) обновление = await проверитьОбновление() || version.update;
  const узел = el.version.querySelector('.version-num');
  if (!version) { tr(узел, 'versionUnknown'); return; }
  узел.textContent = version.commit || version.version || '—';
  version.update = обновление || version.update || null;
  // Состояние кнопки — класс: это состояние представления, а не данные о версии.
  el.version.classList.toggle('has-update', Boolean(version.update?.available));
  el.version.classList.toggle('is-dirty', Boolean(version.dirty));
  // Подсказка несёт то, чего не видно в кнопке: чей это коммит и что мешает обновиться.
  el.version.title = [
    version.subject || '',
    version.update?.available ? `Есть обновление: ${version.update.subject || 'новый коммит'}` : '',
    version.update?.blocked ? 'Обновиться нельзя: в каталоге кода локальные правки' : '',
    version.dirty && !version.update?.available ? 'В каталоге кода локальные правки' : '',
  ].filter(Boolean).join(' · ');
}

/** Обновление меняет код на диске, поэтому спрашиваем прямо, а не делаем молча. */
async function offerUpdate() {
  if (version?.update?.blocked) {
    alert(window.taktText?.('versionBlocked')
      || 'В каталоге кода локальные правки — обновление их затрёт. Сначала разберитесь с ними.');
    return;
  }
  if (!confirm(window.taktText?.('versionConfirm')
      || 'Обновить Takt? Студия перезапустится.')) return;
  const r = await post('/api/update', {});
  if (r?.ok) tr(el.version.querySelector('.version-num'), 'versionUpdating');
}

function renderScreenSize() {
  const узел = document.querySelector('.screen-size-value');
  if (!узел || !storyboard) return;
  const задано = storyboard.screenSize || 0.8;
  /* Показываем то, что применилось, а не то, что записано: окно упирается в высоту
     кадра раньше, чем в единицу, и на широком интерфейсе потолок наступает около
     девяноста процентов. Рисуй мы заданное — «плюс» продолжал бы менять число,
     ничего не меняя в кадре. */
  const реально = compose.screenFit || задано;
  узел.textContent = `${Math.round(реально * 100)}%`;
  for (const b of document.querySelectorAll('[data-screen]')) {
    b.disabled = b.dataset.screen === 'in'
      ? задано >= 1 || реально < задано - 0.005
      : задано <= 0.5;
  }
}

function renderScriptCount() {
  if (!el.scriptCount || !storyboard?.plans) return;
  el.scriptCount.textContent = `${storyboard.plans.length} · ${mmss(DURATION)}`;
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
  // Не-число здесь стоит дорого: плейхед, часы и метка замечания разом показывают
  // NaN, а вернуть их обратно можно только перезагрузкой страницы.
  if (!Number.isFinite(t) || !Number.isFinite(DURATION)) return;
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
  direct: 'planDirect',
  shoot: 'planShoot',
  voice: 'planVoice',
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
  // Перегенерация предлагается только когда есть что перечитывать: замечание с
  // адресом. Без него режиссёру нечего учитывать, и кнопка обещала бы работу,
  // которая ничего не изменит.
  if (el.planRegen) {
    el.planRegen.hidden = !plan.items.some((i) => i.kind === 'direct');
    el.planRegen.disabled = el.agent?.dataset.state === 'offline';
  }
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
  const kinds = { edit: 'kindEdit', voice: 'kindVoice' };
  for (const n of notes) {
    const art = document.createElement('article');
    art.className = 'note';
    art.dataset.id = n.id;
    if (n.status === 'applied') art.dataset.status = 'applied';
    art.innerHTML = `<div class="note-head">
        <button class="time-chip" type="button">${mmss(n.t)}</button>
        <span class="note-where"></span>
        <span class="note-kind"></span>
      </div><p class="note-body"></p>`;
    // Адрес рядом с таймкодом: по нему видно, что именно переделывать, — время
    // говорит лишь, куда смотреть.
    const where = art.querySelector('.note-where');
    const наплане = (storyboard?.plans || []).find((x) => x.id === n.plan);
    if (наплане) tr(where, n.effect ? 'noteOnEffect' : 'noteOnPlan', { plan: наплане.title.text });
    else where.hidden = true;
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
    if (msg.type === 'status') {
      setAgent(msg.status, msg.agent);
      renderInFlight(msg.inFlight);
      renderNow(msg.next);
    }
    if (msg.type === 'stend') setStend(msg.stend);
    if (msg.type === 'project') renderProjects(msg.current, msg.projects);
    if (msg.type === 'version') renderVersion({ данные: msg.version });
    if (msg.type === 'storyboard') { renderBoard(msg.storyboard); reloadCompose(); }
    if (msg.type === 'pipeline') renderStages();
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
  stream.onopen = () => { задержкаСвязи = 1000; setLink('ok'); };
  /* Обрыв — про связь, а не про агента: он там же, где был. Пауза растёт от секунды
     до десяти, потому что первая попытка чаще всего успешна (перезапуск студии), а
     долгий обрыв не должен превращаться в стук в дверь каждую секунду. */
  stream.onerror = () => {
    setLink('lost');
    stream.close();
    setTimeout(connect, задержкаСвязи);
    задержкаСвязи = Math.min(задержкаСвязи * 2, 10000);
  };
}

let задержкаСвязи = 1000;

let voicePanel = null;
let narrationPanel = null;

async function boot() {
  const hello = await fetch('/api/hello').then((r) => r.json());
  token = hello.token;
  voicePanel = setupVoice({ post, getToken: () => token });
  voicePanel.render(hello.voices || []);
  narrationPanel = setupNarration({ post, getPlans: () => storyboard?.plans || [] });
  narrationData = hello.narration;
  narrationPanel.render(hello.narration);
  setAgent(hello.status, hello.agent);
  renderInFlight(hello.inFlight);
  renderNow(hello.next);
  setStend(hello.stend);
  renderProjects(hello.project, hello.projects);
  setupDragAndDrop(el.steps);
  setupCompose();
  renderStages();
  await loadInserts();
  renderBoard(hello.storyboard);
  renderMovie(hello.movie);
  renderNotes(hello.notes || []);
  seek(cursor);
  connect();

  /**
   * Адрес замечания — то, на что человек сейчас смотрит: открытый эффект или план
   * под плейхедом. Без адреса «долго висит пустой экран» уходит в «непонятно», а с
   * ним это внятная работа режиссёра над конкретным планом.
   */
  const noteAddress = () => {
    if (openEffect) {
      const e = effectById(openEffect);
      if (e) return { plan: e.plan, effect: e.id };
    }
    const plan = (storyboard?.plans || [])
      .find((x) => cursor >= x.at && cursor < x.at + x.duration.seconds);
    return plan ? { plan: plan.id, effect: null } : { plan: null, effect: null };
  };

  el.send?.addEventListener('click', async (e) => {
    e.preventDefault();
    const text = el.composer.value.trim();
    if (!text) return;
    await post('/api/event', { type: 'note', t: cursor, text, kind: 'edit', ...noteAddress() });
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

  el.planRegen?.addEventListener('click', async () => {
    el.planRegen.disabled = true;
    await post('/api/event', { type: 'regen', stage: 'storyboard' });
  });

  el.planApply?.addEventListener('click', async () => {
    el.planApply.disabled = true;
    await post('/api/event', { type: 'apply' });
  });

  /* Версия приходит потоком вместе с остальным состоянием: сервер проверяет
     обновления по кругу, и значок появляется сам. Щелчок — не «проверить», а
     «проверить прямо сейчас, не дожидаясь круга», и он же ставит обновление. */
  renderVersion({ check: true });
  setInterval(() => renderVersion({ check: true }), ЧАСТОТА_ПРОВЕРКИ);
  el.version?.addEventListener('click', async () => {
    if (version?.update?.available) return offerUpdate();
    el.version.disabled = true;
    tr(el.version.querySelector('.version-num'), 'versionChecking');
    await renderVersion({ check: true });
    el.version.disabled = false;
    if (version?.update?.available) offerUpdate();
  });

  el.play?.addEventListener('click', togglePlay);

  /* Размер окна приложения. Шаг в пять процентов: мельче человек не видит разницы
     и жмёт вслепую, крупнее — проскакивает то, что искал. */
  document.querySelector('.screen-size')?.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-screen]');
    if (!b || !storyboard?.plans) return;
    const было = storyboard.screenSize || 0.8;
    const стало = Math.min(1, Math.max(0.5,
      Math.round((было + (b.dataset.screen === 'in' ? 0.05 : -0.05)) * 100) / 100));
    if (стало === было) return;
    await pushBoard({ screenSize: стало });
    reloadCompose();
  });

  document.querySelector('.zoom')?.addEventListener('click', (e) => {
    const b = e.target.closest('.zoom-btn');
    if (!b) return;
    setZoom(b.dataset.zoom === 'in' ? zoom * 2 : zoom / 2);
  });
  // Колесо с модификатором — то, чем это делают во всех монтажках; без модификатора
  // страница должна прокручиваться, а не приближаться под рукой.
  document.querySelector('.lanes-scroll')?.addEventListener('wheel', (e) => {
    if (!e.ctrlKey && !e.metaKey) return;
    e.preventDefault();
    setZoom(zoom * (e.deltaY < 0 ? 1.25 : 0.8));
  }, { passive: false });
  setZoom(1);
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
