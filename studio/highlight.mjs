/**
 * Хайлайты: короткая версия ролика из лучших моментов.
 *
 *   takt highlight              ≈25 секунд
 *   takt highlight --seconds 15
 *
 * Полный ролик и хайлайты — разные жанры, а не длинный и укороченный. Полный
 * отвечает «как это работает» и его смотрят, когда уже интересно. Хайлайты отвечают
 * «а что это вообще» за время, которое человек готов потратить на незнакомый продукт
 * в ленте, — и потому строятся не обрезкой, а отбором.
 *
 * ЧТО СЧИТАЕТСЯ ЛУЧШИМ МОМЕНТОМ. Не «где больше движения»: экранные рекордеры так и
 * делают, и в подборку попадает прокрутка длинного списка. У нас есть то, чего у них
 * нет, — знание, что происходило: план с действием ценнее плана-пейзажа, открывающий
 * план объясняет, что это вообще, финальный показывает, к чему всё шло. Сам отбор
 * живёт в композиции (buildHighlightFilm), здесь остаётся только команда.
 *
 * Вертикальный формат пока не поддержан: 9:16 требует своей вёрстки сцены, а не
 * флага рендера — в горизонтальной сцене интерфейс просто не помещается.
 */
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

if (process.argv.includes('--vertical')) {
  console.error('Вертикальные хайлайты пока не собираются: 9:16 требует своей вёрстки сцены');
  process.exit(1);
}

const seconds = (() => {
  const i = process.argv.indexOf('--seconds');
  return i !== -1 ? process.argv[i + 1] : '25';
})();

const DIR = path.dirname(fileURLToPath(import.meta.url));
const child = spawn(process.execPath,
  [path.join(DIR, 'render.mjs'), '--highlight', '--seconds', seconds,
   ...(process.argv.includes('--silent') ? ['--silent'] : [])],
  { stdio: 'inherit' });
child.on('close', (code) => process.exit(code ?? 1));
