import fs from 'node:fs';

/**
 * Пересчёт наездов камеры в УЖЕ СНЯТОЙ телеметрии — чтобы не терять удачный дубль
 * из-за монтажных правок. Применяет те же правила, что теперь зашиты в actions.mjs:
 *
 *  1. zoom проставляется и в событие печати (без него камера откатывалась на общий
 *     план ровно в момент начала набора — «зум не в попад»);
 *  2. наезд начинается на секунду раньше первого символа;
 *  3. после набора добавляется отъезд на общий план;
 *  4. точка наезда прижимается к центру кадра (у края зум выглядел как «улёт за экран»);
 *  5. наезды на всё, кроме печати, снимаются — по решению: приближаем только ввод текста.
 *
 * Запуск: node capture/retune-zoom.mjs 20-full
 */

const scene = process.argv[2] ?? '20-full';
const file = new URL(`../public/timeline/${scene}.json`, import.meta.url);
const timeline = JSON.parse(fs.readFileSync(file, 'utf8'));

// Сколько печатался каждый текст: длина × задержка на символ из сцены
const TYPING_SECONDS = {
  'Задача одним сообщением': (207 * 32) / 1000,
  'Просим доработать маршрут': (44 * 36) / 1000,
  'Договорённости проекта': (150 * 36) / 1000,
  'Спрашиваем в чистом диалоге': (118 * 36) / 1000,
};

// Наездов нет. Причина геометрическая: панель чата занимает всю высоту кадра, и при
// любом масштабе > 1 её верх и низ уходят за границы — «приблизить чат целиком»
// невозможно по построению. Камера остаётся на общем плане, работают курсор и титры.
const ZOOM = 1;
const LEAD_IN = 0.65; // на сколько раньше начинать наезд
const clamp = (v) => Number(Math.min(0.82, Math.max(0.18, v)).toFixed(4));

const events = timeline.events.map((e) => ({ ...e }));

// 1–4: наезд только вокруг печати
const out = [];
events.forEach((e, i) => {
  if (e.x !== undefined) {
    e.x = clamp(e.x);
    e.y = clamp(e.y);
  }

  if (e.kind === 'type') {
    // ведущий move того же действия — двигаем раньше и даём ему зум
    for (let k = out.length - 1; k >= 0; k -= 1) {
      if (out[k].kind === 'move') {
        out[k].zoom = ZOOM;
        out[k].t = Number(Math.max(0, out[k].t - LEAD_IN).toFixed(3));
        break;
      }
      if (out[k].kind !== 'click') break;
    }
    e.zoom = ZOOM;
    out.push(e);

    // отъезд сразу после окончания набора, но не позже следующего события
    const typed = TYPING_SECONDS[e.label] ?? 5;
    const next = events.slice(i + 1).find((n) => n.x !== undefined || n.kind === 'diagram');
    const limit = next ? next.t - 0.3 : e.t + typed + 1.2;
    const release = Number(Math.min(e.t + typed + 0.8, limit).toFixed(3));
    if (release > e.t) out.push({ t: release, kind: 'wide', x: 0.5, y: 0.5, zoom: 1 });
    return;
  }

  // 5: все прочие наезды снимаем — приближаем только ввод текста
  if (e.kind === 'move' || e.kind === 'hover') e.zoom = 1;
  out.push(e);
});

timeline.events = out.sort((a, b) => a.t - b.t);
fs.writeFileSync(file, JSON.stringify(timeline, null, 1));

const zooms = timeline.events.filter((e) => (e.zoom ?? 1) > 1);
console.log(`сцена ${scene}: событий ${timeline.events.length}, наездов ${zooms.length}`);
zooms.forEach((e) => console.log(`  ${e.t.toFixed(1)} ${e.kind} zoom=${e.zoom} ${e.label ?? ''}`));
