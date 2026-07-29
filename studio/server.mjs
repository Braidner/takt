/**
 * Takt live — мост между страницей и агентом.
 *
 * Устройство взято из live-режима impeccable, потому что оно обкатано и решает ровно эту
 * задачу: агент не сервер и не может «слушать» постоянно, но длинный опрос из фоновой
 * задачи даёт тот же результат без циклов опроса — одно висящее соединение, которое
 * разрешается ровно тогда, когда человек что-то сделал.
 *
 * Что перенесено дословно, потому что каждое из этого лечит конкретный отказ:
 *   * ТОКЕН на всех маршрутах — сервер слушает localhost, но страница на соседнем порту
 *     не должна уметь слать сюда команды;
 *   * АРЕНДА события: выданное агенту событие держится за ним ограниченное время. Агент
 *     упал или его прервали — событие возвращается в очередь, а не теряется молча;
 *   * ЖУРНАЛ на диске: замечания копятся по ходу просмотра десятками, и терять их при
 *     перезапуске или закрытии вкладки нельзя;
 *   * HEARTBEAT в SSE: без него прокси и браузер тихо рвут «молчащее» соединение, и
 *     страница считает, что агент на связи, когда его давно нет.
 *
 * Что добавлено сверх impeccable — из-за разницы в предметной области. Там правка
 * прилетает в браузер мгновенно через горячую замену модулей; здесь съёмка идёт минуты,
 * поэтому есть поток кадров живого экрана и явный прогресс. Тишина в три минуты без
 * прогресса читается человеком как поломка.
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { planFor } from './classify-notes.mjs';
import { HOME, HOME_FROM, PROJECTS, VOICES, SERVER_INFO, ensureHome } from './home.mjs';
import { listTargets, readTarget, writeTarget, readNotes as readTargetNotes,
         appendNote, slugifyTarget } from './target.mjs';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.TAKT_PORT || 4173);

// Ограничение не наше: fetch в Node рвёт запрос по таймауту заголовков на 300 с и
// понизить его для одного запроса нельзя. Держим запрос ниже потолка, а длинное
// ожидание собираем из таких отрезков на стороне клиента.
const POLL_MAX_MS = 270_000;
const LEASE_MS = 600_000;
const HEARTBEAT_MS = 30_000;

/**
 * Проекты.
 *
 * Раньше всё лежало в одном безымянном journal/: сценарий, дубли, ролик, замечания,
 * озвучка. Второй ролик молча затирал первый вместе со всей работой по нему — пока
 * ролик был один, это не мешало.
 *
 * Голоса живут ВНЕ проектов: голос диктора один на все ролики, и записывать его заново
 * под каждый бессмысленно. Там же, вне проектов, живут цели — знание о снимаемой системе
 * переживает десятки роликов про неё.
 *
 * Сам каталог данных лежит отдельно от кода: код скилла обновляется и переустанавливается,
 * а снятое и записанное должно это пережить (см. home.mjs).
 */
const ROOT = HOME;
fs.mkdirSync(PROJECTS, { recursive: true });

const slugify = (name) => String(name).trim().toLowerCase()
  .replace(/[^a-zа-яё0-9]+/gi, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'project';

const currentFile = path.join(ROOT, 'current.json');
const readCurrent = () => {
  try { return JSON.parse(fs.readFileSync(currentFile, 'utf8')).id; } catch { return null; }
};

const listProjects = () => {
  try {
    return fs.readdirSync(PROJECTS)
      .filter((d) => fs.existsSync(path.join(PROJECTS, d, 'project.json')))
      .map((d) => JSON.parse(fs.readFileSync(path.join(PROJECTS, d, 'project.json'), 'utf8')))
      .sort((a, b) => (b.openedAt || '').localeCompare(a.openedAt || ''));
  } catch { return []; }
};

const readProject = (id) => {
  try { return JSON.parse(fs.readFileSync(path.join(PROJECTS, id, 'project.json'), 'utf8')); }
  catch { return null; }
};

const writeProject = (id, patch) => {
  const next = { ...(readProject(id) || { id }), ...patch };
  fs.mkdirSync(path.join(PROJECTS, id), { recursive: true });
  fs.writeFileSync(path.join(PROJECTS, id, 'project.json'), JSON.stringify(next, null, 2));
  return next;
};

/** Проект знает свою цель — систему, про которую снят ролик. Всё знание о самой системе
 *  лежит в цели и переиспользуется остальными роликами про неё. */
function ensureProject(id, title, target = null) {
  const dir = path.join(PROJECTS, id);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'project.json');
  if (!fs.existsSync(file)) {
    fs.writeFileSync(file, JSON.stringify(
      { id, title: title || id, target, createdAt: new Date().toISOString() }, null, 2));
  }
  return dir;
}

// Первый запуск: если проектов нет, заводим один — иначе студия открывается в пустоту
// и человеку нужно сделать лишний шаг до того, как он вообще что-то увидел.
let currentId = readCurrent();
if (!currentId || !fs.existsSync(path.join(PROJECTS, currentId, 'project.json'))) {
  currentId = listProjects()[0]?.id || slugify('Первый ролик');
  ensureProject(currentId, 'Первый ролик');
  fs.writeFileSync(currentFile, JSON.stringify({ id: currentId }, null, 2));
}

