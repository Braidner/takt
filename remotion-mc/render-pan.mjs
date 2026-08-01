import { bundle } from '@remotion/bundler';
import { selectComposition, renderMedia, ensureBrowser } from '@remotion/renderer';
import path from 'node:path';
import fs from 'node:fs';

const pw = `${process.env.HOME}/Library/Caches/ms-playwright`;
const shell = fs.readdirSync(pw).filter((d) => d.startsWith('chromium_headless_shell')).sort().at(-1);
const browserExecutable = `${pw}/${shell}/chrome-headless-shell-mac-arm64/chrome-headless-shell`;
const opts = fs.existsSync(browserExecutable) ? { browserExecutable } : {};

const t0 = Date.now();
await ensureBrowser(opts);
const serveUrl = await bundle({ entryPoint: path.resolve('remotion-mc/pan.tsx'), onProgress: () => {} });
const composition = await selectComposition({ serveUrl, id: 'Pan', ...opts });
console.log(`композиция: ${composition.width}×${composition.height}, `
  + `${composition.durationInFrames} кадров, ${composition.fps} к/с`);

const out = 'studio/journal/projects/mc-медиа/movie-pan.mp4';
let last = 0;
await renderMedia({
  composition, serveUrl, codec: 'h264', crf: 18,
  outputLocation: out, ...opts,
  onProgress: ({ progress }) => {
    const p = Math.floor(progress * 10);
    if (p > last) { last = p; process.stdout.write(`${p * 10}% `); }
  },
});
console.log(`\nготово за ${((Date.now() - t0) / 1000).toFixed(0)} с → ${out}`);
