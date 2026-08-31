/**
 * Справочники агенту — командой, а не файлами рядом со скиллом.
 *
 * Инструкция, которая живёт отдельно от кода, устаревает молча: в ревизии этого
 * проекта в справочниках набралось девять ложных утверждений — титры «не
 * выжигаются» (выжигаются), сборка «обрезает вход» (не обрезает), советовалось
 * поле, которого нет. Заметил их человек на готовом ролике, а не агент.
 *
 * Отдавая справочники командой, мы получаем одно: установленная копия скилла
 * ничего не знает и потому не может отстать. Она отправляет за инструкцией сюда,
 * а здесь она ровно та, что лежит рядом с кодом.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ok, usage } from './lib/out.mjs';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const REF = path.join(DIR, '..', 'references');

/** Порядок — рабочий: сначала куда снимаем, потом что, потом как показать. */
const PLAYBOOKS = [
  { id: 'targets', file: 'targets.md', use: 'куда снимаем: адрес, вход, разведанные селекторы' },
  { id: 'storyboard', file: 'storyboard.md', use: 'из задачи словами — в планы съёмки' },
  { id: 'shooting', file: 'shooting.md', use: 'съёмка состояний браузером' },
  { id: 'editing', file: 'editing.md', use: 'монтаж: камера, склейки, титры, карточки, вставки' },
  { id: 'inserts', file: 'inserts.md', use: 'своя графика в кадре: схемы, диаграммы, плашки' },
  { id: 'voice', file: 'voice.md', use: 'дикторский текст и клонированный голос' },
  { id: 'notes', file: 'notes.md', use: 'замечания человека и план работ по ним' },
];

const [, , id] = process.argv;

if (!id) {
  // Без аргумента — список: это оглавление, а не отказ, поэтому код возврата ноль.
  ok({ playbooks: PLAYBOOKS.map(({ id: i, use }) => ({ id: i, use })) },
     ['открыть нужный: takt playbook <id>']);
  process.exit(0);
}

const entry = PLAYBOOKS.find((p) => p.id === id);
if (!entry) {
  usage(`нет справочника «${id}»`, ['список: takt playbook']);
  process.exit(2);
}

const file = path.join(REF, entry.file);
if (!fs.existsSync(file)) {
  usage(`справочник «${id}» описан, а файла ${entry.file} нет`, ['проверить установку: takt doctor']);
  process.exit(2);
}

// Сам текст — как есть: это markdown для чтения, оборачивать его в поля значило бы
// платить токенами за структуру, которой в тексте и так нет.
console.log(fs.readFileSync(file, 'utf8').trim());
