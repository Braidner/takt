/**
 * Привод №2 — покадровый цикл: seek → screenshot → stdin ffmpeg.
 *
 *   node studio/render.mjs [--out файл] [--silent]
 *
 * Кадры считает та же композиция, что и скраббер студии, — им нечем разойтись.
 * Замер прототипа: 24,9 мс на кадр с тенями и трансформами; ролик в три тысячи
 * кадров — около двух минут. Дропнутых кадров не существует по построению.
 *
 * ffmpeg получает кадры через spawn и stdin: у async execFile опции input нет —
 * она молча игнорируется, и ffmpeg виснет на чтении. Оплачено в стадии 1.
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { chromium } from 'playwright';
import { inProject } from './project.mjs';
import { SERVER_INFO } from './home.mjs';
import { buildSound } from './sound.mjs';

const run = promisify(execFile);
const silent = process.argv.includes('--silent');
const outArg = (() => {
  const i = process.argv.indexOf('--out');
  return i !== -1 ? process.argv[i + 1] : null;
})();

const info = JSON.parse(fs.readFileSync(SERVER_INFO, 'utf8'));
const base = `http://localhost:${info.port}`;
const api = (route, payload) =>
  fetch(`${base}${route}?token=${info.token}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }).then((r) => r.json()).catch(() => null);

const manifestPath = inProject('states.json');
if (!fs.existsSync(manifestPath)) {
  console.error('Нет манифеста состояний: сначала снимите сценарий (takt shoot)');
  process.exit(1);
}
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
if (manifest.live) {
  console.error('В съёмке есть живые планы — собирайте старым монтажом: takt build, takt edit');
  process.exit(1);
}

const W = 1920, H = 1080;
const work = inProject('edit');
fs.mkdirSync(work, { recursive: true });

await api('/api/status', { state: 'busy', text: 'Собираю ролик из состояний', step: null, of: null });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: W, height: H } });
const t0 = Date.now();
try {
  await page.goto(`${base}/compose/player.html?render=1`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__takt !== undefined, null, { timeout: 60000 });
  const film = await page.evaluate(() => window.__takt.film ?? { error: window.__takt.error });
  if (!film.frames) throw new Error(film.error || 'плёнка не собралась');

  const body = path.join(work, 'body.mp4');
  const ff = spawn('ffmpeg', [
    '-v', 'error', '-y',
    '-f', 'image2pipe', '-framerate', String(film.fps), '-i', '-',
    '-c:v', 'libx264', '-preset', 'medium', '-crf', '18',
    '-pix_fmt', 'yuv420p', '-movflags', '+faststart', body,
  ], { stdio: ['pipe', 'ignore', 'pipe'] });
  let ffErr = '';
  ff.stderr.on('data', (d) => { ffErr += d; });
  const ffDone = new Promise((resolve, reject) => {
    ff.on('close', (code) => (code === 0 ? resolve() : reject(new Error(ffErr || `ffmpeg: ${code}`))));
  });

  for (let n = 0; n < film.frames; n++) {
    await page.evaluate((k) => window.__takt.seek(k), n);
    const shot = await page.screenshot({ type: 'jpeg', quality: 92 });
    if (!ff.stdin.write(shot)) await new Promise((r) => ff.stdin.once('drain', r));
    if (n % 150 === 0) {
      await api('/api/status', { state: 'busy',
        text: `Кадр ${n} из ${film.frames}`, step: null, of: null });
    }
  }
  ff.stdin.end();
  await ffDone;

  const out = outArg ? path.resolve(outArg) : inProject('movie.mp4');
  if (silent) {
    fs.copyFileSync(body, out);
  } else {
    await buildSound({ video: body, out, hits: film.clicks,
                       duration: film.seconds, work });
  }

  const { stdout } = await run('ffprobe', ['-v', 'error', '-show_entries',
    'format=duration,size', '-of', 'json', out]);
  const meta = JSON.parse(stdout).format;

  // Титры выжжены композицией, поэтому плееру студии накладывать нечего.
  await api('/api/movie', { url: '/project/movie.mp4', duration: Number(meta.duration),
                            captions: [], builtAt: new Date().toISOString() });
  await api('/api/status', { state: 'listening', text: 'Ролик собран', step: null, of: null });
  console.log(JSON.stringify({
    ok: true, out, fps: film.fps, frames: film.frames,
    duration: Number(Number(meta.duration).toFixed(1)),
    megabytes: Math.round(Number(meta.size) / 1024 / 1024 * 10) / 10,
    seconds: Math.round((Date.now() - t0) / 1000),
  }, null, 1));
} catch (e) {
  await api('/api/status', { state: 'listening', text: 'Сборка не удалась', step: null, of: null });
  console.error('рендер:', e.message.split('\n').slice(0, 3).join(' '));
  process.exitCode = 1;
} finally {
  await browser.close();
}
