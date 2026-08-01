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
 * ПОЧЕМУ МАСШТАБ ИЗМЕРЯЕТСЯ, А НЕ ЗАДАН. Замер на синтетической странице обещал 28,9 мс
 * на кадр в 2× — и оказался нерепрезентативным. На живом Mission Control тот же снимок
 * стоит 59,2 мс, то есть 16,9 к/с: держать тридцать в честном 2× нельзя. Цена зависит от
 * страницы и машины, поэтому единственная честная константа — не масштаб, а требуемая
 * частота. Перед записью пробуем масштабы по убыванию и берём наибольший, который в неё
 * укладывается: на лёгкой странице выйдет 2×, на тяжёлой — 1,5×.
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

export class Recorder {
  /** Масштабы по убыванию: берём первый, который укладывается в требуемую частоту. */
  static SCALES = [2, 1.5, 1.25, 1];

  /**
   * Запас к бюджету кадра. Без него выбранный масштаб держится ровно на грани, и первая
   * же тяжёлая страница роняет частоту.
   */
  static HEADROOM = 0.85;

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
    this.cdp = await this.page.context().newCDPSession(this.page);
    if (this.scale === null) this.scale = await this.#pickScale();
    this.t0 = Date.now();
    this.running = true;
    this.loop = this.#capture();
  }

  /** Наибольший масштаб, укладывающийся в бюджет кадра на ЭТОЙ странице и машине. */
  async #pickScale() {
    const budget = (1000 / this.fps) * Recorder.HEADROOM;
    const probe = path.join(this.framesDir, 'probe.jpg');
    for (const scale of Recorder.SCALES) {
      const t0 = Date.now();
      // Меряем ВЕСЬ виток, вместе с записью кадра на диск. Первая версия мерила только
      // снимок и промахивалась на треть: 15,7 мс в пробе против 22,8 мс на деле.
      for (let i = 0; i < 3; i++) {
        const { data } = await this.#shoot(scale);
        await fs.promises.writeFile(probe, Buffer.from(data, 'base64'));
      }
      const ms = (Date.now() - t0) / 3;
      if (ms <= budget || scale === 1) {
        this.scalePick = { scale, ms: Number(ms.toFixed(1)), budget: Number(budget.toFixed(1)) };
        fs.rmSync(probe, { force: true });
        return scale;
      }
    }
    return 1;
  }

  #shoot(scale) {
    return this.cdp.send('Page.captureScreenshot', {
      format: 'jpeg',
      quality: this.quality,
      optimizeForSpeed: true,
      // clip.scale — единственный способ получить настоящий множитель: и скринкаст, и
      // снимок без clip отдают CSS-пиксели, сколько бы ни стоял deviceScaleFactor.
      clip: { x: 0, y: 0, width: this.viewport.width, height: this.viewport.height, scale },
      fromSurface: true,
    });
  }

  async #capture() {
    while (this.running) {
      let data;
      try {
        ({ data } = await this.#shoot(this.scale));
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
      this.latest = data;
      const file = path.join(this.framesDir, `f-${String(this.frameNo).padStart(6, '0')}.jpg`);
      await fs.promises.writeFile(file, Buffer.from(data, 'base64'));
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
      scalePick: this.scalePick || null,
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
