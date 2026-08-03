import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fromScenario, normalizeStoryboard, checkStoryboard, nextPlanId }
  from '../studio/compose/storyboard.mjs';
import { SLATE, END } from '../studio/compose/duration.mjs';

/** Настоящий сценарий mc-медиа: на нём миграция и проверяется. */
const MC = {
  title: 'Mission Control — Медиа',
  task: 'Рекламный ролик медиатеки',
  status: 'ready',
  steps: [
    { n: 1, label: 'Ваша медиатека', hint: 'Библиотека: обложка во весь экран', seconds: 8,
      expect: 'text=Продолжить серию', actions: [{ goto: 'media' }, { wait: 5000 }] },
    { n: 2, label: 'Продолжайте с того места', hint: 'Держим кадр на хиро', seconds: 6,
      expect: null, actions: [{ wait: 4500 }] },
    { n: 3, label: 'Мой список', hint: 'Прокрутка к ряду постеров', seconds: 7,
      expect: null, actions: [{ press: 'PageDown' }, { wait: 4000 }] },
    { n: 4, label: 'Что смотреть дальше', hint: 'Дискавери: тренды', seconds: 8,
      expect: 'text=В тренде сейчас',
      actions: [{ press: 'Home' }, { wait: 1200 }, { click: 'text=Дискавери' }, { wait: 4500 }] },
    { n: 5, label: 'Нашлось за пару букв', hint: 'Печатаем в поиск', seconds: 8, expect: null,
      actions: [{ type: { selector: 'input[placeholder*="Поиск"]', text: 'одиссея' } },
                { wait: 4500 }] },
    { n: 7, label: 'Вся коллекция', hint: 'Мягкая прокрутка', seconds: 8, expect: null,
      actions: [{ press: 'PageDown' }, { wait: 2200 }, { press: 'PageDown' }, { wait: 3500 }] },
  ],
};

test('миграция: переход уходит в экран, а не в действие', () => {
  // goto — это «куда попасть», а не «что показать». Действием остаётся то,
  // ради чего план снимался: здесь — держать кадр на медиатеке.
  const sb = fromScenario(MC);
  const p = sb.plans[0];
  assert.equal(p.screen.route, 'media');
  assert.equal(p.screen.waitFor, 'text=Продолжить серию');
  assert.deepEqual(p.action, { kind: 'hold', seconds: 5 });
});

test('миграция: подпись становится титром, подсказка — намерением', () => {
  const p = fromScenario(MC).plans[0];
  assert.equal(p.title.text, 'Ваша медиатека');
  assert.equal(p.title.style, 'lower');
  assert.equal(p.intent, 'Библиотека: обложка во весь экран');
});

test('миграция: шаг без действий — пауза на экране', () => {
  assert.deepEqual(fromScenario(MC).plans[1].action, { kind: 'hold', seconds: 4.5 });
});

test('миграция: PageDown становится прокруткой на экран', () => {
  assert.deepEqual(fromScenario(MC).plans[2].action, { kind: 'scroll', distance: 729 });
});

test('миграция: две прокрутки подряд складываются в одну', () => {
  assert.deepEqual(fromScenario(MC).plans[5].action, { kind: 'scroll', distance: 1458 });
});

test('миграция: прокрутка перед кликом — подготовка, а не содержание плана', () => {
  // press Home стоял, чтобы камера записи была наверху. Состояние снимается
  // страницей целиком, а к элементу Playwright прокручивает сам.
  assert.deepEqual(fromScenario(MC).plans[3].action,
                   { kind: 'click', selector: 'text=Дискавери' });
});

test('миграция: ввод переносится с селектором и текстом', () => {
  assert.deepEqual(fromScenario(MC).plans[4].action,
                   { kind: 'type', selector: 'input[placeholder*="Поиск"]', text: 'одиссея' });
});

test('миграция: паузы по часам не переносятся — их место заняла композиция', () => {
  // Все wait, кроме единственного оставшегося содержанием плана, были подпоркой
  // под запись потока: они держали экран, пока писался поток кадров.
  const sb = fromScenario(MC);
  assert.equal(sb.plans[3].action.kind, 'click');
  assert.equal(JSON.stringify(sb).includes('"wait"'), false);
});

test('миграция: клавиша после ввода едет вместе с действием', () => {
  const sb = fromScenario({ steps: [{ label: 'Поиск', actions: [
    { type: { selector: 'input', text: 'кино' } }, { press: 'Enter' },
  ] }] });
  assert.equal(sb.plans[0].action.press, 'Enter');
});

test('миграция: возврат на главную — это пустой маршрут, а не отсутствие маршрута', () => {
  // goto: "" — самый обычный шаг обзорного ролика. Как ложное значение он молча
  // пропадал бы, и план снимался бы на прежнем экране.
  const sb = fromScenario({ steps: [{ label: 'Домой', actions: [{ goto: '' }] }] });
  assert.equal(sb.plans[0].screen.route, '');
});

