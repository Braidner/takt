# Стадия 1: съёмка без брака — план внедрения

> **Для исполнителя:** шаги помечены чекбоксами. Каждая задача заканчивается
> самостоятельно проверяемым результатом и своим коммитом.

**Цель:** дубль перестаёт содержать брак — нет загрузки в кадре, нет прыжков прокрутки,
запись в 2× и 30 к/с, координаты целей записаны как треки, а не как точки.

**Архитектура:** чистые функции выносятся в `studio/lib/*.mjs` и покрываются тестами;
работа с браузером остаётся тонкой обёрткой над ними. `shoot.mjs` перестаёт быть местом,
где живёт логика, и становится оркестратором.

**Стек:** Node 22, встроенный `node:test`, Playwright 1.62, системный ffmpeg. Новых
рантайм-зависимостей не добавляется.

## Глобальные ограничения

- Новых зависимостей в `package.json` нет — ни рантайм, ни dev. Тесты на `node:test`.
- Съёмка: `deviceScaleFactor: 2`, 30 к/с, JPEG q92 → x264 crf 16.
- Стабильность кадра: меньше 0,5% различающихся пикселей за 250 мс.
- Порог скачка содержимого: 35%, хранится в цели съёмки, настраивается.
- Потеря кадра: интервал между кадрами больше 1,5 периода.
- Скорость прокрутки по умолчанию 600 px/с, задаётся параметром плана.
- Комментарии, сообщения об ошибках и имена в коде — по-русски, как в остальном проекте.
- Каждая задача — свой коммит.

---

### Задача 1: Сигнатура кадра и мера различия

Основа для двух вещей сразу: ожидания «картинка успокоилась» и проверки «содержимое
скакнуло». Сравнивать полноразмерные JPEG дорого и незачем — хватает уменьшенной
градации серого.

**Файлы:**
- Создать: `studio/lib/frame-signature.mjs`
- Создать: `test/frame-signature.test.mjs`
- Изменить: `package.json` — скрипт `test`

**Интерфейсы:**
- Отдаёт: `differenceRatio(a: Uint8Array, b: Uint8Array) → number` (0..1);
  `signature(jpeg: Buffer) → Promise<Uint8Array>` длиной 576 (32×18 серого)

- [ ] **Шаг 1: тест на меру различия**

```js
// test/frame-signature.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { differenceRatio } from '../studio/lib/frame-signature.mjs';

test('одинаковые сигнатуры не различаются', () => {
  const a = new Uint8Array([10, 20, 30, 40]);
  assert.equal(differenceRatio(a, a), 0);
});

test('противоположные сигнатуры различаются целиком', () => {
  const a = new Uint8Array([0, 0, 0, 0]);
  const b = new Uint8Array([255, 255, 255, 255]);
  assert.equal(differenceRatio(a, b), 1);
});

test('шум сжатия не считается изменением', () => {
  // JPEG шевелит яркость на единицы даже в полностью неподвижном кадре.
  // Без порога любой статичный экран выглядел бы как непрерывное движение.
  const a = new Uint8Array([100, 100, 100, 100]);
  const b = new Uint8Array([102, 98, 101, 100]);
  assert.equal(differenceRatio(a, b), 0);
});

test('различие — доля, а не количество', () => {
  const a = new Uint8Array([0, 0, 0, 0]);
  const b = new Uint8Array([255, 0, 0, 0]);
  assert.equal(differenceRatio(a, b), 0.25);
});

test('сигнатуры разной длины — ошибка, а не молчаливое сравнение', () => {
  assert.throws(
    () => differenceRatio(new Uint8Array(3), new Uint8Array(4)),
    /длины/,
  );
});
```

- [ ] **Шаг 2: убедиться, что тест падает**

Выполнить: `node --test test/frame-signature.test.mjs`
Ожидание: FAIL, `Cannot find module '../studio/lib/frame-signature.mjs'`

- [ ] **Шаг 3: реализация**

