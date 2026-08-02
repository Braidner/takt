/**
 * Сервер студии — единственный владелец данных проекта.
 *
 * Он же самый крупный файл конвейера и до сих пор не был покрыт ничем: всё, что
 * можно было проверить без ввода-вывода, давно вынесено в compose/, а остаток —
 * маршруты, миграция и запись на диск — проверялся только руками.
 *
 * Поэтому здесь настоящий сервер: свой порт, свой каталог данных, живые HTTP-запросы.
 * Мокать нечего — вся суть этого модуля в том, что он делает с файлами.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const PORT = 4200 + Math.floor(process.pid % 300);
const BASE = `http://localhost:${PORT}`;

let home;
let server;
let token;

/** Старый сценарий в проекте: на нём проверяется миграция при первом чтении. */
const SCENARIO = {
  title: 'Тестовый ролик',
  task: 'показать раздел отчётов',
  status: 'ready',
  steps: [
    { label: 'Открываем отчёты', hint: 'раздел «Отчёты»', seconds: 8,
      expect: 'text=Отчёты', actions: [{ goto: 'reports' }, { wait: 3000 }] },
    { label: 'Фильтр по дате', seconds: 6, actions: [{ click: 'button.filter' }] },
  ],
};

const api = async (route, options = {}) => {
  const url = `${BASE}${route}${route.includes('?') ? '&' : '?'}token=${token}`;
  const r = await fetch(url, {
    ...options,
    headers: options.body ? { 'Content-Type': 'application/json' } : undefined,
  });
  return { status: r.status, body: await r.json().catch(() => null) };
};

before(async () => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'takt-server-'));
  const project = path.join(home, 'projects', 'тест');
  fs.mkdirSync(project, { recursive: true });
  fs.writeFileSync(path.join(project, 'project.json'),
                   JSON.stringify({ id: 'тест', title: 'Тестовый ролик' }));
  fs.writeFileSync(path.join(home, 'current.json'), JSON.stringify({ id: 'тест' }));
  fs.writeFileSync(path.join(project, 'scenario.json'), JSON.stringify(SCENARIO));

  server = spawn(process.execPath, [path.join(DIR, '..', 'studio', 'server.mjs')], {
    env: { ...process.env, TAKT_HOME: home, TAKT_PORT: String(PORT) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  // Сервер печатает свой адрес и токен строкой JSON, когда готов принимать запросы.
  token = await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('сервер не поднялся за 15 с')), 15000);
    server.stdout.on('data', (chunk) => {
      const m = String(chunk).match(/"token":"([a-f0-9]+)"/);
      if (m) { clearTimeout(t); resolve(m[1]); }
    });
  });
});

after(() => {
  server?.kill();
  if (home) fs.rmSync(home, { recursive: true, force: true });
});

test('старый сценарий мигрирует в раскадровку при первом чтении', async () => {
  const { body } = await api('/api/storyboard');
  assert.equal(body.title, 'Тестовый ролик');
  assert.equal(body.plans.length, 2);
  // Переход ушёл в экран, пауза стала действием, подпись — титром.
  assert.equal(body.plans[0].screen.route, 'reports');
  assert.equal(body.plans[0].screen.waitFor, 'text=Отчёты');
  assert.deepEqual(body.plans[0].action, { kind: 'hold', seconds: 3 });
  assert.equal(body.plans[0].title.text, 'Открываем отчёты');
  assert.deepEqual(body.plans[1].action, { kind: 'click', selector: 'button.filter' });
});

test('миграция сохраняется на диск и старый файл больше не трогается', async () => {
  const board = path.join(home, 'projects', 'тест', 'storyboard.json');
  assert.ok(fs.existsSync(board), 'раскадровка записана рядом со сценарием');
  const before = fs.readFileSync(path.join(home, 'projects', 'тест', 'scenario.json'), 'utf8');
  await api('/api/storyboard');
  assert.equal(fs.readFileSync(path.join(home, 'projects', 'тест', 'scenario.json'), 'utf8'),
               before, 'старый сценарий остаётся как был');
});

