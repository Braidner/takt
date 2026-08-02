/**
 * Монтаж.
 *
 *   takt edit               смонтировать ролик
 *   takt edit --silent      без звука
 *
 * Отдельного монтажа больше нет: камера, курсор, титры, заставка, склейки и виньетка
 * собираются композицией при сборке. Разделение на «мастер» и «монтаж» имело смысл,
 * пока монтаж считался минуты графом фильтров ffmpeg по записи экрана; композиция
 * делает всё это за один проход, и держать две команды с разным результатом значило
 * бы врать про то, чем они отличаются.
 *
 * Команда оставлена рабочей и ведёт туда же, куда `takt build`: её знает инструкция
 * агента, и ломать договор ради внутренней перестановки нельзя.
 */
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const child = spawn(process.execPath, [path.join(DIR, 'render.mjs'), ...process.argv.slice(2)],
                    { stdio: 'inherit' });
child.on('close', (code) => process.exit(code ?? 1));