```js
// studio/lib/frame-signature.mjs
/**
 * Сигнатура кадра — уменьшенная градация серого 32×18.
 *
 * Сравнивать полные кадры незачем: нас интересует «изменился ли экран», а не «на сколько
 * именно пикселей». Уменьшение до 576 байт заодно убивает шум сжатия в мелких деталях,
 * из-за которого неподвижный экран выглядел бы шевелящимся.
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);

export const SIGNATURE_W = 32;
export const SIGNATURE_H = 18;
export const SIGNATURE_LENGTH = SIGNATURE_W * SIGNATURE_H;

/**
 * Порог, ниже которого разница в яркости считается шумом сжатия, а не изменением.
 * Подобран так, чтобы статичный экран давал ноль, а появление скелетона — заметную долю.
 */
const NOISE = 6;

export function differenceRatio(a, b) {
  if (a.length !== b.length) {
    throw new Error(`Сигнатуры разной длины: ${a.length} и ${b.length}`);
  }
  let changed = 0;
  for (let i = 0; i < a.length; i++) {
    if (Math.abs(a[i] - b[i]) > NOISE) changed++;
  }
  return changed / a.length;
}

/** Кадр (JPEG или PNG в буфере) → сигнатура. Считает ffmpeg, он и так нужен проекту. */
export async function signature(image) {
  const { stdout } = await run('ffmpeg', [
    '-v', 'error', '-i', 'pipe:0',
    '-vf', `scale=${SIGNATURE_W}:${SIGNATURE_H}:flags=area,format=gray`,
    '-f', 'rawvideo', 'pipe:1',
  ], { input: image, encoding: 'buffer', maxBuffer: 1 << 20 });
  return new Uint8Array(stdout);
}
```

- [ ] **Шаг 4: тест проходит**

Выполнить: `node --test test/frame-signature.test.mjs`
Ожидание: PASS, 5 тестов

- [ ] **Шаг 5: скрипт `test` в package.json**

```json
"scripts": {
  "takt": "node cli.mjs",
  "test": "node --test test/"
}
```

- [ ] **Шаг 6: коммит**

```bash
git add studio/lib/frame-signature.mjs test/frame-signature.test.mjs package.json
git commit -m "Сигнатура кадра: мера различия и каркас тестов"
```

---

### Задача 2: Ожидание по содержимому

Заменяет `wait: 4000`. Три условия: селектор готовности, сетевой покой, неподвижная
картинка. Решение о готовности — чистая функция, поэтому его можно проверить без браузера.

**Файлы:**
- Создать: `studio/lib/settle.mjs`
- Создать: `test/settle.test.mjs`

**Интерфейсы:**
- Потребляет: `signature`, `differenceRatio` из задачи 1
- Отдаёт: `settleVerdict({selectorOk, networkIdle, diff}) → {settled, reason}`;
  `waitUntilSettled(page, {waitFor, timeout}) → Promise<{readyAt, waitedMs, reason}>`

- [ ] **Шаг 1: тест на решение о готовности**

```js
// test/settle.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { settleVerdict, STABLE_ENOUGH } from '../studio/lib/settle.mjs';

test('всё сошлось — экран готов', () => {
  const v = settleVerdict({ selectorOk: true, networkIdle: true, diff: 0 });
  assert.equal(v.settled, true);
});

test('селектор не появился — ждём его, что бы ни говорила картинка', () => {
  const v = settleVerdict({ selectorOk: false, networkIdle: true, diff: 0 });
  assert.equal(v.settled, false);
  assert.equal(v.reason, 'селектор');
});

test('сеть ещё работает — ждём', () => {
  const v = settleVerdict({ selectorOk: true, networkIdle: false, diff: 0 });
  assert.equal(v.settled, false);
  assert.equal(v.reason, 'сеть');
});

test('картинка ещё меняется — ждём', () => {
  // Ровно этот случай давал скелетоны в кадре: сеть молчит, селектор есть,
  // а постеры ещё дорисовываются.
  const v = settleVerdict({ selectorOk: true, networkIdle: true, diff: 0.2 });
  assert.equal(v.settled, false);
  assert.equal(v.reason, 'картинка');
});

test('порог стабильности — половина процента', () => {
  assert.equal(STABLE_ENOUGH, 0.005);
  assert.equal(settleVerdict({ selectorOk: true, networkIdle: true, diff: 0.004 }).settled, true);
  assert.equal(settleVerdict({ selectorOk: true, networkIdle: true, diff: 0.006 }).settled, false);
});

test('без селектора в плане его условие не блокирует', () => {
  const v = settleVerdict({ selectorOk: null, networkIdle: true, diff: 0 });
  assert.equal(v.settled, true);
});
```

- [ ] **Шаг 2: убедиться, что тест падает**

Выполнить: `node --test test/settle.test.mjs`
Ожидание: FAIL, модуль не найден

- [ ] **Шаг 3: реализация**

