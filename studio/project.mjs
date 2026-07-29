/**
 * Где лежит состояние текущего проекта.
 *
 * Скрипты съёмки, сборки и озвучки не хранят пути у себя: текущий проект переключается
 * из студии, и любой зашитый путь означал бы, что съёмка пишет в один проект, а сборка
 * читает из другого. Единственный источник правды — сервер.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.join(DIR, 'journal');
export const VOICES = path.join(ROOT, 'voices');   // голоса общие для всех проектов

export function serverInfo() {
  return JSON.parse(fs.readFileSync(path.join(ROOT, 'server.json'), 'utf8'));
}

/** Идентификатор текущего проекта. Читаем файл, а не спрашиваем сервер: скрипты
 *  запускаются и когда сервер занят длинным опросом. */
export function currentProject() {
  try {
    return JSON.parse(fs.readFileSync(path.join(ROOT, 'current.json'), 'utf8')).id;
  } catch {
    return null;
  }
}

/** Путь внутри текущего проекта. */
export function inProject(...parts) {
  const id = currentProject();
  if (!id) throw new Error('Проект не выбран: запустите студию (node studio/server.mjs)');
  const dir = path.join(ROOT, 'projects', id, ...parts);
  fs.mkdirSync(path.dirname(dir), { recursive: true });
  return dir;
}