/** Путь внутри текущего проекта. Всё состояние ролика адресуется только так. */
const inProject = (...parts) => path.join(PROJECTS, currentId, ...parts);

const state = {
  token: crypto.randomBytes(16).toString('hex'),
  queue: [],            // события, ждущие агента
  leased: new Map(),    // id → { event, until }
  polls: [],            // висящие запросы агента
  sse: new Set(),        // подписанные страницы
  agentSeenAt: 0,
  lastFrame: null,       // последний кадр живого экрана
  // Рядом с текстом состояния едет ключ словаря: студия двуязычна и собирает строку
  // сама, а текст остаётся для журнала и консоли, где словаря нет.
  status: { state: 'offline', text: 'Агент не подключён', key: 'agentOffline', step: null, of: null },
  // Стенд — вторая сущность состояния рядом с агентом: агент может быть на связи, а
  // стенд недоступен, и это разные поломки с разным лечением.
  stend: { url: null, state: 'unknown', text: 'Стенд не проверен', key: 'stendUnchecked', from: null },
  // Остановка не может быть событием в общей очереди: съёмка идёт минуты и всё это
  // время не опрашивает очередь. Это флаг, который процесс съёмки читает между шагами.
  stopRequested: false,
};

const stendFile = path.join(ROOT, 'stend.json');

try {
  Object.assign(state.stend, JSON.parse(fs.readFileSync(stendFile, 'utf8')));
} catch { /* первого запуска ещё не было */ }

/**
 * Каталоги данных: проекты, цели, голоса. Голоса не в репозитории намеренно — это записи
 * голосов живых людей, и расходиться со всеми клонами проекта они не должны.
 */
ensureHome();

const readVoices = () => {
  try {
    return fs.readdirSync(VOICES)
      .filter((f) => f.endsWith('.json'))
      .map((f) => JSON.parse(fs.readFileSync(path.join(VOICES, f), 'utf8')))
      .sort((a, b) => (b.addedAt || '').localeCompare(a.addedAt || ''));
  } catch { return []; }
};

const narrationFile = () => inProject('narration.json');
const readNarration = () => {
  try { return JSON.parse(fs.readFileSync(narrationFile(), 'utf8')); } catch { return null; }
};

const movieFile = () => inProject('movie.json');
const readMovie = () => {
  try { return JSON.parse(fs.readFileSync(movieFile(), 'utf8')); } catch { return null; }
};

// Настройки подключения лежат рядом со студией и не попадают в репозиторий: там адрес
// внутреннего окружения и учётные данные.
const taktConfigFile = path.join(HOME, 'takt.json');
const readTaktConfig = () => {
  try { return JSON.parse(fs.readFileSync(taktConfigFile, 'utf8')); } catch { return {}; }
};

/** Готовые цели из пресета — чтобы форма предлагала их, а не заставляла вспоминать. */
function presetTargets() {
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(DIR, 'takt.preset.json'), 'utf8'));
    return Object.entries(raw.targets || {}).map(([name, url]) => ({ name, url }));
  } catch { return []; }
}   // стенд общий: он про окружение, а не про ролик
const scenarioFile = () => inProject('scenario.json');
/** Таймкоды — производные от длительностей, а не самостоятельные данные. */
const withTimeline = (steps) => {
  let at = 0;
  return steps.map((s, i) => {
    const seconds = Number(s.seconds) > 0 ? Number(s.seconds) : 8;
    const step = { ...s, n: i + 1, at, seconds, state: s.state || 'pending' };
    at += seconds;
    return step;
  });
};

const readScenario = () => {
  try { return JSON.parse(fs.readFileSync(scenarioFile(), 'utf8')); } catch { return null; }
};
const writeScenario = (s) => fs.writeFileSync(scenarioFile(), JSON.stringify(s, null, 2));

const notesFile = () => inProject('notes.json');
const eventsFile = () => inProject('events.jsonl');

const readNotes = () => {
  try { return JSON.parse(fs.readFileSync(notesFile(), 'utf8')); } catch { return []; }
};
const writeNotes = (notes) => fs.writeFileSync(notesFile(), JSON.stringify(notes, null, 2));
const logEvent = (e) =>
  fs.appendFileSync(eventsFile(), JSON.stringify({ ...e, at: new Date().toISOString() }) + '\n');

const send = (res, code, body, type = 'application/json') => {
  res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(typeof body === 'string' ? body : JSON.stringify(body));
};

const broadcast = (msg) => {
  const line = `data: ${JSON.stringify(msg)}\n\n`;
  for (const res of state.sse) {
    try { res.write(line); } catch { state.sse.delete(res); }
  }
};

/** Агент считается на связи, пока держит опрос или недавно отвечал. */
const agentAlive = () => state.polls.length > 0 || Date.now() - state.agentSeenAt < 90_000;