```js
// studio/lib/settle.mjs
/**
 * Ожидание по содержимому вместо ожидания по часам.
 *
 * `wait: 4000` в сценарии — это ставка: успеет ли экран догрузиться. Проигранная ставка
 * попадает в кадр скелетоном, и заметно это только на готовом ролике. Здесь ставки нет:
 * ждём, пока сойдутся три условия, и знаем, какое из них не сошлось.
 */
import { signature, differenceRatio } from './frame-signature.mjs';

/** Меньше половины процента изменившихся пикселей — экран считается неподвижным. */
export const STABLE_ENOUGH = 0.005;

/** Интервал между пробами картинки. Чаще незачем: перерисовка занимает десятки мс. */
export const SAMPLE_MS = 250;

/**
 * Готов ли экран. Порядок проверок — от самого содержательного к самому косвенному,
 * чтобы причина ожидания была полезной: «селектор» говорит больше, чем «картинка».
 * selectorOk === null означает, что план не назвал признак готовности.
 */
export function settleVerdict({ selectorOk, networkIdle, diff }) {
  if (selectorOk === false) return { settled: false, reason: 'селектор' };
  if (!networkIdle) return { settled: false, reason: 'сеть' };
  if (diff > STABLE_ENOUGH) return { settled: false, reason: 'картинка' };
  return { settled: true, reason: null };
}

/**
 * Ждёт, пока экран успокоится. Возвращает, сколько ждали и чем закончилось —
 * это время потом вырезается из мастера, чтобы загрузка не попала в кадр.
 */
export async function waitUntilSettled(page, { waitFor = null, timeout = 30000 } = {}) {
  const t0 = Date.now();
  let prev = null;
  let reason = 'старт';

  while (Date.now() - t0 < timeout) {
    const selectorOk = waitFor
      ? await page.locator(waitFor).first().isVisible().catch(() => false)
      : null;

    const networkIdle = await page
      .waitForLoadState('networkidle', { timeout: SAMPLE_MS })
      .then(() => true)
      .catch(() => false);

    const shot = await page.screenshot({ type: 'jpeg', quality: 50 });
    const sig = await signature(shot);
    const diff = prev ? differenceRatio(prev, sig) : 1;
    prev = sig;

    const v = settleVerdict({ selectorOk, networkIdle, diff });
    reason = v.reason;
    if (v.settled) {
      return { readyAt: Date.now(), waitedMs: Date.now() - t0, reason: null };
    }
    await page.waitForTimeout(SAMPLE_MS);
  }

  // Таймаут — это не молчаливая неудача: причина уходит в отчёт съёмки.
  return { readyAt: Date.now(), waitedMs: Date.now() - t0, reason: `таймаут: ${reason}` };
}
```

- [ ] **Шаг 4: тест проходит**

Выполнить: `node --test test/settle.test.mjs`
Ожидание: PASS, 6 тестов

- [ ] **Шаг 5: коммит**

```bash
git add studio/lib/settle.mjs test/settle.test.mjs
git commit -m "Ожидание по содержимому: три условия вместо паузы по часам"
```

---

### Задача 3: Плавная прокрутка

`press: PageDown` перекладывает страницу за один кадр. Прокрутка становится приёмом:
дистанция, скорость, разгон и торможение.

**Файлы:**
- Создать: `studio/lib/scroll.mjs`
- Создать: `test/scroll.test.mjs`

**Интерфейсы:**
- Отдаёт: `scrollOffset(elapsed, distance, duration) → number`;
  `scrollDuration(distance, speed) → number` (мс);
  `smoothScroll(page, {distance, speed}) → Promise<void>`

- [ ] **Шаг 1: тест на кривую движения**

