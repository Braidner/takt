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
  agentText: document.querySelector('.agent:not(.stend) span[data-i]'),
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

function setAgent(status, alive) {
  if (!el.agent) return;
  const state = !alive ? 'offline' : (status?.state === 'busy' ? 'busy' : 'listening');
  el.agent.dataset.state = state;
  let text = status?.text || (state === 'listening' ? 'Слушает' : 'Не подключён');
  if (state === 'busy' && status?.step && status?.of) text += ` — ${status.step} из ${status.of}`;
  if (el.agentText) el.agentText.textContent = text;
  // Отправлять некуда, пока никто не слушает: кнопка блокируется, а не молча глотает клик.
  if (el.send) el.send.disabled = !alive;
}

/** Адрес показываем без схемы и хвоста: в шапке ценно место, а узнаётся стенд по имени. */
function setStend(stend) {
  if (!el.stend || !stend) return;
  el.stend.dataset.state = stend.state || 'unknown';
  const host = stend.url
    ? stend.url.replace(/^https?:\/\//, '').replace(/\/manager\/?$/, '').replace(/\/$/, '')
    : null;
  el.stendText.textContent = stend.state === 'ok' && host ? host : (stend.text || 'Стенд не проверен');
  // В подсказке — полный адрес и откуда он взялся: когда стенд не тот, первый вопрос
  // именно этот, и ответ должен быть под рукой, а не в конфиге.
  el.stend.title = [stend.url, stend.from && `источник: ${stend.from}`].filter(Boolean).join('\n');
}

/**
 * Сценарий в панели. Показывает не только что произойдёт, но и сколько это займёт:
 * хронометраж виден до съёмки, а не после — переснимать пятнадцатиминутный ролик,
 * поняв, что он длинный, дороже, чем сократить план заранее.
 */
let scenario = null;

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
    const steps = [...scenario.steps];
    const [moved] = steps.splice(dragFrom, 1);
    // После выреза индексы ниже сдвигаются на один — иначе шаг встаёт мимо места.
    if (dragFrom < to) to -= 1;
    steps.splice(to, 0, moved);
    dragFrom = null;
    if (steps.some((s, idx) => s !== scenario.steps[idx])) await pushScenario({ steps });
  });

  list.addEventListener('dragend', () => {
    dragFrom = null;
    list.querySelectorAll('.step-row').forEach((x) => x.classList.remove('drop-before', 'drop-after', 'dragging'));
  });
}

async function pushScenario(patch = {}) {
  scenario = { ...scenario, ...patch };
  await post('/api/scenario', scenario);
}

