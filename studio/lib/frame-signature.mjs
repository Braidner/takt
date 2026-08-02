/**
 * Сигнатура кадра — уменьшенная градация серого 32×18.
 *
 * Сравнивать полные кадры незачем: нас интересует «изменился ли экран», а не «на сколько
 * именно пикселей». Уменьшение до 576 байт заодно убивает шум сжатия в мелких деталях,
 * из-за которого неподвижный экран выглядел бы шевелящимся.
 *
 * Считает ffmpeg, а не библиотека декодирования: он проекту и так нужен, а лишняя
 * зависимость в открытом скилле — это лишний вес установки у каждого, кто его ставит.
 */
import { spawn } from 'node:child_process';

export const SIGNATURE_W = 32;
export const SIGNATURE_H = 18;
export const SIGNATURE_LENGTH = SIGNATURE_W * SIGNATURE_H;

/**
 * Порог, ниже которого разница в яркости считается шумом сжатия, а не изменением.
 * Подобран так, чтобы статичный экран давал ноль, а появление скелетона — заметную долю.
 */
const NOISE = 6;

/** Доля точек сигнатуры, изменившихся сильнее шума. 0 — кадр замер, 1 — сменился весь. */
export function differenceRatio(a, b) {
  if (a.length !== b.length) {
    throw new Error(`Сигнатуры разной длины: ${a.length} и ${b.length}`);
  }
  let changed = 0;
  for (let i = 0; i < a.length; i++) {
    if (Math.abs(a[i] - b[i]) > NOISE) changed++;
  }
  return changed / a.length;
}

/**
 * Кадр (JPEG или PNG в буфере) → сигнатура.
 *
 * scale=area, а не bilinear: при уменьшении в сорок раз усреднение по площади сохраняет
 * присутствие мелких деталей, а билинейное — выбрасывает их вместе с половиной строк,
 * и тогда появление текста на пустом экране осталось бы незамеченным.
 */
export async function signature(image) {
  const out = await ffmpegPipe([
    '-v', 'error', '-i', 'pipe:0',
    '-vf', `scale=${SIGNATURE_W}:${SIGNATURE_H}:flags=area,format=gray`,
    '-f', 'rawvideo', 'pipe:1',
  ], image);
  return new Uint8Array(out);
}

/**
 * ffmpeg с картинкой на входе и сырыми байтами на выходе.
 *
 * Именно spawn, а не execFile: у асинхронного execFile нет опции `input`, она есть только
 * у синхронных вариантов. Передашь её — аргумент молча проигнорируется, ffmpeg останется
 * ждать данных на stdin, и процесс повиснет навсегда без единого сообщения.
 */
function ffmpegPipe(args, input) {
  return new Promise((resolve, reject) => {
    const ff = spawn('ffmpeg', args);
    const chunks = [];
    let err = '';
    ff.stdout.on('data', (c) => chunks.push(c));
    ff.stderr.on('data', (c) => { err += c; });
    ff.on('error', reject);
    ff.on('close', (code) => (code === 0
      ? resolve(Buffer.concat(chunks))
      : reject(new Error(`ffmpeg ${code}: ${err.slice(-400)}`))));
    // EPIPE случается, когда ffmpeg закрыл вход раньше, чем мы дописали, — это не ошибка.
    ff.stdin.on('error', () => {});
    ff.stdin.end(input);
  });
}
