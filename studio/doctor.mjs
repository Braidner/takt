/**
 * Что установлено и что для чего не хватает.
 *
 *   takt doctor            человеку, списком
 *   takt doctor --json     студии, для панели окружения
 *
 * Отчёт строится по ВОЗМОЖНОСТЯМ, а не по пакетам, и это осознанно. «Нет mlx-audio»
 * человеку ничего не говорит; «озвучка недоступна» говорит ровно то, что он хочет знать —
 * что он не сможет сделать и что для этого поставить.
 *
 * Возможности независимы: снимать ролики можно без озвучки, а озвучивать — без съёмки.
 * Поэтому недостающее не складывается в один длинный список требований, из-за которого
 * кажется, что до первого ролика ещё далеко.
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { HOME, HOME_FROM } from './home.mjs';
import { REGISTRY, VENV_TTS, VENV_CHATTERBOX, BIN, PY } from './registry.mjs';

const run = promisify(execFile);
const DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(DIR, '..');

/**
 * Платформа определяет, какой бэкенд синтеза вообще применим: MLX существует только на
 * Apple Silicon, CUDA — только там, где есть карта NVIDIA. Без этого совет «поставьте
 * mlx-audio» на Windows был бы вредным.
 */
async function platform() {
  const apple = process.platform === 'darwin' && process.arch === 'arm64';
  let nvidia = false;
  if (!apple) {
    try { await run('nvidia-smi', ['-L']); nvidia = true; } catch { /* карты нет */ }
  }
  return {
    os: process.platform, arch: process.arch, apple, nvidia,
    backend: apple ? 'mlx' : nvidia ? 'cuda' : 'cpu',
  };
}

const has = async (cmd, args = ['--version']) => {
  try { const { stdout, stderr } = await run(cmd, args); return (stdout || stderr).split('\n')[0].trim(); }
  catch { return null; }
};

async function ffmpegH264() {
  try {
    const { stdout } = await run('ffmpeg', ['-hide_banner', '-encoders']);
    return stdout.includes('libx264');
  } catch { return false; }
}

const installed = (pkg) => fs.existsSync(path.join(ROOT, 'node_modules', pkg));

/** Браузер Playwright ставится отдельно от пакета и весит больше него самого. */
async function chromium() {
  try {
    const { chromium: c } = await import('playwright');
    return fs.existsSync(c.executablePath());
  } catch { return false; }
}

const venvPython = path.join(VENV_TTS, BIN, PY);
// У Chatterbox своя venv с более старым Python: в рабочую MLX-venv он не встаёт.
const chatterPython = path.join(VENV_CHATTERBOX, BIN, PY);

async function pythonPkg(pkg, interpreter = venvPython) {
  const py = fs.existsSync(interpreter) ? interpreter : 'python3';
  try { await run(py, ['-c', `import ${pkg}`]); return true; } catch { return false; }
}

const p = await platform();
const [ff, h264, chrome, py] = await Promise.all([
  has('ffmpeg', ['-version']), ffmpegH264(), chromium(), has('python3', ['--version']),
]);

const [mlxAudio, torch, qwen, whisper] = fs.existsSync(venvPython) || py
  ? await Promise.all([pythonPkg('mlx_audio'), pythonPkg('torch'), pythonPkg('qwen3_tts'),
                       pythonPkg('faster_whisper')])
  : [false, false, false, false];
const chatter = fs.existsSync(chatterPython) && await pythonPkg('chatterbox', chatterPython);

// Модель на Маке идёт через MLX, на остальных платформах — через torch. Спрашивать про
// оба бэкенда бессмысленно: на Windows не существует первого, а на Apple Silicon второй
// потребовал бы вторую копию весов.
const qwenReady = p.apple ? mlxAudio && whisper : torch && qwen && whisper;
const chatterReady = Boolean(chatter);

const capabilities = [
  {
    id: 'shoot', name: 'Съёмка',
    ready: Boolean(installed('playwright') && chrome),
    missing: [!installed('playwright') && 'playwright', !chrome && 'браузер Chromium'].filter(Boolean),
    fix: 'takt install browser',
  },
  {
    id: 'build', name: 'Сборка ролика',
    ready: Boolean(ff && h264),
    missing: [!ff && 'ffmpeg', ff && !h264 && 'ffmpeg без H.264'].filter(Boolean),
    fix: 'brew install ffmpeg',
  },
  {
    id: 'voice-qwen', name: 'Озвучка — Qwen3-TTS',
    ready: qwenReady, optional: true,
    missing: p.apple
      ? [!mlxAudio && 'mlx-audio', !whisper && 'faster-whisper'].filter(Boolean)
      : [!torch && 'torch', !qwen && 'qwen3-tts', !whisper && 'faster-whisper'].filter(Boolean),
    fix: 'takt install voice-qwen',
    note: p.apple ? 'бэкенд MLX' : p.nvidia ? 'бэкенд torch + CUDA' : 'бэкенд torch на CPU — медленно',
  },
  {
    id: 'voice-chatterbox', name: 'Озвучка — Chatterbox',
    ready: chatterReady, optional: true,
    missing: chatter ? [] : ['chatterbox-tts (своя venv)'],
    fix: 'takt install voice-chatterbox',
    note: p.apple ? 'бэкенд torch на Metal' : p.nvidia ? 'бэкенд torch + CUDA' : 'бэкенд torch на CPU — медленно',
  },
];

// Вес загрузки едет вместе с возможностью: панель обязана назвать его до кнопки.
const весом = { shoot: 'browser', build: null,
                'voice-qwen': 'voice-qwen', 'voice-chatterbox': 'voice-chatterbox' };
for (const c of capabilities) {
  const рег = REGISTRY[весом[c.id]];
  if (рег && !c.ready) c.size = рег.size;
}

const report = {
  platform: p,
  home: { dir: HOME, from: HOME_FROM },
  versions: { node: process.version, ffmpeg: ff, python: py },
  capabilities,
};

if (process.argv.includes('--json')) {
  console.log(JSON.stringify(report, null, 1));
} else {
  const где = { TAKT_HOME: 'переменная TAKT_HOME', legacy: 'каталог рядом с кодом',
                default: 'по умолчанию' }[HOME_FROM];
  console.log(`Платформа: ${p.os}/${p.arch}${p.apple ? ' (Apple Silicon)' : p.nvidia ? ' + NVIDIA' : ''}`);
  console.log(`Данные:    ${HOME} (${где})\n`);
  for (const c of capabilities) {
    const знак = c.ready ? '✓' : c.optional ? '·' : '✗';
    const хвост = c.ready
      ? (c.note ? `— ${c.note}` : '')
      : `— не хватает: ${c.missing.join(', ')}`;
    console.log(`  ${знак} ${c.name}${хвост ? ' ' + хвост : ''}`);
    if (!c.ready) console.log(`      ${c.fix}`);
  }
  const надо = capabilities.filter((c) => !c.ready && !c.optional);
  console.log(надо.length
    ? `\nБез этого ролик не снять: ${надо.map((c) => c.name).join(', ')}.`
    : '\nСнимать и собирать ролики можно.');
}
