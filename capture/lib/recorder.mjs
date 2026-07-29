import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

/**
 * Съёмка сцены: кадры берутся из CDP-скринкаста (headless, без прав на запись экрана),
 * параллельно копится телеметрия действий — по ней Remotion потом ведёт камеру и курсор.
 */
export class Recorder {
  constructor(page, { scene, fps = 30, root, viewport, scale = 2 }) {
    this.page = page;
    this.scene = scene;
    this.fps = fps;
    this.root = root;
    this.viewport = viewport;
    this.scale = scale;
    this.framesDir = path.join(root, 'out', 'frames', scene);
    this.events = [];
    this.latest = null;
    this.frameNo = 0;
    this.writing = false;
  }

  async start() {
    fs.rmSync(this.framesDir, { recursive: true, force: true });
    fs.mkdirSync(this.framesDir, { recursive: true });

    this.cdp = await this.page.context().newCDPSession(this.page);
    this.cdp.on('Page.screencastFrame', async ({ data, sessionId }) => {
      this.latest = Buffer.from(data, 'base64');
      try {
        await this.cdp.send('Page.screencastFrameAck', { sessionId });
      } catch {
        // сессия уже закрыта — кадр просто отбрасываем
      }
    });
    // без maxWidth/maxHeight скринкаст режет кадр до CSS-пикселей и наезд камеры теряет резкость
    await this.cdp.send('Page.startScreencast', {
      format: 'jpeg',
      quality: 92,
      everyNthFrame: 1,
      maxWidth: this.viewport.width * this.scale,
      maxHeight: this.viewport.height * this.scale,
    });

    // ждём первый кадр, иначе начало сцены будет пустым
    const deadline = Date.now() + 5000;
    while (!this.latest && Date.now() < deadline) await new Promise((r) => setTimeout(r, 50));
    if (!this.latest) throw new Error('скринкаст не отдал ни одного кадра');

    this.t0 = Date.now();
    // ресемплинг в постоянный fps: раз в 1/fps пишем последний пришедший кадр
    this.timer = setInterval(() => this.#tick(), 1000 / this.fps);
  }

  #tick() {
    if (!this.latest || this.writing) return;
    this.writing = true;
    const file = path.join(this.framesDir, `f-${String(this.frameNo).padStart(5, '0')}.jpg`);
    fs.promises.writeFile(file, this.latest).finally(() => {
      this.writing = false;
    });
    this.frameNo += 1;
  }

  now() {
    return (Date.now() - this.t0) / 1000;
  }

  /** kind: move | click | type | caption | wide */
  mark(event) {
    this.events.push({ t: Number(this.now().toFixed(3)), ...event });
  }

  async stop() {
    clearInterval(this.timer);
    try {
      await this.cdp.send('Page.stopScreencast');
    } catch {
      // страница могла закрыться раньше
    }
    await new Promise((r) => setTimeout(r, 200));

    const clipsDir = path.join(this.root, 'public', 'clips');
    const timelineDir = path.join(this.root, 'public', 'timeline');
    fs.mkdirSync(clipsDir, { recursive: true });
    fs.mkdirSync(timelineDir, { recursive: true });

    const clip = path.join(clipsDir, `${this.scene}.mp4`);
    await this.#encode(clip);

    const timeline = {
      scene: this.scene,
      fps: this.fps,
      frames: this.frameNo,
      durationInSeconds: Number((this.frameNo / this.fps).toFixed(3)),
      viewport: this.viewport,
      events: this.events,
    };
    fs.writeFileSync(path.join(timelineDir, `${this.scene}.json`), JSON.stringify(timeline, null, 2));
    return timeline;
  }

  #encode(outFile) {
    return new Promise((resolve, reject) => {
      const args = [
        '-y',
        '-framerate', String(this.fps),
        '-i', path.join(this.framesDir, 'f-%05d.jpg'),
        '-c:v', 'libx264',
        '-preset', 'slow',
        '-crf', '16',
        '-pix_fmt', 'yuv420p',
        outFile,
      ];
      const ff = spawn('ffmpeg', args, { stdio: ['ignore', 'ignore', 'pipe'] });
      let err = '';
      ff.stderr.on('data', (d) => (err += d.toString()));
      ff.on('error', reject);
      ff.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg ${code}: ${err.slice(-800)}`))));
    });
  }
}
