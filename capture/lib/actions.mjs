/**
 * Обёртки над Playwright, которые попутно пишут телеметрию: каждое действие
 * знает свои экранные координаты, время и подпись — из этого монтаж строит
 * траекторию курсора, наезды камеры и титры.
 */
export function makeActor(page, rec) {
  const { width, height } = rec.viewport;

  // Точка наезда прижимается к центру: при origin у самого края кадра зум выглядит
  // как «камера улетела за экран» — половина кадра оказывается пустой.
  const clamp = (v) => Number(Math.min(0.82, Math.max(0.18, v)).toFixed(4));
  const norm = (box) => ({
    x: clamp((box.x + box.width / 2) / width),
    y: clamp((box.y + box.height / 2) / height),
  });

  const locate = async (target) => {
    const loc = typeof target === 'string' ? page.locator(target) : target;
    await loc.first().waitFor({ state: 'visible', timeout: 15000 });
    const box = await loc.first().boundingBox();
    if (!box) throw new Error(`нет boundingBox у ${target}`);
    return { loc: loc.first(), box };
  };

  const api = {
    /** Подъезд курсора к элементу + клик; zoom — во сколько раз камера наезжает на точку */
    async click(target, { label, zoom = 1.7, flight = 450, settle = 700 } = {}) {
      const { loc, box } = await locate(target);
      const p = norm(box);
      rec.mark({ kind: 'move', ...p, zoom, label });
      await page.waitForTimeout(flight);
      rec.mark({ kind: 'click', ...p });
      await loc.click();
      await page.waitForTimeout(settle);
      return api;
    },

    /** Наведение без клика — для подсветки строк таблицы и тултипов */
    async hover(target, { label, zoom = 1.7, flight = 450, settle = 500 } = {}) {
      const { loc, box } = await locate(target);
      const p = norm(box);
      rec.mark({ kind: 'move', ...p, zoom, label });
      await page.waitForTimeout(flight);
      await loc.hover();
      await page.waitForTimeout(settle);
      return api;
    },

    /** Ввод текста посимвольно — в кадре это читается как живая печать */
    // zoom по умолчанию 1: панель чата занимает всю высоту кадра, и наезд неизбежно
    // срезает её сверху и снизу. Для узких элементов (строка таблицы, поле формы)
    // масштаб можно задать явно — там он оправдан.
    async type(target, text, { label, zoom = 1, delay = 55, settle = 500, release = true } = {}) {
      const { loc, box } = await locate(target);
      const p = norm(box);
      // Наезд начинается за ~секунду до первого символа: камера успевает доехать
      // и стоять на поле ввода, а не догонять набор.
      rec.mark({ kind: 'move', ...p, zoom, label });
      await page.waitForTimeout(1000);
      rec.mark({ kind: 'click', ...p });
      await loc.click();
      // zoom обязателен и в событии печати: без него камера откатывалась на общий
      // план в момент начала набора — тот самый «не в попад».
      rec.mark({ kind: 'type', ...p, zoom, label });
      await loc.type(text, { delay });
      await page.waitForTimeout(settle);
      // Набор закончен — отъезжаем: дальше сообщение уходит и работает ассистент.
      if (release) rec.mark({ kind: 'wide', x: 0.5, y: 0.5, zoom: 1 });
      return api;
    },

    /** Камера отъезжает на общий план */
    async wide({ label, settle = 900 } = {}) {
      rec.mark({ kind: 'wide', x: 0.5, y: 0.5, zoom: 1, label });
      await page.waitForTimeout(settle);
      return api;
    },

    /** Титр поверх кадра без действия */
    async caption(label, { hold = 1400 } = {}) {
      rec.mark({ kind: 'caption', label });
      await page.waitForTimeout(hold);
      return api;
    },

    /**
     * Врезка-схема поверх кадра. Нужна там, где ассистент думает и вызывает инструменты:
     * пауза перестаёт быть простоем и объясняет зрителю, что происходит внутри.
     * mode 'side' — окно уезжает влево и ужимается, схема справа (видно, что ход идёт);
     * mode 'full' — схема на весь кадр (для пауз от 20 секунд и заставок).
     */
    async diagram(id, { hold = 12000, minHold = 9000, until } = {}) {
      rec.mark({ kind: 'diagram', id });
      if (until) {
        // Схема живёт ровно столько, сколько работает модель: ждём её же условие
        // (конец хода, появление плашки), но не короче minHold — колонка должна
        // успеть проявиться поблочно и дать себя прочитать.
        const startedAt = Date.now();
        await until();
        const left = minHold - (Date.now() - startedAt);
        if (left > 0) await page.waitForTimeout(left);
      } else {
        await page.waitForTimeout(hold);
      }
      rec.mark({ kind: 'diagram-end', id });
      return api;
    },

    /** Пауза «на почитать» */
    async beat(ms = 900) {
      await page.waitForTimeout(ms);
      return api;
    },

    async scroll(deltaY, { steps = 12, settle = 500 } = {}) {
      for (let i = 0; i < steps; i += 1) {
        await page.mouse.wheel(0, deltaY / steps);
        await page.waitForTimeout(1000 / 30);
      }
      await page.waitForTimeout(settle);
      return api;
    },
  };

  return api;
}
