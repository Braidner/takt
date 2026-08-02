/**
 * Режиссёр: превращает намерение плана в эффекты.
 *
 * До этой стадии камеру выбирала сама композиция, и выбор был неисправим: человек
 * видел результат, но не имел, что править. Теперь решение режиссёра — данные:
 * наезд, панорама, дрейф и склейка лежат в раскадровке, показываются дорожкой и
 * правятся руками. Правка помечается `manual`, и перегенерация её не трогает.
 *
 * Камера целится СЕЛЕКТОРОМ, а не координатами: координаты появляются при сборке
 * плёнки из снятого состояния. Эффект переживает пересъёмку, координаты — нет.
 *
 * Без импортов Node: модуль грузит и браузер, и node:test.
 */
import { LEAD_IN, HOLD_OUT, SCROLL_SPEED } from './duration.mjs';

/** Глубина наезда: мельче не читается как приём, глубже теряет контекст вокруг цели. */
export const DEPTH = 1.26;
/** Кроссфейд на границе планов: резкая склейка на смене экрана читается как сбой. */
export const TRANSITION = 0.35;
/** Вступительный наплыв дрейфа — движение там, где ехать некуда. */
export const DRIFT_IN = 2.6;

/** Есть ли по чему ехать: страница должна быть заметно выше экрана. */
function scrollable(state) {
  if (!state?.size?.h) return false;
  const pageH = state.size.h / (state.scale || 1);
  return pageH - state.viewport.height > state.viewport.height * 0.2;
}

/**
 * Эффекты одного плана.
 *
 * Состояние может быть ещё не снято — раскадровку утверждают до съёмки. Тогда
 * панорама не обещается: неизвестно, есть ли на странице куда ехать.
 */
export function autoEffects(plan, state, { last = false } = {}) {
  const dur = plan.duration.seconds;
  const out = [];

  const target = plan.action?.selector || null;
  if (target) {
    out.push({
      id: `${plan.id}-cam`, plan: plan.id, kind: 'camera',
      at: { from: LEAD_IN, to: Math.min(dur, LEAD_IN + 0.9) },
      anchor: target,
      params: { move: 'push', depth: DEPTH },
      source: 'auto',
    });
  } else if (scrollable(state)) {
    out.push({
      id: `${plan.id}-cam`, plan: plan.id, kind: 'camera',
      at: { from: LEAD_IN, to: Math.max(LEAD_IN, Math.round((dur - HOLD_OUT) * 10) / 10) },
      anchor: null,
      params: { move: 'pan', speed: SCROLL_SPEED },
      source: 'auto',
    });
  } else {
    out.push({
      id: `${plan.id}-cam`, plan: plan.id, kind: 'camera',
      at: { from: 0, to: Math.min(dur, DRIFT_IN) },
      anchor: null,
      params: { move: 'drift' },
      source: 'auto',
    });
  }

  // Последнему плану склеиваться не с чем: ролик после него кончается.
  if (!last) {
    out.push({
      id: `${plan.id}-cut`, plan: plan.id, kind: 'transition',
      at: { from: Math.round((dur - TRANSITION) * 100) / 100, to: dur },
      anchor: null,
      params: { style: 'dissolve' },
      source: 'auto',
    });
  }
  return out;
}

/**
 * Пройти раскадровку целиком. Планы, где человек правил эффекты руками, остаются
 * как есть: молча стереть чужую работу нельзя — её могли делать час назад.
 */
export function directStoryboard(sb, states = []) {
  const byId = new Map((states || []).map((s) => [s.id, s]));
  const manual = (sb.effects || []).filter((e) => e.source === 'manual');
  const touched = new Set(manual.map((e) => e.plan));

  const effects = [];
  for (const [i, plan] of sb.plans.entries()) {
    if (touched.has(plan.id)) {
      effects.push(...manual.filter((e) => e.plan === plan.id));
      continue;
    }
    effects.push(...autoEffects(plan, byId.get(plan.id) || null,
                                { last: i === sb.plans.length - 1 }));
  }
  return { ...sb, effects };
}
