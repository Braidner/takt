/**
 * Плёнка: что показывать и когда. Собирается из раскадровки и снятых состояний.
 *
 * Здесь встречаются две половины одного решения: раскадровка знает НАМЕРЕНИЕ
 * («наехать на поиск»), состояние знает ФАКТ («поиск занимает такой-то
 * прямоугольник»). Разрешение селектора в координаты живёт ровно в одном месте —
 * здесь, — и поэтому у наезда в пустоту больше нет способа появиться незаметно:
 * не нашли якорь, значит не строим наезд и называем план в замечаниях.
 *
 * У плёнки одно место сборки, и скраббер студии с покадровым приводом читают её
 * одной и той же функцией — им физически нечем разойтись.
 *
 * Без импортов Node: модуль грузит и браузер, и node:test.
 */
import { LEAD_IN, HOLD_OUT, SCROLL_SPEED } from './duration.mjs';
import { DEPTH, DRIFT_IN } from './director.mjs';

/** Длина клипа хайлайтов: короче — рвано, длиннее — скучно. */
export const CLIP = 3.2;
/**
 * Заставка и финальная плашка. Ролик без начала и конца выглядит куском чужой
 * записи: непонятно, что это было и куда идти. Длительности выверены старым
 * монтажом и переезжают вместе с самими карточками.
 */
export const SLATE = 2.6;
export const END = 2.2;
/** Щелчок ставится ближе к концу подводки: курсор успел доехать, камера — навестись. */
const CLICK_AFTER = 0.9;

/**
 * Липкие полосы, которые имеет смысл рисовать.
 *
 * Полоса во весь экран — это не шапка, а контейнер порталов: нарисовать её значит
 * накрыть панораму неподвижной копией экрана. Полоса за краем вьюпорта — выдвижная
 * панель в закрытом состоянии: кроп из слоя был бы пустым.
 */
export function visibleSticky(bands, viewport) {
  return (bands || []).filter((b) =>
    b.w * b.h <= viewport.width * viewport.height * 0.5
    && b.x < viewport.width && b.y < viewport.height);
}

/** Центр якоря в CSS-пикселях экрана: снимок вдвое плотнее, камера считает в CSS. */
function anchorPoint(state, selector) {
  const found = (state.anchors || []).find((a) => a.selector === selector && a.rect);
  if (!found) return null;
  const k = state.scale || 1;
  return {
    x: Math.round((found.rect.x + found.rect.w / 2) / k),
    y: Math.round((found.rect.y + found.rect.h / 2) / k),
  };
}

/** Сколько камера успеет проехать за своё окно — но не дальше, чем есть страница. */
function panDistance(state, from, to, speed) {
  const pageH = (state.size?.h || 0) / (state.scale || 1);
  const maxPan = Math.max(0, pageH - state.viewport.height);
  return Math.min(maxPan, Math.round((speed || SCROLL_SPEED) * Math.max(0, to - from)));
}

/**
 * Камера плана из его эффекта. Наезд, не нашедший цели, вырождается в дрейф:
 * неподвижный кадр читается как стоп-кадр, а наезд в пустоту — как брак.
 */
function cameraOf(effect, plan, state, issues) {
  const dur = plan.duration.seconds;
  const drift = { kind: 'drift', from: 0, to: Math.min(dur, DRIFT_IN) };
  if (!effect) return drift;

  const from = effect.at?.from ?? LEAD_IN;
  const to = effect.at?.to ?? Math.max(from, dur - HOLD_OUT);
  const move = effect.params?.move;

  if (move === 'push' || move === 'closeup') {
    const point = anchorPoint(state, effect.anchor);
    if (!point) {
      issues.push({ plan: plan.id,
        text: `«${plan.title.text}»: цель наезда «${effect.anchor}» не попала в снимок — наезд не построен` });
      return drift;
    }
    return { kind: 'push', from, to,
             cx: point.x, cy: point.y,
             depth: effect.params.depth || DEPTH };
  }
  if (move === 'pan') {
    return { kind: 'pan', from, to,
             distance: panDistance(state, from, to, effect.params.speed) };
  }
  return { kind: 'drift', from: 0, to: Math.min(dur, DRIFT_IN) };
}

/** Карточка — такой же план, только вместо снимка на нём текст. */
const card = (id, kind, at, seconds, fields) => ({
  id, kind: 'card', card: kind,
  from: Math.round(at * 10) / 10,
  to: Math.round((at + seconds) * 10) / 10,
  camera: { kind: 'drift', from: 0, to: seconds },
  cursor: null,
  title: { text: '', at: 0 },
  transition: { from: seconds - 0.35, to: seconds, style: 'dissolve' },
  ...fields,
});

