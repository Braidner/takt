/**
 * Где лежат данные Takt.
 *
 * Код и данные обязаны разъехаться, потому что живут они по-разному. Takt ставится как
 * скилл: каталог с кодом обновляется, переустанавливается, может быть снесён и склонирован
 * заново. А записи голосов, снятые ролики и разведанные цели пережить это должны —
 * восстановить их неоткуда.
 *
 * Порядок поиска отвечает на вопрос «куда писать» так, чтобы ничей уже существующий
 * материал не осиротел:
 *
 *   1. TAKT_HOME — явно указанное человеком место, спорить не с чем;
 *   2. studio/journal рядом с кодом — раскладка первых версий. Если он есть, значит там
 *      лежит чья-то работа, и молча начать писать в другое место означало бы показать
 *      человеку пустую студию вместо его проектов;
 *   3. ~/takt — то, что получают все, кто ставит Takt впервые.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const LEGACY = path.join(DIR, 'journal');

function resolveHome() {
  if (process.env.TAKT_HOME) return { dir: path.resolve(process.env.TAKT_HOME), from: 'TAKT_HOME' };
  if (fs.existsSync(LEGACY)) return { dir: LEGACY, from: 'legacy' };
  return { dir: path.join(os.homedir(), 'takt'), from: 'default' };
}

const resolved = resolveHome();

export const HOME = resolved.dir;
export const HOME_FROM = resolved.from;

export const PROJECTS = path.join(HOME, 'projects');
export const TARGETS = path.join(HOME, 'targets');
export const VOICES = path.join(HOME, 'voices');       // голоса общие для всех роликов
export const SERVER_INFO = path.join(HOME, 'server.json');

/** Путь внутри каталога данных, с созданием родителей: писать сюда — обычное дело. */
export function inHome(...parts) {
  const target = path.join(HOME, ...parts);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  return target;
}

export function ensureHome() {
  for (const dir of [HOME, PROJECTS, TARGETS, VOICES]) fs.mkdirSync(dir, { recursive: true });
  return HOME;
}
