/**
 * Разбор сбоя шага: что именно случилось и что с этим делать.
 *
 * Playwright сообщает об ошибке в терминах своего API («Timeout 15000ms exceeded»), а
 * человеку нужен ответ на другой вопрос: я плохо описал шаг, стенд подтормаживает или
 * он вовсе сломался? Это три разные починки, и различить их можно только осмотрев
 * страницу в момент падения — потом она уже закрыта.
 *
 * Вынесено из shoot.mjs отдельным модулем, чтобы проверять на странице-заглушке:
 * ветку «элемент есть, но скрыт» на живом стенде не воспроизвести, а она самая
 * коварная — выглядит как «элемента нет», а лечится совсем иначе.
 */

export async function explainFailure(page, step, e) {
  const full = e.message || String(e);
  const raw = full.split('\n')[0].slice(0, 200);
  const timeout = /Timeout|timeout/.test(raw);

  // Селектор берём из самого сообщения Playwright: он пишет, чего именно ждал. Шаг обычно
  // содержит несколько селекторов — свои действия и expect, — и назвать не тот значит
  // отправить человека чинить исправное место. Разбор по тексту сообщения точен, а список
  // из шага остаётся запасным вариантом, когда сообщение ничего не назвало.
  // Кавычка запоминается и ищется парная: селектор сам нередко содержит кавычки другого
  // вида — input[placeholder*="новая задача"] — и наивный разбор обрезал бы его посередине.
  const изСообщения = full.match(/locator\((['"])(.+?)\1\)/);
  const selector = изСообщения?.[2]
    || (step.actions || []).map((a) => a.click || a.waitFor || a.type?.selector).find(Boolean)
    || step.expect;

  let present = null;
  let visible = null;
  if (timeout && selector) {
    try {
      present = await page.locator(selector).count();
      visible = present ? await page.locator(selector).first().isVisible() : false;
    } catch { /* селектор неразбираем — оставляем сырое сообщение */ }
  }

  let error = raw;
  let fix = null;

  if (timeout && present === 0) {
    error = `Не нашёл на странице: ${selector}`;
    fix = 'Проверить селектор разведкой (probe-stend.mjs) — раздел мог называться иначе';
  } else if (timeout && present > 0 && visible === false) {
    error = `Элемент есть, но скрыт: ${selector}`;
    fix = 'Добавить шагу предварительный клик, раскрывающий этот блок, или прокрутку к нему';
  } else if (timeout) {
    error = `Не дождался за 15 с: ${selector || 'элемента шага'}`;
    fix = 'Увеличить длительность шага — стенд отвечает медленнее обычного';
  } else if (/net::|ERR_|closed|crash/i.test(raw)) {
    error = 'Страница отвалилась во время шага';
    fix = 'Проверить стенд: node studio/check-stend.mjs';
  }

  let url = null;
  try { url = page.url(); } catch { /* контекст уже закрыт */ }

  return { n: step.n, label: step.label, error, fix, url, raw };
}
