/**
 * Прокрутка как приём съёмки.
 *
 * `{"press": "PageDown"}` перекладывает страницу за один кадр: в записи это выглядит как
 * склейка посреди плана, и никакой монтаж такое не чинит — склеивать нечего, кадр уже
 * снят. В mc-медиа так сняты две сцены из семи, и они же дали половину ощущения
 * «дёрганого экрана».
 *
 * Здесь страница едет ровно, с разгоном и торможением, — читается как проезд камеры.
 * Побочная польза важнее, чем кажется: пока кадр едет медленно, ленивые картинки
 * успевают догрузиться ДО того, как войдут в кадр, и витрина не мигает пустыми местами.
 */

/** Пикселей в секунду. Быстрее — рябит на тексте, медленнее — зритель скучает. */
export const DEFAULT_SPEED = 600;

/** Ниже этой длительности любое движение читается как прыжок, сколько бы ни было пикселей. */
const MIN_DURATION = 400;

export function scrollDuration(distance, speed = DEFAULT_SPEED) {
  return Math.max(MIN_DURATION, Math.round((Math.abs(distance) / speed) * 1000));
}

/** Кубический разгон-торможение: без него старт и стоп выглядят рывками. */
export function scrollOffset(elapsed, distance, duration) {
  if (elapsed <= 0) return 0;
  if (elapsed >= duration) return distance;
  const p = elapsed / duration;
  const eased = p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2;
  return distance * eased;
}

/**
 * Крутит страницу в браузере.
 *
 * Кривую считает страница, а не Node. Слать позицию по одной через CDP значит получить
 * движение с частотой сети вместо частоты экрана — то есть ту же рванину, ради устранения
 * которой всё и затевалось. Формула продублирована внутри evaluate намеренно: она
 * исполняется в другом рантайме, куда импорт не дотянется.
 */
export async function smoothScroll(page, { distance, speed = DEFAULT_SPEED } = {}) {
  const duration = scrollDuration(distance, speed);
  await page.evaluate(
    ([dist, dur]) => new Promise((resolve) => {
      const from = window.scrollY;
      const t0 = performance.now();
      const step = (now) => {
        const elapsed = now - t0;
        const p = Math.min(1, elapsed / dur);
        const eased = p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2;
        window.scrollTo(0, from + dist * eased);
        if (p < 1) requestAnimationFrame(step);
        else resolve();
      };
      requestAnimationFrame(step);
    }),
    [distance, duration],
  );
}
