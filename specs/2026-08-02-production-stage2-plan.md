# Стадия 2: композиция в браузере — план внедрения

> **Для исполнителя:** шаги помечены чекбоксами. Каждая задача заканчивается
> самостоятельно проверяемым результатом и своим коммитом. Выполнять через
> superpowers:subagent-driven-development или superpowers:executing-plans.

**Цель:** ролик собирается из снятых состояний чистой функцией `composeFrame(film, frame)`
— панорама, наезд, курсор, титры, мокап-рамка, — предпросмотр в студии и вывод в movie.mp4
идут одним кодом, Remotion выводится из поставки.

**Архитектура:** композиция разделена на чистую геометрию и тонкий DOM-слой.
`studio/compose/film.mjs` строит плёнку из `states.json` + `scenario.json`;
`studio/compose/frame.mjs` считает описание кадра (числа, без DOM); браузерный
`apply.mjs` применяет описание к DOM. Два привода — скраббер (`player.html` в студии)
и покадровый цикл (`studio/render.mjs`: seek → screenshot → ffmpeg stdin). За ffmpeg —
только кодирование и звук.

**Стек:** Node 22, встроенный `node:test`, Playwright 1.62, системный ffmpeg.
Новых зависимостей нет; Remotion, react и typescript уходят.

## Глобальные ограничения

- Новых зависимостей нет — ни рантайм, ни dev. Тесты на `node:test`.
- `studio/compose/{curves,film,frame}.mjs` — чистые модули без импортов Node:
  их грузит и браузер, и тесты.
- `sound.mjs` не трогать. За ffmpeg — кодирование, склейка, звук; ни одного
  выражения от времени.
- Частота ролика вычисляется из состава: все планы статичные — 30 к/с, есть живой —
  весь ролик 25 к/с. В стадии 2 проекты с живыми планами продолжают идти старым
  монтажом (`build.mjs`/`edit.mjs` как есть); композиция собирает только статичные.
- Потоковую передачу кадров в ffmpeg — только через `spawn`: у async `execFile`
  нет опции `input`, она молча игнорируется, ffmpeg виснет на stdin.
- Работа с браузером — только через API Playwright, без сырого CDP.
- Вывод: 1920×1080 (вертикаль 1080×1920), `deviceScaleFactor: 1`, JPEG q92 → x264 crf 18.
- Комментарии, сообщения и коммиты — по-русски, в стиле репозитория: почему, а не что.
- Каждая задача — свой коммит; пуш после завершения задач.

## Карта файлов

```
studio/compose/curves.mjs     интерполяция и кривые Безье            (чистый, тесты)
studio/compose/film.mjs       плёнка из states.json + scenario.json  (чистый, тесты)
studio/compose/frame.mjs      описание кадра из номера               (чистый, тесты)
studio/compose/apply.mjs      DOM: собрать сцену, применить кадр     (браузер)
studio/compose/player.html    страница предпросмотра со скраббером   (браузер)
studio/compose/player.js      привод №1: скраббер                    (браузер)
studio/render.mjs             привод №2: покадровый цикл → movie.mp4 (Node)
```

`film.json` как отдельная точка контроля появится в стадии 4; пока плёнка строится
на лету — и плеером, и приводом — из одних и тех же данных одной и той же функцией.

---

### Задача 1: кривые движения

Камера прототипа (`remotion-mc/pan.tsx`) едет на `Easing.bezier(0.45, 0, 0.25, 1)`
и `interpolate` от Remotion. Композиции нужны свои — это единственное, что она берёт
у Remotion, и оно умещается в сорок строк.

**Файлы:**
- Создать: `studio/compose/curves.mjs`
- Создать: `test/curves.test.mjs`

**Интерфейсы:**
- Отдаёт: `clamp(v, lo, hi) → number`;
  `interpolate(t, [a, b], [va, vb], { easing? }) → number` — вне диапазона прижимается
  к краям; `cubicBezier(x1, y1, x2, y2) → (x: 0..1) → 0..1`;
  `ride` — готовая кривая проезда камеры `cubicBezier(0.45, 0, 0.25, 1)`;
  `easeInOut` — `cubicBezier(0.42, 0, 0.58, 1)`.

- [ ] **Шаг 1: тесты**

```js
// test/curves.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clamp, interpolate, cubicBezier, ride } from '../studio/compose/curves.mjs';

test('interpolate: середина диапазона линейна', () => {
  assert.equal(interpolate(5, [0, 10], [0, 100]), 50);
});

test('interpolate: за краями прижимается, а не экстраполирует', () => {
  // Камера за границей плана должна стоять, а не улетать дальше цели.
  assert.equal(interpolate(-1, [0, 10], [0, 100]), 0);
  assert.equal(interpolate(11, [0, 10], [0, 100]), 100);
});

test('interpolate: вырожденный диапазон — левое значение, а не NaN', () => {
  assert.equal(interpolate(3, [3, 3], [7, 9]), 7);
});

test('interpolate: убывающий выход', () => {
  assert.equal(interpolate(2.5, [0, 10], [100, 0]), 75);
});

test('cubicBezier(0,0,1,1) — прямая', () => {
  const lin = cubicBezier(0, 0, 1, 1);
  for (const x of [0, 0.25, 0.5, 0.75, 1]) {
    assert.ok(Math.abs(lin(x) - x) < 1e-4, `x=${x} → ${lin(x)}`);
  }
});

test('ride: края точные, между ними — монотонный разгон и торможение', () => {
  assert.equal(ride(0), 0);
  assert.equal(ride(1), 1);
  let prev = 0;
  for (let x = 0.05; x <= 0.95; x += 0.05) {
    const v = ride(x);
    assert.ok(v > prev, `кривая не монотонна на x=${x}`);
    prev = v;
  }
  // Разгон: первая десятая часть пути даёт меньше десятой части дистанции.
  assert.ok(ride(0.1) < 0.1);
});

test('clamp', () => {
  assert.equal(clamp(5, 0, 10), 5);
  assert.equal(clamp(-1, 0, 10), 0);
  assert.equal(clamp(99, 0, 10), 10);
});
```

- [ ] **Шаг 2: убедиться, что тесты падают**

Запустить: `npm test`
Ожидание: FAIL — модуля `curves.mjs` нет.

- [ ] **Шаг 3: реализация**

```js
// studio/compose/curves.mjs
/**
 * Кривые движения камеры.
 *
 * Единственное, что композиция брала у Remotion, — interpolate и Easing.bezier.
 * Свои сорок строк дешевле пятисот мегабайт optionalDependencies: ролик — артефакт
 * сборки, и сборка обязана работать на голом Playwright + ffmpeg.
 *
 * Без импортов Node: модуль грузит и браузер (плеер), и node:test.
 */
export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

export function interpolate(t, [a, b], [va, vb], { easing = (x) => x } = {}) {
  if (b === a) return va;
  const x = clamp((t - a) / (b - a), 0, 1);
  return va + (vb - va) * easing(x);
}

/**
 * Кубическая кривая Безье как в CSS: по x подбирается параметр, отдаётся y.
 * Двоичный поиск вместо производных: 24 итерации дают точность лучше 1e-6,
 * а понять его можно с первого взгляда.
 */
export function cubicBezier(x1, y1, x2, y2) {
  const at = (u, p1, p2) => 3 * u * (1 - u) * (1 - u) * p1 + 3 * u * u * (1 - u) * p2 + u ** 3;
  return (x) => {
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    let lo = 0, hi = 1;
    for (let i = 0; i < 24; i++) {
      const mid = (lo + hi) / 2;
      if (at(mid, x1, x2) < x) lo = mid; else hi = mid;
    }
    return at((lo + hi) / 2, y1, y2);
  };
}

/** Проезд камеры: разгон и торможение, снято с утверждённого прототипа панорамы. */
export const ride = cubicBezier(0.45, 0, 0.25, 1);
export const easeInOut = cubicBezier(0.42, 0, 0.58, 1);
```

- [ ] **Шаг 4: тесты зелёные**

Запустить: `npm test`
Ожидание: PASS, все прежние 78 тестов тоже зелёные.

- [ ] **Шаг 5: коммит**

```bash
git add studio/compose/curves.mjs test/curves.test.mjs
git commit -m "Свои кривые движения: всё, что композиция брала у Remotion"
```

---

### Задача 2: плёнка — что показывать

Плёнка (`film`) — это ответ на вопрос «что в ролике и когда», собранный из манифеста
состояний и сценария. Здесь живут три правила, каждое тестируется отдельно:
частота из состава, камера по содержимому плана, фильтр липких слоёв.