/** Что сейчас ждёт агента или уже у него в работе — для показа в интерфейсе. */
const inFlight = () => [
  ...state.queue.map((e) => ({ id: e.id, type: e.type, text: e.text || null, state: 'queued' })),
  ...[...state.leased.values()].map(({ event }) => ({
    id: event.id, type: event.type, text: event.text || null, state: 'working' })),
];

function pushStatus(patch) {
  // Ключ словаря сбрасывается вместе с текстом: подпись шага сценария переводу не
  // подлежит, и оставшийся от прошлого состояния ключ подменил бы её своей фразой.
  Object.assign(state.status, { key: null, args: null }, patch);
  broadcast({ type: 'status', status: state.status, agent: agentAlive(), inFlight: inFlight() });
}

function enqueue(event) {
  const e = { id: crypto.randomUUID(), ...event };
  logEvent(e);
  // Ждущий агент забирает событие сразу; иначе оно ждёт в очереди.
  const poll = state.polls.shift();
  if (poll) {
    clearTimeout(poll.timer);
    lease(e);
    poll.resolve(e);
  } else {
    state.queue.push(e);
  }
  return e;
}

function lease(e) {
  state.leased.set(e.id, { event: e, until: Date.now() + LEASE_MS });
}

/** Просроченная аренда возвращает событие в очередь: агент упал, работа не потеряна. */
function reclaimExpired() {
  const now = Date.now();
  for (const [id, l] of state.leased) {
    if (l.until < now) {
      state.leased.delete(id);
      state.queue.unshift(l.event);
    }
  }
}

const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.jpg': 'image/jpeg', '.png': 'image/png',
  '.mp4': 'video/mp4', '.json': 'application/json' };

const body = (req) => new Promise((resolve) => {
  let b = ''; req.on('data', (c) => { b += c; });
  req.on('end', () => { try { resolve(JSON.parse(b || '{}')); } catch { resolve(null); } });
});

/**
 * Отдача файла с поддержкой диапазонов.
 *
 * Range-запросы обязательны для перемотки: без них браузер качает видео целиком при
 * каждом прыжке по таймкоду и не даёт мотать до полной загрузки. А перемотка здесь —
 * основное действие: по ролику работают прыжками по моментам замечаний.
 */