test('нормализация: номера и время выводятся, идентификаторы — нет', () => {
  const sb = normalizeStoryboard(fromScenario(MC));
  assert.deepEqual(sb.plans.map((p) => p.id), ['p01', 'p02', 'p03', 'p04', 'p05', 'p06']);
  assert.deepEqual(sb.plans.map((p) => p.n), [1, 2, 3, 4, 5, 6]);
  // Планы встык, но не с нуля: перед ними стоит обложка и занимает своё время.
  const at = sb.plans.map((p) => p.at);
  assert.equal(at[0], SLATE);
  assert.ok(Math.abs(at[1] - (SLATE + sb.plans[0].duration.seconds)) < 0.01);
  const sum = sb.plans.reduce((s, p) => s + p.duration.seconds, 0);
  assert.ok(Math.abs(sb.seconds - (SLATE + sum + END)) < 0.05,
            `${sb.seconds} против ${SLATE + sum + END}`);
});

test('нормализация: без обложки планы начинаются с нуля', () => {
  const sb = normalizeStoryboard({ ...fromScenario(MC), slate: { on: false }, end: { on: false } });
  assert.equal(sb.plans[0].at, 0);
  const sum = sb.plans.reduce((s, p) => s + p.duration.seconds, 0);
  assert.ok(Math.abs(sb.seconds - sum) < 0.05);
});

test('нормализация повторяется без последствий', () => {
  // Композиция прогоняет её у себя, не полагаясь на то, что сервер свежей версии.
  // Значит она обязана быть идемпотентной: второй проход не должен сдвинуть ни
  // время планов, ни хронометраж, ни идентификаторы.
  const один = normalizeStoryboard(fromScenario(MC));
  const два = normalizeStoryboard(один);
  assert.deepEqual(два.plans.map((p) => [p.id, p.n, p.at, p.duration.seconds]),
                   один.plans.map((p) => [p.id, p.n, p.at, p.duration.seconds]));
  assert.equal(два.seconds, один.seconds);
  assert.deepEqual(два.slate, один.slate);
  assert.deepEqual(два.end, один.end);
});

test('карточки независимы: обложку можно снять, оставив финал', () => {
  // Пока это был один флаг, финал уходил вместе с обложкой. Ролик, который
  // начинается сразу с дела и заканчивается плашкой со ссылкой, — обычная просьба.
  const sb = normalizeStoryboard({ ...fromScenario(MC), slate: { on: false } });
  assert.equal(sb.slate.on, false);
  assert.equal(sb.end.on, true);
  assert.equal(sb.plans[0].at, 0);
  const sum = sb.plans.reduce((s, p) => s + p.duration.seconds, 0);
  assert.ok(Math.abs(sb.seconds - (sum + END)) < 0.05, `${sb.seconds}`);
});

test('карточки — данные, а не флаг: старое булево переезжает в объект', () => {
  // Заставка была включателем, и всё её содержание выводилось из названия ролика.
  // Теперь это запись, которую человек правит, поэтому старые раскадровки надо
  // прочитать так, будто они всегда такими и были.
  const был = normalizeStoryboard({ ...fromScenario(MC), slate: true });
  assert.equal(был.slate.on, true);
  assert.equal(был.slate.seconds, SLATE);
  assert.equal(был.end.on, true);
  assert.equal(был.end.seconds, END);

  // Сырая раскадровка со старым флагом: финал в ней шёл в комплекте с обложкой,
  // и прочитать её надо так же, иначе у старого проекта вырастет лишняя плашка.
  const старая = normalizeStoryboard({ title: 'Демо', slate: false,
                                       plans: [{ title: { text: 'раз' } }] });
  assert.equal(старая.slate.on, false);
  assert.equal(старая.end.on, false);
});

test('карточка держит свой текст, а пустой наследует название ролика', () => {
  // Текст по умолчанию не копируется в данные: иначе переименование ролика
  // оставило бы на обложке старое название, и понять почему было бы нечем.
  const свой = normalizeStoryboard({ ...fromScenario(MC), title: 'Демо',
                                     slate: { on: true, text: 'Своя обложка' } });
  assert.equal(свой.slate.text, 'Своя обложка');
  assert.equal(свой.end.text, null, 'финал названия не задавали — наследует');
});

test('длительность карточки задаётся и сдвигает всё, что после неё', () => {
  const sb = normalizeStoryboard({ ...fromScenario(MC),
                                   slate: { on: true, seconds: 4 },
                                   end: { on: true, seconds: 1.5 } });
  assert.equal(sb.plans[0].at, 4, 'первый план начинается после своей обложки');
  const sum = sb.plans.reduce((s, p) => s + p.duration.seconds, 0);
  assert.ok(Math.abs(sb.seconds - (4 + sum + 1.5)) < 0.05, `${sb.seconds}`);
});