**Файлы:**
- Создать: `studio/compose/film.mjs`
- Создать: `test/film.test.mjs`

**Интерфейсы:**
- Потребляет: манифест `states.json` (см. образец в
  `studio/journal/projects/mc-медиа/states.json`) и `scenario.json`
  (поля `steps[].n`, `label`, `seconds`).
- Отдаёт:
  - `filmFps(states) → 25 | 30` — 25, если есть хоть один `mode: 'live'`;
  - `visibleSticky(bands, viewport) → bands` — без контейнеров и полос вне вьюпорта;
  - `planCamera(state, seconds) → { kind: 'push', anchor: {cx, cy}, depth: 1.26 } |
    { kind: 'pan', to: px } | { kind: 'drift' }` — cx/cy в CSS-пикселях вьюпорта;
  - `buildFilm(manifest, scenario) → film`, где `film = { fps, screen: {w, h},
    title, seconds, plans: [...], clicks: [{t}] }`, план — `{ id, label, from, to,
    state, camera, cursor: {x, y, at} | null, title: {text, at} }`;
    при живых планах в манифесте — `throw` с текстом про старый монтаж.
- Константы (экспортируются, их используют frame.mjs и тесты): `LEAD = 0.6`
  (подводка до движения камеры), `TAIL = 1.6` (удержание после), `DEPTH = 1.26`
  (глубина наезда — из edit.mjs: мельче не читается, глубже теряет контекст),
  `PAN_SPEED = 600` (px/с, как в стадии 1), `TRANSITION = 0.35` (кроссфейд планов),
  `CLICK_AT = 1.5` (щелчок после подводки камеры и курсора).

- [ ] **Шаг 1: тесты**

```js
// test/film.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { filmFps, visibleSticky, planCamera, buildFilm }
  from '../studio/compose/film.mjs';

const VIEWPORT = { width: 1440, height: 810 };

/** Состояние как его пишет shoot.mjs; высота страницы задаётся в пикселях снимка (2×). */
const state = (over = {}) => ({
  id: 'p01', plan: 1, label: 'Ваша медиатека', mode: 'static',
  body: 'states/p01-body.jpg', layer: 'states/p01-layer.jpg',
  size: { w: 2880, h: 6152 }, viewport: VIEWPORT, scale: 2,
  sticky: [], anchors: [], settle: { waitedMs: 100, reason: null },
  ...over,
});

const scenario = { title: 'Демо', steps: [
  { n: 1, label: 'Ваша медиатека', seconds: 8 },
  { n: 2, label: 'Поиск', seconds: 6 },
] };

test('частота: все статичные — 30', () => {
  assert.equal(filmFps([state(), state({ id: 'p02', plan: 2 })]), 30);
});

test('частота: один живой — весь ролик 25', () => {
  // Пересчёт 25 в 30 дублированием — та судорога, ради которой всё затевалось.
  assert.equal(filmFps([state(), state({ id: 'p02', plan: 2, mode: 'live' })]), 25);
});

test('липкие: контейнер во весь экран отфильтрован', () => {
  // В mc-медиа есть fixed-div 1440×810 — портал для тостов. Нарисовать его слоем
  // значит накрыть панораму неподвижной копией экрана.
  const bands = [
    { edge: 'top', x: 0, y: 0, w: 1440, h: 49, tag: 'header', position: 'sticky' },
    { edge: 'top', x: 0, y: 0, w: 1440, h: 810, tag: 'div', position: 'fixed' },
  ];
  assert.deepEqual(visibleSticky(bands, VIEWPORT).map((b) => b.tag), ['header']);
});

test('липкие: полоса за правым краем вьюпорта отфильтрована', () => {
  // Выдвижная панель стоит на x=1440 — в кадре её нет, кроп из слоя был бы пустым.
  const bands = [
    { edge: 'right', x: 1440, y: 0, w: 420, h: 810, tag: 'aside', position: 'fixed' },
    { edge: 'left', x: 0, y: 49, w: 76, h: 762, tag: 'aside', position: 'sticky' },
  ];
  assert.deepEqual(visibleSticky(bands, VIEWPORT).map((b) => b.edge), ['left']);
});

test('камера: якорь → наезд в CSS-координатах', () => {
  const st = state({ anchors: [
    { selector: 'text=БОЕВИКИ', rect: { x: 2000, y: 1200, w: 200, h: 80 } },
  ] });
  const cam = planCamera(st, 8);
  assert.equal(cam.kind, 'push');
  // Центр якоря из шкалы снимка (2×) в CSS-шкалу вьюпорта.
  assert.equal(cam.anchor.cx, 1050);   // (2000 + 200/2) / 2
  assert.equal(cam.anchor.cy, 620);    // (1200 + 80/2) / 2
  assert.equal(cam.depth, 1.26);
});

test('камера: длинная страница без якоря → панорама, дистанция ограничена страницей', () => {
  const cam = planCamera(state(), 8);
  assert.equal(cam.kind, 'pan');
  // Страница 6152/2 = 3076 CSS px, вьюпорт 810 → дальше 2266 ехать некуда,
  // хотя 600 px/с за окно движения успели бы больше.
  assert.equal(cam.to, 2266);
});

test('камера: короткий план едет медленнее, а не столько же', () => {
  const cam = planCamera(state(), 4);
  // Окно движения 4 − 0.6 − 1.6 = 1.8 с → 600 px/с × 1.8 = 1080.
  assert.equal(cam.to, 1080);
});

test('камера: страница в один экран → дрейф', () => {
  const st = state({ size: { w: 2880, h: 1620 } });
  assert.equal(planCamera(st, 6).kind, 'drift');
});

test('плёнка: планы встык, длительности из сценария', () => {
  const film = buildFilm(
    { viewport: VIEWPORT, live: null, states: [state(), state({ id: 'p02', plan: 2, label: 'Поиск' })] },
    scenario,
  );
  assert.equal(film.fps, 30);
  assert.equal(film.seconds, 14);
  assert.deepEqual(film.plans.map((p) => [p.from, p.to]), [[0, 8], [8, 14]]);
  assert.equal(film.plans[1].title.text, 'Поиск');
});

test('плёнка: план с якорем получает курсор и щелчок для звука', () => {
  const st = state({ anchors: [{ selector: 'x', rect: { x: 2000, y: 1200, w: 200, h: 80 } }] });
  const film = buildFilm({ viewport: VIEWPORT, live: null, states: [st] },
                         { title: 'Демо', steps: [{ n: 1, label: 'Клик', seconds: 6 }] });
  assert.equal(film.plans[0].cursor.x, 1050);
  assert.equal(film.plans[0].cursor.at, 1.5);       // CLICK_AT от начала плана
  assert.deepEqual(film.clicks, [{ t: 1.5 }]);
});

test('плёнка: живой план — отказ с объяснением, а не молчаливый пропуск', () => {
  const manifest = { viewport: VIEWPORT, live: { video: 'x.webm', ranges: [] },
                     states: [state({ mode: 'live' })] };
  assert.throws(() => buildFilm(manifest, scenario), /старым монтажом/);
});

test('плёнка: шаг без seconds получает 6 по умолчанию', () => {
  const film = buildFilm({ viewport: VIEWPORT, live: null, states: [state()] },
                         { title: 'Демо', steps: [{ n: 1, label: 'Без секунд' }] });
  assert.equal(film.plans[0].to, 6);
});
```

- [ ] **Шаг 2: убедиться, что тесты падают** — `npm test` → FAIL, модуля нет.

- [ ] **Шаг 3: реализация**