test('раскадровка нормализуется при записи, а не принимается на веру', async () => {
  const { body: before } = await api('/api/storyboard');
  const кривая = {
    ...before,
    plans: before.plans.map((p) => ({ ...p, n: 99, at: 1000, duration: undefined })),
  };
  const { body } = await api('/api/storyboard', { method: 'POST', body: JSON.stringify(кривая) });
  assert.equal(body.ok, true);

  const { body: after } = await api('/api/storyboard');
  assert.deepEqual(after.plans.map((p) => p.n), [1, 2]);
  // Первый план начинается после обложки, а не там, где было написано в запросе.
  assert.ok(after.plans[0].at > 0 && after.plans[0].at < 5, `at=${after.plans[0].at}`);
  assert.equal(after.plans[0].duration.source, 'derived');
});

test('раскадровка без планов отвергается', async () => {
  const { status, body } = await api('/api/storyboard',
    { method: 'POST', body: JSON.stringify({ title: 'пусто' }) });
  assert.equal(status, 400);
  assert.equal(body.error, 'no_plans');
});

test('задача словами сохраняется отдельным файлом — это первая ступень', async () => {
  const prompt = path.join(home, 'projects', 'тест', 'prompt.txt');
  assert.ok(fs.existsSync(prompt));
  assert.match(fs.readFileSync(prompt, 'utf8'), /раздел отчётов/);
});

test('ступени выводятся из файлов, а утверждение хранится', async () => {
  const { body: до } = await api('/api/pipeline');
  const по = (id) => до.stages.find((s) => s.id === id);
  assert.equal(по('prompt').state, 'draft');
  assert.equal(по('recon').state, 'missing', 'разведки нет — и ступень это говорит');
  assert.equal(по('storyboard').state, 'draft');

  await api('/api/approve', { method: 'POST', body: JSON.stringify({ stage: 'storyboard' }) });
  const { body: после } = await api('/api/pipeline');
  assert.equal(после.stages.find((s) => s.id === 'storyboard').state, 'ready');

  // Утверждение раскадровки — то же самое, что «Снимать»: иначе съёмка стартовала бы
  // по неутверждённому.
  const { body: sb } = await api('/api/storyboard');
  assert.equal(sb.status, 'ready');
});

test('утверждение снимается тем же маршрутом', async () => {
  await api('/api/approve',
            { method: 'POST', body: JSON.stringify({ stage: 'storyboard', approved: false }) });
  const { body } = await api('/api/pipeline');
  assert.equal(body.stages.find((s) => s.id === 'storyboard').state, 'draft');
  const { body: sb } = await api('/api/storyboard');
  assert.equal(sb.status, 'draft');
});

test('неизвестная ступень отвергается', async () => {
  const { status } = await api('/api/approve',
    { method: 'POST', body: JSON.stringify({ stage: 'её-нет' }) });
  assert.equal(status, 400);
});

test('замечание сохраняет адрес: по нему видно, что переделывать', async () => {
  const { body: sb } = await api('/api/storyboard');
  const план = sb.plans[0].id;
  await api('/api/event', { method: 'POST', body: JSON.stringify({
    type: 'note', t: 4.2, text: 'долго висит пустой экран', plan: план,
  }) });

  const r = await fetch(`${BASE}/api/notes`);
  const notes = await r.json();
  assert.equal(notes.length, 1);
  assert.equal(notes[0].plan, план);
  assert.equal(notes[0].status, 'open');
});

test('план работ относит адресное замечание к перегенерации, а не к пересъёмке', async () => {
  const r = await fetch(`${BASE}/api/plan`);
  const plan = await r.json();
  assert.equal(plan.needsShooting, false);
  assert.equal(plan.items[0].kind, 'direct');
});

test('состояние плана пишется по идентификатору, а не по позиции', async () => {
  const { body: sb } = await api('/api/storyboard');
  const второй = sb.plans[1].id;
  await api('/api/step', { method: 'POST', body: JSON.stringify({
    plan: второй, state: 'failed', error: 'не нашёл кнопку', fix: 'разведать заново',
  }) });

  const { body: после } = await api('/api/storyboard');
  assert.equal(после.plans[1].state, 'failed');
  assert.equal(после.plans[1].error, 'не нашёл кнопку');
  assert.equal(после.plans[0].state, 'pending', 'соседний план не тронут');
});

test('запись без токена отвергается, чтение раскадровки — нет', async () => {
  const r = await fetch(`${BASE}/api/storyboard`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ plans: [] }),
  });
  assert.equal(r.status, 401);
  assert.equal((await fetch(`${BASE}/api/storyboard`)).status, 200);
});
