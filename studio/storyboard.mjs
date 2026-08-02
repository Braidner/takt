/**
 * Передача раскадровки в студию.
 *
 *   node studio/storyboard.mjs draft.json          отправить черновиком
 *   node studio/storyboard.mjs draft.json --ready  отправить утверждённой (съёмка разрешена)
 *   node studio/storyboard.mjs --show              показать текущую
 *
 * Раскадровка — массив ПЛАНОВ. План описывает намерение и одно типизированное действие,
 * а не список команд браузеру: из «клик по такому-то селектору» выводится длительность,
 * строится наезд камеры и рисуется курсор, а из `[{press},{wait},{click},{wait}]` —
 * ничего, потому что там не сказано, что содержание, а что подпорка.
 *
 * Длительности и таймкоды здесь не задаются вовсе: их считает сервер по содержанию
 * плана и пересчитывает при каждой правке. Назначить своё можно, но это отдельное
 * осознанное действие человека в студии, а не умолчание, которое никто не выбирал.
 */
import fs from 'node:fs';
import { SERVER_INFO } from './home.mjs';

const info = JSON.parse(fs.readFileSync(SERVER_INFO, 'utf8'));
const base = `http://localhost:${info.port}`;

if (process.argv[2] === '--show') {
  const r = await fetch(`${base}/api/storyboard`);
  console.log(JSON.stringify(await r.json(), null, 1));
  process.exit(0);
}

const file = process.argv[2];
if (!file) {
  console.error('Укажите файл раскадровки: node studio/storyboard.mjs draft.json');
  process.exit(1);
}

const draft = JSON.parse(fs.readFileSync(file, 'utf8'));
const plans = (draft.plans || []).map((p) => ({
  id: p.id || null,
  intent: p.intent || null,
  // Титр приходит строкой или объектом: агенту проще написать строку, а формат
  // хранит стиль рядом с текстом.
  title: typeof p.title === 'string' ? { text: p.title } : (p.title || { text: '' }),
  mode: p.mode === 'live' ? 'live' : 'static',
  screen: { route: p.screen?.route ?? null, waitFor: p.screen?.waitFor || null },
  action: p.action || null,
  // Ручную длительность пропускаем только помеченной: иначе «выведено» и «назначено»
  // не отличить, и первый же пересчёт молча затрёт решение человека.
  duration: p.duration?.source === 'manual' ? p.duration : undefined,
}));

const payload = {
  title: draft.title || 'Демонстрационный ролик',
  task: draft.task || null,
  status: process.argv.includes('--ready') ? 'ready' : 'draft',
  plans,
  effects: (draft.effects || []).filter((e) => e.source === 'manual'),
};

const r = await fetch(`${base}/api/storyboard?token=${info.token}`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(payload),
});
const answer = await r.json();

const mmss = (x) => `${Math.floor(x / 60)}:${String(Math.round(x % 60)).padStart(2, '0')}`;
console.log(JSON.stringify(answer));
console.log(`${payload.status === 'ready' ? 'Утверждена' : 'Черновик'}: `
  + `${plans.length} планов, ${mmss(answer.seconds || 0)}`);
// Замечания печатаются сразу: длинный план надо разбить надвое, и узнать об этом
// лучше здесь, а не после прогона съёмки.
for (const i of answer.issues || []) console.error(`  · ${i.text}`);
