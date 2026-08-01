/**
 * Треки якорей: где целевой элемент находился в кадре в каждый момент плана.
 *
 * Раньше съёмка записывала одну точку — результат `boundingBox()` ДО клика. Playwright
 * перед кликом сам прокручивает страницу к элементу, поэтому записанная координата
 * относилась к экрану, которого в кадре уже нет. В телеметрии mc-медиа так появилось
 * `y = 3673` при высоте кадра 810: монтаж упёр наезд в нижний край и показал пустоту,
 * а курсор нарисовал на y ≈ 4900, то есть не нарисовал вовсе. Ошибки при этом не было
 * ни одной — ни в съёмке, ни в монтаже.
 *
 * Трек снимается всё время плана и потому переживает любую прокрутку: камера следует за
 * элементом. Если элемент ушёл из кадра — в треке это видно, наезд не строится, а
 * проверка дубля называет шаг. Промахнуться становится нечем.
 */

/** Интервал проб. Чаще незачем: за 100 мс интерфейс не успевает уехать незаметно. */
export const SAMPLE_MS = 100;

/** Виден ли прямоугольник в кадре хотя бы частично. */
export function visible(rect, viewport) {
  if (!rect || rect.w <= 0 || rect.h <= 0) return false;
  return rect.x < viewport.width && rect.y < viewport.height
      && rect.x + rect.w > 0 && rect.y + rect.h > 0;
}

/**
 * Положение якоря в момент t. Между пробами — линейно, за краями трека — крайняя проба.
 * Интерполяция нужна, потому что кадры идут чаще проб: 30 к/с против 10 проб в секунду.
 */
export function rectAt(track, t) {
  if (!track || track.length === 0) return null;
  if (t <= track[0].t) return track[0];
  if (t >= track[track.length - 1].t) return track[track.length - 1];

  for (let i = 1; i < track.length; i++) {
    if (track[i].t >= t) {
      const a = track[i - 1];
      const b = track[i];
      const p = (t - a.t) / (b.t - a.t);
      return {
        t,
        x: a.x + (b.x - a.x) * p,
        y: a.y + (b.y - a.y) * p,
        w: a.w + (b.w - a.w) * p,
        h: a.h + (b.h - a.h) * p,
      };
    }
  }
  return track[track.length - 1];
}

export class AnchorTracker {
  /** clock — функция, отдающая время съёмки в секундах: треки живут в её шкале, не в часах. */
  constructor(page, viewport, clock) {
    this.page = page;
    this.viewport = viewport;
    this.clock = clock;
    this.tracks = new Map();
    this.timer = null;
    this.busy = false;
  }

  watch(selector) {
    if (selector && !this.tracks.has(selector)) this.tracks.set(selector, []);
  }

  start() {
    if (this.timer) return;
    this.timer = setInterval(() => { this.#sample(); }, SAMPLE_MS);
  }

  /** Проба прямо сейчас — например, сразу после клика, когда страница уже прокрутилась. */
  async sampleNow(selector) {
    if (selector) this.watch(selector);
    await this.#sample();
  }

  async #sample() {
    // Проба медленнее интервала на загруженной странице; без этого флага пробы
    // накладываются друг на друга и время в треке перестаёт быть монотонным.
    if (this.busy) return;
    const selectors = [...this.tracks.keys()];
    if (!selectors.length) return;
    this.busy = true;
    const t = this.clock();
    try {
      // Один заход в страницу на все якоря: по вызову на каждый — это лишние переходы
      // через CDP на каждой пробе, а их десять в секунду.
      const rects = await this.page.evaluate((list) => list.map((sel) => {
        const el = document.querySelector(sel);
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return { x: r.x, y: r.y, w: r.width, h: r.height };
      }), selectors);

      selectors.forEach((sel, i) => {
        const r = rects[i];
        if (r) this.tracks.get(sel).push({ t: Number(t.toFixed(3)), ...r });
      });
    } catch {
      // Страница между переходами недоступна для evaluate — пропущенная проба
      // безобиднее упавшей съёмки.
    } finally {
      this.busy = false;
    }
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    return [...this.tracks.entries()].map(([selector, rects]) => ({ selector, rects }));
  }
}
