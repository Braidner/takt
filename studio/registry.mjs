/**
 * Реестр устанавливаемых возможностей — единственное место, где сказано, что Takt умеет
 * ставить, сколько это весит и какими шагами.
 *
 * Его читают двое: установщик (install.mjs) выполняет шаги, доктор (doctor.mjs) и панель
 * окружения показывают вес до нажатия кнопки. Разъехаться им нельзя: вес, который панель
 * обещает, обязан быть весом того, что установщик скачает.
 */
import fs from 'node:fs';
import path from 'node:path';
import { VENVS } from './home.mjs';

export const APPLE = process.platform === 'darwin' && process.arch === 'arm64';
export const BIN = process.platform === 'win32' ? 'Scripts' : 'bin';
export const PY = process.platform === 'win32' ? 'python.exe' : 'python3';
// Внутри $TAKT_HOME, а не рядом с кодом: см. комментарий у VENVS в home.mjs.
export const VENV_TTS = path.join(VENVS, 'venv-tts');
export const VENV_CHATTERBOX = path.join(VENVS, 'venv-chatterbox');

/**
 * Шаг — это argv, а не строка шелла: команда с параметрами из реестра не проходит через
 * интерпретатор, и подстановке там взяться неоткуда.
 */
export const REGISTRY = {
  browser: {
    name: 'Браузер для съёмки',
    size: 'загрузка ≈350 МБ',
    steps: () => [
      ['npm', 'install', '--no-audit', '--no-fund'],
      ['npx', 'playwright', 'install', 'chromium'],
    ],
  },
  zoom: {
    name: 'Монтаж с зумом и переходами (Remotion)',
    size: 'загрузка ≈550 МБ',
    note: 'платная лицензия для команд от четырёх человек — remotion.pro',
    steps: () => [
      // Версии берутся из package.json (optionalDependencies), а не отсюда.
      ['npm', 'install', '--include=optional', '--no-audit', '--no-fund'],
    ],
  },
  'voice-qwen': {
    name: 'Озвучка — Qwen3-TTS',
    size: APPLE
      ? 'пакеты ≈700 МБ; при первом синтезе модели ≈3 ГБ (Qwen) и ≈3 ГБ (распознавание)'
      : 'пакеты ≈2.5 ГБ (torch); при первом синтезе модели ≈3 ГБ (Qwen) и ≈3 ГБ (распознавание)',
    python: APPLE ? ['3.14', '3.13', '3.12', '3'] : ['3.12', '3.11', '3.13'],
    venv: VENV_TTS,
    steps: (py) => {
      // pip — через «python -m pip», не через бинарь: шебанги скриптов venv хранят
      // абсолютный путь и ломаются при переносе, а сам python работает откуда угодно.
      const pip = [path.join(VENV_TTS, BIN, PY), '-m', 'pip', 'install', '--quiet'];
      const пакеты = APPLE
        ? ['mlx-audio', 'faster-whisper']
        : ['torch', 'qwen3-tts', 'faster-whisper', 'soundfile'];
      return [
        fs.existsSync(VENV_TTS) ? null : [py, '-m', 'venv', VENV_TTS],
        [...pip, ...пакеты],
      ].filter(Boolean);
    },
  },
  'voice-chatterbox': {
    name: 'Озвучка — Chatterbox',
    size: 'пакеты ≈2.5 ГБ (torch); при первом синтезе модели ≈3 ГБ',
    // Chatterbox отстаёт от Python: на 3.13+ его зависимости не собираются.
    python: ['3.12', '3.11', '3.10'],
    venv: VENV_CHATTERBOX,
    steps: (py) => [
      fs.existsSync(VENV_CHATTERBOX) ? null : [py, '-m', 'venv', VENV_CHATTERBOX],
      [path.join(VENV_CHATTERBOX, BIN, PY), '-m', 'pip', 'install', '--quiet', 'chatterbox-tts'],
    ].filter(Boolean),
  },
};
