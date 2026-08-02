/**
 * Липкие и закреплённые элементы — отдельным слоем.
 *
 * Снимок всей страницы отрисовывает `position: sticky` и `fixed` ОДИН раз, в их месте
 * сверху. Проверено на живом стенде: шапка Mission Control есть в снимке на высоте 0 и
 * отсутствует на глубине 2400 пикселей. Значит панорама по такому снимку уехала бы вместе
 * с шапкой — а в настоящей прокрутке шапка остаётся на месте, и зритель это заметит
 * мгновенно, даже не поняв, что именно не так.
 *
 * Поэтому липкие снимаются отдельно, по вьюпорту, а тело страницы — без них. Композиция
 * кладёт слой поверх едущего тела, и поведение совпадает с настоящим.
 *
 * Прячем `visibility`, а не `display`: место в потоке обязано сохраниться, иначе всё
 * содержимое подскочит вверх на высоту шапки и снимок разойдётся с координатами якорей.
 */

/** Мельче этого накладывать нечего: значки, бейджи, полоски прокрутки. */
export const MIN_SIZE = { w: 40, h: 20 };

/** Атрибут-метка: по нему восстанавливаем ровно то, что прятали. */
const MARK = 'data-takt-sticky';

export async function findSticky(page) {
  return page.evaluate(({ minW, minH }) => {
    const out = [];
    for (const el of document.querySelectorAll('body *')) {
      const cs = getComputedStyle(el);
      if (cs.position !== 'fixed' && cs.position !== 'sticky') continue;
      const r = el.getBoundingClientRect();
      if (r.width < minW || r.height < minH) continue;
      out.push({
        tag: el.tagName.toLowerCase(),
        cls: (el.className || '').toString().slice(0, 60),
        position: cs.position,
        zIndex: cs.zIndex,
        rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
      });
    }
    return out;
  }, { minW: MIN_SIZE.w, minH: MIN_SIZE.h });
}

/** Прячет липкие, возвращает сколько спрятал. Прежнее значение стиля запоминается. */
export function hideSticky(page) {
  return page.evaluate(({ minW, minH, mark }) => {
    let n = 0;
    for (const el of document.querySelectorAll('body *')) {
      const cs = getComputedStyle(el);
      if (cs.position !== 'fixed' && cs.position !== 'sticky') continue;
      const r = el.getBoundingClientRect();
      if (r.width < minW || r.height < minH) continue;
      el.setAttribute(mark, el.style.visibility || '');
      el.style.visibility = 'hidden';
      n += 1;
    }
    return n;
  }, { minW: MIN_SIZE.w, minH: MIN_SIZE.h, mark: MARK });
}

export function showSticky(page) {
  return page.evaluate((mark) => {
    for (const el of document.querySelectorAll(`[${mark}]`)) {
      const prev = el.getAttribute(mark);
      el.style.visibility = prev || '';
      el.removeAttribute(mark);
    }
  }, MARK);
}

/**
 * К какому краю кадра прижат каждый липкий элемент.
 *
 * Композиции нужен именно край, а не координата: слой накладывается на кадр любого
 * размера, и «шапка сверху» переносится, а «шапка на y=0 при высоте 810» — нет.
 */
export function stickyBands(items, viewport) {
  return items.map((it) => {
    const { x, y, w, h } = it.rect;
    // Край определяется тем, вдоль какой стороны элемент растянут, а не расстоянием.
    // Расстояние обманывает: боковая панель выше вьюпорта, и до нижнего края у неё
    // отрицательное «расстояние», которое выигрывает любое сравнение.
    const spansWidth = w >= viewport.width * 0.9;
    const spansHeight = h >= viewport.height * 0.9;
    const edge = spansWidth && !spansHeight
      ? (y <= viewport.height - (y + h) ? 'top' : 'bottom')
      : spansHeight && !spansWidth
        ? (x <= viewport.width - (x + w) ? 'left' : 'right')
        : nearestEdge({ x, y, w, h }, viewport);
    return { edge, x, y, w, h, tag: it.tag, position: it.position };
  });
}

/** Запасной случай: элемент не растянут ни вдоль одной стороны — берём ближний край. */
function nearestEdge({ x, y, w, h }, viewport) {
  const d = {
    top: y,
    left: x,
    bottom: viewport.height - (y + h),
    right: viewport.width - (x + w),
  };
  return Object.keys(d).reduce((a, b) => (d[b] < d[a] ? b : a));
}