```js
// studio/compose/film.mjs
/**
 * Плёнка: что показывать и когда, собранная из манифеста состояний и сценария.
 *
 * Длительности пока приходят из сценария (человек назначил секунды при разведке) —
 * их вывод из содержания плана появится вместе с раскадровкой в стадии 3. Здесь
 * важно другое: у плёнки ОДНО место сборки, и скраббер студии с покадровым приводом
 * читают её одной и той же функцией — им физически нечем разойтись.
 *
 * Без импортов Node: модуль грузит и браузер, и node:test.
 */

export const LEAD = 0.6;        // подводка: камера трогается не сразу
export const TAIL = 1.6;        // удержание: результат должен дочитаться
export const DEPTH = 1.26;      // глубина наезда — мельче не читается, глубже мылит
export const PAN_SPEED = 600;   // px/с, скорость прокрутки из стадии 1
export const TRANSITION = 0.35; // кроссфейд на границе планов
export const CLICK_AT = 1.5;    // щелчок: курсор успел доехать, камера — навестись

/** 25, если есть хоть один живой план: пересчёт частот дублированием запрещён. */
export const filmFps = (states) =>
  states.some((s) => s.mode === 'live') ? 25 : 30;

/**
 * Липкие полосы, которые имеет смысл рисовать.
 *
 * Полоса во весь экран — это не шапка, а контейнер порталов: нарисовать её значит
 * накрыть панораму неподвижной копией экрана. Полоса за краем вьюпорта — выдвижная
 * панель в закрытом состоянии: кроп из слоя был бы пустым.
 */
export function visibleSticky(bands, viewport) {
  return (bands || []).filter((b) =>
    b.w * b.h <= viewport.width * viewport.height * 0.5
    && b.x < viewport.width && b.y < viewport.height);
}

/**
 * Камера плана: по содержимому, а не по вкусу.
 * Есть якорь — наезд: действие важнее пейзажа. Страница длинная — панорама.
 * Иначе — дрейф: неподвижный кадр читается как стоп-кадр.
 */
export function planCamera(state, seconds) {
  const a = (state.anchors || []).find((x) => x.rect);
  const k = state.scale || 1;
  if (a) {
    return { kind: 'push', depth: DEPTH, anchor: {
      cx: Math.round((a.rect.x + a.rect.w / 2) / k),
      cy: Math.round((a.rect.y + a.rect.h / 2) / k),
    } };
  }
  const pageH = (state.size?.h || 0) / k;
  const maxPan = Math.max(0, pageH - state.viewport.height);
  if (maxPan > state.viewport.height * 0.2) {
    const window = Math.max(0, seconds - LEAD - TAIL);
    return { kind: 'pan', to: Math.min(maxPan, Math.round(PAN_SPEED * window)) };
  }
  return { kind: 'drift' };
}

export function buildFilm(manifest, scenario) {
  const states = manifest.states || [];
  if (states.some((s) => s.mode === 'live')) {
    throw new Error('в съёмке есть живые планы — такой проект пока собирается старым монтажом (takt build/edit)');
  }

  const bySteps = new Map((scenario?.steps || []).map((s) => [s.n, s]));
  const plans = [];
  const clicks = [];
  let at = 0;

  for (const st of states) {
    const step = bySteps.get(st.plan) || {};
    const seconds = step.seconds || 6;
    const camera = planCamera(st, seconds);
    // Курсор существует ради действия: без якоря ему не к чему ехать и нечего нажимать.
    const cursor = camera.kind === 'push'
      ? { x: camera.anchor.cx, y: camera.anchor.cy, at: CLICK_AT }
      : null;
    if (cursor) clicks.push({ t: at + cursor.at });

    plans.push({
      id: st.id, label: st.label,
      from: at, to: at + seconds,
      state: { ...st, sticky: visibleSticky(st.sticky, st.viewport) },
      camera, cursor,
      title: { text: step.label || st.label, at: at + 0.15 },
    });
    at += seconds;
  }

  return {
    fps: filmFps(states),
    screen: { w: manifest.viewport.width, h: manifest.viewport.height },
    title: scenario?.title || '',
    seconds: at,
    plans, clicks,
  };
}
```

- [ ] **Шаг 4: тесты зелёные** — `npm test` → PASS.

- [ ] **Шаг 5: коммит**

```bash
git add studio/compose/film.mjs test/film.test.mjs
git commit -m "Плёнка: частота из состава, камера по содержимому, липкие без контейнеров"
```

---

### Задача 3: кадр из номера

Сердце стадии. `composeFrame(film, n)` — чистая геометрия: где стоит снимок, куда
наведена камера, где курсор, насколько поднялся титр. Ни DOM, ни браузера — только
числа, поэтому кадр тестируется как функция.

**Файлы:**
- Создать: `studio/compose/frame.mjs`
- Создать: `test/frame.test.mjs`

**Интерфейсы:**
- Потребляет: `film` из задачи 2, константы `LEAD`, `TAIL`, `TRANSITION`, `CLICK_AT`;
  `interpolate`, `ride`, `easeInOut`, `clamp` из задачи 1.
- Отдаёт: `composeFrame(film, n) → desc`:

```js
{
  screens: [                       // 1 обычно, 2 внутри кроссфейда (сверху — входящий)
    { plan: 'p01', opacity: 1,
      scrollY: 812,                              // CSS px, сдвиг тела вверх
      camera: { scale: 1.13, ox: 60.3, oy: 61.9 }, // масштаб и центр (% ширины/высоты)
      sticky: [{ x, y, w, h }],                  // CSS px, кропы слоя
      cursor: { x, y, pressed: false, opacity: 0.9 } | null },
  ],
  caption: { text: 'Поиск', progress: 0.7 } | null,   // progress 0..1 — подъём титра
}
```

- Правила (все — предмет тестов):
  - `pan`: `scrollY = interpolate(t, [LEAD, dur − TAIL], [0, to], ride)`;
  - `push`: `scale = interpolate(t, [LEAD, LEAD + 0.9], [1, depth], easeInOut)`;
    центр — как в edit.mjs: притяжение к середине 0.45, зажим `ox ∈ [22, 78]`,
    `oy ∈ [24, 76]` (иначе наезд выбрасывает контекст из кадра);
  - `drift`: `scale = interpolate(t, [0, 2.6], [1.045, 1])` — вступительный наплыв
    прототипа;
  - курсор: появляется в `(0.55·w, 0.9·h)` на `t = LEAD`, доезжает к якорю
    к `CLICK_AT − 0.1`, `pressed` в окне `[CLICK_AT, CLICK_AT + 0.18]`, гаснет
    к `CLICK_AT + 1.0`;
  - кроссфейд: в окне `[to − TRANSITION, to]` два экрана, у входящего
    `opacity = (t − (to − TRANSITION)) / TRANSITION`;
  - титр: `progress = interpolate(t, [at, at + 0.45], [0, 1], easeInOut)`,
    титр живёт до конца плана.

- [ ] **Шаг 1: тесты**

