/**
 * Ожидание по содержимому вместо ожидания по часам.
 *
 * `{"wait": 4000}` в сценарии — это ставка: успеет ли экран догрузиться. Проигранная
 * ставка попадает в кадр скелетоном, и заметно это только на готовом ролике. Хуже: в
 * сценарии mc-медиа поле `expect` уже было, но проверялось ПОСЛЕ паузы и потому ничем
 * не управляло — пауза всё равно отсчитывалась по часам.
 *
 * Здесь ставки нет: ждём, пока сойдутся три условия, и знаем, какое не сошлось. Время
 * ожидания возвращается наружу, потому что оно вырезается из мастера — загрузка не
 * должна попадать в кадр даже как секунда неподвижности.
 */
import { signature, differenceRatio } from './frame-signature.mjs';

/** Меньше половины процента изменившихся точек — экран считается неподвижным. */
export const STABLE_ENOUGH = 0.005;

/** Интервал между пробами картинки. Чаще незачем: перерисовка занимает десятки мс. */
export const SAMPLE_MS = 250;

/**
 * Сколько ждём тишины в сети, прежде чем перестать её требовать.
 *
 * Проверено на живом стенде: Mission Control держит постоянные соединения, поэтому
 * `networkidle` у него не наступает никогда. Как ОБЯЗАТЕЛЬНОЕ условие сетевая тишина
 * неприменима к любому приложению с живым каналом — а таких большинство, и Takt ставят
 * именно на них. Первая версия этого модуля висела по тридцать секунд на каждом шаге.
 *
 * Поэтому сеть — условие вспомогательное: полторы секунды оно ускоряет решение, дальше
 * ответ дают признак готовности и неподвижность картинки. Они и отвечают на настоящий
 * вопрос «дорисовался ли экран», тогда как тишина в сети — лишь косвенный его признак.
 */
export const NETWORK_GRACE_MS = 1500;

/**
 * Готов ли экран.
 *
 * Порядок проверок — от самого содержательного к самому косвенному, и это не
 * формальность: причина ожидания уходит человеку в отчёт. «Селектор» говорит, что раздел
 * не открылся; «картинка» — что он открылся, но ещё дорисовывается. Это разные беды с
 * разным лечением, и путать их нельзя.
 *
 * `selectorOk === null` означает, что план не назвал признак готовности — тогда это
 * условие просто не участвует.
 */
export function settleVerdict({ selectorOk, networkIdle, diff }) {
  if (selectorOk === false) return { settled: false, reason: 'селектор' };
  if (!networkIdle) return { settled: false, reason: 'сеть' };
  if (diff > STABLE_ENOUGH) return { settled: false, reason: 'картинка' };
  return { settled: true, reason: null };
}

/**
 * Ждёт, пока экран успокоится.
 *
 * Возвращает, а не бросает: не догрузившийся экран — это замечание к дублю, а не крах
 * съёмки. Прогон должен дойти до конца и показать человеку все проблемные шаги сразу,
 * иначе он будет чинить их по одному, каждый раз ожидая минуты.
 */
export async function waitUntilSettled(page, { waitFor = null, timeout = 30000 } = {}) {
  const t0 = Date.now();
  let prev = null;
  let reason = 'старт';

  while (Date.now() - t0 < timeout) {
    const selectorOk = waitFor
      ? await page.locator(waitFor).first().isVisible().catch(() => false)
      : null;

    // После грации сеть перестаёт быть требованием — см. NETWORK_GRACE_MS.
    const networkIdle = Date.now() - t0 > NETWORK_GRACE_MS
      ? true
      : await page.waitForLoadState('networkidle', { timeout: SAMPLE_MS })
          .then(() => true).catch(() => false);

    const shot = await page.screenshot({ type: 'jpeg', quality: 50 }).catch(() => null);
    // Между переходами страница бывает недоступна для снимка — это само по себе
    // означает «ещё не успокоилось», а не ошибку.
    const diff = shot && prev ? differenceRatio(prev, await signature(shot)) : 1;
    if (shot) prev = await signature(shot);

    const v = settleVerdict({ selectorOk, networkIdle, diff });
    reason = v.reason;
    if (v.settled) return { readyAt: Date.now(), waitedMs: Date.now() - t0, reason: null };

    await page.waitForTimeout(SAMPLE_MS).catch(() => {});
  }

  return { readyAt: Date.now(), waitedMs: Date.now() - t0, reason: `таймаут: ${reason}` };
}
