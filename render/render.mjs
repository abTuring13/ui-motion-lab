// Renders morph/index.html to video by calling window.seek(t) frame by frame.
//
//   node render/render.mjs --beats            one PNG per beat → render/beats/ (check the grid first)
//   node render/render.mjs --at 3.3,9.8       specific times → render/beats/
//   node render/render.mjs [--song s.mp3 --offset 0.42] [--loops 2]
//                                             full render: 60 fps, 4 subframes blended for motion blur
//
// Uses your installed Google Chrome (playwright-core, no browser download). The full render needs ffmpeg.
import { chromium } from 'playwright-core';
import { mkdir, rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const opt = name => { const i = argv.indexOf(name); return i === -1 ? null : argv[i + 1]; };

const FPS = 60, SUB = 4, BEAT = 0.5;
const beats = argv.includes('--beats');
const at = opt('--at');
const preview = beats || at;
const outDir = path.join(root, 'render', preview ? 'beats' : 'frames');

await rm(outDir, { recursive: true, force: true });
await mkdir(outDir, { recursive: true });

const browser = await chromium.launch({ channel: 'chrome' });
const page = await browser.newPage({ viewport: { width: 1440, height: 1440 }, deviceScaleFactor: 1 });
await page.goto(pathToFileURL(path.join(root, 'morph', 'index.html')).href + '?render=1');
await page.evaluate(() => window.ready);
const P = await page.evaluate(() => window.LOOP);
const loops = Number(opt('--loops') || 1);

let times;
if (at) times = at.split(',').map(Number);
else if (beats) times = Array.from({ length: Math.round(P / BEAT) }, (_, i) => i * BEAT);
else times = Array.from({ length: Math.round(P * FPS * SUB) }, (_, i) => i / (FPS * SUB));

for (const [i, t] of times.entries()) {
  await page.evaluate(t => window.seek(t), t);
  const name = preview ? `t${t.toFixed(3).padStart(6, '0')}.png` : `${String(i).padStart(5, '0')}.png`;
  await page.screenshot({ path: path.join(outDir, name) });
  if (!preview && i % 240 === 0) console.log(`frame ${i}/${times.length}`);
}
await browser.close();

if (preview) {
  console.log(`wrote ${times.length} frames to ${path.relative(root, outDir)}/`);
  process.exit(0);
}

// Blend each group of 4 subframes (tmix), keep one per group → 60 fps with motion blur.
await mkdir(path.join(root, 'out'), { recursive: true });
const song = opt('--song');
const offset = opt('--offset') || '0';
const out = path.join(root, 'out', 'morph-loop.mp4');
const args = ['-y', '-stream_loop', String(loops - 1), '-framerate', String(FPS * SUB), '-i', path.join(outDir, '%05d.png')];
if (song) args.push('-ss', offset, '-i', song);
args.push(
  '-vf', `tmix=frames=${SUB},select='eq(mod(n\\,${SUB})\\,${SUB - 1})',setpts=N/${FPS}/TB`,
  '-r', String(FPS), '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '14',
);
if (song) args.push('-c:a', 'aac', '-b:a', '256k', '-shortest');
args.push(out);
const r = spawnSync('ffmpeg', args, { stdio: 'inherit' });
if (r.error) { console.error('ffmpeg not found — install it (brew install ffmpeg) and rerun.'); process.exit(1); }
console.log(`wrote ${path.relative(root, out)}`);
