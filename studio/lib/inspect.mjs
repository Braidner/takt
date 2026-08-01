/**
 * Автопроверки дубля — страховка, а не основная защита.
 *
 * Основная стратегия — предотвращение: ждём содержимое, крутим плавно, снимаем координаты
 * после прокрутки. Проверки нужны там, где чужой интерфейс придумает то, чего мы не
 * предусмотрели, а такое будет: Takt ставят на системы, которых мы не видели.
 *
 * Каждое замечание отвечает на вопрос человека «что не так и где», а не «какое число
 * вышло за порог». Поэтому оно называет шаг и говорит словами: смотреть на отчёт
 * будут между дублями, а не изучать его.
 */
import { visible } from './anchors.mjs';

/** Доля изменившихся точек, выше которой это уже не движение, а смена экрана. */
export const JUMP_THRESHOLD = 0.35;

/** Загрузка в кадре: ожидание не сошлось за отведённое время. */
export function checkLoading(steps) {
  return steps
    .filter((s) => s.settle && s.settle.reason)
    .map((s) => ({
      kind: 'загрузка',
      step: s.n,
      text: `шаг ${s.n}${s.label ? ` «${s.label}»` : ''}: экран не успокоился за `
          + `${(s.settle.waitedMs / 1000).toFixed(1)} с — ${s.settle.reason}`,
    }));
}

/**
 * Скачок содержимого вне запланированной склейки.
 *
 * Порог обязан быть настраиваемым и жить в цели съёмки: у плотного интерфейса смена
 * раздела меняет меньше половины кадра, у полноэкранной витрины — почти всё. Одно
 * число на все системы давало бы либо молчание, либо шум.
 */
export function checkJumps(diffs, cuts = [], threshold = JUMP_THRESHOLD) {
  const planned = (t) => cuts.some((c) => t >= c.from && t <= c.to);
  return diffs
    .filter((d) => d.diff > threshold && !planned(d.t))
    .map((d) => ({
      kind: 'скачок',
      at: d.t,
      text: `${d.t.toFixed(1)} с: экран сменился на ${Math.round(d.diff * 100)}% `
          + 'вне запланированной склейки',
    }));
}

/** Якорь, ни разу не попавший в кадр: наезжать не на что. */
export function checkAnchors(anchors, viewport) {
  return anchors
    .filter((a) => !a.rects.some((r) => visible(r, viewport)))
    .map((a) => ({
      kind: 'якорь',
      step: a.step,
      text: `шаг ${a.step}: цель «${a.selector}» ни разу не попала в кадр — `
          + 'наезд не построен',
    }));
}

/** Потери кадров: интервал больше полутора периодов. */
export function checkDrops(times, fps = 30) {
  const period = 1000 / fps;
  const limit = period * 1.5;
  const out = [];
  for (let i = 1; i < times.length; i++) {
    const gap = times[i] - times[i - 1];
    if (gap > limit) {
      out.push({
        kind: 'пропуск',
        at: times[i] / 1000,
        text: `${(times[i] / 1000).toFixed(1)} с: разрыв ${Math.round(gap)} мс — `
            + `потеряно кадров: ${Math.round(gap / period) - 1}`,
      });
    }
  }
  return out;
}

/** Полный отчёт по дублю. */
export function inspect(take) {
  const issues = [
    ...checkLoading(take.steps || []),
    ...checkJumps(take.diffs || [], take.cuts || [], take.jumpThreshold),
    ...checkAnchors(take.anchors || [], take.viewport),
    ...checkDrops(take.frameTimes || [], take.fps || 30),
  ];
  return { ok: issues.length === 0, issues };
}
