import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Recorder } from '../studio/lib/recorder.mjs';

const run = promisify(execFile);

async function record(seconds, { scale = 2, fps = 30 } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'takt-rec-'));
  const browser = await chromium.launch();
  const viewport = { width: 720, height: 406 };
  const page = await browser.newPage({ viewport, deviceScaleFactor: scale });
  // Движущееся содержимое: на статичном кадре скринкаст может не прислать ничего нового.
  await page.setContent(`
    <body style="margin:0;background:#101418;color:#eee;font:20px sans-serif">
      <div id="b" style="width:60px;height:60px;background:#4d9dff"></div>
      <script>
        let x = 0;
        setInterval(() => { x = (x + 7) % 600;
          document.getElementById('b').style.transform = 'translateX(' + x + 'px)'; }, 33);
      </script>
    </body>`);

  const rec = new Recorder(page, { dir, fps, viewport, scale });
  await rec.start();
  await page.waitForTimeout(seconds * 1000);
  const take = await rec.stop();
  await browser.close();
  return { take, dir };
}

test('пишет в двойном разрешении и тридцати кадрах', async () => {
  const { take, dir } = await record(1.5);

  const { stdout } = await run('ffprobe', ['-v', 'error', '-select_streams', 'v',
    '-show_entries', 'stream=width,height,r_frame_rate', '-of', 'csv=p=0', take.file]);
  assert.equal(stdout.trim().replace(/,$/, ''), '1440,812,30/1', 'разрешение или частота не те');

  assert.equal(take.fps, 30);
  assert.equal(take.scale, 2);
  assert.ok(take.frames > 20, `кадров всего ${take.frames} за полторы секунды`);

  fs.rmSync(dir, { recursive: true, force: true });
});

test('время каждого кадра записано — по нему считаются пропуски', async () => {
  const { take, dir } = await record(1.2);

  assert.equal(take.frameTimes.length, take.frames, 'времён меньше, чем кадров');
  for (let i = 1; i < take.frameTimes.length; i++) {
    assert.ok(take.frameTimes[i] >= take.frameTimes[i - 1],
      `время пошло назад на кадре ${i}`);
  }
  assert.ok(take.frameTimes[0] < 200, `первый кадр снят через ${take.frameTimes[0]} мс после старта`);

  fs.rmSync(dir, { recursive: true, force: true });
});

test('без масштабирования пишет один к одному — для сравнения', async () => {
  const { take, dir } = await record(1, { scale: 1 });
  const { stdout } = await run('ffprobe', ['-v', 'error', '-select_streams', 'v',
    '-show_entries', 'stream=width,height', '-of', 'csv=p=0', take.file]);
  assert.equal(stdout.trim().replace(/,$/, ''), '720,406');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('временные кадры убираются, остаётся только запись', async () => {
  const { take, dir } = await record(1);
  const left = fs.readdirSync(dir).filter((f) => f.endsWith('.jpg'));
  assert.equal(left.length, 0, `осталось ${left.length} временных кадров`);
  assert.ok(fs.existsSync(take.file));
  fs.rmSync(dir, { recursive: true, force: true });
});
