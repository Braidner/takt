/**
 * Раскадровка — то, что снимается и рендерится. Единственный документ, который
 * человек и агент правят руками.
 *
 * План описывает НАМЕРЕНИЕ и одно типизированное действие, а не список команд
 * браузеру. Разница не косметическая: из «клик по такому-то селектору» выводится
 * длительность, строится наезд камеры и рисуется курсор, а из массива
 * `[{press}, {wait}, {click}, {wait}]` — ничего, потому что в нём не сказано, что
 * из этого содержание плана, а что подпорка под запись потока.
 *
 * Номера и время — производные и пересчитываются при каждой правке. Идентификатор
 * плана — нет: на него ссылаются эффекты, и перенумерация при перестановке молча
 * перевесила бы настроенный человеком наезд на чужой план.
 *
 * Без импортов Node: модуль грузит и браузер, и node:test.
 */
import { planDuration, SLATE, END } from './duration.mjs';

/** Шаг прокрутки клавишей: 0,9 экрана съёмки — как это делала старая съёмка. */
const PAGE_STEP = Math.round(810 * 0.9);
const KINDS = ['click', 'type', 'scroll', 'hold', 'goto'];

const pad = (n) => `p${String(n).padStart(2, '0')}`;

/** Идентификатор, которого ещё не было: планы удаляют, а ссылки на них остаются. */
export function nextPlanId(plans) {
  const max = (plans || []).reduce((m, p) => {
    const n = Number(String(p.id || '').replace(/^p/, ''));
    return Number.isFinite(n) ? Math.max(m, n) : m;
  }, 0);
  return pad(max + 1);
}

/**
 * Миграция старого сценария.
 *
 * Массив действий разбирается по смыслу: переход — это экран, ожидание признака —
 * условие готовности, а действием плана становится самое содержательное из
 * оставшегося. Прокрутка перед кликом отбрасывается: она была нужна записи потока,
 * чтобы камера смотрела в нужное место, а состояние снимается страницей целиком.
 */
export function fromScenario(scenario) {
  const plans = (scenario?.steps || []).map((s, i) => {
    let route = null;
    let waitFor = s.expect || null;
    let click = null, type = null, press = null, hold = 0, scroll = 0;

    for (const a of s.actions || []) {
      // Сравнение с undefined, а не проверка на истинность: goto: "" — это возврат
      // на главную, самый обычный шаг обзорного ролика.
      if (a.goto !== undefined) { route = a.goto; continue; }
      if (a.waitFor) { waitFor = a.waitFor; continue; }
      if (a.click) { click = a.click; continue; }
      if (a.type) { type = a.type; continue; }
      if (a.scroll !== undefined) { scroll += Number(a.scroll) || 0; continue; }
      if (a.press === 'PageDown' || a.press === 'End') { scroll += PAGE_STEP; continue; }
      if (a.press === 'PageUp' || a.press === 'Home') { scroll -= PAGE_STEP; continue; }
      if (a.press) { press = a.press; continue; }
      if (a.wait) hold += Number(a.wait) / 1000;
    }

    const action = click ? { kind: 'click', selector: click }
      : type ? { kind: 'type', selector: type.selector, text: type.text }
      : scroll ? { kind: 'scroll', distance: scroll }
      : hold ? { kind: 'hold', seconds: Math.round(hold * 10) / 10 }
      : null;
    if (action && press) action.press = press;

    return {
      id: pad(i + 1),
      intent: s.hint || null,
      title: { text: s.label || '', style: 'lower' },
      mode: s.mode === 'live' ? 'live' : 'static',
      screen: { route, waitFor },
      action,
      state: s.state || 'pending',
      error: s.error || null,
      fix: s.fix || null,
      took: s.took ?? null,
    };
  });

  return normalizeStoryboard({
    title: scenario?.title || 'Без названия',
    task: scenario?.task || null,
    status: scenario?.status || 'draft',
    plans,
    effects: [],
  });
}

/**
 * Нормализация: всё производное пересчитывается, всё внесённое руками — остаётся.
 * Одно место, где считается хронометраж; отсюда его берут и студия, и композиция.
 */
/**
 * Карточка заставки или финала.
 *
 * Раньше это был включатель: всё содержание выводилось из названия ролика, а длина
 * была константой композиции. Править было нечего — и человеку, который хотел на
 * обложке другой текст или лишнюю секунду, оставалось переименовать весь проект.
 *
 * Пустой текст не заполняется значением по умолчанию намеренно: `null` означает
 * «брать название ролика», и переименование ролика тянет обложку за собой. Запиши мы
 * туда копию — она бы молча устарела.
 */
