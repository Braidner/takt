/**
 * Плёнка: что показывать и когда, собранная из манифеста состояний и сценария.
 *
 * Длительности пока приходят из сценария (человек назначил секунды при разведке) —
 * их вывод из содержания плана появится вместе с раскадровкой в стадии 3. Здесь
 * важно другое: у плёнки ОДНО место сборки, и скраббер студии с покадровым приводом
 * читают её одной и той же функцией — им физически нечем разойтись.
 *
 * Без импортов Node: модуль грузит и браузер, и node:test.
 */

export const LEAD = 0.6;        // подводка: камера трогается не сразу
export const TAIL = 1.6;        // удержание: результат должен дочитаться
export const DEPTH = 1.26;      // глубина наезда — мельче не читается, глубже мылит
export const PAN_SPEED = 600;   // px/с, скорость прокрутки из стадии 1
export const TRANSITION = 0.35; // кроссфейд на границе планов
export const CLICK_AT = 1.5;    // щелчок: курсор успел доехать, камера — навестись

/** 25, если есть хоть один живой план: пересчёт частот дублированием запрещён. */
export const filmFps = (states) =>
  states.some((s) => s.mode === 'live') ? 25 : 30;

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

/**
 * Камера плана: по содержимому, а не по вкусу.
 * Есть якорь — наезд: действие важнее пейзажа. Страница длинная — панорама.
 * Иначе — дрейф: неподвижный кадр читается как стоп-кадр.
 */
export function planCamera(state, seconds) {
  const a = (state.anchors || []).find((x) => x.rect);
  const k = state.scale || 1;
  if (a) {
    return { kind: 'push', depth: DEPTH, anchor: {
      cx: Math.round((a.rect.x + a.rect.w / 2) / k),
      cy: Math.round((a.rect.y + a.rect.h / 2) / k),
    } };
  }
  const pageH = (state.size?.h || 0) / k;
  const maxPan = Math.max(0, pageH - state.viewport.height);
  if (maxPan > state.viewport.height * 0.2) {
    const window = Math.max(0, seconds - LEAD - TAIL);
    return { kind: 'pan', to: Math.min(maxPan, Math.round(PAN_SPEED * window)) };
  }
  return { kind: 'drift' };
}

export function buildFilm(manifest, scenario) {
  const states = manifest.states || [];
  if (states.some((s) => s.mode === 'live')) {
    throw new Error('в съёмке есть живые планы — такой проект пока собирается старым монтажом (takt build/edit)');
  }

  const bySteps = new Map((scenario?.steps || []).map((s) => [s.n, s]));
  const plans = [];
  const clicks = [];
  let at = 0;

  for (const st of states) {
    const step = bySteps.get(st.plan) || {};
    const seconds = step.seconds || 6;
    const camera = planCamera(st, seconds);
    // Курсор существует ради действия: без якоря ему не к чему ехать и нечего нажимать.
    const cursor = camera.kind === 'push'
      ? { x: camera.anchor.cx, y: camera.anchor.cy, at: CLICK_AT }
      : null;
    if (cursor) clicks.push({ t: at + cursor.at });

    plans.push({
      id: st.id, label: st.label,
      from: at, to: at + seconds,
      state: { ...st, sticky: visibleSticky(st.sticky, st.viewport) },
      camera, cursor,
      title: { text: step.label || st.label, at: at + 0.15 },
    });
    at += seconds;
  }

  return {
    fps: filmFps(states),
    screen: { w: manifest.viewport.width, h: manifest.viewport.height },
    title: scenario?.title || '',
    seconds: at,
    plans, clicks,
  };
}
