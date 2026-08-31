/**
 * Где установлен скилл и надо ли его обновлять отдельно.
 *
 * Три способа установки — три разных последствия у `takt update`:
 *
 *   ссылка   `~/.claude/skills/takt` → каталог кода. `git pull` обновляет обоих
 *            разом: файл скилла лежит в том же дереве.
 *   копия    скилл скопирован (`npx skills add`). Код обновится, копия — нет,
 *            и агент будет читать вчерашнюю инструкцию, не зная об этом.
 *   нет      скилл не установлен: обновлять нечего.
 *
 * Различать их важно ровно из-за второго случая: он молчаливый. Ничего не падает,
 * просто инструкция расходится с кодом — та самая болезнь, ради которой скилл и
 * ужимался до стаба.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/** Куда ставят скиллы — в порядке, в каком их ищут сами харнессы. */
export const МЕСТА = [
  path.join(os.homedir(), '.claude', 'skills', 'takt'),
  path.join(os.homedir(), '.agents', 'skills', 'takt'),
];

/** Чистая часть: по факту о пути сказать, что с ним делать. */
export function classifySkill({ exists = false, link = null, root = null } = {}) {
  if (!exists) return { kind: 'none', needsCopy: false };
  // Ссылка может вести и в подкаталог кода — сравниваем по началу пути.
  if (link && root && (link === root || link.startsWith(`${root}${path.sep}`))) {
    return { kind: 'link', needsCopy: false };
  }
  return { kind: link ? 'link-elsewhere' : 'copy', needsCopy: true };
}

/** Что из кода составляет скилл: инструкция и справочники, на которые она ссылается. */
const ЧАСТИ = ['SKILL.md', 'references'];

export function findSkill(root) {
  for (const dir of МЕСТА) {
    let stat;
    try { stat = fs.lstatSync(dir); } catch { continue; }
    const link = stat.isSymbolicLink() ? fs.realpathSync(dir) : null;
    return { dir, ...classifySkill({ exists: true, link, root: fs.realpathSync(root) }) };
  }
  return { dir: null, ...classifySkill({ exists: false }) };
}

/**
 * Обновление копии: переписываем инструкцию и справочники из кода. Всё остальное
 * в каталоге скилла не наше — не трогаем.
 */
export function syncSkill(root, dir) {
  const обновлено = [];
  for (const часть of ЧАСТИ) {
    const из = path.join(root, часть);
    if (!fs.existsSync(из)) continue;
    const куда = path.join(dir, часть);
    fs.rmSync(куда, { recursive: true, force: true });
    fs.cpSync(из, куда, { recursive: true });
    обновлено.push(часть);
  }
  return обновлено;
}