```js
// test/frame.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { composeFrame } from '../studio/compose/frame.mjs';
import { buildFilm } from '../studio/compose/film.mjs';

const VIEWPORT = { width: 1440, height: 810 };
const state = (over = {}) => ({
  id: 'p01', plan: 1, label: 'Лента', mode: 'static',
  body: 'states/p01-body.jpg', layer: 'states/p01-layer.jpg',
  size: { w: 2880, h: 6152 }, viewport: VIEWPORT, scale: 2,
  sticky: [{ edge: 'top', x: 0, y: 0, w: 1440, h: 49, tag: 'header', position: 'sticky' }],
  anchors: [], settle: {},
  ...over,
});

const panFilm = () => buildFilm(
  { viewport: VIEWPORT, live: null, states: [state()] },
  { title: 'Демо', steps: [{ n: 1, label: 'Лента', seconds: 8 }] },
);

test('панорама: до подводки стоим, к началу удержания доехали', () => {
  const film = panFilm();
  assert.equal(composeFrame(film, 0).screens[0].scrollY, 0);
  // t = 0.6 — камера ещё не тронулась.
  assert.equal(composeFrame(film, Math.round(0.6 * 30)).screens[0].scrollY, 0);
  // t = 6.4 = 8 − 1.6 — приехали: вся дистанция 2266 (задача 2 объясняет число).
  assert.equal(composeFrame(film, Math.round(6.4 * 30)).screens[0].scrollY, 2266);
});

test('панорама: в середине едем, а не стоим и не телепортируемся', () => {
  const y = composeFrame(panFilm(), Math.round(3.5 * 30)).screens[0].scrollY;
  assert.ok(y > 0 && y < 2266, `scrollY=${y}`);
});

test('панорама: липкий слой отдан кадру как есть', () => {
  const fr = composeFrame(panFilm(), 90);
  assert.deepEqual(fr.screens[0].sticky, [{ x: 0, y: 0, w: 1440, h: 49 }]);
});

const pushFilm = () => buildFilm(
  { viewport: VIEWPORT, live: null,
    states: [state({ anchors: [{ selector: 'x', rect: { x: 2000, y: 1200, w: 200, h: 80 } }] })] },
  { title: 'Демо', steps: [{ n: 1, label: 'Клик', seconds: 6 }] },
);

test('наезд: масштаб дошёл до глубины, центр зажат у якоря', () => {
  const fr = composeFrame(pushFilm(), Math.round(2.0 * 30));
  const cam = fr.screens[0].camera;
  assert.equal(cam.scale, 1.26);
  // Якорь (1050, 620) CSS: ox = 50 + (1050/1440 − 0.5)·45 ≈ 60.3.
  assert.ok(Math.abs(cam.ox - 60.3) < 0.1, `ox=${cam.ox}`);
  assert.ok(Math.abs(cam.oy - 61.9) < 0.1, `oy=${cam.oy}`);
});

test('курсор: до подводки нет, в момент щелчка нажат, потом гаснет', () => {
  const film = pushFilm();
  assert.equal(composeFrame(film, 0).screens[0].cursor, null);
  const click = composeFrame(film, Math.round(1.55 * 30)).screens[0].cursor;
  assert.ok(click.pressed);
  assert.ok(Math.abs(click.x - 1050) < 2 && Math.abs(click.y - 620) < 2);
  assert.equal(composeFrame(film, Math.round(3.0 * 30)).screens[0].cursor, null);
});

const twoPlans = () => buildFilm(
  { viewport: VIEWPORT, live: null,
    states: [state(), state({ id: 'p02', plan: 2, label: 'Поиск' })] },
  { title: 'Демо', steps: [
    { n: 1, label: 'Лента', seconds: 8 }, { n: 2, label: 'Поиск', seconds: 6 },
  ] },
);

test('кроссфейд: внутри окна два экрана, входящий набирает непрозрачность', () => {
  // t = 7.9, окно [7.65, 8]: прошло 0.25 из 0.35.
  const fr = composeFrame(twoPlans(), Math.round(7.9 * 30));
  assert.equal(fr.screens.length, 2);
  assert.equal(fr.screens[0].plan, 'p01');
  assert.equal(fr.screens[1].plan, 'p02');
  assert.ok(Math.abs(fr.screens[1].opacity - 0.25 / 0.35) < 0.05);
});

test('кроссфейд: вне окна экран один', () => {
  assert.equal(composeFrame(twoPlans(), Math.round(5 * 30)).screens.length, 1);
  assert.equal(composeFrame(twoPlans(), Math.round(9 * 30)).screens.length, 1);
  assert.equal(composeFrame(twoPlans(), Math.round(9 * 30)).screens[0].plan, 'p02');
});

test('титр: поднимается после начала плана и живёт до его конца', () => {
  const film = twoPlans();
  assert.ok(composeFrame(film, Math.round(0.2 * 30)).caption.progress < 1);
  assert.equal(composeFrame(film, Math.round(2 * 30)).caption.progress, 1);
  assert.equal(composeFrame(film, Math.round(2 * 30)).caption.text, 'Лента');
  assert.equal(composeFrame(film, Math.round(9 * 30)).caption.text, 'Поиск');
});

test('последний кадр не выпадает за плёнку', () => {
  const film = twoPlans();
  const last = Math.round(film.seconds * film.fps) - 1;
  assert.equal(composeFrame(film, last).screens.length, 1);
});
```

- [ ] **Шаг 2: убедиться, что тесты падают** — `npm test` → FAIL.

- [ ] **Шаг 3: реализация**

```js
// studio/compose/frame.mjs
/**
 * Кадр из номера — сердце композиции.
 *
 * Ничего не снимается и не ловится: описание кадра ВЫЧИСЛЯЕТСЯ из плёнки и номера,
 * поэтому дропнутых кадров не существует по построению, а предпросмотр и вывод
 * не могут разойтись — это одна функция. Здесь только числа: DOM применяет их
 * отдельным тонким слоем (apply.mjs), который не знает, откуда они взялись.
 */
import { interpolate, ride, easeInOut, clamp } from './curves.mjs';
import { LEAD, TAIL, TRANSITION, CLICK_AT } from './film.mjs';

/** Притяжение центра наезда к середине: см. edit.mjs — контекст дороже точности. */
const PULL = 0.45;

export function composeFrame(film, n) {
  const t = n / film.fps;
  const current = film.plans.find((p) => t >= p.from && t < p.to)
    || film.plans[film.plans.length - 1];
  const screens = [screenAt(film, current, t)];

  // Кроссфейд на границе: входящий план поверх уходящего набирает непрозрачность.
  const next = film.plans[film.plans.indexOf(current) + 1];
  if (next && t >= current.to - TRANSITION) {
    screens.push({ ...screenAt(film, next, t),
                   opacity: (t - (current.to - TRANSITION)) / TRANSITION });
  }

  return { screens, caption: captionAt(current, t) };
}

function screenAt(film, plan, t) {
  const local = clamp(t - plan.from, 0, plan.to - plan.from);
  const dur = plan.to - plan.from;
  const cam = plan.camera;
  const { w, h } = film.screen;

  let scrollY = 0;
  let camera = { scale: 1, ox: 50, oy: 50 };

  if (cam.kind === 'pan') {
    scrollY = Math.round(interpolate(local, [LEAD, dur - TAIL], [0, cam.to],
                                     { easing: ride }));
  } else if (cam.kind === 'push') {
    camera = {
      scale: interpolate(local, [LEAD, LEAD + 0.9], [1, cam.depth], { easing: easeInOut }),
      ox: clamp(50 + (cam.anchor.cx / w - 0.5) * PULL * 100, 22, 78),
      oy: clamp(50 + (cam.anchor.cy / h - 0.5) * PULL * 100, 24, 76),
    };
  } else {
    // Дрейф: вступительный наплыв — неподвижный кадр читается как стоп-кадр.
    camera = { scale: interpolate(local, [0, 2.6], [1.045, 1]), ox: 50, oy: 50 };
  }

  return { plan: plan.id, opacity: 1, scrollY, camera,
           sticky: plan.state.sticky.map(({ x, y, w: bw, h: bh }) => ({ x, y, w: bw, h: bh })),
           cursor: cursorAt(plan, local, film.screen) };
}

/** Курсор: приехать, нажать, погаснуть. Без него действие выглядит самопроизвольным. */
function cursorAt(plan, local, screen) {
  if (!plan.cursor) return null;
  const { x, y, at } = plan.cursor;
  if (local < LEAD || local > at + 1.0) return null;
  return {
    x: interpolate(local, [LEAD, at - 0.1], [screen.w * 0.55, x], { easing: easeInOut }),
    y: interpolate(local, [LEAD, at - 0.1], [screen.h * 0.9, y], { easing: easeInOut }),
    pressed: local >= at && local <= at + 0.18,
    opacity: interpolate(local, [at + 0.6, at + 1.0], [1, 0]),
  };
}

function captionAt(plan, t) {
  if (!plan.title || t < plan.title.at) return null;
  return { text: plan.title.text,
           progress: interpolate(t, [plan.title.at, plan.title.at + 0.45], [0, 1],
                                 { easing: easeInOut }) };
}
```

- [ ] **Шаг 4: тесты зелёные** — `npm test` → PASS.

- [ ] **Шаг 5: коммит**

```bash
git add studio/compose/frame.mjs test/frame.test.mjs
git commit -m "Кадр вычисляется из номера: панорама, наезд, курсор, титр, кроссфейд"
```

---

### Задача 4: сцена в DOM и скраббер — привод №1

Тонкий слой: собрать сцену (фон, мокап-рамка, экраны, курсор, титр, виньетка) и
применять к ней описание кадра. Layout и стиль переезжают из утверждённого прототипа
`remotion-mc/pan.tsx`; титр и курсор — по образцам из `titles.mjs` (шаблоны оттуда
не импортируются: titles.mjs — Node-модуль, а здесь браузер; совпадение стиля
проверяется глазами в шаге 4).

**Файлы:**
- Создать: `studio/compose/apply.mjs`
- Создать: `studio/compose/player.html`
- Создать: `studio/compose/player.js`
- Изменить: `studio/index.html` — ссылка на предпросмотр композиции.

**Интерфейсы:**
- `apply.mjs` отдаёт: `mountScene(root, film, base) → scene` — строит DOM один раз,
  `base` — префикс URL снимков (`/project/`); `applyFrame(scene, desc)` — мутирует
  трансформы по описанию кадра. Экраны создаются по одному на план и
  переключаются видимостью: пересоздавать DOM на каждом кадре — значит терять
  кеш декодированных картинок.
- `player.js`: грузит `/project/states.json` и `/api/scenario`, строит плёнку,
  ждёт декодирования всех снимков и шрифтов, выставляет
  `window.__takt = { ready: true, film: { fps, seconds, frames, clicks }, seek(n) }`.
  С `?render=1` панель управления не строится вовсе — в кадр вывода попадает
  только сцена.