```js
// test/scroll.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scrollOffset, scrollDuration, DEFAULT_SPEED } from '../studio/lib/scroll.mjs';

test('в начале не сдвинулись, в конце пришли ровно', () => {
  assert.equal(scrollOffset(0, 1000, 2000), 0);
  assert.equal(scrollOffset(2000, 1000, 2000), 1000);
});

test('после конца не уезжаем дальше', () => {
  assert.equal(scrollOffset(5000, 1000, 2000), 1000);
});

test('движение монотонное', () => {
  let prev = -1;
  for (let t = 0; t <= 2000; t += 50) {
    const y = scrollOffset(t, 1000, 2000);
    assert.ok(y >= prev, `на ${t} мс поехали назад: ${y} после ${prev}`);
    prev = y;
  }
});

test('разгон и торможение: середина проходится быстрее краёв', () => {
  // Это и отличает движение камеры от перекладывания страницы.
  const start = scrollOffset(200, 1000, 2000) - scrollOffset(100, 1000, 2000);
  const middle = scrollOffset(1050, 1000, 2000) - scrollOffset(950, 1000, 2000);
  const end = scrollOffset(1900, 1000, 2000) - scrollOffset(1800, 1000, 2000);
  assert.ok(middle > start * 2, `середина ${middle} не быстрее начала ${start}`);
  assert.ok(middle > end * 2, `середина ${middle} не быстрее конца ${end}`);
});

test('длительность считается из дистанции и скорости', () => {
  assert.equal(scrollDuration(1200, 600), 2000);
  assert.equal(scrollDuration(600, DEFAULT_SPEED), 1000);
});

test('скорость по умолчанию — 600 пикселей в секунду', () => {
  assert.equal(DEFAULT_SPEED, 600);
});

test('очень короткая прокрутка всё равно занимает заметное время', () => {
  // Прокрутка на 40 пикселей за 66 мс — это тот же прыжок, только маленький.
  assert.ok(scrollDuration(40, 600) >= 400);
});
```

- [ ] **Шаг 2: убедиться, что тест падает**

Выполнить: `node --test test/scroll.test.mjs`
Ожидание: FAIL, модуль не найден

- [ ] **Шаг 3: реализация**

```js
// studio/lib/scroll.mjs
/**
 * Прокрутка как приём съёмки.
 *
 * PageDown перекладывает страницу за один кадр: в записи это выглядит как склейка посреди
 * плана, и никакой монтаж такое не чинит. Здесь страница едет ровно, с разгоном и
 * торможением — читается как проезд камеры. Побочная польза: пока кадр едет медленно,
 * ленивые картинки успевают догрузиться до того, как войдут в кадр.
 */

/** Пикселей в секунду. Быстрее — рябит на тексте, медленнее — зритель скучает. */
export const DEFAULT_SPEED = 600;

/** Ниже этой длительности любое движение читается как прыжок. */
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
 * Крутит страницу в браузере. Кривую считает страница, а не Node: посылать позицию
 * по одной через CDP значит получить движение с частотой сети, а не экрана.
 */
export async function smoothScroll(page, { distance, speed = DEFAULT_SPEED } = {}) {
  const duration = scrollDuration(distance, speed);
  await page.evaluate(
    ([dist, dur]) =>
      new Promise((resolve) => {
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
```

- [ ] **Шаг 4: тест проходит**

Выполнить: `node --test test/scroll.test.mjs`
Ожидание: PASS, 7 тестов

- [ ] **Шаг 5: коммит**

```bash
git add studio/lib/scroll.mjs test/scroll.test.mjs
git commit -m "Прокрутка приёмом: разгон, торможение, скорость вместо PageDown"
```

---

### Задача 4: Треки якорей

Причина «зума в пустоту» — координата снималась до авто-прокрутки Playwright. Вместо точки
съёмка отдаёт трек: где элемент был в кадре в каждый момент.

**Файлы:**
- Создать: `studio/lib/anchors.mjs`
- Создать: `test/anchors.test.mjs`

**Интерфейсы:**
- Отдаёт: `visible(rect, viewport) → boolean`; `rectAt(track, t) → rect|null`;
  `class AnchorTracker { constructor(page, viewport); watch(selector); start(clock); stop() → tracks }`

- [ ] **Шаг 1: тест на видимость и выборку по времени**

```js
// test/anchors.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { visible, rectAt } from '../studio/lib/anchors.mjs';

const VIEWPORT = { width: 1440, height: 810 };

test('элемент внутри кадра виден', () => {
  assert.equal(visible({ x: 100, y: 200, w: 80, h: 32 }, VIEWPORT), true);
});

test('элемент ниже кадра не виден', () => {
  // Ровно этот случай убил третий план mc-медиа: y=3673 при высоте 810.
  assert.equal(visible({ x: 177, y: 3673, w: 90, h: 28 }, VIEWPORT), false);
});

test('элемент, наполовину вышедший за край, ещё виден', () => {
  assert.equal(visible({ x: 1400, y: 400, w: 80, h: 32 }, VIEWPORT), true);
});

test('элемент, вышедший целиком, не виден', () => {
  assert.equal(visible({ x: 1441, y: 400, w: 80, h: 32 }, VIEWPORT), false);
});

test('элемент нулевого размера не виден', () => {
  // Скрытый display:none отдаёт нули, и наезжать на него нельзя.
  assert.equal(visible({ x: 0, y: 0, w: 0, h: 0 }, VIEWPORT), false);
});

const TRACK = [
  { t: 1.0, x: 100, y: 100, w: 50, h: 20 },
  { t: 2.0, x: 200, y: 100, w: 50, h: 20 },
];

test('выборка между пробами интерполируется', () => {
  assert.equal(rectAt(TRACK, 1.5).x, 150);
});

test('выборка до начала трека берёт первую пробу', () => {
  assert.equal(rectAt(TRACK, 0.2).x, 100);
});

test('выборка после конца трека берёт последнюю пробу', () => {
  assert.equal(rectAt(TRACK, 9).x, 200);
});

test('пустой трек не даёт цели', () => {
  assert.equal(rectAt([], 1), null);
});
```

