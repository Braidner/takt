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
import { ok, usage } from './lib/out.mjs';
import { draftPayload } from './compose/storyboard.mjs';

const info = JSON.parse(fs.readFileSync(SERVER_INFO, 'utf8'));
const base = `http://localhost:${info.port}`;

if (process.argv[2] === '--show') {
  const r = await fetch(`${base}/api/storyboard`);
  ok(await r.json(), ['посмотреть план работ по замечаниям: takt poll']);
  process.exit(0);
}

const file = process.argv[2];
if (!file) {
  usage('укажите файл раскадровки', ['takt storyboard <файл.json>']);
  process.exit(2);
}

const draft = JSON.parse(fs.readFileSync(file, 'utf8'));
const payload = draftPayload(draft, { ready: process.argv.includes('--ready') });

const r = await fetch(`${base}/api/storyboard?token=${info.token}`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(payload),
});
const answer = await r.json();

const mmss = (x) => `${Math.floor(x / 60)}:${String(Math.round(x % 60)).padStart(2, '0')}`;
ok(answer, answer.issues?.length
     ? ['раскадровка принята с замечаниями — поправить и отправить снова']
     : ['человек утверждает её в студии и нажимает «Снимать»', 'ждать этого: takt poll']);
console.log(`${payload.status === 'ready' ? 'Утверждена' : 'Черновик'}: `
  + `${payload.plans.length} планов, ${mmss(answer.seconds || 0)}`);
// Замечания печатаются сразу: длинный план надо разбить надвое, и узнать об этом
// лучше здесь, а не после прогона съёмки.
for (const i of answer.issues || []) console.error(`  · ${i.text}`);