test('длительность карточки не бывает нулевой или отрицательной', () => {
  // Ноль здесь означал бы карточку, которая есть в данных, занимает место
  // в интерфейсе и не видна в ролике ни одним кадром.
  const sb = normalizeStoryboard({ ...fromScenario(MC),
                                   slate: { on: true, seconds: 0 },
                                   end: { on: true, seconds: -3 } });
  assert.ok(sb.slate.seconds >= 0.4, `обложка ${sb.slate.seconds}`);
  assert.ok(sb.end.seconds >= 0.4, `финал ${sb.end.seconds}`);
});

test('нормализация: время раскадровки совпадает со временем собранной плёнки', () => {
  // Один источник времени: разойдись они — и клик по плану в студии уводил бы
  // на чужой кадр, а замечание по таймкоду приезжало бы агенту не туда.
  const sb = normalizeStoryboard(fromScenario(MC));
  assert.equal(sb.plans[0].at, SLATE);
  assert.equal(sb.slate.on, true);
});

test('нормализация: идентификатор переживает перестановку планов', () => {
  // Эффекты ссылаются на план по идентификатору. Перенумеруй его при перестановке —
  // и наезд, настроенный человеком, молча переедет на чужой план.
  const sb = normalizeStoryboard(fromScenario(MC));
  const moved = normalizeStoryboard({ ...sb, plans: [sb.plans[3], ...sb.plans.slice(0, 3)] });
  assert.equal(moved.plans[0].id, 'p04');
  assert.equal(moved.plans[0].n, 1);
  assert.equal(moved.plans[0].at, SLATE);
});

test('нормализация: частота следует самому строгому плану', () => {
  const sb = normalizeStoryboard(fromScenario(MC));
  assert.equal(sb.fps, 30);
  const live = normalizeStoryboard({ ...sb,
    plans: sb.plans.map((p, i) => (i === 2 ? { ...p, mode: 'live' } : p)) });
  assert.equal(live.fps, 25);
});

test('нормализация: состояние съёмки не затирается пересчётом', () => {
  const sb = normalizeStoryboard({ plans: [
    { title: { text: 'Снят' }, action: null, state: 'done', took: 12 },
  ] });
  assert.equal(sb.plans[0].state, 'done');
  assert.equal(sb.plans[0].took, 12);
});

test('нормализация: ручная длительность остаётся ручной', () => {
  const sb = normalizeStoryboard({ plans: [
    { title: { text: 'Долгий' }, action: { kind: 'click', selector: 'x' },
      duration: { source: 'manual', seconds: 11 } },
  ] });
  assert.equal(sb.plans[0].duration.seconds, 11);
  assert.equal(sb.seconds, 11);
});

test('проверки: длинный план называется по имени', () => {
  const sb = normalizeStoryboard({ plans: [
    { title: { text: 'Слишком долгий' }, action: { kind: 'hold', seconds: 30 } },
  ] });
  const issues = checkStoryboard(sb);
  assert.equal(issues.length, 1);
  assert.match(issues[0].text, /Слишком долгий/);
  assert.match(issues[0].text, /разбить/);
  assert.equal(issues[0].plan, 'p01');
});

test('проверки: переход без признака готовности — замечание', () => {
  // Клик по пункту меню, который на самом деле раскрывает подменю, проходит без
  // ошибки: элемент найден, клик выполнен, а в кадре прежний экран.
  const sb = normalizeStoryboard({ plans: [
    { title: { text: 'Переход' }, screen: { route: 'discover', waitFor: null }, action: null },
  ] });
  assert.match(checkStoryboard(sb)[0].text, /признак/);
});

test('проверки: неизвестное действие называется', () => {
  const sb = normalizeStoryboard({ plans: [
    { title: { text: 'Зум' }, action: { kind: 'зум' } },
  ] });
  assert.match(checkStoryboard(sb)[0].text, /зум/);
});

test('проверки: план без титра — замечание, а не немой кадр', () => {
  const sb = normalizeStoryboard({ plans: [{ action: { kind: 'click', selector: 'x' } }] });
  assert.match(checkStoryboard(sb)[0].text, /титр/);
});

test('проверки: здоровая раскадровка молчит', () => {
  assert.deepEqual(checkStoryboard(normalizeStoryboard(fromScenario(MC))), []);
});

test('новый идентификатор не сталкивается с существующими', () => {
  assert.equal(nextPlanId([{ id: 'p01' }, { id: 'p09' }]), 'p10');
  assert.equal(nextPlanId([]), 'p01');
});
