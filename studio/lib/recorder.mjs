/**
 * Запись экрана в двойном разрешении.
 *
 * Playwright умеет писать видео сам — `recordVideo` в контексте, — и Takt год этим
 * пользовался. Замер на семи настоящих дублях показал цену: VP8, 505–716 кбит/с,
 * 25 кадров в секунду, разрешение ровно в CSS-пикселях. Для интерфейса с мелким текстом
 * это мало втройне: детали умирают в кодеке раньше, чем упрутся в разрешение, а монтаж
 * потом тянет 25 к/с до 30 дублированием кадров, и прокрутка начинает дёргаться.
 *
 * ПОЧЕМУ НЕ СКРИНКАСТ. `Page.startScreencast` дёшев и событийен, но отдаёт CSS-пиксели и
 * `deviceScaleFactor` игнорирует: при вьюпорте 720×405 и dsf=2 он прислал 720×405.
 * `maxWidth`/`maxHeight` работают потолком, а не целью, и `Emulation.setDeviceMetricsOverride`
 * ничего не меняет. Проверено замером — старый комментарий в capture/lib/recorder.mjs
 * утверждал обратное и был неверен для нынешнего Chromium.
 *
 * ПОЧЕМУ НЕ ПО ТАЙМЕРУ. Снимаем непрерывно, как получается, и запоминаем время каждого
 * кадра. Постоянные 30 к/с делает кодировщик по этим отметкам: неровный захват не искажает
 * темп движения, а провалы честно видит проверка пропусков.
 *
 * ПОЧЕМУ page.screenshot, А НЕ СЫРОЙ CDP. Сырой `Page.captureScreenshot` быстрее на
 * пятую часть, и первая версия брала его. На живом прогоне это дало намертво висящий
 * захват: сырой цикл идёт мимо планировщика Playwright и конкурирует с его же действиями
 * на той же странице — сначала с живым экраном студии, потом с пробами якорей. Оба раза
 * снимок переставал возвращаться совсем, без ошибки. Одно соединение и один планировщик
 * дороже, но конкурировать в нём нечему.
 *
 * ЧЕГО ЭТОТ РЕКОРДЕР НЕ УМЕЕТ. Множитель задаётся `deviceScaleFactor` контекста и на лету
 * не меняется. Замер на живом Mission Control: снимок в 2× стоит 59,2 мс — это 16,9 к/с
 * при целевых тридцати. Недостачу кодировщик добивает повтором кадров, то есть движение
 * теряет плавность ровно там, где её обещали. Поэтому рекордер пишет в `capturedFps`,
 * сколько реально вышло, — решение о компромиссе между резкостью и плавностью принимается
 * по этому числу, а не вслепую.
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

export class Recorder {
  constructor(page, { dir, fps = 30, viewport, scale = null, quality = 90 } = {}) {
    this.page = page;
    this.dir = dir;
    this.fps = fps;
    this.viewport = viewport;
    this.scale = scale;
    this.quality = quality;
    this.framesDir = path.join(dir, 'frames');
    this.file = path.join(dir, 'take.mp4');
    this.frameNo = 0;
    this.frameTimes = [];
    this.running = false;
  }

  /** Время съёмки в секундах — общая шкала для треков якорей и телеметрии. */
  now() {
    return this.t0 ? (Date.now() - this.t0) / 1000 : 0;
  }

  async start() {
    fs.rmSync(this.framesDir, { recursive: true, force: true });
    fs.mkdirSync(this.framesDir, { recursive: true });
    this.t0 = Date.now();
    this.running = true;
    this.loop = this.#capture();
  }

  /**
   * Один кадр. Множитель задаётся `deviceScaleFactor` контекста, а не параметром снимка:
   * page.screenshot честно отдаёт плотность контекста, в отличие от скринкаста.
   */
  async #shoot() {
    const buf = await this.page.screenshot({ type: 'jpeg', quality: this.quality });
    return { data: buf };
  }

  async #capture() {
    while (this.running) {
      let data;
      try {
        ({ data } = await this.#shoot());
        this.fails = 0;
      } catch (e) {
        // Страница между переходами снимку недоступна — пропущенный кадр безобиднее
        // упавшей съёмки. Но пауза и счётчик обязательны: без них подряд идущие отказы
        // дают бесконечный тихий цикл, который выглядит как работающая съёмка и не
        // пишет ни кадра. Ровно так и случилось на первом прогоне.
        if (!this.running) break;
        this.fails = (this.fails || 0) + 1;
        if (this.fails >= 50) {
          this.running = false;
          this.error = new Error(`Снимок экрана не удался 50 раз подряд: ${e.message}`);
          break;
        }
        await new Promise((r) => setTimeout(r, 50));
        continue;
      }
      const t = Date.now() - this.t0;
      // Последний кадр отдаём наружу: живой экран студии показывает его вместо того,
      // чтобы снимать свой. Два потока снимков конкурируют за один surface браузера, и
      // тогда снимок рекордера просто не возвращается — процесс жив, а кадров нет.
      this.latest = data.toString('base64');
      const file = path.join(this.framesDir, `f-${String(this.frameNo).padStart(6, '0')}.jpg`);
      await fs.promises.writeFile(file, data);
      this.frameTimes.push(t);
      this.frameNo += 1;
    }
  }

  async stop() {
    this.running = false;
    await this.loop;
    if (this.error) throw this.error;

    await this.#encode();
    fs.rmSync(this.framesDir, { recursive: true, force: true });

    return {
      file: this.file,
      fps: this.fps,
      scale: this.scale,
      viewport: this.viewport,
      frames: this.frameNo,
      frameTimes: this.frameTimes,
      // Сколько кадров в секунду реально вышло. Если заметно ниже целевой частоты,
      // кодировщик добьёт её повтором кадров — и это будет видно как подёргивание.
      capturedFps: this.frameTimes.length > 1
        ? Number((this.frameNo / (this.frameTimes.at(-1) / 1000)).toFixed(1))
        : 0,
      seconds: this.frameTimes.length
        ? Number((this.frameTimes.at(-1) / 1000).toFixed(3))
        : 0,
    };
  }

  /**
   * Кадры → mp4 с постоянной частотой.
   *
   * Демуксер concat, а не image2: у него на каждый кадр своя длительность, поэтому
   * реальное время съёмки сохраняется. С image2 неровный захват выдал бы ролик,
   * который идёт то быстрее, то медленнее настоящего.
   */
  #encode() {
    if (!this.frameNo) throw new Error('Не снято ни одного кадра');

    const lines = [];
    for (let i = 0; i < this.frameNo; i++) {
      const next = i + 1 < this.frameNo ? this.frameTimes[i + 1] : this.frameTimes[i] + 1000 / this.fps;
      const dur = Math.max(0.001, (next - this.frameTimes[i]) / 1000);
      lines.push(`file 'f-${String(i).padStart(6, '0')}.jpg'`);
      lines.push(`duration ${dur.toFixed(4)}`);
    }
    // Демуксер concat теряет последний кадр, если его не повторить — известная особенность.
    lines.push(`file 'f-${String(this.frameNo - 1).padStart(6, '0')}.jpg'`);
    const listFile = path.join(this.framesDir, 'frames.txt');
    fs.writeFileSync(listFile, lines.join('\n'));

    return new Promise((resolve, reject) => {
      const ff = spawn('ffmpeg', [
        '-v', 'error', '-y',
        '-f', 'concat', '-safe', '0', '-i', listFile,
        // trunc до чётного: x264 не берёт нечётную сторону, а вьюпорт бывает любым.
        '-vf', `fps=${this.fps},scale=trunc(iw/2)*2:trunc(ih/2)*2`,
        '-c:v', 'libx264', '-preset', 'slow', '-crf', '16',
        '-pix_fmt', 'yuv420p',
        // Перемотка по таймкодам — основной способ работы с дублем в студии,
        // без частых ключевых кадров она прыгает мимо.
        '-g', String(this.fps * 2),
        '-movflags', '+faststart',
        this.file,
      ], { stdio: ['ignore', 'ignore', 'pipe'] });
      let err = '';
      ff.stderr.on('data', (d) => { err += d; });
      ff.on('error', reject);
      ff.on('close', (code) => (code === 0
        ? resolve()
        : reject(new Error(`ffmpeg ${code}: ${err.slice(-600)}`))));
    });
  }
}