- [ ] **Шаг 2: убедиться, что тест падает**

Выполнить: `node --test test/anchors.test.mjs`
Ожидание: FAIL, модуль не найден

- [ ] **Шаг 3: реализация**

```js
// studio/lib/anchors.mjs
/**
 * Треки якорей: где целевой элемент находился в кадре в каждый момент плана.
 *
 * Раньше съёмка записывала одну точку — результат boundingBox() ДО клика. Playwright
 * перед кликом сам прокручивает страницу к элементу, поэтому записанная координата
 * относилась к экрану, которого в кадре уже нет. В телеметрии mc-медиа так появилось
 * y=3673 при высоте кадра 810: монтаж упёр наезд в нижний край и показал пустоту.
 *
 * Трек снимается ПОСЛЕ прокрутки и продолжает сниматься всё время плана, поэтому камера
 * следует за элементом, а если элемент ушёл из кадра — трека нет и наезжать не на что.
 */

/** Интервал проб. Чаще незачем: за 100 мс интерфейс не успевает уехать незаметно. */
export const SAMPLE_MS = 100;

export function visible(rect, viewport) {
  if (!rect || rect.w <= 0 || rect.h <= 0) return false;
  return rect.x < viewport.width && rect.y < viewport.height
      && rect.x + rect.w > 0 && rect.y + rect.h > 0;
}

/** Положение якоря в момент t. Между пробами — линейно, за краями — крайняя проба. */
export function rectAt(track, t) {
  if (!track || track.length === 0) return null;
  if (t <= track[0].t) return track[0];
  if (t >= track[track.length - 1].t) return track[track.length - 1];

  for (let i = 1; i < track.length; i++) {
    if (track[i].t >= t) {
      const a = track[i - 1], b = track[i];
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
  /** clock — функция, отдающая время съёмки в секундах: треки живут в её шкале. */
  constructor(page, viewport, clock) {
    this.page = page;
    this.viewport = viewport;
    this.clock = clock;
    this.tracks = new Map();
    this.timer = null;
  }

  watch(selector) {
    if (selector && !this.tracks.has(selector)) this.tracks.set(selector, []);
  }

  start() {
    if (this.timer) return;
    this.timer = setInterval(() => { this.#sample(); }, SAMPLE_MS);
  }

  async #sample() {
    const selectors = [...this.tracks.keys()];
    if (!selectors.length) return;
    const t = this.clock();
    // Один заход в страницу на все якоря: по вызову на каждый — это лишние переходы
    // через CDP на каждой пробе.
    const rects = await this.page.evaluate((list) => list.map((sel) => {
      const el = document.querySelector(sel);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: r.x, y: r.y, w: r.width, h: r.height };
    }), selectors).catch(() => null);
    if (!rects) return;

    selectors.forEach((sel, i) => {
      const r = rects[i];
      if (r) this.tracks.get(sel).push({ t: Number(t.toFixed(3)), ...r });
    });
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    return [...this.tracks.entries()].map(([selector, rects]) => ({ selector, rects }));
  }
}
```

- [ ] **Шаг 4: тест проходит**

Выполнить: `node --test test/anchors.test.mjs`
Ожидание: PASS, 9 тестов

- [ ] **Шаг 5: коммит**

```bash
git add studio/lib/anchors.mjs test/anchors.test.mjs
git commit -m "Треки якорей: положение цели во времени вместо одной точки"
```

---

### Задача 5: Автопроверки дубля

