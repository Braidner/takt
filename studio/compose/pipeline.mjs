/**
 * Ступени конвейера и их состояния.
 *
 * Состояние ступени ВЫВОДИТСЯ из того, что лежит на диске, а не хранится флагом.
 * Флаг однажды разойдётся с правдой — файл перезапишут мимо студии, проект скопируют,
 * съёмка упадёт на середине, — и человек будет смотреть на «готово» там, где готового
 * нет. Хранится ровно одно решение, которое из файлов не выводится: утвердил человек
 * эту ступень или ещё нет.
 *
 * Устаревание считается по времени правки: раскадровку переписали после съёмки —
 * значит состояния сняты не по ней. Устаревшее не удаляется и даже не перестаёт быть
 * утверждённым: молча стирать чужую работу нельзя, её могли править руками час назад.
 * Дело студии — сказать правду, а решение остаётся за человеком.
 *
 * Без импортов Node: модуль грузит и браузер, и node:test.
 */

/**
 * Порядок работы. `needs` — ступень, из которой эта выведена; по ней и считается
 * устаревание. Пропуск середины (разведку можно не сохранять) не делает следующую
 * ступень испорченной — поэтому источник ищется вверх по цепочке до первого живого.
 */
export const STAGES = [
  { id: 'prompt', file: 'prompt.txt', needs: null },
  { id: 'recon', file: 'recon.json', needs: 'prompt' },
  { id: 'story', file: 'story.md', needs: 'recon' },
  { id: 'storyboard', file: 'storyboard.json', needs: 'story' },
  { id: 'states', file: 'states.json', needs: 'storyboard' },
  { id: 'movie', file: 'movie.mp4', needs: 'states' },
];

const index = (id) => STAGES.findIndex((s) => s.id === id);

/**
 * Состояния ступеней.
 *
 * `files` — карта «имя файла → время правки»; чего нет, того нет.
 * `approved` — что человек утвердил. `gates: false` снимает требование утверждения
 * целиком: на проекте, где гейты не нужны, каждый существующий артефакт считается
 * готовым. Файлы при этом не выдумываются — пустой проект остаётся пустым.
 */
export function pipelineState({ files = {}, approved = [], gates = true } = {}) {
  const at = (id) => files[STAGES[index(id)].file];

  return STAGES.map((stage) => {
    const time = files[stage.file];
    if (time === undefined) return { id: stage.id, state: 'missing', stale: false, at: null };

    // Источник ищется вверх по цепочке: пропущенная ступень не повод считать
    // следующую испорченной — она просто не сохранялась.
    let source = stage.needs;
    let sourceTime;
    while (source && sourceTime === undefined) {
      sourceTime = at(source);
      source = STAGES[index(source)].needs;
    }

    return {
      id: stage.id,
      state: gates === false || approved.includes(stage.id) ? 'ready' : 'draft',
      stale: sourceTime !== undefined && time < sourceTime,
      at: time,
    };
  }).map((s, i, all) => ({
    // Устаревание идёт вниз по цепочке: если состояния сняты по старой раскадровке,
    // то и собранный из них ролик — про старую раскадровку.
    ...s,
    stale: s.state === 'missing' ? false : s.stale || all.slice(0, i).some((x) => x.stale),
  }));
}

/** Что помечается устаревшим при перегенерации ступени: всё, что ниже неё. */
export function staleFrom(id) {
  const i = index(id);
  return i === -1 ? [] : STAGES.slice(i + 1).map((s) => s.id);
}
