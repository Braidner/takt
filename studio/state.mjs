/**
 * Что сейчас с проектом.
 *
 * Ответ на первый вопрос агента в начале работы: где мы. Список команд он читает
 * один раз и дальше помнит; чего он не знает никогда — какой проект открыт, докуда
 * дошёл конвейер, ждёт ли человек ответа и не устарел ли снятый материал.
 *
 * Живые данные, а не справка: это и есть смысл пустого вызова. Всё, что здесь
 * печатается, читается с диска — студия для этого поднимать не нужно.
 */
import fs from 'node:fs';
import path from 'node:path';
import { HOME, SERVER_INFO } from './home.mjs';
import { pipelineState } from './compose/pipeline.mjs';
import { normalizeStoryboard } from './compose/storyboard.mjs';
import { ok } from './lib/out.mjs';

const PROJECTS = path.join(HOME, 'projects');
const читать = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } };

export async function state() {
  const проектов = fs.existsSync(PROJECTS)
    ? fs.readdirSync(PROJECTS).filter((d) => fs.existsSync(path.join(PROJECTS, d, 'project.json')))
    : [];
  const id = читать(path.join(HOME, 'current.json'))?.id || null;

  // Пустой дом — законное состояние, а не сбой: так выглядит первый запуск.
  if (!id || !проектов.includes(id)) {
    return ok({ home: HOME, projects: проектов.length, project: null },
              ['поднять студию и начать: takt start']);
  }

  const dir = path.join(PROJECTS, id);
  const файлы = Object.fromEntries(fs.readdirSync(dir).map((f) => {
    try { return [f, fs.statSync(path.join(dir, f)).mtimeMs]; } catch { return [f, 0]; }
  }));
  /* Утверждения лежат в project.json, а не отдельным файлом: там же, где их пишет
     студия. Читать их «где логичнее» значит показывать черновиком то, что человек
     уже утвердил. */
  const проект = читать(path.join(dir, 'project.json')) || {};
  const шаги = pipelineState({ files: файлы, approved: проект.approved || [], gates: проект.gates });

  const raw = читать(path.join(dir, 'storyboard.json'));
  const board = raw ? normalizeStoryboard(raw, читать(path.join(dir, 'states.json'))?.states || []) : null;
  const notes = (читать(path.join(dir, 'notes.json')) || []).filter((n) => n.status === 'open');

  const студия = fs.existsSync(SERVER_INFO) ? читать(SERVER_INFO) : null;

  /* Подсказка — та, что отвечает на «а что теперь». Порядок важен: открытое
     замечание срочнее устаревшей ступени, а неутверждённая раскадровка — срочнее
     того и другого, потому что без неё съёмка всё равно не пойдёт. */
  const help = [];
  if (!студия) help.push('поднять студию: takt serve');
  if (notes.length) help.push('разобрать замечания: takt poll --plan');
  else if (board && board.status !== 'ready') help.push('человек утверждает раскадровку в студии; ждать: takt poll');
  else if (шаги.find((s) => s.id === 'states')?.state === 'missing') help.push('снять по раскадровке: takt shoot');
  else if (шаги.find((s) => s.id === 'movie')?.stale) help.push('пересобрать ролик: takt build');
  else help.push('ждать задачу от человека: takt poll');

  ok({
    project: id,
    projects: проектов.length,
    studio: студия ? `http://localhost:${студия.port}` : null,
    plans: board?.plans.length ?? 0,
    seconds: board?.seconds ?? 0,
    status: board?.status ?? 'нет раскадровки',
    notesOpen: notes.length,
    stages: шаги.map((s) => ({ id: s.id, state: s.state, stale: Boolean(s.stale) })),
  }, help);
}
