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
import { planDuration, SLATE, END, SCREEN_SIZE } from './duration.mjs';

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

export function normalizeStoryboard(sb, states) {
  /* Снятое приходит сюда затем, чтобы живой план знал свою настоящую длину и чтобы
     не забывалось, что он вообще снят: время ролика и факт съёмки считаются в одном
     месте.

     Разница между «манифест пуст» и «манифеста не давали» существенна. Пустой
     значит «ничего не снято» — так и покажем. Не давали значит «не знаем», и тогда
     записанное в раскадровке остаётся единственным, что о плане известно. */
  const знаемСнятое = Array.isArray(states);
  const снято = new Map((states || []).map((s) => [s.id, s]));
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

  /* Свободный номер ищется среди ВСЕХ планов, а не только уже просмотренных.
     Иначе план, добавленный в середину, забирал идентификатор у того, кто шёл
     следом, и дальше по цепочке: снятые состояния оставались под прежними
     именами, а половина ролика разом становилась «не снятой». */
  const занятые = (sb?.plans || []).map((p) => p.id).filter(Boolean);
  const plans = (sb?.plans || []).map((p, i) => {
    const свободен = p.id && !seen.includes(p.id);
    const id = свободен
      ? p.id
      : nextPlanId([...занятые, ...seen].map((x) => ({ id: x })));
    seen.push(id);
    const plan = {
      ...p,
      id,
      n: i + 1,
      at: Math.round(at * 10) / 10,
      title: { text: p.title?.text || '', style: p.title?.style || 'lower' },
      mode: p.mode === 'live' ? 'live' : p.mode === 'insert' ? 'insert' : 'static',
      screen: { route: p.screen?.route ?? null, waitFor: p.screen?.waitFor || null },
      action: p.action || null,
      /* Снят план или нет — факт манифеста, а не запись в раскадровке. Пока он
         хранился здесь, любая перезаписанная раскадровка сбрасывала его в
         «ещё не снято»: агент присылал поправленную версию, и снятый материал
         переставал считаться снятым. Неудача — другое дело: снятого состояния
         нет, а причина есть, и затирать её нечем. */
      state: p.state === 'failed' || p.state === 'running' || !знаемСнятое
        ? (p.state || 'pending')
        : (p.mode === 'insert' || снято.has(p.id) ? 'done' : 'pending'),
      error: p.error || null,
      fix: p.fix || null,
      took: p.took ?? null,
    };
    // Поля, которых больше нет, вычищаются при первом же чтении: без этого они
    // переживают в сохранённых раскадровках и всплывают в экспорте.
    delete plan.diagram;
    /* Вставка не снимается: экрана у неё нет, действия тоже. Оставь их — и съёмка
       пойдёт открывать несуществующий маршрут, а режиссёр повесит на неё наезд
       по якорю, которого ни в одном состоянии нет. */
    if (plan.mode === 'insert') {
      plan.insert = { src: p.insert?.src || null };
      plan.action = null;
      plan.screen = { route: null, waitFor: null };
    } else {
      delete plan.insert;
    }
    plan.duration = planDuration(plan, снято.get(id) || null);
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
    /* Доля кадра, которую занимает окно приложения. Была константой формата — 69% —
       и на интерфейсе с мелким текстом это читалось плохо: две трети кадра занимал
       экран, треть уходила в поля, не несущие ничего. Ниже половины интерфейс
       превращается в марку на конверте, выше единицы — рисует себя за краем. */
    screenSize: Math.min(1, Math.max(0.5, Number(sb?.screenSize) || SCREEN_SIZE)),
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
    // Вставка без титра — норма: её содержание нарисовано в ней самой, и подпись
    // поверх схемы только отнимает у схемы место.
    if (!p.title?.text && p.mode !== 'insert') {
      issues.push({ plan: p.id, text: `План ${p.n} без титра: зритель не поймёт, что ему показывают` });
    }
    if (p.duration?.over) {
      issues.push({ plan: p.id,
        text: `«${name(p)}» длиннее ${p.duration.seconds} с — такой план надо разбить надвое` });
    }
    // Вставка без файла соберётся в чёрный прямоугольник на пять секунд: формально
    // это работающий план, и заметить подмену можно только на просмотре готового.
    if (p.mode === 'insert' && !p.insert?.src) {
      issues.push({ plan: p.id, text: `«${name(p)}»: вставка без файла врезки — показывать нечего` });
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

/**
 * Полезная нагрузка из присланного агентом файла.
 *
 * Живёт рядом с нормализацией, а не в скрипте команды: скрипт исполняется целиком при
 * импорте, и проверить его сборку иначе нечем. Именно здесь потерялись обложка и финал —
 * справочник называет их записями раскадровки, а нагрузка их не несла, и подзаголовок
 * молча оставался прежним до самого готового ролика.
 */
export function draftPayload(draft, { ready } = {}) {
  const plans = (draft.plans || []).map((p) => ({
    id: p.id || null,
    intent: p.intent || null,
    // Титр приходит строкой или объектом: агенту проще написать строку, а формат
    // хранит стиль рядом с текстом.
    title: typeof p.title === 'string' ? { text: p.title } : (p.title || { text: '' }),
    mode: p.mode === 'live' ? 'live' : 'static',
    screen: { route: p.screen?.route ?? null, waitFor: p.screen?.waitFor || null },
    action: p.action || null,
    // Ручную длительность пропускаем только помеченной: иначе «выведено» и «назначено»
    // не отличить, и первый же пересчёт молча затрёт решение человека.
    duration: p.duration?.source === 'manual' ? p.duration : undefined,
  }));

  return {
    title: draft.title || 'Демонстрационный ролик',
    task: draft.task || null,
    status: ready ? 'ready' : 'draft',
    plans,
    effects: (draft.effects || []).filter((e) => e.source === 'manual'),
    ...(draft.slate !== undefined ? { slate: draft.slate } : {}),
    ...(draft.end !== undefined ? { end: draft.end } : {}),
  };
}
