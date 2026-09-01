/**
 * Чей признак готовности берёт съёмка — цели или пресета.
 *
 * Пресет описывает систему по умолчанию, цель — систему конкретного ролика. Когда
 * скрипт берёт пресет напрямую, чужой селектор готовности молча побеждает: стенд живой,
 * вход прошёл, а проверка отвечает «интерфейс не загрузился» и непонятно, что чинить.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { presetForTarget } from '../studio/preset.mjs';

const STUDIO = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'studio');

test('цель перекрывает признак готовности из пресета', () => {
  const p = presetForTarget({ name: 'FESB', ready: '#app .ant-menu' });
  assert.equal(p.ready, '#app .ant-menu');
  assert.equal(p.name, 'FESB');
});

test('цель без своего признака готовности оставляет пресетный', () => {
  const p = presetForTarget({ name: 'FESB' });
  assert.ok(p.ready, 'признак готовности должен остаться от пресета');
});

test('язык и тема цели перекрывают пресетные', () => {
  const p = presetForTarget({ language: { key: 'lang', value: 'ru' }, theme: null });
  assert.deepEqual(p.language, { key: 'lang', value: 'ru' });
});

/**
 * Гейт паритета: три скрипта открывают браузер по одному и тому же знанию о системе.
 * Разъехаться им нельзя — иначе проверка стенда зелёная, а съёмка идёт на чужих
 * селекторах (или наоборот).
 */
for (const file of ['check-stend.mjs', 'probe-stend.mjs', 'shoot.mjs']) {
  test(`${file} берёт пресет с поправкой на цель`, () => {
    const src = fs.readFileSync(path.join(STUDIO, file), 'utf8');
    assert.ok(/presetForTarget\(/.test(src), 'должен звать presetForTarget');
    assert.ok(!/[^a-zA-Z]loadPreset\(\)/.test(src), 'пресет напрямую брать нельзя — цель будет проигнорирована');
  });
}