function renderScenario(next) {
  scenario = next;
  const has = Boolean(scenario?.steps?.length);
  if (el.scriptEmpty) el.scriptEmpty.hidden = has;
  if (el.steps) el.steps.hidden = !has;
  if (el.scriptActions) el.scriptActions.hidden = !has;
  if (!has) {
    if (el.scriptCount) el.scriptCount.textContent = '';
    return;
  }

  DURATION = scenario.steps.reduce((sum, s) => sum + (s.seconds || 0), 0) || DURATION;
  const shooting = scenario.steps.some((s) => s.state === 'running');
  // Плашка «идёт съёмка» показывается ровно пока съёмка идёт: висящая поверх готового
  // кадра, она врёт о состоянии — а состояние здесь и есть главное, что читает человек.
  const liveBadge = document.querySelector('.live-badge');
  if (liveBadge) liveBadge.hidden = !shooting;
  if (el.frame) el.frame.dataset.live = shooting ? 'true' : 'false';
  const editable = scenario.status !== 'ready' && !shooting;
  el.steps.innerHTML = '';

  scenario.steps.forEach((s, i) => {
    const li = document.createElement('li');
    li.className = 'step-row';
    const b = document.createElement('button');
    b.className = 'step';
    b.type = 'button';
    b.dataset.t = String(s.at);
    if (s.state && s.state !== 'done') b.dataset.state = s.state;
    b.innerHTML = `<span class="step-time">${mmss(s.at)}</span>
      <span class="step-label"></span>${s.diagram || s.hint ? '<span class="step-note"></span>' : ''}`;
    b.querySelector('.step-label').textContent = s.label;
    const note = b.querySelector('.step-note');
    if (note) note.textContent = s.diagram ? `Врезка-схема · ${s.seconds} с` : s.hint;
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
      retake.innerHTML = '<button type="button" class="step-tool" data-act="from">снять отсюда</button>';
      retake.addEventListener('click', (e) => {
        if (e.target.dataset?.act !== 'from') return;
        post('/api/event', { type: 'retake', from: s.n, label: s.label });
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
        if (to < 0 || to >= scenario.steps.length) return;
        const steps = [...scenario.steps];
        [steps[i], steps[to]] = [steps[to], steps[i]];
        pushScenario({ steps });
      });

      const tools = document.createElement('div');
      tools.className = 'step-tools';
      tools.innerHTML = `
        <span class="step-tool" data-act="drag" title="Перетащите строку, чтобы переставить">⠿ переставить</span>
        <button type="button" class="step-tool" data-act="edit">подпись</button>
        <button type="button" class="step-tool" data-act="del">убрать</button>`;
      tools.addEventListener('click', async (e) => {
        const act = e.target.dataset?.act;
        if (!act || act === 'drag') return;
        const steps = [...scenario.steps];
        if (act === 'del') steps.splice(i, 1);
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
            if (!text) { label.textContent = s.label; return; }
            if (text === s.label) return;
            steps[i] = { ...steps[i], label: text };
            await pushScenario({ steps });
          };
          label.addEventListener('blur', commit, { once: true });
          label.addEventListener('keydown', (k) => {
            if (k.key === 'Enter') { k.preventDefault(); commit(); }
            if (k.key === 'Escape') { done = true; label.textContent = s.label; label.contentEditable = 'false'; }
          });
          return;
        }
        await pushScenario({ steps });
      });
      li.append(tools);
    }

    el.steps.append(li);
  });

  if (el.scriptCount) el.scriptCount.textContent = `${scenario.steps.length} · ${mmss(DURATION)}`;
  renderRuler();
  renderTracks();

  // Статус рядом с заголовком: пока черновик — съёмка не стартует, и человек должен
  // понимать, почему, не заглядывая в документацию.
  let badge = el.scriptHead.querySelector('.script-status');
  if (!badge) {
    badge = document.createElement('span');
    badge.className = 'script-status';
    el.scriptHead.querySelector('span').after(badge);
  }
  badge.dataset.state = scenario.status;
  badge.textContent = scenario.status === 'ready' ? 'утверждён' : 'черновик';

  if (el.shoot) {
    el.shoot.hidden = false;
    const ready = scenario.status === 'ready';
    el.shoot.textContent = ready ? 'Снято по этому сценарию' : 'Снимать';
    // Съёмку выполняет агент: без него кнопка обещала бы то, чего не произойдёт.
    el.shoot.disabled = ready || el.agent?.dataset.state === 'offline';
    el.shoot.title = el.shoot.disabled && !ready ? 'Агент не подключён' : '';
  }
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

  // Шаги: границы между подписями в кадре. Цвет границы говорит, что с шагом стало.
  const steps = track('steps');
  if (steps) {
    steps.querySelectorAll('.step-edge, .track-fill').forEach((x) => x.remove());
    const done = scenario?.steps?.filter((s) => s.state === 'done') || [];
    if (done.length) {
      const fill = document.createElement('span');
      fill.className = 'track-fill';
      const last = done[done.length - 1];
      fill.style.width = pct(last.at + last.seconds);
      steps.prepend(fill);
    }
    for (const s of scenario?.steps || []) {
      const edge = document.createElement('span');
      edge.className = 'step-edge';
      edge.dataset.state = s.state || 'pending';
      edge.style.left = pct(s.at);
      edge.title = `${s.n}. ${s.label}`;
      steps.append(edge);
    }
  }

  // Схемы: врезка занимает время, поэтому это отрезок, а не точка.
  const diagrams = track('diagrams');
  if (diagrams) {
    diagrams.innerHTML = '';
    for (const s of (scenario?.steps || []).filter((x) => x.diagram)) {
      const clip = document.createElement('span');
      clip.className = 'clip';
      clip.dataset.kind = 'diagram';
      clip.style.left = pct(s.at);
      clip.style.width = pct(s.seconds);
      clip.textContent = s.diagram;
      clip.title = `Схема «${s.diagram}» · ${s.seconds} с`;
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
      m.addEventListener('click', (e) => { e.stopPropagation(); seek(n.t); });
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
  scenario_note: 'Правка сценария',
  task: 'Сборка сценария',
  note: 'Замечание',
  apply: 'Применение замечаний',
  retake: 'Пересъёмка',
  shoot: 'Съёмка',
  stop: 'Остановка',
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
      const title = EVENT_TITLES[e.type] || e.type;
      const span = document.createElement('span');
      span.className = 'inflight-text';
      span.textContent = e.text ? `${title}: ${e.text}` : title;
      const state = document.createElement('span');
      state.textContent = e.state === 'working' ? 'в работе' : 'ждёт';
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
function renderMovie(next) {
  movie = next;
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
  DURATION = movie.duration || DURATION;
  renderRuler();
  renderTracks();
  // Позиция могла остаться от прежней длительности и оказаться за концом нового ролика:
  // тогда титр показывает последний кадр сценария ещё до нажатия «играть».
  if (cursor > DURATION) seek(0);
  else renderCaption(cursor);
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
  if (el.pin) el.pin.textContent = `Метка на ${mmss(cursor)}`;
  if (el.composer) el.composer.placeholder = `Что поправить в этот момент? Метка встанет на ${mmss(cursor)}`;
  renderCaption(cursor);
}

/**
 * План работ по накопленным замечаниям.
 *
 * Показывается до нажатия, а не после: «поправь титр» и «покажи другой раздел» выглядят
 * одинаково — две строчки текста, — но стоят двух минут и двадцати. Человек должен
 * увидеть эту разницу прежде, чем согласится ждать.
 */
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
    kind.textContent = it.title;
    const why = document.createElement('span');
    why.textContent = it.why;
    li.append(kind, why);
    el.planList.append(li);
  }

  el.planCost.textContent = plan.minutes ? `≈ ${plan.minutes} мин` : 'срок неясен';
  // Пересъёмка — единственное, что стоит десятки минут: об этом говорим прямо в кнопке.
  el.planApply.textContent = plan.needsShooting ? 'Применить и переснять' : 'Применить';
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
  const kinds = { diagram: 'Схема', edit: 'Монтаж', voice: 'Озвучка' };
  for (const n of notes) {
    const art = document.createElement('article');
    art.className = 'note';
    if (n.status === 'applied') art.dataset.status = 'applied';
    art.innerHTML = `<div class="note-head">
        <button class="time-chip" type="button">${mmss(n.t)}</button>
        <span class="note-kind">${n.status === 'applied' ? 'Применено' : (kinds[n.kind] || 'Монтаж')}</span>
      </div><p class="note-body"></p>`;
    art.querySelector('.note-body').textContent = n.text;
    art.querySelector('.time-chip').addEventListener('click', () => seek(n.t));
    el.notes.append(art);
  }
  if (el.notesCount) el.notesCount.textContent = String(notes.length);
  renderPlan();
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
    if (msg.type === 'scenario') renderScenario(msg.scenario);
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
  renderScenario(hello.scenario);
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
    await pushScenario({ status: 'ready' });
    await post('/api/event', { type: 'shoot' });
  });

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
    const title = prompt('Название ролика');
    if (!title) return;
    await post('/api/projects', { title });
    location.reload();
  });

  el.planApply?.addEventListener('click', async () => {
    el.planApply.disabled = true;
    await post('/api/event', { type: 'apply' });
  });

  el.play?.addEventListener('click', () => {
    if (!video) return;
    if (video.paused) video.play(); else video.pause();
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
