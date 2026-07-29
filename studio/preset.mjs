/**
 * Пресет целевой системы: всё, что знает про конкретное приложение.
 *
 * Ядро студии не должно знать ни адресов, ни учётных данных, ни того, как в вашей
 * системе называются разделы. Иначе инструмент годится ровно для одной системы, а любая
 * попытка снять что-то ещё превращается в правку исходников.
 *
 * Пресет лежит рядом с проектом (takt.preset.json) или задаётся переменной TAKT_PRESET.
 * Файл с настройками вашей системы держите вне публичного репозитория: там адреса
 * внутренних стендов и учётные данные.
 *
 * Формат:
 * {
 *   "name": "Моя система",
 *   "targets": {                       // короткие имена вместо адресов
 *     "local": "http://localhost:8080/",
 *     "dev":   "http://localhost:3000/"
 *   },
 *   "branchUrl": "https://pw-{slug}.preview.example.com/app/",  // {slug} — имя ветки
 *   "credentials": { "user": "admin", "password": "admin" },
 *   "login": {                         // как выглядит форма входа
 *     "password": "input[type=password]:visible",
 *     "user": "input:not([type=password]):visible",
 *     "submit": "Enter"
 *   },
 *   "ready": "#root, #app, main, nav",  // признак загруженного интерфейса
 *   "language": { "key": "lang", "value": "ru" },
 *   "theme": { "key": "AppThemeConfig", "value": "{\"isLightSelected\":false}" }
 * }
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = path.dirname(fileURLToPath(import.meta.url));

/** Пресет по умолчанию: голая система без имени, работает с любым адресом. */
const DEFAULT = {
  name: 'Целевая система',
  targets: {},
  branchUrl: null,
  credentials: { user: 'admin', password: 'admin' },
  login: {
    password: 'input[type="password"]:visible',
    user: 'input:not([type="password"]):visible',
    submit: 'Enter',
  },
  ready: '#root, #app, main, nav, .app',
  language: null,
  theme: null,
};

let cached = null;

/**
 * Пресет с поправкой на цель текущего проекта.
 *
 * Пресет описывает систему по умолчанию — он был единственным способом рассказать студии
 * о приложении, пока роликов было мало и система одна. Цель описывает конкретную систему
 * этого ролика и потому главнее: у неё свой признак готовности и своя форма входа. Разница
 * не косметическая — с чужим селектором готовности вход проходит, а интерфейс считается
 * незагрузившимся, и съёмка встаёт на ровном месте.
 */
export function presetForTarget(target) {
  const base = loadPreset();
  if (!target) return base;
  return {
    ...base,
    name: target.name || base.name,
    ready: target.ready || base.ready,
    login: { ...base.login, ...(target.login || {}) },
    credentials: { ...base.credentials, ...(target.creds || {}) },
    language: target.language ?? base.language,
    theme: target.theme ?? base.theme,
  };
}

export function loadPreset() {
  if (cached) return cached;

  const candidates = [
    process.env.TAKT_PRESET,
    path.join(DIR, 'takt.preset.json'),
    path.join(DIR, '..', 'takt.preset.json'),
  ].filter(Boolean);

  for (const file of candidates) {
    try {
      const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
      // Слияние поверхностное, но по разделам: частичный пресет не должен обнулять
      // умолчания входа и признака готовности, которые он не переопределяет.
      cached = {
        ...DEFAULT, ...raw,
        credentials: { ...DEFAULT.credentials, ...(raw.credentials || {}) },
        login: { ...DEFAULT.login, ...(raw.login || {}) },
      };
      cached.source = file;
      return cached;
    } catch { /* следующий кандидат */ }
  }

  cached = { ...DEFAULT, source: null };
  return cached;
}

/**
 * Slug ветки по правилам GitLab (CI_COMMIT_REF_SLUG): нижний регистр, всё кроме букв и
 * цифр в дефис, обрезка до 63 символов, без дефисов по краям.
 */
export function branchSlug(branch) {
  return String(branch)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 63);
}
