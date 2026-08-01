/**
 * Выгрузка проекта: ролик и всё, что нужно для его понимания и переделки.
 *
 *   node studio/export.mjs             в exports/<проект>/
 *   node studio/export.mjs ~/Desktop   в указанный каталог
 *
 * Кладём не только видео. Ролик без сценария и дикторского текста нельзя ни проверить,
 * ни повторить: через месяц никто не вспомнит, что именно там показывали и почему в
 * таком порядке. Поэтому рядом с mp4 едут читаемые файлы, а не служебный JSON.
 *
 * Сырые дубли НЕ выгружаются: их вес — сотни мегабайт, а ценность после сборки нулевая.
 * Они остаются в проекте, если понадобится пересобрать.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { currentProject, inProject, ROOT } from './project.mjs';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const id = currentProject();
if (!id) { console.error('Проект не выбран'); process.exit(1); }

const read = (name) => {
  try { return JSON.parse(fs.readFileSync(inProject(name), 'utf8')); } catch { return null; }
};

const project = read('project.json') || { id, title: id };
const scenario = read('scenario.json');
const narration = read('narration.json');
const notes = read('notes.json') || [];
const movie = read('movie.json');

const dest = path.join(process.argv[2] || path.join(DIR, '..', 'exports'), id);
fs.mkdirSync(dest, { recursive: true });

const mmss = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
const copied = [];

/**
 * Версии ролика по убыванию готовности: смонтированный с озвучкой лучше просто
 * смонтированного, тот лучше мастера. Первый найденный становится «роликом», а
 * короткие версии едут отдельными файлами — они не замена, а другой жанр.
 */
for (const [src, as] of [['movie-cut.mp4', 'ролик.mp4'],
                         ['movie-vo.mp4', 'ролик.mp4'],
                         ['movie.mp4', 'ролик.mp4']]) {
  const from = inProject(src);
  if (fs.existsSync(from) && !copied.includes('ролик.mp4')) {
    fs.copyFileSync(from, path.join(dest, as));
    copied.push(as);
  }
}
for (const [src, as] of [['movie-short.mp4', 'хайлайты.mp4'],
                         ['movie-short-vertical.mp4', 'хайлайты-вертикальные.mp4']]) {
  const from = inProject(src);
  if (fs.existsSync(from)) { fs.copyFileSync(from, path.join(dest, as)); copied.push(as); }
}

if (scenario?.steps?.length) {
  const lines = [`# ${project.title}`, '', '## Сценарий', ''];
  for (const s of scenario.steps) {
    lines.push(`**${mmss(s.at)}** — ${s.label}`);
    if (s.hint) lines.push(`  ${s.hint}`);
    if (s.diagram) lines.push(`  врезка-схема: ${s.diagram}`);
    lines.push('');
  }
  fs.writeFileSync(path.join(dest, 'сценарий.md'), lines.join('\n'));
  copied.push('сценарий.md');
}

if (narration?.lines?.length) {
  const lines = ['# Дикторский текст', ''];
  for (const l of narration.lines) {
    lines.push(`**${mmss(l.at)}**  ${l.text}`);
    lines.push('');
  }
  fs.writeFileSync(path.join(dest, 'дикторский-текст.md'), lines.join('\n'));
  copied.push('дикторский-текст.md');
}

if (notes.length) {
  const lines = ['# Замечания', ''];
  for (const n of notes) {
    lines.push(`- **${mmss(n.t)}** ${n.text}${n.status === 'applied' ? ' _(применено)_' : ''}`);
  }
  fs.writeFileSync(path.join(dest, 'замечания.md'), lines.join('\n') + '\n');
  copied.push('замечания.md');
}

// Телеметрия — единственный служебный файл в выгрузке: без неё ролик не пересобрать,
// а весит она килобайты.
const timeline = inProject('timeline.json');
if (fs.existsSync(timeline)) {
  fs.copyFileSync(timeline, path.join(dest, 'timeline.json'));
  copied.push('timeline.json');
}

const size = copied.reduce((sum, f) => sum + fs.statSync(path.join(dest, f)).size, 0);
console.log(JSON.stringify({
  ok: true, dest, files: copied,
  duration: movie?.duration ? mmss(movie.duration) : null,
  megabytes: Math.round(size / 1024 / 1024 * 10) / 10,
}, null, 1));
