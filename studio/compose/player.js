/**
 * Привод №1 — скраббер. Ролик смотрится без рендера: кадр вычисляется из позиции
 * ползунка той же функцией, которой привод вывода считает кадры для ffmpeg.
 * С ?render=1 страница отдаёт только сцену: панель управления в кадр не попадает.
 */
import { buildFilm, buildHighlightFilm } from './film.mjs';
import { composeFrame } from './frame.mjs';
import { mountScene, applyFrame, FORMATS } from './apply.mjs';
import { directStoryboard } from './director.mjs';
import { normalizeStoryboard } from './storyboard.mjs';

const q = new URLSearchParams(location.search);
const render = q.get('render') === '1';
/**
 * Врезка: та же страница внутри студии. Спека называет скраббер главным инструментом —
 * пока он жил отдельной вкладкой, это было неправдой. Своих органов управления у врезки
 * нет: позицию задаёт плейхед студии, и двух источников правды о ней быть не должно.
 */
const embed = q.get('embed') === '1';

try {
  const [manifest, storyboard] = await Promise.all([
    fetch('/project/states.json').then((r) => {
      if (!r.ok) throw new Error('нет манифеста состояний — сначала снимите раскадровку (takt shoot)');
      return r.json();
    }),
    fetch('/api/storyboard').then((r) => r.json()),
  ]);
  /* Нормализация прогоняется и здесь — по той же причине, что и режиссёр ниже:
     она идемпотентна, а полагаться на то, что сервер уже свежей версии, нельзя.
     Он держит модули в памяти, и после обновления кода какое-то время отдаёт
     раскадровку в старой форме — с булевой заставкой вместо записи. Композиция
     молча собиралась без карточек, и ролик оказывался на пять секунд короче
     того, что показывал список планов.

     Режиссёр прогоняется здесь же: он не трогает ручные эффекты, зато страхует от
     раскадровки, утверждённой до съёмки, — тогда камере неоткуда было узнать,
     есть ли на странице куда ехать. */
  const board = normalizeStoryboard(storyboard, manifest.states);
  let film = buildFilm(manifest, directStoryboard(board, manifest.states));
  if (film.issues.length) console.warn('замечания композиции:', film.issues);
  // Хайлайты — та же композиция, другая плёнка: отбор планов вместо обрезки видео.
  if (q.get('highlight') === '1') {
    film = buildHighlightFilm(film, { seconds: Number(q.get('seconds')) || 25,
                                      format: q.get('format') === 'vertical' ? 'vertical' : 'wide' });
  }
  const frames = Math.round(film.seconds * film.fps);

  const SCENE = FORMATS[film.format] || FORMATS.wide;
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

  /**
   * Видео живых отрезков должно иметь метаданные ДО первого кадра.
   *
   * Присваивание currentTime незагруженному видео игнорируется молча — и в ролике
   * вместо нужного момента остаётся первый кадр записи. На дымовом прогоне это дало
   * экран входа в систему посреди ролика, причём одинаковый во всех кадрах плана.
   */
  await Promise.race([
    Promise.all([...document.querySelectorAll('video.live')].map((v) => (
      v.readyState >= 1 ? Promise.resolve() : new Promise((r) => {
        v.addEventListener('loadedmetadata', r, { once: true });
        v.addEventListener('error', r, { once: true });
      })
    ))),
    new Promise((r) => setTimeout(r, 15000)),
  ]);

  let current = -1;
  const seek = (n) => {
    const k = Math.max(0, Math.min(frames - 1, n));
    if (k === current) return;
    current = k;
    applyFrame(scene, composeFrame(film, k));
  };
  seek(0);

  /**
   * Готовность кадра.
   *
   * У снимков её нет: они декодированы заранее и рисуются мгновенно. У живого
   * отрезка есть: `currentTime` только просит видео перемотаться, а показывает оно
   * кадр позже — по событию `seeked`. Привод вывода, снявший кадр раньше, получит
   * предыдущий, и в ролике появится рывок назад.
   */
  const settled = () => {
    const видео = [...document.querySelectorAll('video.live')]
      .filter((v) => v.offsetParent !== null && (v.seeking || v.readyState < 2));
    if (!видео.length) return Promise.resolve(true);
    return Promise.all(видео.map((v) => new Promise((r) => {
      const готово = () => {
        v.removeEventListener('seeked', готово);
        v.removeEventListener('canplay', готово);
        r(true);
      };
      v.addEventListener('seeked', готово);
      v.addEventListener('canplay', готово);
      // Сторож: у повреждённого отрезка seeked может не прийти вовсе, и ждать его
      // вечно значит подвесить весь рендер.
      setTimeout(готово, 2000);
    }))).then(() => true);
  };

  window.__takt = { ready: true, seek, settled,
    film: { fps: film.fps, seconds: film.seconds, frames,
            width: SCENE.w, height: SCENE.h,
            clicks: film.clicks, issues: film.issues,
            live: film.plans.some((p) => p.kind === 'live') } };

  if (embed) {
    // Студия и композиция говорят временем, а не номерами кадров: у студии на той же
    // шкале лежат замечания, реплики и врезки, и переводить их в кадры значило бы
    // хранить частоту в двух местах.
    const toParent = (msg) => parent.postMessage({ source: 'takt-compose', ...msg }, '*');
    addEventListener('message', (e) => {
      if (e.data?.type === 'takt:seek') seek(Math.round((e.data.t || 0) * film.fps));
    });
    // Врезка — это кадр, а не страница: прокручивать в ней нечего, и полоса
    // прокрутки съедала бы часть самого кадра.
    document.documentElement.style.overflow = 'hidden';
    const fitEmbed = () => {
      const s = Math.min(innerWidth / SCENE.w, innerHeight / SCENE.h);
      const frame = document.getElementById('frame');
      frame.style.transform = `scale(${s})`;
      frame.style.height = `${SCENE.h * s}px`;
    };
    fitEmbed();
    addEventListener('resize', fitEmbed);
    toParent({ type: 'takt:ready', seconds: film.seconds, fps: film.fps,
               screenFit: scene.screenFit, issues: film.issues });
  }

  if (!render && !embed) {
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
      const s = Math.min(1, innerWidth / SCENE.w, (innerHeight - 60) / SCENE.h);
      const frame = document.getElementById('frame');
      frame.style.transform = `scale(${s})`;
      frame.style.height = `${SCENE.h * s}px`;
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
  // Врезка обязана сказать студии, что показывать нечего: молчащий чёрный
  // прямоугольник человек читает как поломку студии, а не как отсутствие съёмки.
  if (embed) parent.postMessage({ source: 'takt-compose', type: 'takt:error',
                                  error: e.message }, '*');
}
