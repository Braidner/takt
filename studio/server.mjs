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

const DIR = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.TAKT_PORT || 4173);

// Ограничение не наше: fetch в Node рвёт запрос по таймауту заголовков на 300 с и
// понизить его для одного запроса нельзя. Держим запрос ниже потолка, а длинное
// ожидание собираем из таких отрезков на стороне клиента.
const POLL_MAX_MS = 270_000;
const LEASE_MS = 600_000;
const HEARTBEAT_MS = 30_000;

const state = {
  token: crypto.randomBytes(16).toString('hex'),
  queue: [],            // события, ждущие агента
  leased: new Map(),    // id → { event, until }
  polls: [],            // висящие запросы агента
  sse: new Set(),        // подписанные страницы
  agentSeenAt: 0,
  lastFrame: null,       // последний кадр живого экрана
  status: { state: 'offline', text: 'Агент не подключён', step: null, of: null },
  // Стенд — вторая сущность состояния рядом с агентом: агент может быть на связи, а
  // стенд недоступен, и это разные поломки с разным лечением.
  stend: { url: null, state: 'unknown', text: 'Стенд не проверен', from: null },
  // Остановка не может быть событием в общей очереди: съёмка идёт минуты и всё это
  // время не опрашивает очередь. Это флаг, который процесс съёмки читает между шагами.
  stopRequested: false,
};

try {
  Object.assign(state.stend, JSON.parse(fs.readFileSync(path.join(DIR, 'journal', 'stend.json'), 'utf8')));
} catch { /* первого запуска ещё не было */ }

/**
 * Каталог голосов лежит рядом с журналом, а не в репозитории: это записи голосов живых
 * людей, и расходиться со всеми клонами проекта они не должны.
 */
const VOICES = path.join(DIR, 'journal', 'voices');
fs.mkdirSync(VOICES, { recursive: true });

const readVoices = () => {
  try {
    return fs.readdirSync(VOICES)
      .filter((f) => f.endsWith('.json'))
      .map((f) => JSON.parse(fs.readFileSync(path.join(VOICES, f), 'utf8')))
      .sort((a, b) => (b.addedAt || '').localeCompare(a.addedAt || ''));
  } catch { return []; }
};

const narrationFile = path.join(DIR, 'journal', 'narration.json');
const readNarration = () => {
  try { return JSON.parse(fs.readFileSync(narrationFile, 'utf8')); } catch { return null; }
};

const movieFile = path.join(DIR, 'journal', 'movie.json');
const readMovie = () => {
  try { return JSON.parse(fs.readFileSync(movieFile, 'utf8')); } catch { return null; }
};

const stendFile = path.join(DIR, 'journal', 'stend.json');
const scenarioFile = path.join(DIR, 'journal', 'scenario.json');
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
  try { return JSON.parse(fs.readFileSync(scenarioFile, 'utf8')); } catch { return null; }
};
const writeScenario = (s) => fs.writeFileSync(scenarioFile, JSON.stringify(s, null, 2));

const JOURNAL = path.join(DIR, 'journal');
fs.mkdirSync(JOURNAL, { recursive: true });
const notesFile = path.join(JOURNAL, 'notes.json');
const eventsFile = path.join(JOURNAL, 'events.jsonl');

const readNotes = () => {
  try { return JSON.parse(fs.readFileSync(notesFile, 'utf8')); } catch { return []; }
};
const writeNotes = (notes) => fs.writeFileSync(notesFile, JSON.stringify(notes, null, 2));
const logEvent = (e) =>
  fs.appendFileSync(eventsFile, JSON.stringify({ ...e, at: new Date().toISOString() }) + '\n');

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
  Object.assign(state.status, patch);
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

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const p = url.pathname;
  const token = url.searchParams.get('token') || req.headers['x-takt-token'];
  const authed = token === state.token;

  // ── Страница узнаёт свой токен из этого маршрута: он открыт, но отдаёт токен только
  // локальному запросу — сервер и так слушает только петлевой интерфейс.
  if (p === '/api/hello') {
    return send(res, 200, { token: state.token, status: state.status, agent: agentAlive(),
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
    fs.writeFileSync(narrationFile, JSON.stringify(narration, null, 2));
    broadcast({ type: 'narration', narration });
    return send(res, 200, { ok: true });
  }

  if (p === '/api/narration' && req.method === 'GET') return send(res, 200, readNarration());

  // ── Голос: запись из браузера или загруженный файл
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

  // ── План работ по накопленным замечаниям: что и сколько займёт
  if (p === '/api/plan') {
    const plan = planFor(readNotes());
    return send(res, 200, plan);
  }

  // ── Готовый ролик
  if (p === '/api/movie' && req.method === 'POST') {
    if (!authed) return send(res, 401, { error: 'unauthorized' });
    const msg = await body(req);
    fs.writeFileSync(movieFile, JSON.stringify(msg, null, 2));
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

  // ── Состояние стенда: проверяется отдельным шагом до всякой съёмки
  if (p === '/api/stend' && req.method === 'POST') {
    if (!authed) return send(res, 401, { error: 'unauthorized' });
    const msg = await body(req);
    Object.assign(state.stend, msg || {});
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

  // ── Статика студии
  const file = path.join(DIR, p === '/' ? 'index.html' : decodeURIComponent(p).replace(/^\/+/, ''));
  if (!file.startsWith(DIR)) return send(res, 403, 'forbidden', 'text/plain');

  const type = MIME[path.extname(file)] || 'application/octet-stream';
  if (path.extname(file) === '.mp4') {
    // Range-запросы обязательны для перемотки: без них браузер качает файл целиком
    // при каждом прыжке по таймкоду и не даёт мотать до полной загрузки.
    fs.stat(file, (err, st) => {
      if (err) return send(res, 404, 'not found', 'text/plain');
      const range = req.headers.range;
      if (!range) {
        res.writeHead(200, { 'Content-Type': type, 'Content-Length': st.size,
                             'Accept-Ranges': 'bytes' });
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
    return;
  }

  fs.readFile(file, (err, data) => {
    if (err) return send(res, 404, 'not found', 'text/plain');
    res.writeHead(200, { 'Content-Type': type });
    res.end(data);
  });
});

server.listen(PORT, '127.0.0.1', () => {
  fs.writeFileSync(path.join(JOURNAL, 'server.json'),
    JSON.stringify({ port: PORT, token: state.token, pid: process.pid }, null, 2));
  console.log(JSON.stringify({ ok: true, url: `http://localhost:${PORT}`, token: state.token }));
});

// Страница должна отличать «агент думает» от «агента нет»: без этого человек пишет
// замечания в пустоту и узнаёт об этом через десять минут.
setInterval(() => {
  reclaimExpired();
  broadcast({ type: 'status', status: state.status, agent: agentAlive(), inFlight: inFlight() });
}, 15_000);