const карточка = (v, было, по_умолчанию) => {
  // Старая раскадровка: slate было булевым, а финал шёл в комплекте с обложкой.
  if (v === undefined || typeof v === 'boolean') {
    return { on: было, text: null, subtitle: null, seconds: по_умолчанию };
  }
  const seconds = Number(v.seconds);
  return {
    on: v.on !== false,
    text: v.text || null,
    subtitle: v.subtitle || null,
    // Полсекунды — нижняя граница читаемости: короче карточка успевает только
    // мигнуть, и в ролике это выглядит сбоем сборки, а не решением.
    seconds: Number.isFinite(seconds) && seconds >= 0.4
      ? Math.round(seconds * 10) / 10 : по_умолчанию,
  };
};

export function normalizeStoryboard(sb) {
  const seen = [];
  // Обложка идёт первой и занимает своё время: планы начинаются после неё. Иначе
  // таймкоды раскадровки разъезжаются с собранным роликом ровно на её длину.
  const было = sb?.slate !== false && Boolean(sb?.title);
  const slate = карточка(sb?.slate, было, SLATE);
  const end = { ...карточка(sb?.end, было, END), url: sb?.end?.url || sb?.url || null };
  // Заставка без названия — пустой чёрный кадр: показывать нечего.
  const обложка = slate.on && Boolean(sb?.title || slate.text);
  const финал = end.on && Boolean(sb?.title || end.text);
  let at = обложка ? slate.seconds : 0;

  const plans = (sb?.plans || []).map((p, i) => {
    const id = p.id && !seen.includes(p.id) ? p.id : nextPlanId(seen.map((x) => ({ id: x })));
    seen.push(id);
    const plan = {
      ...p,
      id,
      n: i + 1,
      at: Math.round(at * 10) / 10,
      title: { text: p.title?.text || '', style: p.title?.style || 'lower' },
      mode: p.mode === 'live' ? 'live' : 'static',
      screen: { route: p.screen?.route ?? null, waitFor: p.screen?.waitFor || null },
      action: p.action || null,
      state: p.state || 'pending',
      error: p.error || null,
      fix: p.fix || null,
      took: p.took ?? null,
    };
    // Поля, которых больше нет, вычищаются при первом же чтении: без этого они
    // переживают в сохранённых раскадровках и всплывают в экспорте.
    delete plan.diagram;
    plan.duration = planDuration(plan);
    at += plan.duration.seconds;
    return plan;
  });

  return {
    title: sb?.title || 'Без названия',
    task: sb?.task || null,
    status: sb?.status || 'draft',
    // Обложка и финальная плашка — решение человека, а не побочный эффект того,
    // что у ролика есть название. По умолчанию есть: ролик без начала и конца
    // выглядит куском чужой записи.
    slate: { ...slate, on: обложка },
    end: { ...end, on: финал },
    url: sb?.url || null,
    // Частота следует самому строгому источнику: пересчёт 25 в 30 дублированием и есть
    // та судорога, ради устранения которой всё затевалось.
    fps: plans.some((p) => p.mode === 'live') ? 25 : 30,
    // Финальная плашка тоже входит в хронометраж: человек видит длину того, что
    // соберётся, а не длину середины.
    seconds: Math.round((at + (финал ? end.seconds : 0)) * 10) / 10,
    plans,
    // Эффекты живут ссылками на планы, поэтому осиротевшие выбрасываются здесь же:
    // иначе они всплывут наездом в никуда через несколько правок.
    effects: (sb?.effects || []).filter((e) => plans.some((p) => p.id === e.plan)),
  };
}

/**
 * Проверки раскадровки — отчёт по планам, а не по секундам. Каждое замечание
 * называет план, потому что чинить придётся именно его.
 */
export function checkStoryboard(sb) {
  const issues = [];
  const name = (p) => p.title?.text || `план ${p.n}`;

  for (const p of sb.plans || []) {
    if (!p.title?.text) {
      issues.push({ plan: p.id, text: `План ${p.n} без титра: зритель не поймёт, что ему показывают` });
    }
    if (p.duration?.over) {
      issues.push({ plan: p.id,
        text: `«${name(p)}» длиннее ${p.duration.seconds} с — такой план надо разбить надвое` });
    }
    if (p.action && !KINDS.includes(p.action.kind)) {
      issues.push({ plan: p.id, text: `«${name(p)}»: неизвестное действие «${p.action.kind}»` });
    }
    // Переход, который не назвал признак готовности, снимется «успешно» с прежним
    // экраном в кадре: клик по пункту меню, раскрывающему подменю, ошибки не даёт.
    if (p.screen?.route !== null && p.screen?.route !== undefined && !p.screen.waitFor) {
      issues.push({ plan: p.id,
        text: `«${name(p)}» меняет экран, но не назвал признак, по которому это видно` });
    }
  }
  return issues;
}
