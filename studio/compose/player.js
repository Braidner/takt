/**
 * Привод №1 — скраббер. Ролик смотрится без рендера: кадр вычисляется из позиции
 * ползунка той же функцией, которой привод вывода считает кадры для ffmpeg.
 * С ?render=1 страница отдаёт только сцену: панель управления в кадр не попадает.
 */
import { buildFilm, buildHighlightFilm } from './film.mjs';
import { composeFrame } from './frame.mjs';
import { mountScene, applyFrame } from './apply.mjs';

const q = new URLSearchParams(location.search);
const render = q.get('render') === '1';

try {
  const [manifest, scenario] = await Promise.all([
    fetch('/project/states.json').then((r) => {
      if (!r.ok) throw new Error('нет манифеста состояний — сначала снимите сценарий (takt shoot)');
      return r.json();
    }),
    fetch('/api/scenario').then((r) => r.json()),
  ]);
  let film = buildFilm(manifest, scenario);
  // Хайлайты — та же композиция, другая плёнка: отбор планов вместо обрезки видео.
  if (q.get('highlight') === '1') {
    film = buildHighlightFilm(film, { seconds: Number(q.get('seconds')) || 25 });
  }
  const frames = Math.round(film.seconds * film.fps);

  const scene = mountScene(document.getElementById('root'), film, '/project/');

  // Кадры листаются без сети: все снимки должны быть декодированы до ready,
  // иначе привод вывода снимет кадр с ещё серой картинкой. Но decode() в фоновой
  // вкладке Chromium откладывается до показа — без таймаута плеер, открытый не на
  // переднем плане, не оживал бы вовсе. Привод вывода это не задевает: его снимки
  // сами форсируют декодирование.
  await Promise.race([
    Promise.all([...document.images].map((img) => img.decode().catch(() => {}))),
    new Promise((r) => setTimeout(r, 8000)),
  ]);
  await document.fonts.ready;

  let current = -1;
  const seek = (n) => {
    const k = Math.max(0, Math.min(frames - 1, n));
    if (k === current) return;
    current = k;
    applyFrame(scene, composeFrame(film, k));
  };
  seek(0);

  window.__takt = { ready: true, seek,
    film: { fps: film.fps, seconds: film.seconds, frames, clicks: film.clicks } };

  if (!render) {
    const controls = document.getElementById('controls');
    controls.hidden = false;
    const scrub = document.getElementById('scrub');
    const time = document.getElementById('time');
    const play = document.getElementById('play');
    scrub.max = String(frames - 1);
    const mmss = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

    const show = (n) => {
      seek(n);
      scrub.value = String(current);
      time.textContent = `${mmss(current / film.fps)} / ${mmss(film.seconds)}`;
    };
    show(0);
    scrub.addEventListener('input', () => show(Number(scrub.value)));

    let playing = null;
    play.addEventListener('click', () => {
      if (playing) { clearInterval(playing); playing = null; play.textContent = '▶'; return; }
      play.textContent = '⏸';
      playing = setInterval(() => {
        if (current >= frames - 1) { clearInterval(playing); playing = null; play.textContent = '▶'; }
        else show(current + 1);
      }, 1000 / film.fps);
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowRight') show(current + (e.shiftKey ? 30 : 1));
      if (e.key === 'ArrowLeft') show(current - (e.shiftKey ? 30 : 1));
      if (e.key === ' ') { e.preventDefault(); play.click(); }
    });

    // Человеку сцена ужимается под окно; приводу вывода — нет.
    const fit = () => {
      const s = Math.min(1, innerWidth / 1920, (innerHeight - 60) / 1080);
      const frame = document.getElementById('frame');
      frame.style.transform = `scale(${s})`;
      frame.style.height = `${1080 * s}px`;
    };
    fit();
    addEventListener('resize', fit);
  }
} catch (e) {
  // Причина отказа — человеку на страницу, а не только в консоль: сюда приходят
  // и «нет манифеста», и «есть живые планы — собирайте старым монтажом».
  const div = document.createElement('div');
  div.id = 'error';
  div.textContent = e.message;
  document.body.prepend(div);
  window.__takt = { ready: false, error: e.message };
}
