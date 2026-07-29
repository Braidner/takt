/**
 * Цель съёмки — система, про которую снимают ролики.
 *
 * Это средний уровень между кодом и роликом, и он появился не из любви к структуре.
 * Ролик — это один сюжет, а вот знание о системе переживает десятки роликов: где вход,
 * как называются разделы, по каким признакам видно, что экран догрузился, что в этом
 * интерфейсе трогать нельзя. Пока такого уровня не было, знание жило в голове того, кто
 * снимал, и разведка повторялась при каждом новом ролике по тому же сайту.
 *
 * Два файла, потому что у знания две природы:
 *
 *   * target.json — машинное: адрес, вход, селекторы. Его читают скрипты;
 *   * target.md   — человеческое: заметки прозой. «Кнопки Стоп у контейнеров не нажимать,
 *                   это живой Proxmox» в схему не уложить, а знать обязательно. Это читает
 *                   агент перед работой.
 *
 * Заметки дописывает агент по ходу дела, а не человек когда-нибудь потом. Агент скилла
 * просыпается с пустым контекстом: не записал — значит не было. Разведал селектор, набил
 * шишку на таймауте, выяснил, что раздел грузится пять секунд — записал сразу.
 */
import fs from 'node:fs';
import path from 'node:path';
import { TARGETS, HOME, PROJECTS } from './home.mjs';

export const slugifyTarget = (name) => String(name).trim().toLowerCase()
  .replace(/[^a-zа-яё0-9]+/gi, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'target';

const dirOf = (slug) => path.join(TARGETS, slug);
const jsonOf = (slug) => path.join(dirOf(slug), 'target.json');
const notesOf = (slug) => path.join(dirOf(slug), 'target.md');

export function listTargets() {
  try {
    return fs.readdirSync(TARGETS)
      .filter((d) => fs.existsSync(jsonOf(d)))
      .map((d) => ({ slug: d, ...JSON.parse(fs.readFileSync(jsonOf(d), 'utf8')) }));
  } catch {
    return [];
  }
}

export function readTarget(slug) {
  if (!slug) return null;
  try {
    return { slug, ...JSON.parse(fs.readFileSync(jsonOf(slug), 'utf8')) };
  } catch {
    return null;
  }
}

export function writeTarget(slug, patch) {
  fs.mkdirSync(dirOf(slug), { recursive: true });
  const current = readTarget(slug) || {};
  const next = { ...current, ...patch, slug: undefined, updatedAt: new Date().toISOString() };
  delete next.slug;
  fs.writeFileSync(jsonOf(slug), JSON.stringify(next, null, 2) + '\n');
  return { slug, ...next };
}

export function readNotes(slug) {
  try { return fs.readFileSync(notesOf(slug), 'utf8'); } catch { return ''; }
}

/**
 * Дописать заметку о цели. Дата ставится сама: заметка без даты через полгода
 * неотличима от заметки, которая уже устарела вместе с интерфейсом.
 */
export function appendNote(slug, text) {
  if (!text?.trim()) return;
  fs.mkdirSync(dirOf(slug), { recursive: true });
  const head = fs.existsSync(notesOf(slug))
    ? ''
    : `# ${slug}\n\nЗаметки о съёмке этой системы. Пишет агент по ходу работы.\n`;
  const day = new Date().toISOString().slice(0, 10);
  fs.appendFileSync(notesOf(slug), `${head}\n- ${day} — ${text.trim()}\n`);
}

/**
 * Запомнить разведанный селектор. Разведка — самая дорогая часть подготовки: один прогон
 * по чужому интерфейсу занимает минуты, и повторять его ради того, что уже выяснено,
 * незачем.
 */
export function rememberSelector(slug, name, selector) {
  const t = readTarget(slug) || {};
  writeTarget(slug, { selectors: { ...(t.selectors || {}), [name]: selector } });
}

/**
 * takt target            что известно про цель текущего ролика
 * takt target <slug>     то же про конкретную цель
 *
 * Отдельной командой, потому что это первое, что делает агент, проснувшись: читает, что
 * уже выяснено про систему. Без неё пришлось бы лезть во внутренние модули — а инструкция
 * агента не должна знать раскладку файлов.
 */
if (import.meta.url === `file://${process.argv[1]}`) {
  // Текущий проект читаем сами, а не через project.mjs: тот импортирует этот модуль, и
  // обращение назад замкнуло бы круг — запуск повисал бы на неразрешённом импорте.
  const текущаяЦель = () => {
    try {
      const { id } = JSON.parse(fs.readFileSync(path.join(HOME, 'current.json'), 'utf8'));
      const project = JSON.parse(fs.readFileSync(path.join(PROJECTS, id, 'project.json'), 'utf8'));
      return readTarget(project.target);
    } catch {
      return null;
    }
  };

  const slug = process.argv[2];
  const target = slug ? readTarget(slug) : текущаяЦель();

  if (!target) {
    console.error(slug
      ? `Цели «${slug}» нет. Заведённые: ${listTargets().map((t) => t.slug).join(', ') || 'ни одной'}`
      : 'У текущего ролика цель не указана. Список: '
        + (listTargets().map((t) => t.slug).join(', ') || 'целей ещё нет'));
    process.exit(1);
  }

  // Пароль не печатаем даже здесь: вывод команды попадает в транскрипт агента, оттуда в
  // логи и в пересказы. Знать нужно лишь то, что вход настроен.
  const { creds, ...видимое } = target;
  console.log(JSON.stringify({ ...видимое, hasPassword: Boolean(creds?.password),
                               user: creds?.user || null }, null, 1));
  const notes = readNotes(target.slug);
  if (notes) console.log('\n' + notes.trim());
}