Страховка на случай, когда чужой интерфейс придумает то, чего мы не предусмотрели. Все
четыре проверки — чистые функции над данными дубля, поэтому проверяются без браузера.

**Файлы:**
- Создать: `studio/lib/inspect.mjs`
- Создать: `test/inspect.test.mjs`

**Интерфейсы:**
- Потребляет: `visible` из задачи 4
- Отдаёт: `checkLoading(steps)`, `checkJumps(diffs, cuts, threshold)`,
  `checkAnchors(anchors, viewport)`, `checkDrops(times, fps)`,
  `inspect(take) → {ok, issues}`; каждая проверка возвращает массив
  `{kind, step?, at?, text}`

- [ ] **Шаг 1: тесты на четыре проверки**

```js
// test/inspect.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkLoading, checkJumps, checkAnchors, checkDrops, JUMP_THRESHOLD }
  from '../studio/lib/inspect.mjs';

test('шаг, где ожидание не сошлось, попадает в отчёт', () => {
  const issues = checkLoading([
    { n: 1, label: 'Медиатека', settle: { waitedMs: 900, reason: null } },
    { n: 4, label: 'Дискавери', settle: { waitedMs: 30000, reason: 'таймаут: картинка' } },
  ]);
  assert.equal(issues.length, 1);
  assert.equal(issues[0].step, 4);
  assert.match(issues[0].text, /картинка/);
});

test('чистый дубль не даёт замечаний по загрузке', () => {
  assert.deepEqual(checkLoading([{ n: 1, settle: { waitedMs: 500, reason: null } }]), []);
});

test('скачок содержимого вне склейки — замечание', () => {
  const diffs = [{ t: 1.0, diff: 0.02 }, { t: 2.0, diff: 0.9 }];
  const issues = checkJumps(diffs, [], JUMP_THRESHOLD);
  assert.equal(issues.length, 1);
  assert.equal(issues[0].at, 2.0);
});

test('запланированная склейка скачком не считается', () => {
  const diffs = [{ t: 2.0, diff: 0.9 }];
  assert.deepEqual(checkJumps(diffs, [{ from: 1.8, to: 2.2 }], JUMP_THRESHOLD), []);
});

test('порог скачка настраивается', () => {
  const diffs = [{ t: 1.0, diff: 0.5 }];
  assert.equal(checkJumps(diffs, [], 0.35).length, 1);
  assert.equal(checkJumps(diffs, [], 0.8).length, 0);
});

test('якорь вне кадра — замечание с номером шага', () => {
  const anchors = [{
    step: 6, selector: 'button.genre',
    rects: [{ t: 37.0, x: 177, y: 3673, w: 90, h: 28 }],
  }];
  const issues = checkAnchors(anchors, { width: 1440, height: 810 });
  assert.equal(issues.length, 1);
  assert.equal(issues[0].step, 6);
  assert.match(issues[0].text, /вне кадра/);
});

test('якорь, побывавший в кадре хоть раз, замечания не даёт', () => {
  const anchors = [{
    step: 6, selector: 'button.genre',
    rects: [
      { t: 37.0, x: 177, y: 3673, w: 90, h: 28 },
      { t: 37.4, x: 177, y: 420, w: 90, h: 28 },
    ],
  }];
  assert.deepEqual(checkAnchors(anchors, { width: 1440, height: 810 }), []);
});

test('пропуск кадров виден по интервалу', () => {
  // 30 к/с — период 33 мс. Полтора периода это 50 мс.
  const times = [0, 33, 66, 200, 233];
  const issues = checkDrops(times, 30);
  assert.equal(issues.length, 1);
  assert.match(issues[0].text, /кадр/);
});

test('ровная запись пропусков не даёт', () => {
  assert.deepEqual(checkDrops([0, 33, 66, 99, 132], 30), []);
});
```

- [ ] **Шаг 2: убедиться, что тест падает**

Выполнить: `node --test test/inspect.test.mjs`
Ожидание: FAIL, модуль не найден

- [ ] **Шаг 3: реализация**

