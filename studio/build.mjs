/**
 * Сборка ролика.
 *
 *   takt build              собрать ролик
 *   takt build --silent     без звука
 *
 * Ролик — артефакт сборки, а не запись экрана: композиция вычисляет каждый кадр из
 * его номера и отдаёт покадровому приводу. Поэтому «мастера» и отдельного монтажа
 * больше нет — сборка сразу даёт смонтированный ролик с камерой, курсором, титрами,
 * заставкой и звуком.
 *
 * Команда осталась тонкой обёрткой: инструкция агента описывает работу командами, и
 * ломать этот договор ради перестановки файлов нельзя.
 *
 * Отдельный процесс, а не импорт: render.mjs сам читает аргументы и сам выходит.
 */
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const child = spawn(process.execPath, [path.join(DIR, 'render.mjs'), ...process.argv.slice(2)],
                    { stdio: 'inherit' });
child.on('close', (code) => process.exit(code ?? 1));
