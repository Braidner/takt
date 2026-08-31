/**
 * Клиент протокола для агента.
 *
 *   node studio/poll.mjs                      ждать событие (запускать фоновой задачей)
 *   node studio/poll.mjs --reply <id> done    подтвердить обработку
 *   node studio/poll.mjs --status busy "Снимаю сцену 2 из 5" --step 2 --of 5
 *   node studio/poll.mjs --status listening
 *
 * Почему длинный опрос, а не цикл проверок: агент не сервер и не может держать
 * обработчик, но одно висящее соединение даёт тот же эффект — оно разрешается ровно
 * тогда, когда человек что-то сделал, и не тратит ходов на пустые проверки.
 *
 * В Claude Code запускать фоновой задачей: харнесс сам разбудит, когда команда
 * завершится. Блокировать основной разговор не нужно.
 *
 * Ответ `{"type":"timeout"}` — не ошибка: истёк отрезок ожидания, нужно позвать снова.
 * Ожидание собирается из отрезков, потому что fetch в Node рвёт запрос по таймауту
 * заголовков на 300 секунд и понизить его для одного запроса нельзя.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SERVER_INFO } from './home.mjs';
import { ok } from './lib/out.mjs';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const infoPath = SERVER_INFO;

if (!fs.existsSync(infoPath)) {
  console.log('ok: false\nerror: no_studio\ntext: студия не запущена\nhelp[1]: "поднять студию: takt serve"');
  process.exit(1);
}
const { port, token } = JSON.parse(fs.readFileSync(infoPath, 'utf8'));
const base = `http://localhost:${port}`;
const args = process.argv.slice(2);

/** Что делать с событием — прямо в ответе, готовой командой. */
const ПОДСКАЗКИ = {
  task: ['собрать раскадровку и отправить: takt storyboard <файл.json>'],
  shoot: ['снять по утверждённой раскадровке: takt shoot'],
  cut: ['собрать ролик: takt build'],
  short: ['короткая версия: takt highlight'],
  regen: ['пересобрать раскадровку по замечаниям: takt storyboard <файл.json>'],
  retake: ['переснять с указанного плана: takt shoot --from <n>'],
  notes: ['посмотреть план работ: takt poll --plan'],
  narrate: ['синтезировать реплики: takt narrate', 'подмешать в ролик: takt track'],
  timeout: ['ждать дальше: takt poll'],
};

const post = async (route, payload) => {
  const r = await fetch(`${base}${route}?token=${token}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return r.json();
};

if (args[0] === '--reply') {
  const [, id, verdict, ...rest] = args;
  const notesApplied = [];
  const notesIdx = rest.indexOf('--applied');
  if (notesIdx !== -1) {
    // Каждый аргумент дополнительно режем по пробелам и запятым: zsh, в отличие от
    // bash, не разбивает подставленную переменную на слова, и весь список приезжает
    // одной строкой. Сервер тогда сравнивает идентификаторы с этой склейкой и молча
    // ничего не помечает — ошибка тихая, ответ при этом «ок».
    notesApplied.push(...rest.slice(notesIdx + 1)
      .flatMap((x) => String(x).split(/[\s,]+/))
      .filter(Boolean));
  }
  ok(await post('/api/poll', { id, verdict, notesApplied }));
  process.exit(0);
}

if (args[0] === '--status') {
  const stateName = args[1] || 'listening';
  const text = args[2] || (stateName === 'listening' ? 'Слушает' : '');
  const step = args.includes('--step') ? Number(args[args.indexOf('--step') + 1]) : null;
  const of = args.includes('--of') ? Number(args[args.indexOf('--of') + 1]) : null;
  ok(await post('/api/status', { state: stateName, text, step, of }));
  process.exit(0);
}

// Ожидание события. Сообщаем «слушаю» до того, как повиснуть на опросе: иначе индикатор
// в интерфейсе покажет «не подключён» ровно в тот момент, когда агент уже готов.
await post('/api/status', { state: 'listening', text: 'Слушает', step: null, of: null });

const r = await fetch(`${base}/api/poll?token=${token}`);
const event = await r.json();
/* Подсказка зависит от того, что пришло: событие называет работу, и агенту не
   надо помнить, какой командой она делается. */
ok(event, ПОДСКАЗКИ[event.type] || []);