```js
// studio/lib/inspect.mjs
/**
 * Автопроверки дубля — страховка, а не основная защита.
 *
 * Основная стратегия — предотвращение: ждём содержимое, крутим плавно, снимаем координаты
 * после прокрутки. Проверки нужны там, где чужой интерфейс придумает то, чего мы не
 * предусмотрели. Каждая отвечает на вопрос человека «что не так», а не «какое число
 * вышло за порог», поэтому замечание называет шаг и говорит словами.
 */
import { visible } from './anchors.mjs';

/** Доля изменившихся пикселей, выше которой это уже не движение, а смена экрана. */
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

/** Скачок содержимого вне запланированной склейки. */
export function checkJumps(diffs, cuts, threshold = JUMP_THRESHOLD) {
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
      text: `шаг ${a.step}: цель «${a.selector}» ни разу не была вне кадра — `
          + 'наезд не построен',
    }));
}

/** Потери кадров: интервал больше полутора периодов. */
export function checkDrops(times, fps) {
  const limit = (1000 / fps) * 1.5;
  const out = [];
  for (let i = 1; i < times.length; i++) {
    const gap = times[i] - times[i - 1];
    if (gap > limit) {
      out.push({
        kind: 'пропуск',
        at: times[i] / 1000,
        text: `${(times[i] / 1000).toFixed(1)} с: разрыв ${Math.round(gap)} мс — `
            + `потеряно кадров: ${Math.round(gap / (1000 / fps)) - 1}`,
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
```

- [ ] **Шаг 4: тест проходит**

Выполнить: `node --test test/inspect.test.mjs`
Ожидание: PASS, 9 тестов

- [ ] **Шаг 5: исправить формулировку в `checkAnchors`**

Текст замечания в реализации читается наоборот («ни разу не была вне кадра»).
Правильный текст: `цель «…» ни разу не попала в кадр — наезд не построен`.
Тест на подстроку `/вне кадра/` заменить на `/не попала в кадр/`.

- [ ] **Шаг 6: коммит**

```bash
git add studio/lib/inspect.mjs test/inspect.test.mjs
git commit -m "Автопроверки дубля: загрузка, скачки, якори, пропуски кадров"
```

---

### Задача 6: Рекордер 2× / 30 к/с

Playwright `recordVideo` пишет 1440×810 VP8 на 600 кбит/с при 25 к/с. CDP-скринкаст даёт
2×, 30 к/с и практически исходное качество. Реализация уже существует в
`capture/lib/recorder.mjs` — переносится и адаптируется под раскладку проектов.

**Файлы:**
- Создать: `studio/lib/recorder.mjs` (на основе `capture/lib/recorder.mjs`)
- Создать: `test/recorder.test.mjs`

**Интерфейсы:**
- Отдаёт: `class Recorder { constructor(page, {dir, fps, viewport, scale}); start();
  now(); stop() → Promise<{file, fps, frames, frameTimes, viewport, scale}> }`

- [ ] **Шаг 1: тест на сборку записи**

```js
// test/recorder.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Recorder } from '../studio/lib/recorder.mjs';

const run = promisify(execFile);

test('записывает в двойном разрешении и 30 к/с', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'takt-rec-'));
  const browser = await chromium.launch();
  const viewport = { width: 720, height: 405 };
  const page = await browser.newPage({ viewport, deviceScaleFactor: 2 });
  await page.setContent('<body style="background:#123"><h1>кадр</h1></body>');

  const rec = new Recorder(page, { dir, fps: 30, viewport, scale: 2 });
  await rec.start();
  await page.waitForTimeout(1200);
  const take = await rec.stop();
  await browser.close();

  const { stdout } = await run('ffprobe', ['-v', 'error', '-select_streams', 'v',
    '-show_entries', 'stream=width,height', '-of', 'csv=p=0', take.file]);
  assert.equal(stdout.trim(), '1440,810');
  assert.equal(take.fps, 30);
  assert.ok(take.frames > 20, `кадров всего ${take.frames}`);
  assert.equal(take.frameTimes.length, take.frames);

  fs.rmSync(dir, { recursive: true, force: true });
});
```

- [ ] **Шаг 2: убедиться, что тест падает**

Выполнить: `node --test test/recorder.test.mjs`
Ожидание: FAIL, модуль не найден

- [ ] **Шаг 3: реализация**

Взять `capture/lib/recorder.mjs` как основу и изменить:
- убрать понятие сцены и запись телеметрии — этим теперь занимается `shoot.mjs`;
- складывать результат в переданный `dir`, а не в `root/out/frames`;
- копить `frameTimes` — они нужны проверке пропусков из задачи 5;
- вернуть из `stop()` объект `{file, fps, frames, frameTimes, viewport, scale}`.

Кодирование остаётся прежним: `-framerate 30 -i f-%05d.jpg -c:v libx264 -preset slow
-crf 16 -pix_fmt yuv420p`.

