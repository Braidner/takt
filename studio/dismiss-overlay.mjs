/**
 * Снятие оверлея ошибок dev-сервера.
 *
 * webpack-dev-server рисует поверх приложения полноэкранную панель «Uncaught runtime
 * errors» — она перехватывает всё и делает интерфейс невидимым для разведки. Хуже того,
 * она сама состоит из блоков и проходит проверку «на странице есть живое дерево», так
 * что стенд с оверлеем выглядит рабочим, а собрать с него нечего.
 *
 * На собранных стендах оверлея нет — это чисто дев-специфика, поэтому снимаем его молча
 * и сообщаем вызывающему, был ли он: наличие оверлея само по себе полезный факт (на
 * фронтенде есть ошибки времени выполнения), просто не повод останавливать работу.
 */
export async function dismissDevOverlay(page) {
  return page.evaluate(() => {
    let found = false;

    // Основной случай: оверлей живёт в отдельном iframe поверх приложения.
    for (const frame of document.querySelectorAll('iframe')) {
      const id = frame.id || '';
      if (/webpack-dev-server-client-overlay|react-refresh|error-overlay/i.test(id)) {
        frame.remove();
        found = true;
      }
    }

    // Запасной случай: оверлей встроен в документ (react-error-overlay старых версий).
    for (const node of document.querySelectorAll('body > div')) {
      const text = node.textContent || '';
      if (/Uncaught runtime error|Compiled with problems|Failed to compile/i.test(text)
          && node.querySelectorAll('*').length < 400) {
        node.remove();
        found = true;
      }
    }

    return found;
  });
}
