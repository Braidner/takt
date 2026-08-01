/**
 * Звук ролика: подложка и щелчки действий.
 *
 * Музыка СИНТЕЗИРУЕТСЯ, а не берётся из библиотеки, и это решение не про экономию.
 * Ролик про чужой продукт уезжает к заказчику, в соцсети, на конференцию — и трек с
 * неясной лицензией превращается в проблему через полгода, когда автор ролика уже не
 * помнит, откуда его взял. Сгенерированная подложка правовых хвостов не оставляет.
 *
 * Заодно она подстраивается под ролик: длительность точно по видео, тональность одна
 * на все ролики проекта, громкость посчитана относительно щелчков.
 *
 * Что здесь звучит:
 *   * ПОДЛОЖКА — минорный септаккорд из чистых тонов с медленным дыханием громкости.
 *     Не мелодия: мелодия отвлекает от интерфейса и через три просмотра надоедает.
 *     Задача подложки — убрать ощущение немого черновика, а не развлечь;
 *   * ЩЕЛЧКИ на каждом действии — они объясняют, что произошло действие, а не само
 *     открылось. Это единственный звук, который несёт смысл;
 *   * ПРИГЛУШЕНИЕ подложки под щелчком (sidechain): без него щелчок тонет в музыке,
 *     а поднимать его громкость значит делать ролик резким.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);
const ff = (args) => run('ffmpeg', ['-v', 'error', '-y', ...args], { maxBuffer: 1 << 28 });

const SR = 48000;

/**
 * Ноты подложки — Dm9 без терции: она даёт минорную окраску, а без неё аккорд звучит
 * нейтрально и не тянет одеяло на себя. Частоты низкие: высокие тона на фоне речи и
 * щелчков режут слух.
 */
const CHORD = [
  { hz: 73.42,  gain: 0.34 },   // D2 — опора
  { hz: 146.83, gain: 0.22 },   // D3
  { hz: 220.00, gain: 0.15 },   // A3
  { hz: 329.63, gain: 0.09 },   // E4 — воздух
];

/** Подложка на всю длину ролика. */
async function makeBed(seconds, file) {
  const inputs = [];
  const parts = [];
  CHORD.forEach((n, i) => {
    inputs.push('-f', 'lavfi', '-t', String(seconds),
                '-i', `sine=frequency=${n.hz}:sample_rate=${SR}`);
    // Каждый голос дышит своим периодом: совпадающие периоды дают пульсацию,
    // которую слышно как «моргание» громкости. Дыхание задаём выражением, а не
    // фильтром tremolo: он не принимает частоты ниже 0.1 Гц, а нужный период —
    // десятки секунд, иначе подложка начинаетвибрировать вместо того, чтобы дышать.
    const period = 11 + i * 3.5;
    parts.push(`[${i}:a]volume=eval=frame:`
      + `volume='${n.gain}*(0.78+0.22*sin(2*PI*t/${period.toFixed(1)}))',`
      + `lowpass=f=${1200 + i * 400}[n${i}]`);
  });

  const mix = CHORD.map((_, i) => `[n${i}]`).join('');
  parts.push(`${mix}amix=inputs=${CHORD.length}:normalize=0,`
    // Реверб короткими отражениями: чистые тоны звучат синтетически и «в лоб»,
    // с ним подложка отодвигается за картинку, где ей и место.
    + `aecho=0.8:0.85:180|320|520:0.28|0.19|0.11,`
    + `highpass=f=45,`
    + `afade=t=in:st=0:d=2.5,afade=t=out:st=${Math.max(0, seconds - 3).toFixed(2)}:d=3,`
    + `volume=0.5[bed]`);

  await ff([...inputs, '-filter_complex', parts.join(';'), '-map', '[bed]',
            '-ar', String(SR), '-ac', '2', file]);
  return file;
}