- [ ] **Шаг 4: тест проходит**

Выполнить: `node --test test/recorder.test.mjs`
Ожидание: PASS

- [ ] **Шаг 5: коммит**

```bash
git add studio/lib/recorder.mjs test/recorder.test.mjs
git commit -m "Рекордер: скринкаст в 2x и 30 кадров вместо VP8 на 600 кбит/с"
```

---

### Задача 7: Сборка в `shoot.mjs`

Всё написанное включается в съёмку. `shoot.mjs` перестаёт содержать логику и становится
оркестратором.

**Файлы:**
- Изменить: `studio/shoot.mjs` — контекст без `recordVideo`, с `deviceScaleFactor: 2`;
  действия используют `smoothScroll` и `waitUntilSettled`; `AnchorTracker` на весь прогон;
  `Recorder` вместо `page.video()`; запись `take.json` и отчёта проверок
- Изменить: `studio/build.mjs` — читать `take.json`, вырезать интервалы загрузки

- [ ] **Шаг 1: контекст и рекордер**

В `studio/shoot.mjs` заменить создание контекста:

```js
const viewport = { width: 1440, height: 810 };
const context = await browser.newContext({
  viewport,
  deviceScaleFactor: 2,     // видео пишет скринкаст, а не recordVideo
  locale: 'ru-RU',
  colorScheme: 'dark',
});
```

Убрать `recordVideo` и всё, что связано с `page.video()`.

- [ ] **Шаг 2: действия переходят на новые примитивы**

```js
if (a.scroll !== undefined) {
  await smoothScroll(page, { distance: a.scroll, speed: a.speed });
  return;
}
if (a.click) {
  tracker.watch(a.click);
  await page.click(a.click, { timeout: 15000 });
  // Координаты берём ПОСЛЕ клика: до него Playwright ещё не прокрутил страницу к цели.
  await tracker.sampleNow(a.click);
}
```

`{"press": "PageDown"}` и `{"wait": N}` из сценариев убираются: первое заменяется
`{"scroll": 810}`, второе — ожиданием по содержимому.

- [ ] **Шаг 3: ожидание вместо пауз**

После действий шага:

```js
const settle = await waitUntilSettled(page, { waitFor: step.expect });
stepReport.push({ n: step.n, label: step.label, settle,
                  loadingFrom: tStart, loadingTo: tStart + settle.waitedMs / 1000 });
```

- [ ] **Шаг 4: take.json и отчёт**

```js
const take = {
  viewport, scale: 2, fps: 30,
  file: rec.file, frames: rec.frames, frameTimes: rec.frameTimes,
  steps: stepReport,
  anchors: tracker.stop(),
  diffs, cuts: [],
  jumpThreshold: target.jumpThreshold ?? 0.35,
};
fs.writeFileSync(inProject('take.json'), JSON.stringify(take, null, 2));
const report = inspect(take);
```

Замечания уходят в студию тем же каналом, что и статус, и печатаются в вывод команды.

- [ ] **Шаг 5: прогон на стенде**

```bash
node cli.mjs shoot
```

Ожидание: `take.json` создан; в отчёте нет замечаний вида «загрузка» и «якорь»;
`ffprobe` на записи показывает 2880×1620 и 30 к/с.

- [ ] **Шаг 6: коммит**

```bash
git add studio/shoot.mjs studio/build.mjs
git commit -m "Съёмка: скринкаст 2x, ожидание содержимым, плавная прокрутка, треки якорей"
```

## Самопроверка плана

**Покрытие спеки.** Раздел «Съёмка» покрыт задачами 2, 3, 4, 6, 7; автопроверки — задачей
5; принцип TDD — тестами в каждой задаче. Разделы «Модель данных», «Композиция», «Студия»,
«Флоу» относятся к стадиям 2–4 и в этот план намеренно не входят.

**Незакрытое в стадии 1.** Вырезание интервалов загрузки из мастера описано в задаче 7
шагом 4, но реально применяется в `build.mjs`; если объём окажется больше ожидаемого,
это выделяется в отдельную задачу 8.

**Согласованность имён.** `signature`/`differenceRatio` (задача 1) используются в
`settle.mjs` (задача 2). `visible` (задача 4) используется в `inspect.mjs` (задача 5).
`SAMPLE_MS` объявлен и в `settle.mjs` (250 мс), и в `anchors.mjs` (100 мс) — это разные
константы разных модулей, пересечения имён нет, потому что они не импортируются
друг в друга.