export function buildFilm(manifest, storyboard) {
  if (manifest.live || (storyboard.plans || []).some((p) => p.mode === 'live')) {
    throw new Error('в раскадровке есть живые планы — такой проект пока собирается старым монтажом (takt build/edit)');
  }

  const byId = new Map((manifest.states || []).map((s) => [s.id, s]));
  const issues = [];
  const plans = [];
  const clicks = [];
  let at = 0;

  // Заставка идёт первой и в хронометраж входит: иначе таймкоды замечаний и реплик
  // разъедутся с картинкой ровно на её длину.
  const заставка = storyboard.slate !== false && Boolean(storyboard.title);
  if (заставка) {
    // Задача идёт подзаголовком, только если она короткая: человек пишет её абзацем,
    // а на обложке абзац превращается в стену текста, которую никто не читает.
    const подзаголовок = storyboard.task && storyboard.task.length <= 90
      ? storyboard.task : null;
    plans.push(card('slate', 'slate', 0, SLATE,
                    { text: storyboard.title, subtitle: подзаголовок }));
    at += SLATE;
  }

  for (const plan of storyboard.plans || []) {
    const state = byId.get(plan.id);
    if (!state) {
      issues.push({ plan: plan.id, text: `«${plan.title.text}» не снят — плана нет в манифесте состояний` });
      continue;
    }
    const dur = plan.duration.seconds;
    const forPlan = (kind) => (storyboard.effects || [])
      .find((e) => e.plan === plan.id && e.kind === kind);

    const camera = cameraOf(forPlan('camera'), plan, state, issues);

    // Курсор существует ради действия: без цели ему не к чему ехать и нечего нажимать.
    const point = plan.action?.selector ? anchorPoint(state, plan.action.selector) : null;
    const cursor = point
      ? { x: point.x, y: point.y, at: Math.min(dur - 0.2, LEAD_IN + CLICK_AFTER) }
      : null;
    if (cursor) clicks.push({ t: Math.round((at + cursor.at) * 100) / 100 });

    const cut = forPlan('transition');
    plans.push({
      id: plan.id,
      kind: 'state',
      from: Math.round(at * 10) / 10,
      to: Math.round((at + dur) * 10) / 10,
      state: { ...state, sticky: visibleSticky(state.sticky, state.viewport) },
      camera, cursor,
      title: { text: plan.title.text, at: 0.15 },
      transition: cut ? { from: cut.at.from, to: cut.at.to, style: cut.params.style } : null,
    });
    at += dur;
  }

  if (заставка) {
    plans.push(card('end', 'end', at, END,
                    { text: storyboard.title, url: storyboard.url || null,
                      transition: null }));
    at += END;
  }

  return {
    fps: storyboard.fps || 30,
    screen: { w: manifest.viewport.width, h: manifest.viewport.height },
    title: storyboard.title || '',
    seconds: Math.round(at * 10) / 10,
    plans, clicks, issues,
  };
}

/**
 * Хайлайты — отбор, а не обрезка: сначала действия (видно функциональность),
 * потом открывающий план (что это вообще), потом финал (к чему всё шло).
 */
export function buildHighlightFilm(film, { seconds = 25 } = {}) {
  // Карточки в отбор не идут: хайлайты отвечают «а что это вообще» за время, которое
  // человек готов потратить на незнакомый продукт в ленте, и тратить его на заставку
  // значит не ответить вовсе.
  const материал = film.plans.filter((p) => p.kind !== 'card');
  const weight = (p, i) =>
    (p.cursor ? 3 : 0) + (i === 0 ? 2 : 0) + (i === материал.length - 1 ? 1 : 0);
  const picked = материал
    .map((p, i) => ({ p, i, w: weight(p, i) }))
    .sort((a, b) => b.w - a.w || a.i - b.i)
    .slice(0, Math.max(1, Math.floor(seconds / CLIP)))
    .sort((a, b) => a.i - b.i)
    .map(({ p }) => p);

  const plans = [];
  const clicks = [];
  let at = 0;
  for (const [i, p] of picked.entries()) {
    // Клип короче плана, поэтому окно движения пересчитывается: камера должна
    // проехать меньше, а не то же самое быстрее.
    const to = Math.max(LEAD_IN, CLIP - HOLD_OUT);
    const camera = p.camera.kind === 'pan'
      ? { ...p.camera, from: LEAD_IN, to,
          distance: panDistance(p.state, LEAD_IN, to, SCROLL_SPEED) }
      : { ...p.camera, from: Math.min(p.camera.from, LEAD_IN), to: Math.min(p.camera.to, CLIP) };
    const cursor = p.cursor ? { ...p.cursor, at: Math.min(p.cursor.at, CLIP - 0.4) } : null;
    if (cursor) clicks.push({ t: Math.round((at + cursor.at) * 100) / 100 });

    plans.push({ ...p, from: at, to: at + CLIP, camera, cursor,
                 title: { ...p.title, at: 0.15 },
                 transition: i === picked.length - 1 ? null
                   : { from: CLIP - 0.35, to: CLIP, style: 'dissolve' } });
    at += CLIP;
  }
  return { ...film, plans, clicks, seconds: Math.round(at * 10) / 10 };
}
