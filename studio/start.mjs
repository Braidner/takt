/**
 * takt start — единственная команда, которую нужно знать.
 *
 * Ставит недостающее (npm-зависимости, браузер), поднимает студию в фоне, открывает
 * сайт. Повторный запуск при живой студии мгновенен и второй не поднимает.
 *
 * --no-open — не открывать браузер: для повторных вызовов агентом, когда вкладка
 * у человека уже открыта.
 */
import { ensureDeps, migrateVenvs, launchStudio, openSite } from './bootstrap.mjs';
import { ok, fail } from './lib/out.mjs';

const noOpen = process.argv.includes('--no-open');

migrateVenvs();
await ensureDeps();
const { url, reused } = await launchStudio();
if (!noOpen) openSite(url);

console.log(reused ? `Студия уже работает: ${url}` : `Студия поднята: ${url}`);
ok({ ok: true, url, studio: reused ? 'reused' : 'started' },
   ['ждать задачу от человека: takt poll']);
