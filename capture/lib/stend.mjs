/**
 * Куда снимать и как войти.
 *
 * Модуль намеренно ничего не знает про конкретную систему: адреса, учётные данные и
 * селекторы формы входа приходят из пресета (studio/preset.mjs). Иначе инструмент годится
 * ровно для одного приложения, а снять что-то ещё можно только правкой исходников.
 */
import { branchSlug, loadPreset, presetForTarget } from '../../studio/preset.mjs';
import { currentTarget } from '../../studio/project.mjs';

/**
 * Адрес по короткому указанию.
 *
 *   'https://...'  — как есть
 *   'local', 'dev' — имена из targets пресета
 *   'my-branch'    — подстановка в branchUrl, если он задан в пресете
 *
 * Ветка как источник адреса — приём для систем, где CI поднимает отдельное окружение на
 * каждую ветку: новая ветка даёт чистую систему под съёмку, а её адрес выводится из имени
 * и не требует ручного поиска. Для демонстрационного ролика чистая система нужна почти
 * всегда, и отвести ветку дешевле, чем вычищать рабочую.
 */
export function stendUrl(target = 'local') {
  if (/^https?:\/\//.test(target)) return target;

  const preset = loadPreset();
  if (preset.targets?.[target]) return preset.targets[target];

  if (preset.branchUrl) {
    // Ограничение длины и отсечка конечного дефиса повторяют правило GitLab для имени
    // релиза; без них адрес разойдётся с тем, что развернул CI.
    const slug = `pw-${branchSlug(target)}`.slice(0, 53).replace(/-+$/, '');
    return preset.branchUrl.replace('{slug}', slug);
  }

  throw new Error(
    `Не знаю адреса «${target}». Укажите полный URL или опишите цели в takt.preset.json`);
}

/**
 * Вход в приложение.
 *
 * Форма появляется не мгновенно: приложение обычно отдаёт свою оболочку раньше, чем
 * поднимается бэкенд. Поэтому ждём именно поле, а не фиксированную паузу, и признаком
 * успеха считаем исчезновение этого поля — заголовки и меню у всех разные.
 */
export async function login(page, creds = {}) {
  // Форма входа берётся из цели проекта, если она известна: у каждой системы своя.
  const preset = presetForTarget(currentTarget());
  const { user, password } = { ...preset.credentials, ...creds };
  const sel = preset.login;

  const field = page.locator(sel.password).first();
  try {
    await field.waitFor({ state: 'visible', timeout: 8000 });
  } catch {
    return false; // формы нет — уже внутри
  }

  await page.locator(sel.user).first().fill(user);
  await field.fill(password);
  await page.keyboard.press(sel.submit || 'Enter');

  await field.waitFor({ state: 'detached', timeout: 60000 }).catch(() => {});
  await page.waitForTimeout(3000);
  return true;
}

/**
 * Готовая страница: перейти и войти.
 *
 * networkidle здесь не годится — приложения с живыми соединениями (горячая перезагрузка,
 * стриминг, вебсокеты) в это состояние не приходят никогда.
 */
export async function openStend(page, target, creds) {
  await page.goto(stendUrl(target), { waitUntil: 'domcontentloaded', timeout: 90000 });
  await page.waitForTimeout(5000);
  await login(page, creds);
  return page;
}