/**
 * Щелчок действия: короткий импульс с быстрым затуханием.
 *
 * Собирается из шума, а не из тона: чистый тон звучит как сигнал прибора, шумовой
 * импульс — как механическое нажатие.
 */
async function makeClick(file) {
  await ff(['-f', 'lavfi', '-t', '0.12', '-i', `anoisesrc=c=pink:r=${SR}:a=0.5`,
            '-af', 'highpass=f=1400,lowpass=f=7000,'
                 + 'afade=t=out:st=0:d=0.10:curve=exp,volume=0.55',
            '-ar', String(SR), '-ac', '2', file]);
  return file;
}

/** Мягкий «выдох» на смене плана: сглаживает склейку, если она резкая. */
async function makeWhoosh(file) {
  await ff(['-f', 'lavfi', '-t', '0.65', '-i', `anoisesrc=c=brown:r=${SR}:a=0.6`,
            '-af', 'highpass=f=200,lowpass=f=2200,'
                 + 'afade=t=in:st=0:d=0.28,afade=t=out:st=0.3:d=0.35,volume=0.22',
            '-ar', String(SR), '-ac', '2', file]);
  return file;
}

/**
 * Собрать дорожку и подмешать в видео.
 *
 * hits — моменты действий из телеметрии. Щелчок ставится на сам момент, а не на
 * начало наезда камеры: звук должен совпасть с тем, что видно.
 */
export async function buildSound({ video, out, hits = [], duration, work, music = true }) {
  fs.mkdirSync(work, { recursive: true });

  const bed = await makeBed(duration, path.join(work, 'bed.wav'));
  const click = await makeClick(path.join(work, 'click.wav'));
  const whoosh = await makeWhoosh(path.join(work, 'whoosh.wav'));

  // Больше двадцати щелчков в графе — это уже каша и в звуке, и в командной строке.
  const marks = hits.slice(0, 20);

  const inputs = ['-i', video, '-i', bed];
  const parts = [];

  parts.push('[1:a]volume=1[bedv]');

  marks.forEach((h, i) => {
    inputs.push('-i', click);
    const idx = 2 + i;
    parts.push(`[${idx}:a]adelay=${Math.round(h.t * 1000)}|${Math.round(h.t * 1000)}[k${i}]`);
  });

  // Один выдох на старте: он же прикрывает вход в кадр.
  inputs.push('-i', whoosh);
  const wIdx = 2 + marks.length;
  parts.push(`[${wIdx}:a]adelay=200|200[wh]`);

  if (marks.length) {
    // Щелчки собираем в отдельную шину. Её приходится раздваивать: один и тот же
    // выход в ffmpeg нельзя подключить дважды, а шина нужна и как боковая цепь
    // компрессора, и как самостоятельный голос в миксе.
    const keys = marks.map((_, i) => `[k${i}]`).join('');
    // Шину дополняем тишиной до полной длины: sidechaincompress завершается по
    // КРАТЧАЙШЕМУ входу, а щелчки кончаются задолго до конца музыки — без padding
    // он обрезал бы готовый ролик на последнем действии. Ошибки при этом нет:
    // файл просто оказывается короче картинки.
    parts.push(`${keys}[wh]amix=inputs=${marks.length + 1}:normalize=0,`
      + `apad=whole_dur=${duration.toFixed(2)},atrim=0:${duration.toFixed(2)},asplit=2[fxA][fxB]`);
    parts.push('[bedv][fxA]sidechaincompress=threshold=0.06:ratio=6:attack=6:release=280[ducked]');
    parts.push('[ducked][fxB]amix=inputs=2:normalize=0,'
      + 'loudnorm=I=-19:TP=-1.5,alimiter=limit=0.95[mix]');
  } else {
    parts.push('[bedv][wh]amix=inputs=2:normalize=0,loudnorm=I=-19:TP=-1.5[mix]');
  }

  await ff([...inputs, '-filter_complex', parts.join(';'),
            '-map', '0:v:0', '-map', '[mix]',
            '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-shortest', out]);
  return out;
}
