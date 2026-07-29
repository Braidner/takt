/**
 * Где лежит состояние текущего проекта.
 *
 * Скрипты съёмки, сборки и озвучки не хранят пути у себя: текущий проект переключается
 * из студии, и любой зашитый путь означал бы, что съёмка пишет в один проект, а сборка
 * читает из другого. Единственный источник правды — сервер.
 *
 * Сам каталог данных выбирает home.mjs: код скилла и работа человека лежат в разных
 * местах и переживают друг друга по отдельности.
 */
import fs from 'node:fs';
import path from 'node:path';
import { HOME, PROJECTS, VOICES, SERVER_INFO } from './home.mjs';
import { readTarget } from './target.mjs';

export const ROOT = HOME;
export { VOICES };

export function serverInfo() {
  return JSON.parse(fs.readFileSync(SERVER_INFO, 'utf8'));
}

/** Идентификатор текущего проекта. Читаем файл, а не спрашиваем сервер: скрипты
 *  запускаются и когда сервер занят длинным опросом. */
export function currentProject() {
  try {
    return JSON.parse(fs.readFileSync(path.join(HOME, 'current.json'), 'utf8')).id;
  } catch {
    return null;
  }
}

/** Путь внутри текущего проекта. */
export function inProject(...parts) {
  const id = currentProject();
  if (!id) throw new Error('Проект не выбран: запустите студию (node studio/server.mjs)');
  const dir = path.join(PROJECTS, id, ...parts);
  fs.mkdirSync(path.dirname(dir), { recursive: true });
  return dir;
}

/** Описание проекта — из него узнаётся, про какую систему этот ролик. */
export function projectInfo() {
  try {
    return JSON.parse(fs.readFileSync(path.join(PROJECTS, currentProject(), 'project.json'), 'utf8'));
  } catch {
    return null;
  }
}

/**
 * Цель текущего проекта. Именно здесь смыкаются два уровня: ролик знает, про какую
 * систему он снят, а всё знание о системе — адрес, вход, селекторы — лежит в цели и
 * переиспользуется всеми роликами про неё.
 */
export function currentTarget() {
  return readTarget(projectInfo()?.target);
}
