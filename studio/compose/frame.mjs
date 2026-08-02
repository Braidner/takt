/**
 * Кадр из номера — сердце композиции.
 *
 * Ничего не снимается и не ловится: описание кадра ВЫЧИСЛЯЕТСЯ из плёнки и номера,
 * поэтому дропнутых кадров не существует по построению, а предпросмотр и вывод
 * не могут разойтись — это одна функция. Здесь только числа: DOM применяет их
 * отдельным тонким слоем (apply.mjs), который не знает, откуда они взялись.
 */
import { interpolate, ride, easeInOut, clamp } from './curves.mjs';
import { LEAD, TAIL, TRANSITION } from './film.mjs';

/** Притяжение центра наезда к середине: см. edit.mjs — контекст дороже точности. */
const PULL = 0.45;

export function composeFrame(film, n) {
  const t = n / film.fps;
  const current = film.plans.find((p) => t >= p.from && t < p.to)
    || film.plans[film.plans.length - 1];
  const screens = [screenAt(film, current, t)];

  // Кроссфейд на границе: входящий план поверх уходящего набирает непрозрачность.
  const next = film.plans[film.plans.indexOf(current) + 1];
  if (next && t >= current.to - TRANSITION) {
    screens.push({ ...screenAt(film, next, t),
                   opacity: (t - (current.to - TRANSITION)) / TRANSITION });
  }

  return { screens, caption: captionAt(current, t) };
}

function screenAt(film, plan, t) {
  const local = clamp(t - plan.from, 0, plan.to - plan.from);
  const dur = plan.to - plan.from;
  const cam = plan.camera;

  let scrollY = 0;
  let camera = { scale: 1, ox: 50, oy: 50 };

  if (cam.kind === 'pan') {
    scrollY = Math.round(interpolate(local, [LEAD, dur - TAIL], [0, cam.to],
                                     { easing: ride }));
  } else if (cam.kind === 'push') {
    camera = {
      scale: interpolate(local, [LEAD, LEAD + 0.9], [1, cam.depth], { easing: easeInOut }),
      ox: clamp(50 + (cam.anchor.cx / film.screen.w - 0.5) * PULL * 100, 22, 78),
      oy: clamp(50 + (cam.anchor.cy / film.screen.h - 0.5) * PULL * 100, 24, 76),
    };
  } else {
    // Дрейф: вступительный наплыв — неподвижный кадр читается как стоп-кадр.
    camera = { scale: interpolate(local, [0, 2.6], [1.045, 1]), ox: 50, oy: 50 };
  }

  return { plan: plan.id, opacity: 1, scrollY, camera,
           sticky: plan.state.sticky.map(({ x, y, w, h }) => ({ x, y, w, h })),
           cursor: cursorAt(plan, local, film.screen) };
}

/** Курсор: приехать, нажать, погаснуть. Без него действие выглядит самопроизвольным. */
function cursorAt(plan, local, screen) {
  if (!plan.cursor) return null;
  const { x, y, at } = plan.cursor;
  if (local < LEAD || local > at + 1.0) return null;
  return {
    x: interpolate(local, [LEAD, at - 0.1], [screen.w * 0.55, x], { easing: easeInOut }),
    y: interpolate(local, [LEAD, at - 0.1], [screen.h * 0.9, y], { easing: easeInOut }),
    pressed: local >= at && local <= at + 0.18,
    opacity: interpolate(local, [at + 0.6, at + 1.0], [1, 0]),
  };
}

function captionAt(plan, t) {
  if (!plan.title || t < plan.title.at) return null;
  return { text: plan.title.text,
           progress: interpolate(t, [plan.title.at, plan.title.at + 0.45], [0, 1],
                                 { easing: easeInOut }) };
}
