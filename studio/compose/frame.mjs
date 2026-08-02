/**
 * Кадр из номера — сердце композиции.
 *
 * Ничего не снимается и не ловится: описание кадра ВЫЧИСЛЯЕТСЯ из плёнки и номера,
 * поэтому дропнутых кадров не существует по построению, а предпросмотр и вывод
 * не могут разойтись — это одна функция. Здесь только числа: DOM применяет их
 * отдельным тонким слоем (apply.mjs), который не знает, откуда они взялись.
 *
 * Окна движения приходят из эффектов раскадровки, а не из констант: правка наезда
 * человеком обязана менять картинку, иначе дорожка эффектов — украшение.
 */
import { interpolate, ride, easeInOut, clamp } from './curves.mjs';

/** Притяжение центра наезда к середине: контекст вокруг цели дороже точности. */
const PULL = 0.45;
/** Поле между якорем и краем окна камеры: цель не должна лежать на срезе кадра. */
const MARGIN = 60;
/** Подъём титра: быстрее выглядит как подёргивание, медленнее — как задержка. */
const TITLE_IN = 0.45;

export function composeFrame(film, n) {
  const t = n / film.fps;
  const current = film.plans.find((p) => t >= p.from && t < p.to)
    || film.plans[film.plans.length - 1];
  const screens = [screenAt(film, current, t)];

  // Кроссфейд на границе: входящий план поверх уходящего набирает непрозрачность.
  const next = film.plans[film.plans.indexOf(current) + 1];
  const cut = current.transition;
  if (next && cut && t - current.from >= cut.from) {
    const done = (t - current.from - cut.from) / Math.max(0.01, cut.to - cut.from);
    screens.push({ ...screenAt(film, next, t), opacity: clamp(done, 0, 1) });
  }

  return { screens, caption: captionAt(current, t) };
}

/**
 * Окно камеры: масштаб и сдвиг окна в CSS-пикселях экрана.
 *
 * Семантика zoompan, а не transform-origin: окно шириной w/scale смотрит на долю
 * свободного хода. Притяжение к центру сохраняет контекст вокруг цели, но у краёв
 * экрана утащило бы её за кадр — например, клик по пункту липкой шапки происходил
 * бы за верхним срезом. Поэтому после притяжения окно прижимается так, чтобы якорь
 * остался внутри с полем MARGIN.
 */
function cameraWindow(scale, ax, ay, { w, h }) {
  if (scale <= 1) return { scale, x: 0, y: 0 };
  const spanX = w - w / scale, spanY = h - h / scale;
  let x = spanX * clamp(0.5 + (ax / w - 0.5) * PULL, 0.22, 0.78);
  let y = spanY * clamp(0.5 + (ay / h - 0.5) * PULL, 0.24, 0.76);
  x = clamp(clamp(x, ax + MARGIN - w / scale, ax - MARGIN), 0, spanX);
  y = clamp(clamp(y, ay + MARGIN - h / scale, ay - MARGIN), 0, spanY);
  return { scale, x, y };
}

function screenAt(film, plan, t) {
  const local = clamp(t - plan.from, 0, plan.to - plan.from);
  const cam = plan.camera;

  // Живой отрезок: вместо снимка кадр называет момент записи. Дальше его ставит
  // сцена, а привод вывода ждёт, пока видео этот момент действительно покажет.
  if (plan.kind === 'live') {
    return { plan: plan.id, live: true, opacity: 1,
             video: { t: Math.round((plan.videoFrom + local) * 1000) / 1000 },
             sticky: [], cursor: null,
             camera: { scale: 1, x: 0, y: 0 }, scrollY: 0 };
  }

  // Карточка живёт своей жизнью: у неё нет ни снимка, ни камеры по нему — только
  // текст, который проявляется и держится.
  if (plan.kind === 'card') {
    return { plan: plan.id, card: plan.card, opacity: 1,
             text: plan.text, subtitle: plan.subtitle || null, url: plan.url || null,
             appear: interpolate(local, [0, 0.5], [0, 1], { easing: easeInOut }) };
  }

  let scrollY = 0;
  let camera = { scale: 1, x: 0, y: 0 };

  if (cam.kind === 'pan') {
    scrollY = Math.round(interpolate(local, [cam.from, cam.to], [0, cam.distance],
                                     { easing: ride }));
  } else if (cam.kind === 'push') {
    const scale = interpolate(local, [cam.from, cam.to], [1, cam.depth], { easing: easeInOut });
    camera = cameraWindow(scale, cam.cx, cam.cy, film.screen);
  } else {
    // Дрейф: вступительный наплыв — неподвижный кадр читается как стоп-кадр.
    const scale = interpolate(local, [cam.from, cam.to], [1.045, 1]);
    camera = cameraWindow(scale, film.screen.w / 2, film.screen.h / 2, film.screen);
  }

  return { plan: plan.id, opacity: 1, scrollY, camera,
           sticky: plan.state.sticky.map(({ x, y, w, h }) => ({ x, y, w, h })),
           overlays: overlaysAt(plan, local, scrollY, film.screen),
           cursor: cursorAt(plan, local, film.screen) };
}

/**
 * Наложения на текущий момент: только живые, с плавным появлением и уходом.
 *
 * Резко возникшая подсветка читается как сбой отрисовки, поэтому у наложения всегда
 * есть проявление и угасание — четверть секунды с каждой стороны.
 */
const OVERLAY_FADE = 0.25;

function overlaysAt(plan, local, scrollY, screen) {
  const out = [];
  for (const o of plan.overlays || []) {
    if (local < o.from || local > o.to) continue;
    // Выноска ставится с той стороны, где есть место: у цели под верхним краем она
    // уходила за кадр и обрезалась вместе с текстом.
    const сверху = o.rect ? (o.rect.y - scrollY) < screen.h * 0.42 : false;
    const opacity = Math.min(
      interpolate(local, [o.from, o.from + OVERLAY_FADE], [0, 1], { easing: easeInOut }),
      interpolate(local, [o.to - OVERLAY_FADE, o.to], [1, 0], { easing: easeInOut }),
    );
    out.push({ id: o.id, what: o.what, text: o.text, rect: o.rect, opacity,
               place: сверху ? 'below' : 'above' });
  }
  return out;
}

/** Курсор: приехать, нажать, погаснуть. Без него действие выглядит самопроизвольным. */
function cursorAt(plan, local, screen) {
  if (!plan.cursor) return null;
  const { x, y, at } = plan.cursor;
  const start = Math.max(0, at - 0.9);
  if (local < start || local > at + 1.0) return null;
  return {
    x: interpolate(local, [start, at - 0.1], [screen.w * 0.55, x], { easing: easeInOut }),
    y: interpolate(local, [start, at - 0.1], [screen.h * 0.9, y], { easing: easeInOut }),
    pressed: local >= at && local <= at + 0.18,
    opacity: interpolate(local, [at + 0.6, at + 1.0], [1, 0]),
  };
}

function captionAt(plan, t) {
  const local = t - plan.from;
  if (!plan.title?.text || local < plan.title.at) return null;
  return { text: plan.title.text,
           progress: interpolate(local, [plan.title.at, plan.title.at + TITLE_IN], [0, 1],
                                 { easing: easeInOut }) };
}
