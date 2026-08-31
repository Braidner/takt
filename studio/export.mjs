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
import { currentProject, inProject } from './project.mjs';
import { ok, fail } from './lib/out.mjs';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const id = currentProject();
if (!id) { fail('no_project', 'проект не выбран', { help: ['список проектов в студии: takt serve'] }); process.exit(1); }

const read = (name) => {
  try { return JSON.parse(fs.readFileSync(inProject(name), 'utf8')); } catch { return null; }
};

const project = read('project.json') || { id, title: id };
const storyboard = read('storyboard.json');
const narration = read('narration.json');
const notes = read('notes.json') || [];
const movie = read('movie.json');

const dest = path.join(process.argv[2] || path.join(DIR, '..', 'exports'), id);
fs.mkdirSync(dest, { recursive: true });

const mmss = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
const copied = [];

/**
 * Версии ролика по убыванию готовности: с озвучкой лучше немого. Первый найденный
 * становится «роликом», а хайлайты едут отдельным файлом — они не замена, а
 * другой жанр.
 */
for (const [src, as] of [['movie-vo.mp4', 'ролик.mp4'],
                         ['movie.mp4', 'ролик.mp4']]) {
  const from = inProject(src);
  if (fs.existsSync(from) && !copied.includes('ролик.mp4')) {
    fs.copyFileSync(from, path.join(dest, as));
    copied.push(as);
  }
}
for (const [src, as] of [['movie-short.mp4', 'хайлайты.mp4']]) {
  const from = inProject(src);
  if (fs.existsSync(from)) { fs.copyFileSync(from, path.join(dest, as)); copied.push(as); }
}

if (storyboard?.plans?.length) {
  const lines = [`# ${project.title}`, '', '## Раскадровка', ''];
  for (const p of storyboard.plans) {
    lines.push(`**${mmss(p.at)}** — ${p.title?.text || ''}`);
    if (p.intent) lines.push(`  ${p.intent}`);
    lines.push('');
  }
  fs.writeFileSync(path.join(dest, 'раскадровка.md'), lines.join('\n'));
  copied.push('раскадровка.md');
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

// Раскадровка — единственный служебный файл в выгрузке: по ней ролик пересобирается
// целиком, а весит она килобайты.
const board = inProject('storyboard.json');
if (fs.existsSync(board)) {
  fs.copyFileSync(board, path.join(dest, 'storyboard.json'));
  copied.push('storyboard.json');
}

const size = copied.reduce((sum, f) => sum + fs.statSync(path.join(dest, f)).size, 0);
ok({
  ok: true, dest, files: copied,
  duration: movie?.duration ? mmss(movie.duration) : null,
  megabytes: Math.round(size / 1024 / 1024 * 10) / 10,
});