function serveFile(req, res, file) {
  const type = MIME[path.extname(file)] || 'application/octet-stream';
  if (path.extname(file) !== '.mp4') {
    return fs.readFile(file, (err, data) => {
      if (err) return send(res, 404, 'not found', 'text/plain');
      res.writeHead(200, { 'Content-Type': type });
      res.end(data);
    });
  }

  fs.stat(file, (err, st) => {
    if (err) return send(res, 404, 'not found', 'text/plain');
    const range = req.headers.range;
    if (!range) {
      res.writeHead(200, { 'Content-Type': type, 'Content-Length': st.size, 'Accept-Ranges': 'bytes' });
      return fs.createReadStream(file).pipe(res);
    }
    const [s0, s1] = range.replace(/bytes=/, '').split('-');
    const start = Number(s0);
    const end = s1 ? Number(s1) : st.size - 1;
    res.writeHead(206, {
      'Content-Type': type,
      'Content-Range': `bytes ${start}-${end}/${st.size}`,
      'Accept-Ranges': 'bytes',
      'Content-Length': end - start + 1,
    });
    fs.createReadStream(file, { start, end }).pipe(res);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const p = url.pathname;
  const token = url.searchParams.get('token') || req.headers['x-takt-token'];
  const authed = token === state.token;

  // ── Страница узнаёт свой токен из этого маршрута: он открыт, но отдаёт токен только
  // локальному запросу — сервер и так слушает только петлевой интерфейс.
  if (p === '/api/hello') {
    return send(res, 200, { token: state.token, project: currentId, projects: listProjects(),
                            status: state.status, agent: agentAlive(),
                            stend: state.stend, notes: readNotes(), scenario: readScenario(),
                            movie: readMovie(), voices: readVoices(),
                            narration: readNarration(), inFlight: inFlight() });
  }

  // ── Поток состояния в страницу
  if (p === '/api/stream') {
    if (!authed) return send(res, 401, { error: 'unauthorized' });
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache',
                         Connection: 'keep-alive' });
    res.write(`data: ${JSON.stringify({ type: 'status', status: state.status, agent: agentAlive(), inFlight: inFlight() })}\n\n`);
    res.write(`data: ${JSON.stringify({ type: 'stend', stend: state.stend })}\n\n`);
    res.write(`data: ${JSON.stringify({ type: 'project', current: currentId, projects: listProjects() })}\n\n`);
    const sc = readScenario();
    if (sc) res.write(`data: ${JSON.stringify({ type: 'scenario', scenario: sc })}\n\n`);
    const mv = readMovie();
    if (mv) res.write(`data: ${JSON.stringify({ type: 'movie', movie: mv })}\n\n`);
    const nr = readNarration();
    if (nr) res.write(`data: ${JSON.stringify({ type: 'narration', narration: nr })}\n\n`);
    if (state.lastFrame) res.write(`data: ${JSON.stringify({ type: 'frame', frame: state.lastFrame })}\n\n`);
    state.sse.add(res);
    const beat = setInterval(() => {
      try { res.write(': keepalive\n\n'); } catch { clearInterval(beat); }
    }, HEARTBEAT_MS);
    req.on('close', () => { clearInterval(beat); state.sse.delete(res); });
    return;
  }

  // ── Страница → агент: задача, замечание, применить, переснять, остановить
  if (p === '/api/event' && req.method === 'POST') {
    if (!authed) return send(res, 401, { error: 'unauthorized' });
    const msg = await body(req);
    if (!msg || !msg.type) return send(res, 400, { error: 'bad_event' });

    // Замечания копятся в журнале и уходят агенту пачкой по «применить»: правка ролика
    // стоит минуты, дёргать агента на каждую метку бессмысленно.
    if (msg.type === 'note') {
      const notes = readNotes();
      const note = { id: crypto.randomUUID(), t: msg.t ?? 0, kind: msg.kind || 'edit',
                     text: String(msg.text || '').slice(0, 2000), status: 'open' };
      notes.push(note);
      writeNotes(notes);
      logEvent({ type: 'note', ...note });
      broadcast({ type: 'notes', notes });
      return send(res, 200, { ok: true, note });
    }

    if (msg.type === 'stop') state.stopRequested = true;
    if (msg.type === 'apply') msg.plan = planFor(readNotes());
    const e = enqueue(msg);
    broadcast({ type: 'status', status: state.status, agent: agentAlive(), inFlight: inFlight() });
    return send(res, 200, { ok: true, id: e.id });
  }

  // ── Кадры живого экрана от процесса съёмки
  if (p === '/api/frame' && req.method === 'POST') {
    if (!authed) return send(res, 401, { error: 'unauthorized' });
    const msg = await body(req);
    if (!msg?.frame) return send(res, 400, { error: 'no_frame' });
    state.lastFrame = msg.frame;
    broadcast({ type: 'frame', frame: msg.frame });
    return send(res, 200, { ok: true });
  }

  // ── Агент сообщает, чем занят
  if (p === '/api/status' && req.method === 'POST') {
    if (!authed) return send(res, 401, { error: 'unauthorized' });
    const msg = await body(req);
    state.agentSeenAt = Date.now();
    pushStatus(msg || {});
    return send(res, 200, { ok: true });
  }

  // ── Сценарий: агент присылает его сюда, страница получает потоком
  if (p === '/api/scenario' && req.method === 'POST') {
    if (!authed) return send(res, 401, { error: 'unauthorized' });
    const msg = await body(req);
    if (!msg?.steps) return send(res, 400, { error: 'no_steps' });
    // Статус «черновик» — не украшение: пока он такой, съёмка не стартует, потому что
    // прогон стоит минут живого времени, а расхождение выясняется на первой же реплике.
    const scenario = { title: msg.title || 'Без названия', status: msg.status || 'draft',
                       task: msg.task || null, steps: withTimeline(msg.steps) };
    writeScenario(scenario);
    logEvent({ type: 'scenario', title: scenario.title, steps: scenario.steps.length });
    broadcast({ type: 'scenario', scenario });
    return send(res, 200, { ok: true });
  }

  if (p === '/api/scenario' && req.method === 'GET') return send(res, 200, readScenario());

  // ── Дикторский текст: реплики, привязанные к меткам сценария
  if (p === '/api/narration' && req.method === 'POST') {
    if (!authed) return send(res, 401, { error: 'unauthorized' });
    const msg = await body(req);
    if (!Array.isArray(msg?.lines)) return send(res, 400, { error: 'no_lines' });

    /**
     * Дорожка не может быть собрана из разных голосов или движков.
     *
     * Разные модели дают разный голос из одного и того же образца, а разные голоса —
     * тем более. Стоит переозвучить одну реплику другим движком, и посреди дорожки
     * появляется слышимый шов — причём именно там, ради чего точечная переозвучка и
     * делалась. Поймать это можно только на слух и только целиком прослушав ролик.
     *
     * Поэтому смена голоса или движка при уже озвученных репликах требует явного
     * согласия: с ним вся дорожка возвращается в черновик и переозвучивается заново.
     */
    const прежняя = readNarration();
    const озвученные = (прежняя?.lines || []).filter((l) => l.state === 'voiced');
    const сменаГолоса = прежняя && msg.voiceId !== undefined && msg.voiceId !== прежняя.voiceId;
    const сменаДвижка = прежняя && msg.engine !== undefined && msg.engine !== прежняя.engine;

    if (озвученные.length && (сменаГолоса || сменаДвижка) && !msg.force) {
      return send(res, 409, {
        error: 'engine_mismatch',
        voiced: озвученные.length,
        was: { voiceId: прежняя.voiceId, engine: прежняя.engine },
        now: { voiceId: msg.voiceId, engine: msg.engine },
      });
    }
    // force означает «отправитель отвечает за согласованность дорожки» — и состояния
    // реплик принимаются как присланы. Полная переозвучка присылает всё свежеозвученным,
    // и сбрасывать её в черновик значило бы стереть только что сделанную работу.

    const narration = {
      voiceId: msg.voiceId ?? null,
      engine: msg.engine || 'qwen',
      // Реплика знает своё окно: следующая метка минус своя. По нему проверяется
      // укладка — реплика, не влезающая в окно, наедет на следующую в дорожке.
      lines: msg.lines.map((l, i) => ({
        n: i + 1, at: l.at ?? 0, hold: l.hold ?? null, text: String(l.text || '').slice(0, 600),
        state: l.state || 'draft', seconds: l.seconds ?? null,
      })),
      updatedAt: new Date().toISOString(),
    };
    fs.writeFileSync(narrationFile(), JSON.stringify(narration, null, 2));
    broadcast({ type: 'narration', narration });
    return send(res, 200, { ok: true });
  }

  if (p === '/api/narration' && req.method === 'GET') return send(res, 200, readNarration());

  // ── Голос: запись из браузера или загруженный файл
  /**
   * Смена движка у голоса. Отдельный маршрут, а не правка каталога с клиента: голос —
   * это файлы на диске плюс согласие человека, и давать странице писать в него целиком
   * значило бы доверить ей и то, и другое.
   *
   * Переозвучивать уже собранные дорожки при этом не нужно: защита от смешения стоит на
   * приёме дикторского текста и сработает при следующей озвучке.
   */
  if (p === '/api/voice-engine' && req.method === 'POST') {
    if (!authed) return send(res, 401, { error: 'unauthorized' });
    const msg = await body(req);
    const file = path.join(VOICES, `${msg?.id}.json`);
    if (!msg?.id || !fs.existsSync(file)) return send(res, 404, { error: 'no_voice' });
    if (!['qwen', 'chatterbox'].includes(msg.engine)) return send(res, 400, { error: 'bad_engine' });
    const meta = { ...JSON.parse(fs.readFileSync(file, 'utf8')), engine: msg.engine };
    fs.writeFileSync(file, JSON.stringify(meta, null, 2));
    logEvent({ type: 'voice_engine', id: msg.id, engine: msg.engine });
    broadcast({ type: 'voices', voices: readVoices() });
    return send(res, 200, { ok: true, engine: msg.engine });
  }

  if (p === '/api/voice' && req.method === 'POST') {
    if (!authed) return send(res, 401, { error: 'unauthorized' });
    const msg = await body(req);
    if (!msg?.audio || !msg?.name) return send(res, 400, { error: 'no_audio' });

    // Согласие спрашивается в интерфейсе и записывается рядом с голосом: через месяц
    // никто не вспомнит, спрашивали ли, а голос человека охраняется законом.
    if (!msg.consent) return send(res, 400, { error: 'no_consent' });

    const id = crypto.randomUUID();
    const ext = msg.mime?.includes('wav') ? 'wav' : 'webm';
    const base64 = String(msg.audio).replace(/^data:[^,]+,/, '');
    fs.writeFileSync(path.join(VOICES, `${id}.${ext}`), Buffer.from(base64, 'base64'));

    const meta = {
      id, name: String(msg.name).slice(0, 60), file: `${id}.${ext}`,
      source: msg.source || 'record', seconds: msg.seconds ?? null,
      // Движок — свойство голоса, а не дорожки: один и тот же образец, заведённый под
      // двумя движками, даёт два голоса в каталоге, и их можно сравнить на одной реплике.
      engine: ['qwen', 'chatterbox'].includes(msg.engine) ? msg.engine : 'qwen',
      consent: true, consentBy: String(msg.consentBy || '').slice(0, 120),
      addedAt: new Date().toISOString(), ready: false,
    };
    fs.writeFileSync(path.join(VOICES, `${id}.json`), JSON.stringify(meta, null, 2));
    logEvent({ type: 'voice_added', id, name: meta.name, source: meta.source });
    broadcast({ type: 'voices', voices: readVoices() });
    // Подготовка (расшифровка эталона) — работа агента: она долгая и требует моделей.
    enqueue({ type: 'voice_prepare', id, name: meta.name });
    broadcast({ type: 'status', status: state.status, agent: agentAlive(), inFlight: inFlight() });
    return send(res, 200, { ok: true, id });
  }

  if (p === '/api/voices' && req.method === 'GET') return send(res, 200, readVoices());

  // Агент отмечает голос готовым и дописывает то, что выяснил при подготовке.
  if (p === '/api/voice-ready' && req.method === 'POST') {
    if (!authed) return send(res, 401, { error: 'unauthorized' });
    const msg = await body(req);
    const file = path.join(VOICES, `${msg?.id}.json`);
    if (!fs.existsSync(file)) return send(res, 404, { error: 'no_voice' });
    const meta = JSON.parse(fs.readFileSync(file, 'utf8'));
    Object.assign(meta, { ready: true, seconds: msg.seconds ?? meta.seconds,
                          quality: msg.quality ?? null, refText: msg.refText ?? null });
    fs.writeFileSync(file, JSON.stringify(meta, null, 2));
    broadcast({ type: 'voices', voices: readVoices() });
    return send(res, 200, { ok: true });
  }

  // ── Проекты: список, переключение, создание
  if (p === '/api/projects' && req.method === 'GET') {
    return send(res, 200, { current: currentId, projects: listProjects() });
  }

  if (p === '/api/projects' && req.method === 'POST') {
    if (!authed) return send(res, 401, { error: 'unauthorized' });
    const msg = await body(req);

    if (msg?.open) {
      // Переключение — это смена корня для всего состояния, поэтому страницу
      // перерисовываем целиком: половина старого проекта рядом с половиной нового
      // хуже, чем короткая пауза.
      if (!fs.existsSync(path.join(PROJECTS, msg.open, 'project.json'))) {
        return send(res, 404, { error: 'no_project' });
      }
      currentId = msg.open;
      fs.writeFileSync(currentFile, JSON.stringify({ id: currentId }, null, 2));
      logEvent({ type: 'project_open', id: currentId });
      broadcast({ type: 'project', current: currentId, projects: listProjects() });
      broadcast({ type: 'scenario', scenario: readScenario() });
      broadcast({ type: 'notes', notes: readNotes() });
      broadcast({ type: 'movie', movie: readMovie() });
      broadcast({ type: 'narration', narration: readNarration() });
      return send(res, 200, { ok: true, current: currentId });
    }

    const title = String(msg?.title || 'Новый ролик').slice(0, 80);
    let id = slugify(title);
    // Одноимённые ролики — обычное дело («Обзор», «Обзор» второй попыткой), поэтому
    // при совпадении добавляем номер, а не отказываем.
    let n = 2;
    while (fs.existsSync(path.join(PROJECTS, id, 'project.json'))) id = `${slugify(title)}-${n++}`;
    // Новый ролик наследует цель текущего: чаще всего снимают следующий сюжет про ту же
    // систему, и заставлять человека каждый раз выбирать её заново незачем.
    ensureProject(id, title, msg?.target ?? readProject(currentId)?.target ?? null);
    currentId = id;
    fs.writeFileSync(currentFile, JSON.stringify({ id: currentId }, null, 2));
    logEvent({ type: 'project_create', id, title });
    broadcast({ type: 'project', current: currentId, projects: listProjects() });
    broadcast({ type: 'scenario', scenario: null });
    broadcast({ type: 'notes', notes: [] });
    broadcast({ type: 'movie', movie: null });
    broadcast({ type: 'narration', narration: null });
    return send(res, 200, { ok: true, id });
  }

  /**
   * ── Цели съёмки: системы, про которые снимают ролики.
   *
   * Пароль наружу не отдаётся — как и в настройках подключения. Заметки отдаются целиком:
   * их пишет агент для себя, но человеку полезно видеть, что тот выучил про его систему,
   * и поправить, если выучил неверно.
   */
  if (p === '/api/targets' && req.method === 'GET') {
    const targets = listTargets().map(({ creds, ...t }) => ({ ...t, hasPassword: Boolean(creds?.password) }));
    return send(res, 200, {
      targets,
      current: readProject(currentId)?.target || null,
      notes: readTargetNotes(readProject(currentId)?.target),
    });
  }

  if (p === '/api/targets' && req.method === 'POST') {
    if (!authed) return send(res, 401, { error: 'unauthorized' });
    const msg = await body(req);

    // Привязка текущего ролика к цели — самое частое действие: систему завели один раз,
    // а роликов про неё будет много.
    if (msg?.use !== undefined) {
      writeProject(currentId, { target: msg.use || null });
      logEvent({ type: 'target_use', project: currentId, target: msg.use || null });
      broadcast({ type: 'project', current: currentId, projects: listProjects() });
      return send(res, 200, { ok: true, target: msg.use || null });
    }

    const patch = {};
    for (const k of ['name', 'url', 'ready', 'login', 'selectors', 'language', 'theme']) {
      if (msg[k] !== undefined) patch[k] = msg[k];
    }
    const описываетЦель = Object.keys(patch).length > 0 || msg?.user !== undefined || msg?.password;

    // Заметка агента о системе. Копится списком с датами, а не переписывается: выученное
    // про интерфейс накапливается по крупицам, и каждая крупица потом экономит разведку.
    // Отдельной веткой — только когда пришла ОДНА заметка: иначе она перехватывала бы
    // сохранение цели, у которой заметка идёт довеском к полям.
    if (msg?.note && !описываетЦель) {
      const slug = msg.slug || readProject(currentId)?.target;
      if (!slug) return send(res, 400, { error: 'no_target' });
      appendNote(slug, msg.note);
      return send(res, 200, { ok: true });
    }

    const slug = msg?.slug || slugifyTarget(msg?.name || '');
    if (!slug) return send(res, 400, { error: 'no_slug' });
    if (msg.user !== undefined || msg.password) {
      const current = readTarget(slug)?.creds || {};
      patch.creds = { ...current };
      if (msg.user !== undefined) patch.creds.user = String(msg.user || '').trim();
      // Пустой пароль означает «оставить прежний» — та же логика, что в форме подключения.
      if (msg.password) patch.creds.password = String(msg.password);
    }

    const saved = writeTarget(slug, patch);
    if (msg.note) appendNote(slug, msg.note);
    logEvent({ type: 'target_saved', slug, url: saved.url || null });
    broadcast({ type: 'targets', targets: listTargets().map(({ creds, ...t }) => t) });
    return send(res, 200, { ok: true, slug });
  }

  // ── План работ по накопленным замечаниям: что и сколько займёт
  if (p === '/api/plan') {
    const plan = planFor(readNotes());
    return send(res, 200, plan);
  }

  // ── Готовый ролик
  if (p === '/api/movie' && req.method === 'POST') {
    if (!authed) return send(res, 401, { error: 'unauthorized' });
    const msg = await body(req);
    fs.writeFileSync(movieFile(), JSON.stringify(msg, null, 2));
    logEvent({ type: 'movie', duration: msg?.duration });
    broadcast({ type: 'movie', movie: msg });
    return send(res, 200, { ok: true });
  }

  // ── Флаг остановки: съёмка спрашивает его между шагами
  if (p === '/api/control' && req.method === 'GET') {
    if (!authed) return send(res, 401, { error: 'unauthorized' });
    return send(res, 200, { stop: state.stopRequested });
  }
  if (p === '/api/control' && req.method === 'POST') {
    if (!authed) return send(res, 401, { error: 'unauthorized' });
    const msg = await body(req);
    state.stopRequested = Boolean(msg?.stop);
    return send(res, 200, { ok: true, stop: state.stopRequested });
  }

  // ── Прогресс по шагам: во время съёмки состояние меняет процесс съёмки
  if (p === '/api/step' && req.method === 'POST') {
    if (!authed) return send(res, 401, { error: 'unauthorized' });
    const msg = await body(req);
    const scenario = readScenario();
    if (!scenario) return send(res, 400, { error: 'no_scenario' });
    const step = scenario.steps[msg.n - 1];
    if (!step) return send(res, 400, { error: 'no_step' });
    Object.assign(step, { state: msg.state || 'pending', error: msg.error || null,
                          fix: msg.fix ?? null, took: msg.took ?? step.took ?? null });
    writeScenario(scenario);
    broadcast({ type: 'scenario', scenario });
    return send(res, 200, { ok: true });
  }

  /**
   * ── Настройки подключения: адрес и учётные данные из формы.
   *
   * Пишутся В ЦЕЛЬ текущего ролика, если она задана, и только иначе — в общую настройку.
   * Разница не формальная: общий на всю установку пароль означал бы, что учётные данные
   * от одной системы применяются ко всем остальным. Пока система одна, это незаметно;
   * со второй — попытка входа чужим паролем, и хорошо ещё, если она просто не пройдёт.
   */
  if (p === '/api/connection' && req.method === 'GET') {
    const slug = readProject(currentId)?.target;
    const target = slug ? readTarget(slug) : null;
    const cfg = readTaktConfig();
    const creds = target ? target.creds : cfg.creds;
    // Пароль наружу не отдаётся никогда — ни в ответе, ни в потоке событий. Форме
    // достаточно знать, задан он или нет: показывать его обратно незачем, а утечь
    // через историю браузера или скриншот он может запросто.
    return send(res, 200, {
      stend: (target?.url) || cfg.stend || null,
      user: creds?.user || null,
      hasPassword: Boolean(creds?.password),
      target: slug || null,
      targets: [...presetTargets(),
                ...listTargets().map((t) => ({ name: t.name || t.slug, url: t.url }))]
        .filter((t) => t.url),
    });
  }

  if (p === '/api/connection' && req.method === 'POST') {
    if (!authed) return send(res, 401, { error: 'unauthorized' });
    const msg = await body(req);
    const slug = readProject(currentId)?.target;

    // Пустой пароль в форме означает «оставить прежний», а не «стереть»: иначе правка
    // адреса вслепую сбрасывала бы уже сохранённые учётные данные.
    const мержКредов = (было = {}) => {
      const creds = { ...было };
      if (msg?.user !== undefined) creds.user = String(msg.user || '').trim();
      if (msg?.password) creds.password = String(msg.password);
      if (msg?.clearPassword) delete creds.password;
      return creds;
    };

    let адрес;
    if (slug) {
      const t = writeTarget(slug, {
        ...(msg?.stend ? { url: String(msg.stend).trim() } : {}),
        creds: мержКредов(readTarget(slug)?.creds),
      });
      адрес = t.url;
    } else {
      const cfg = readTaktConfig();
      if (msg?.stend) cfg.stend = String(msg.stend).trim();
      cfg.creds = мержКредов(cfg.creds);
      fs.writeFileSync(taktConfigFile, JSON.stringify(cfg, null, 2) + '\n');
      адрес = cfg.stend;
    }

    // В журнал пишем факт, но не значения: журнал читают глазами и передают дальше.
    logEvent({ type: 'connection_saved', stend: адрес, target: slug || null });

    // Чип в шапке обязан сразу перестать показывать прежний адрес. Иначе форма врёт:
    // снимать будем с нового стенда, а зелёная отметка остаётся от старого — и это
    // ровно та ошибка, которую замечают уже на смонтированном ролике.
    if (адрес && адрес !== state.stend.url) {
      Object.assign(state.stend, {
        url: адрес, from: 'форма', fromKey: 'form', fromArgs: null,
        state: msg?.check ? 'checking' : 'unknown',
        text: msg?.check ? 'Проверяю доступ' : 'Стенд не проверен',
        key: msg?.check ? 'stendChecking' : 'stendUnchecked',
        args: null,
      });
      fs.writeFileSync(stendFile, JSON.stringify(state.stend, null, 2));
      broadcast({ type: 'stend', stend: state.stend });
    }

    if (msg?.check) {
      enqueue({ type: 'check_stend', url: адрес });
      broadcast({ type: 'status', status: state.status, agent: agentAlive(), inFlight: inFlight() });
    }
    const сохранённые = slug ? readTarget(slug)?.creds : readTaktConfig().creds;
    return send(res, 200, { ok: true, stend: адрес, target: slug || null,
                            hasPassword: Boolean(сохранённые?.password) });
  }

  // ── Состояние стенда: проверяется отдельным шагом до всякой съёмки
  if (p === '/api/stend' && req.method === 'POST') {
    if (!authed) return send(res, 401, { error: 'unauthorized' });
    const msg = await body(req);
    // Ключ и подстановки к нему сбрасываются вместе с состоянием: оставшиеся от прошлой
    // проверки, они подставились бы в новую фразу — «ошибка 500» пережила бы саму ошибку.
    Object.assign(state.stend, { key: null, args: null, fromKey: null, fromArgs: null }, msg || {});
    fs.writeFileSync(stendFile, JSON.stringify(state.stend, null, 2));
    logEvent({ type: 'stend', ...state.stend });
    broadcast({ type: 'stend', stend: state.stend });
    return send(res, 200, { ok: true });
  }

  // ── Агент забирает событие (длинный опрос)
  if (p === '/api/poll' && req.method === 'GET') {
    if (!authed) return send(res, 401, { error: 'unauthorized' });
    state.agentSeenAt = Date.now();
    reclaimExpired();
    broadcast({ type: 'status', status: state.status, agent: true, inFlight: inFlight() });

    const ready = state.queue.shift();
    if (ready) { lease(ready); return send(res, 200, ready); }

    const wait = Math.min(Number(url.searchParams.get('timeout') || POLL_MAX_MS), POLL_MAX_MS);
    const poll = {
      resolve: (e) => send(res, 200, e),
      timer: setTimeout(() => {
        const i = state.polls.indexOf(poll);
        if (i !== -1) state.polls.splice(i, 1);
        send(res, 200, { type: 'timeout' });
        broadcast({ type: 'status', status: state.status, agent: agentAlive() });
      }, wait),
    };
    state.polls.push(poll);
    req.on('close', () => {
      clearTimeout(poll.timer);
      const i = state.polls.indexOf(poll);
      if (i !== -1) state.polls.splice(i, 1);
    });
    return;
  }

  // ── Агент подтверждает обработку события
  if (p === '/api/poll' && req.method === 'POST') {
    if (!authed) return send(res, 401, { error: 'unauthorized' });
    const msg = await body(req);
    state.agentSeenAt = Date.now();
    if (msg?.id) state.leased.delete(msg.id);
    if (msg?.notesApplied?.length) {
      const notes = readNotes();
      for (const n of notes) if (msg.notesApplied.includes(n.id)) n.status = 'applied';
      writeNotes(notes);
      broadcast({ type: 'notes', notes });
    }
    logEvent({ type: 'reply', ...msg });
    broadcast({ type: 'status', status: state.status, agent: agentAlive(), inFlight: inFlight() });
    return send(res, 200, { ok: true });
  }

  if (p === '/api/notes') return send(res, 200, readNotes());

  // ── Файлы текущего проекта
  if (p.startsWith('/project/')) {
    const rel = decodeURIComponent(p.slice('/project/'.length));
    const file = inProject(rel);
    if (!file.startsWith(path.join(PROJECTS, currentId))) return send(res, 403, 'forbidden', 'text/plain');
    return serveFile(req, res, file);
  }

  // ── Статика студии
  const file = path.join(DIR, p === '/' ? 'index.html' : decodeURIComponent(p).replace(/^\/+/, ''));
  if (!file.startsWith(DIR)) return send(res, 403, 'forbidden', 'text/plain');
  return serveFile(req, res, file);
});

server.listen(PORT, '127.0.0.1', () => {
  fs.writeFileSync(SERVER_INFO,
    JSON.stringify({ port: PORT, token: state.token, pid: process.pid }, null, 2));
  console.log(JSON.stringify({ ok: true, url: `http://localhost:${PORT}`, token: state.token }));
});

// Страница должна отличать «агент думает» от «агента нет»: без этого человек пишет
// замечания в пустоту и узнаёт об этом через десять минут.
setInterval(() => {
  reclaimExpired();
  broadcast({ type: 'status', status: state.status, agent: agentAlive(), inFlight: inFlight() });
}, 15_000);
