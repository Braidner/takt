/**
 * Передача сценария в студию.
 *
 *   node studio/scenario.mjs draft.json          отправить сценарий (статусом «черновик»)
 *   node studio/scenario.mjs draft.json --ready  отправить утверждённым (съёмка разрешена)
 *   node studio/scenario.mjs --show              показать текущий
 *
 * Формат: { title, task, steps: [{ label, hint, seconds, diagram }] }
 *   label   — подпись для ЗРИТЕЛЯ, она станет титром в кадре («Маршрут на очередь
 *             заказов»), а не заметкой разработчика («проверяем таблицу»);
 *   actions — что делает агент: goto, click, type, press, wait, waitFor;
 *   expect  — селектор, по которому видно, что шаг ДЕЙСТВИТЕЛЬНО показал обещанное.
 *             Без него клик по пункту меню, раскрывающему подменю, считается успехом,
 *             а в кадре остаётся прежний экран;
 *   hint    — что делает агент на этом шаге, видно только в студии;
 *   seconds — ожидаемая длительность, из неё складывается хронометраж;
 *   diagram — идентификатор врезки-схемы, если на этом шаге показывается схема.
 *
 * Тайминги проставляются здесь, а не руками: они складываются из длительностей и должны
 * пересчитываться при каждой правке шага, иначе разъедутся с первым же изменением.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const info = JSON.parse(fs.readFileSync(path.join(DIR, 'journal', 'server.json'), 'utf8'));
const base = `http://localhost:${info.port}`;

if (process.argv[2] === '--show') {
  const r = await fetch(`${base}/api/scenario`);
  console.log(JSON.stringify(await r.json(), null, 1));
  process.exit(0);
}

const file = process.argv[2];
if (!file) {
  console.error('Укажите файл сценария: node studio/scenario.mjs draft.json');
  process.exit(1);
}

const draft = JSON.parse(fs.readFileSync(file, 'utf8'));
const steps = (draft.steps || []).map((s) => ({
  label: s.label, hint: s.hint || null, seconds: s.seconds ?? 8, diagram: s.diagram || null,
  actions: s.actions || null, expect: s.expect || null,
}));

const payload = {
  title: draft.title || 'Демонстрационный ролик',
  task: draft.task || null,
  status: process.argv.includes('--ready') ? 'ready' : 'draft',
  steps,
};

const r = await fetch(`${base}/api/scenario?token=${info.token}`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(payload),
});

const total = steps.reduce((sum, s) => sum + (s.seconds || 8), 0);
const mmss = (x) => `${Math.floor(x / 60)}:${String(Math.round(x % 60)).padStart(2, '0')}`;
console.log(JSON.stringify(await r.json()));
console.log(`${payload.status === 'ready' ? 'Утверждён' : 'Черновик'}: ${steps.length} шагов, ${mmss(total)}`);