- [ ] **Шаг 1: apply.mjs**

```js
// studio/compose/apply.mjs
/**
 * Сцена и применение кадра. Тонкий слой у композиции: вся геометрия уже посчитана
 * в frame.mjs числами, здесь она только доносится до стилей. Логики нет намеренно —
 * всё, что можно проверить без браузера, живёт в frame.mjs под тестами.
 *
 * Layout — из утверждённого прототипа панорамы (remotion-mc/pan.tsx): фон двумя
 * радиальными пятнами, окно с горошинами, виньетка. Титры и курсор следуют
 * titles.mjs — брендовая типографика, а не системный шрифт.
 */
const W = 1920, H = 1080;

export function mountScene(root, film, base) {
  const { w: sw, h: sh } = film.screen;
  // Окно прототипа: 1330 из 1920 по ширине, экран вписан масштабом.
  const winW = 1330, scale = winW / sw;

  root.innerHTML = `
    <div class="scene" style="position:relative;width:${W}px;height:${H}px;overflow:hidden;
      background:radial-gradient(72% 92% at 78% 4%,#14335f,transparent 62%),
                 radial-gradient(60% 80% at 8% 98%,#0d3b34,transparent 60%),
                 linear-gradient(158deg,#0b1120,#070a11 72%)">
      <div class="window" style="position:absolute;left:${(W - winW) / 2}px;top:54px;width:${winW}px;
        border-radius:14px;overflow:hidden;background:#12161d;
        box-shadow:0 60px 120px -22px rgba(0,0,0,.8),0 0 0 1px rgba(255,255,255,.07),
                   0 0 160px -50px rgba(1,98,228,.5)">
        <div style="height:40px;display:flex;align-items:center;gap:9px;padding:0 16px;
          background:linear-gradient(#242a34,#1b2029)">
          <span style="width:12px;height:12px;border-radius:50%;background:#ff5f57"></span>
          <span style="width:12px;height:12px;border-radius:50%;background:#febc2e"></span>
          <span style="width:12px;height:12px;border-radius:50%;background:#28c840"></span>
          <span style="margin-left:18px;color:rgba(255,255,255,.45);
            font:500 15px 'Golos Text',system-ui,sans-serif">${film.title}</span>
        </div>
        <div class="stage" style="position:relative;width:${winW}px;height:${Math.round(sh * scale)}px;
          overflow:hidden"></div>
      </div>
      <div style="position:absolute;inset:0;pointer-events:none;
        background:radial-gradient(118% 90% at 50% 42%,transparent 54%,rgba(0,0,0,.5))"></div>
      <div class="caption" style="position:absolute;left:0;right:0;bottom:58px;text-align:center;
        padding:0 140px"><div style="overflow:hidden;padding-bottom:12px"><div class="caption-text"
        style="font:800 50px/1.1 'Unbounded',system-ui,sans-serif;color:#fff;
        letter-spacing:-.035em;text-shadow:0 12px 48px rgba(0,0,0,.9);
        transform:translateY(110%)"></div></div></div>
    </div>`;

  const stage = root.querySelector('.stage');
  const screens = new Map();
  for (const plan of film.plans) {
    const el = document.createElement('div');
    el.style.cssText = `position:absolute;inset:0;display:none`;
    // Внутри — виртуальный экран в CSS-пикселях съёмки, вписанный масштабом:
    // так вся геометрия кадра остаётся в одной шкале со снимками.
    el.innerHTML = `
      <div class="cam" style="position:absolute;left:0;top:0;width:${sw}px;height:${sh}px;
        transform-origin:0 0;transform:scale(${scale})">
        <div class="zoom" style="position:absolute;inset:0">
          <img class="body" src="${base}${plan.state.body}" style="position:absolute;left:0;top:0;
            width:${sw}px;will-change:transform">
          ${plan.state.sticky.map((b) => `
            <div style="position:absolute;left:${b.x}px;top:${b.y}px;width:${b.w}px;
              height:${b.h}px;overflow:hidden">
              <img src="${base}${plan.state.layer}" style="position:absolute;
                left:${-b.x}px;top:${-b.y}px;width:${sw}px"></div>`).join('')}
          <div class="cursor" style="position:absolute;width:26px;height:26px;margin:-13px 0 0 -13px;
            border-radius:50%;background:rgba(255,255,255,.9);
            box-shadow:0 0 0 5px rgba(255,255,255,.28),0 6px 22px rgba(0,0,0,.5);
            opacity:0;will-change:transform"></div>
        </div>
      </div>`;
    stage.appendChild(el);
    screens.set(plan.id, {
      el, zoom: el.querySelector('.zoom'), body: el.querySelector('.body'),
      cursor: el.querySelector('.cursor'),
    });
  }

  return { screens, captionText: root.querySelector('.caption-text'), lastText: '' };
}

export function applyFrame(scene, desc) {
  for (const [, s] of scene.screens) s.el.style.display = 'none';
  for (const d of desc.screens) {
    const s = scene.screens.get(d.plan);
    s.el.style.display = '';
    s.el.style.opacity = String(d.opacity);
    s.body.style.transform = `translateY(${-d.scrollY}px)`;
    s.zoom.style.transform = `scale(${d.camera.scale})`;
    s.zoom.style.transformOrigin = `${d.camera.ox}% ${d.camera.oy}%`;
    if (d.cursor) {
      s.cursor.style.opacity = String(d.cursor.opacity);
      // Курсор целится в якорь — его координаты в шкале СТРАНИЦЫ, а рисуется он
      // в шкале экрана: прокрутку надо вычесть. На планах с наездом scrollY = 0,
      // поэтому ошибка здесь не проявилась бы на смоуке — не полагаться на него.
      s.cursor.style.transform = `translate(${d.cursor.x}px,${d.cursor.y - d.scrollY}px)`
        + (d.cursor.pressed ? ' scale(.72)' : '');
    } else {
      s.cursor.style.opacity = '0';
    }
  }
  const cap = desc.caption;
  if (cap) {
    if (cap.text !== scene.lastText) {
      scene.captionText.textContent = cap.text;
      scene.lastText = cap.text;
    }
    scene.captionText.style.transform = `translateY(${110 - 110 * cap.progress}%)`;
  } else {
    scene.captionText.style.transform = 'translateY(110%)';
  }
}
```

- [ ] **Шаг 2: player.html и player.js**

```html
<!-- studio/compose/player.html -->
<!doctype html>
<html lang="ru">
<meta charset="utf-8">
<title>Композиция — предпросмотр</title>
<link rel="stylesheet"
  href="https://fonts.googleapis.com/css2?family=Unbounded:wght@600;800&family=Golos+Text:wght@400;500;600&display=swap">
<style>
  body { margin: 0; background: #070a11; color: #cfd6e4;
         font: 14px 'Golos Text', system-ui, sans-serif; }
  /* Сцена рендерится в честных 1920×1080 и вписывается в окно масштабом:
     привод вывода снимает её 1:1, человеку она ужимается под его экран. */
  #frame { transform-origin: 0 0; }
  #controls { display: flex; gap: 12px; align-items: center; padding: 10px 16px; }
  #controls input[type=range] { flex: 1; accent-color: #4c8dff; }
  #controls button { background: #182034; color: inherit; border: 1px solid #2a3550;
                     border-radius: 8px; padding: 6px 14px; cursor: pointer; }
</style>
<div id="frame"><div id="root"></div></div>
<div id="controls" hidden>
  <button id="play" aria-label="Играть/пауза">▶</button>
  <input id="scrub" type="range" min="0" value="0" step="1"
         aria-label="Позиция ролика по кадрам">
  <span id="time">0:00 / 0:00</span>
</div>
<script type="module" src="/compose/player.js"></script>
```

```js
// studio/compose/player.js
/**
 * Привод №1 — скраббер. Ролик смотрится без рендера: кадр вычисляется из позиции
 * ползунка той же функцией, которой привод вывода считает кадры для ffmpeg.
 * С ?render=1 страница отдаёт только сцену: панель управления в кадр не попадает.
 */
import { buildFilm } from './film.mjs';
import { composeFrame } from './frame.mjs';
import { mountScene, applyFrame } from './apply.mjs';

const render = new URLSearchParams(location.search).get('render') === '1';

const [manifest, scenario] = await Promise.all([
  fetch('/project/states.json').then((r) => r.json()),
  fetch('/api/scenario').then((r) => r.json()),
]);
const film = buildFilm(manifest, scenario);
const frames = Math.round(film.seconds * film.fps);

const scene = mountScene(document.getElementById('root'), film, '/project/');

// Кадры листаются без сети: все снимки должны быть декодированы до ready,
// иначе привод вывода снимет кадр с ещё серой картинкой.
await Promise.all([...document.images].map((img) => img.decode().catch(() => {})));
await document.fonts.ready;

let current = -1;
const seek = (n) => {
  const k = Math.max(0, Math.min(frames - 1, n));
  if (k === current) return;
  current = k;
  applyFrame(scene, composeFrame(film, k));
};
seek(0);

window.__takt = { ready: true, seek,
  film: { fps: film.fps, seconds: film.seconds, frames, clicks: film.clicks } };

if (!render) {
  const controls = document.getElementById('controls');
  controls.hidden = false;
  const scrub = document.getElementById('scrub');
  const time = document.getElementById('time');
  const play = document.getElementById('play');
  scrub.max = String(frames - 1);
  const mmss = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

  const show = (n) => { seek(n); scrub.value = String(current);
    time.textContent = `${mmss(current / film.fps)} / ${mmss(film.seconds)}`; };
  scrub.addEventListener('input', () => show(Number(scrub.value)));

  let playing = null;
  play.addEventListener('click', () => {
    if (playing) { clearInterval(playing); playing = null; play.textContent = '▶'; return; }
    play.textContent = '⏸';
    playing = setInterval(() => {
      if (current >= frames - 1) { clearInterval(playing); playing = null; play.textContent = '▶'; }
      else show(current + 1);
    }, 1000 / film.fps);
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowRight') show(current + (e.shiftKey ? 30 : 1));
    if (e.key === 'ArrowLeft') show(current - (e.shiftKey ? 30 : 1));
    if (e.key === ' ') { e.preventDefault(); play.click(); }
  });

  // Человеку сцена ужимается под окно; приводу вывода — нет.
  const fit = () => {
    const s = Math.min(1, innerWidth / 1920, (innerHeight - 60) / 1080);
    document.getElementById('frame').style.transform = `scale(${s})`;
    document.getElementById('frame').style.height = `${1080 * s}px`;
  };
  fit();
  addEventListener('resize', fit);
}
```

- [ ] **Шаг 3: ссылка из студии**

В `studio/index.html` рядом с плеером добавить ссылку (точное место — по вёрстке
панели ролика, класс и стиль — существующие студийные):

```html
<a href="/compose/player.html" target="_blank" data-when-states>Предпросмотр композиции</a>
```

и в `studio/app.js` показывать её только когда манифест есть:

```js
// Композиция доступна, когда снят хотя бы один манифест состояний.
fetch('/project/states.json', { method: 'HEAD' }).then((r) => {
  for (const el of document.querySelectorAll('[data-when-states]'))
    el.hidden = !r.ok;
}).catch(() => {});
```

- [ ] **Шаг 4: проверить глазами в браузере**

Поднять студию через preview_start (`takt-studio` из `.claude/launch.json`), убедиться
что открыт проект `mc-медиа`, открыть `http://localhost:4173/compose/player.html`.
Проверить: панорама едет с разгоном и торможением; шапка (липкий слой) стоит, тело
едет под ней; титры поднимаются; кроссфейд на границах планов; скраббер и стрелки
листают кадры мгновенно; `?render=1` показывает голую сцену 1920×1080.
Снять скриншоты пары кадров для отчёта.

- [ ] **Шаг 5: `npm test` зелёный, коммит**

```bash
git add studio/compose/apply.mjs studio/compose/player.html studio/compose/player.js \
        studio/index.html studio/app.js
git commit -m "Скраббер композиции: ролик смотрится без рендера"
```

---

### Задача 5: покадровый цикл — привод №2 и movie.mp4

Вывод: та же страница, тот же `seek`, но кадры уходят в ffmpeg. За ffmpeg —
только кодирование и звук.

**Файлы:**
- Создать: `studio/render.mjs`

**Интерфейсы:**
- Потребляет: `window.__takt` из задачи 4; `buildSound` из `sound.mjs`
  (`{ video, out, hits, duration, work }`); `SERVER_INFO` из `home.mjs`;
  `inProject` из `project.mjs`.
- Отдаёт: `node studio/render.mjs [--out файл] [--silent]` → `movie.mp4` проекта,
  POST `/api/movie` в студию. Код возврата 0/1.

- [ ] **Шаг 1: реализация**

```js
// studio/render.mjs
/**
 * Привод №2 — покадровый цикл: seek → screenshot → stdin ffmpeg.
 *
 * Кадры считает та же композиция, что и скраббер студии, — им нечем разойтись.
 * Замер прототипа: 24,9 мс на кадр с тенями и трансформами; ролик в три тысячи
 * кадров — около двух минут. Дропнутых кадров не существует по построению.
 *
 * ffmpeg получает кадры через spawn и stdin: у async execFile опции input нет —
 * она молча игнорируется, и ffmpeg виснет на чтении. Оплачено в стадии 1.
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { chromium } from 'playwright';
import { inProject } from './project.mjs';
import { SERVER_INFO } from './home.mjs';
import { buildSound } from './sound.mjs';

const run = promisify(execFile);
const silent = process.argv.includes('--silent');
const outArg = (() => {
  const i = process.argv.indexOf('--out');
  return i !== -1 ? process.argv[i + 1] : null;
})();

const info = JSON.parse(fs.readFileSync(SERVER_INFO, 'utf8'));
const base = `http://localhost:${info.port}`;
const api = (route, payload) =>
  fetch(`${base}${route}?token=${info.token}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }).then((r) => r.json()).catch(() => null);

const manifestPath = inProject('states.json');
if (!fs.existsSync(manifestPath)) {
  console.error('Нет манифеста состояний: сначала снимите сценарий (takt shoot)');
  process.exit(1);
}
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
if (manifest.live) {
  console.error('В съёмке есть живые планы — собирайте старым монтажом: takt build, takt edit');
  process.exit(1);
}

const W = 1920, H = 1080;
const work = inProject('edit');
fs.mkdirSync(work, { recursive: true });

await api('/api/status', { state: 'busy', text: 'Собираю ролик из состояний', step: null, of: null });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: W, height: H } });
let film;
const t0 = Date.now();
try {
  await page.goto(`${base}/compose/player.html?render=1`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__takt?.ready, null, { timeout: 60000 });
  film = await page.evaluate(() => window.__takt.film);

  const body = path.join(work, 'body.mp4');
  const ff = spawn('ffmpeg', [
    '-v', 'error', '-y',
    '-f', 'image2pipe', '-framerate', String(film.fps), '-i', '-',
    '-c:v', 'libx264', '-preset', 'medium', '-crf', '18',
    '-pix_fmt', 'yuv420p', '-movflags', '+faststart', body,
  ], { stdio: ['pipe', 'ignore', 'pipe'] });
  let ffErr = '';
  ff.stderr.on('data', (d) => { ffErr += d; });
  const ffDone = new Promise((resolve, reject) => {
    ff.on('close', (code) => (code === 0 ? resolve() : reject(new Error(ffErr || `ffmpeg: ${code}`))));
  });

  for (let n = 0; n < film.frames; n++) {
    await page.evaluate((k) => window.__takt.seek(k), n);
    const shot = await page.screenshot({ type: 'jpeg', quality: 92 });
    if (!ff.stdin.write(shot)) await new Promise((r) => ff.stdin.once('drain', r));
    if (n % 150 === 0) {
      await api('/api/status', { state: 'busy',
        text: `Кадр ${n} из ${film.frames}`, step: null, of: null });
    }
  }
  ff.stdin.end();
  await ffDone;

  const out = outArg ? path.resolve(outArg) : inProject('movie.mp4');
  if (silent) {
    fs.copyFileSync(body, out);
  } else {
    await buildSound({ video: body, out, hits: film.clicks,
                       duration: film.seconds, work });
  }

  const { stdout } = await run('ffprobe', ['-v', 'error', '-show_entries',
    'format=duration,size', '-of', 'json', out]);
  const meta = JSON.parse(stdout).format;

  // Титры выжжены композицией, поэтому плееру студии накладывать нечего.
  await api('/api/movie', { url: '/project/movie.mp4', duration: Number(meta.duration),
                            captions: [], builtAt: new Date().toISOString() });
  await api('/api/status', { state: 'listening', text: 'Ролик собран', step: null, of: null });
  console.log(JSON.stringify({
    ok: true, out, fps: film.fps, frames: film.frames,
    duration: Number(Number(meta.duration).toFixed(1)),
    megabytes: Math.round(Number(meta.size) / 1024 / 1024 * 10) / 10,
    seconds: Math.round((Date.now() - t0) / 1000),
  }, null, 1));
} catch (e) {
  await api('/api/status', { state: 'listening', text: 'Сборка не удалась', step: null, of: null });
  console.error('рендер:', e.message.split('\n').slice(0, 3).join(' '));
  process.exitCode = 1;
} finally {
  await browser.close();
}
```

- [ ] **Шаг 2: смоук на существующих состояниях mc-медиа**

Студия поднята, проект `mc-медиа` открыт (состояния сняты стадией 1 — пересъёмка
не нужна для смоука):

```bash
node studio/render.mjs --out /tmp/пробный-стадия2.mp4
```

Ожидание: JSON с `ok: true`, `fps: 30`, длительность ≈ сумме секунд сценария.
Открыть файл, проверить глазами: панорама плавная, титры на местах, звук есть.
`ffprobe` подтверждает 30 к/с и 1920×1080.

- [ ] **Шаг 3: `npm test` зелёный, коммит**

```bash
git add studio/render.mjs
git commit -m "Покадровый привод: композиция уходит в ffmpeg через stdin"
```

---

### Задача 6: конвейер снова цел — build и edit для статичных проектов

Стадия 1 намеренно сломала `takt build`/`takt edit` для статичных проектов
(коммит 9752be0): у них нет видеофайла. Композиция и есть новый монтаж — обе
команды приводят к `render.mjs`. Отдельного «мастера» у статичного проекта нет:
пересборка и так занимает минуты, а титры правятся в плёнке без пересъёмки.

**Файлы:**
- Изменить: `studio/build.mjs` — в начале, после чтения таймлайна.
- Изменить: `studio/edit.mjs` — так же.
- Изменить: `cli.mjs` — тексты помощи.

**Интерфейсы:**
- Потребляет: `states.json` (признак статичного проекта: файл есть и `live: null`).
- Отдаёт: прежние команды `takt build` / `takt edit` работают на статичных проектах.

- [ ] **Шаг 1: развилка в build.mjs**

После блока чтения `timelinePath` (строка ~40), ДО проверки `timeline.video`:

```js
/**
 * Статичный проект собирается композицией: у него нет записи, из которой можно
 * было бы делать «мастер», — ролик рендерится из состояний сразу смонтированным.
 * Отдельный процесс, а не импорт: render.mjs сам читает аргументы и сам выходит.
 */
const manifestPath = inProject('states.json');
if (fs.existsSync(manifestPath)
    && !JSON.parse(fs.readFileSync(manifestPath, 'utf8')).live) {
  const { spawn } = await import('node:child_process');
  const child = spawn(process.execPath, [path.join(DIR, 'render.mjs'),
                                         ...process.argv.slice(2)], { stdio: 'inherit' });
  child.on('close', (code) => process.exit(code ?? 1));
  await new Promise(() => {});   // дальше живёт только дочерний процесс
}
```

В `edit.mjs` — тот же блок после чтения `timeline` (константа `DIR` там есть не
везде — завести по образцу build.mjs: `path.dirname(fileURLToPath(import.meta.url))`).

- [ ] **Шаг 2: тексты помощи в cli.mjs**

```js
build:    { file: 'studio/build.mjs',  help: 'собрать ролик (статичный проект — композицией из состояний)', studio: true },
edit:     { file: 'studio/edit.mjs',   help: 'смонтировать; статичный проект собирает та же композиция', studio: true },
```

- [ ] **Шаг 3: проверить обе команды на mc-медиа**

```bash
node cli.mjs build
```

Ожидание: JSON `ok: true` от render.mjs, `movie.mp4` в проекте обновился,
студия показывает ролик. `node cli.mjs edit` даёт тот же результат.

- [ ] **Шаг 4: `npm test` зелёный, коммит**

```bash
git add studio/build.mjs studio/edit.mjs cli.mjs
git commit -m "Конвейер снова цел: build и edit статичного проекта ведут в композицию"
```

---

### Задача 7: хайлайты той же композицией

Хайлайты — отбор, а не обрезка (см. шапку highlight.mjs). Для статичного проекта
отбор делается по плёнке: планы с действием, затем первый план, затем финальный.
Рендерит тот же привод — меняется только плёнка.

**Файлы:**
- Изменить: `studio/compose/film.mjs` — добавить `buildHighlightFilm`
- Изменить: `test/film.test.mjs` — тесты отбора
- Изменить: `studio/compose/player.js` — параметры `?highlight=1&seconds=N`
- Изменить: `studio/render.mjs` — прокинуть флаги в URL и имя файла
- Изменить: `studio/highlight.mjs` — развилка на статичный проект

**Интерфейсы:**
- `buildHighlightFilm(film, { seconds = 25 }) → film` — новая плёнка: отобранные
  планы по 3.2 с, титры те же, `clicks` пересчитаны. Вертикальная версия в стадию 2
  не входит: её кадрирование — отдельная вёрстка сцены, а спрос на неё появится
  после стадии 3; горизонтальные хайлайты закрывают обещание «пересобираются той же
  композицией».

- [ ] **Шаг 1: тесты отбора**

```js
// test/film.test.mjs — добавить
import { buildHighlightFilm } from '../studio/compose/film.mjs';

const longFilm = () => buildFilm(
  { viewport: VIEWPORT, live: null, states: [
    state(),                                                          // панорама
    state({ id: 'p02', plan: 2, label: 'Клик',
            anchors: [{ selector: 'x', rect: { x: 2000, y: 1200, w: 200, h: 80 } }] }),
    state({ id: 'p03', plan: 3, label: 'Финал', size: { w: 2880, h: 1620 } }),
  ] },
  { title: 'Демо', steps: [
    { n: 1, label: 'Лента', seconds: 8 },
    { n: 2, label: 'Клик', seconds: 6 },
    { n: 3, label: 'Финал', seconds: 7 },
  ] },
);

test('хайлайты: действие важнее пейзажа, бюджет соблюдён', () => {
  const hl = buildHighlightFilm(longFilm(), { seconds: 7 });
  // Бюджет на два клипа по 3.2 c: действие + первый план; финал не влез.
  assert.deepEqual(hl.plans.map((p) => p.id), ['p01', 'p02']);
  assert.ok(hl.seconds <= 7 + 0.01);
  // Планы перенумерованы встык.
  assert.deepEqual(hl.plans.map((p) => [p.from, p.to]), [[0, 3.2], [3.2, 6.4]]);
});

test('хайлайты: щелчки пересчитаны в новую шкалу', () => {
  const hl = buildHighlightFilm(longFilm(), { seconds: 7 });
  // Клик был на CLICK_AT от начала своего плана; план p02 теперь начинается на 3.2.
  assert.deepEqual(hl.clicks, [{ t: 3.2 + 1.5 }]);
});

test('хайлайты: панорама укорочена — дистанция пересчитана под 3.2 секунды', () => {
  const hl = buildHighlightFilm(longFilm(), { seconds: 7 });
  const pan = hl.plans[0].camera;
  assert.equal(pan.kind, 'pan');
  // Окно 3.2 − 0.6 − 1.6 = 1.0 c → 600 px.
  assert.equal(pan.to, 600);
});
```

- [ ] **Шаг 2: реализация в film.mjs**

```js
/** Длина клипа хайлайтов: короче — рвано, длиннее — скучно (перенято из highlight.mjs). */
export const CLIP = 3.2;

/**
 * Хайлайты — отбор, а не обрезка: сначала действия (видно функциональность),
 * потом открывающий план (что это вообще), потом финал (к чему всё шло).
 */
export function buildHighlightFilm(film, { seconds = 25 } = {}) {
  const weight = (p, i) =>
    (p.cursor ? 3 : 0) + (i === 0 ? 2 : 0) + (i === film.plans.length - 1 ? 1 : 0);
  const picked = film.plans
    .map((p, i) => ({ p, i, w: weight(p, i) }))
    .sort((a, b) => b.w - a.w || a.i - b.i)
    .slice(0, Math.max(1, Math.floor(seconds / CLIP)))
    .sort((a, b) => a.i - b.i)
    .map(({ p }) => p);

  const plans = [];
  const clicks = [];
  let at = 0;
  for (const p of picked) {
    // Камера пересчитывается под длину клипа: панорама на 3.2 с едет меньше.
    const camera = planCamera(p.state, CLIP);
    const cursor = camera.kind === 'push'
      ? { x: camera.anchor.cx, y: camera.anchor.cy, at: CLICK_AT } : null;
    if (cursor) clicks.push({ t: at + cursor.at });
    plans.push({ ...p, from: at, to: at + CLIP, camera, cursor,
                 title: { text: p.title.text, at: at + 0.15 } });
    at += CLIP;
  }
  return { ...film, plans, clicks, seconds: at };
}
```

- [ ] **Шаг 3: параметры плеера и привода**

В `player.js` после построения `film`:

```js
const q = new URLSearchParams(location.search);
if (q.get('highlight') === '1') {
  film = buildHighlightFilm(film, { seconds: Number(q.get('seconds')) || 25 });
}
```

(`const film` станет `let film`; импорт дополнится `buildHighlightFilm`.)

В `render.mjs`: флаг `--highlight` и `--seconds N` уходят в URL страницы, выход —
`movie-short.mp4`:

```js
const highlight = process.argv.includes('--highlight');
const seconds = (() => {
  const i = process.argv.indexOf('--seconds');
  return i !== -1 ? Number(process.argv[i + 1]) : 25;
})();
// … URL:
const q = highlight ? `&highlight=1&seconds=${seconds}` : '';
await page.goto(`${base}/compose/player.html?render=1${q}`, { waitUntil: 'domcontentloaded' });
// … выход по умолчанию:
const out = outArg ? path.resolve(outArg)
  : inProject(highlight ? 'movie-short.mp4' : 'movie.mp4');
```

POST `/api/movie` при `--highlight` не делается: студия показывает полный ролик.

- [ ] **Шаг 4: развилка в highlight.mjs**

Тем же блоком, что в задаче 6 (после чтения `timeline`): статичный проект →
`spawn render.mjs --highlight` с пробросом `--seconds`. `--vertical` на статичном
проекте — честный отказ:

```js
if (process.argv.includes('--vertical')) {
  console.error('Вертикальные хайлайты статичного проекта появятся вместе с раскадровкой (стадия 3)');
  process.exit(1);
}
```

- [ ] **Шаг 5: проверить на mc-медиа**

```bash
node cli.mjs highlight
```

Ожидание: `movie-short.mp4` ≈ 25 с, действия в приоритете, титры крупных планов
на месте. `npm test` зелёный.

- [ ] **Шаг 6: коммит**

```bash
git add studio/compose/film.mjs studio/compose/player.js studio/render.mjs \
        studio/highlight.mjs test/film.test.mjs
git commit -m "Хайлайты пересобираются той же композицией: отбор по плёнке"
```

---

### Задача 8: дымовой тест — пересъёмка и пересборка mc-медиа

Спека требует: на границе стадии конвейер рабочий и `mc-медиа` пересниматься
целиком. Съёмка идёт на живом стенде — синтетика врёт (грабли №3).

**Файлы:** нет изменений кода; артефакты в `studio/journal/projects/mc-медиа/`.

- [ ] **Шаг 1: поднять студию и стенд**

Студия — preview_start `takt-studio` (порт 4173). Стенд — `http://hermes.lan:3000/`,
цель `mission-control`, креды сохранены. Сценарий должен быть `status: ready`
(`/api/scenario`); если студия сбросила статус — переутвердить.

- [ ] **Шаг 2: пересъёмка**

```bash
node cli.mjs shoot
```

Ожидание: `ok: true`, 7 состояний, 0 замечаний в `states.json` (как в прогоне
стадии 1). Если появились замечания — читать их, чинить причину, не порог.

- [ ] **Шаг 3: пересборка полного ролика и хайлайтов**

```bash
node cli.mjs build
node cli.mjs highlight
```

Ожидание: `movie.mp4` ≈ 52 с при 30 к/с, `movie-short.mp4` ≈ 25 с. Посмотреть оба
глазами от начала до конца: дефекты, ради которых всё затевалось, — дёрганье,
загрузка в кадре, зум в пустоту — отсутствуют; липкая шапка стоит, тело едет.

- [ ] **Шаг 4: отчёт хозяину**

```bash
~/.claude/skills/telegram/send.sh file "studio/journal/projects/mc-медиа/movie.mp4" "Стадия 2: mc-медиа собран композицией из состояний, 30 к/с"
~/.claude/skills/telegram/send.sh file "studio/journal/projects/mc-медиа/movie-short.mp4" "Хайлайты той же композицией"
```

- [ ] **Шаг 5: коммит** — если по итогам просмотра были правки кода, они коммитятся
  своими осмысленными сообщениями; артефакты проекта не коммитятся.

---

### Задача 9: Remotion выводится из поставки

Композиция доказала себя на пересобранном mc-медиа — прототип и рантайм Remotion
больше не нужны. Уходит всё: optionalDependencies, react, typescript, `src/`,
`remotion-mc/`, возможность `zoom` у доктора и реестра, упоминание лицензии в README.

**Файлы:**
- Удалить: `src/`, `remotion-mc/`, `public/` (артефакты прототипа, не в гите)
- Изменить: `package.json`, `studio/doctor.mjs`, `studio/registry.mjs`, `README.md`
- Проверить: `studio/install.mjs`, `SKILL.md`, `references/` — по grep

- [ ] **Шаг 1: удалить код прототипа**

```bash
git rm -r src remotion-mc
rm -rf public remotion-mc
```

(`public/` и `remotion-mc/props.json` не под гитом — потому и `rm`.)

- [ ] **Шаг 2: package.json**

Удалить: блок `optionalDependencies` целиком; скрипт `render`; devDependencies
`@types/react` и `typescript` (жили ради `src/*.tsx`); `"src/"` из `files`.
Остаётся единственная зависимость — playwright.

- [ ] **Шаг 3: доктор и реестр**

В `studio/doctor.mjs` удалить возможность `zoom` (строки ~106–113) — монтаж
делает композиция, а её требования уже описаны возможностями `shoot` (playwright)
и `build` (ffmpeg). В `studio/registry.mjs` удалить запись `zoom`.

- [ ] **Шаг 4: хвосты по grep**

```bash
grep -rn -i "remotion\|react" --include="*.mjs" --include="*.md" --include="*.json" . | grep -v node_modules | grep -v journal
```

Ожидание: ноль строк про Remotion в коде и документации (README — вычистить
раздел про лицензию remotion.pro и упоминания монтажа через Remotion; `SKILL.md`
и `references/` — если встречается `takt install zoom`, убрать). История в
`specs/` не правится: спеки — документы своего времени.

- [ ] **Шаг 5: убедиться, что ничего не отвалилось**

```bash
npm test
node cli.mjs doctor
node cli.mjs build
```

Ожидание: тесты зелёные; доктор не поминает Remotion и не падает; сборка mc-медиа
проходит.

- [ ] **Шаг 6: коммит и пуш всей стадии**

```bash
git add -A
git commit -m "Remotion выведен из поставки: композиция своя, зависимость — один playwright"
git push
```

---

## Самопроверка по спеке

- «Композиция — чистая функция, один модуль, два привода» → задачи 3, 4, 5.
- «Предпросмотр и вывод не могут разойтись, потому что это один код» → `player.js`
  и `render.mjs` зовут один `composeFrame` через одну страницу.
- «Кадр: фон, мокап-рамка, состояние с трансформом камеры, курсор, наложения,
  титры, виньетка» → задачи 3–4. Наложения (`spotlight`/`arrow`/`callout`) — данные
  эффектов, которых до стадии 3 никто не порождает; в стадии 2 их не из чего рисовать.
- «Мокап-рамка требует 2×» → снимки 2×, сцена вписывает их масштабом ~0.92,
  наезд 1.26 остаётся в запасе плотности (проверено прототипом на 1.55).
- «Частота следует самому строгому источнику» → `filmFps` + тесты; живые проекты
  идут старым монтажом до стадии 3 (там появится смешанная раскадровка).
- «Хайлайты пересобираются той же композицией» → задача 7 (вертикаль — стадия 3,
  отказ честный, старый вертикальный путь для живых проектов не тронут).
- «Здесь же выводится Remotion из поставки» → задача 9.
- «Липкие слои накладываются композицией неподвижно» → `visibleSticky` + сцена;
  риск «панорама не совпадёт с прокруткой» проверяется глазами в задачах 4 и 8.
