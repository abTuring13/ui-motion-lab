// Renders morph/index.html to video by calling window.seek(t) frame by frame.
//
//   node render/render.mjs --beats            one PNG per beat → render/beats/ (check the grid first)
//   node render/render.mjs --at 3.3,9.8       specific times → render/beats/
//   node render/render.mjs [--loops 2]        full render: 60 fps, 4 subframes blended for motion blur,
//                                             with a synthesized kick + UI-click track (same as the page's Sound toggle)
//   node render/render.mjs --song s.mp3 --offset 0.42
//                                             use a song instead (--offset = where its first downbeat is, in s)
//   node render/render.mjs --mux-only         skip capture, re-encode from the frames already in render/frames/
//   --no-sfx                                  video only, no audio
//
// Uses your installed Google Chrome (playwright-core, no browser download). The full render needs ffmpeg.
import { chromium } from 'playwright-core';
import { mkdir, rm, writeFile } from 'node:fs/promises';
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
const muxOnly = argv.includes('--mux-only');
const outDir = path.join(root, 'render', preview ? 'beats' : 'frames');

const browser = await chromium.launch({ channel: 'chrome' });
const page = await browser.newPage({ viewport: { width: 1440, height: 1440 }, deviceScaleFactor: 1 });
await page.goto(pathToFileURL(path.join(root, 'morph', 'index.html')).href + '?render=1');
await page.evaluate(() => window.ready);
const P = await page.evaluate(() => window.LOOP);
const EVENTS = await page.evaluate(() => window.EVENTS);
const loops = Number(opt('--loops') || 1);

if (!muxOnly) {
  await rm(outDir, { recursive: true, force: true });
  await mkdir(outDir, { recursive: true });
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
  if (preview) console.log(`wrote ${times.length} frames to ${path.relative(root, outDir)}/`);
}
await browser.close();
if (preview) process.exit(0);

await mkdir(path.join(root, 'out'), { recursive: true });
const song = opt('--song');
const sfx = !song && !argv.includes('--no-sfx');
const wav = path.join(root, 'out', 'sfx.wav');
if (sfx) await writeFile(wav, synthesize(EVENTS, P, loops));

// Blend each group of 4 subframes (tmix), keep one per group → 60 fps with motion blur.
const out = path.join(root, 'out', 'morph-loop.mp4');
const args = ['-y', '-stream_loop', String(loops - 1), '-framerate', String(FPS * SUB), '-i', path.join(outDir, '%05d.png')];
if (song) args.push('-ss', opt('--offset') || '0', '-i', song);
if (sfx) args.push('-i', wav);
args.push(
  '-vf', `tmix=frames=${SUB},select='eq(mod(n\\,${SUB})\\,${SUB - 1})',setpts=N/${FPS}/TB`,
  '-r', String(FPS), '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '14',
);
if (song || sfx) args.push('-c:a', 'aac', '-b:a', '192k', '-shortest');
args.push(out);
const r = spawnSync('ffmpeg', args, { stdio: 'inherit' });
if (r.error) { console.error('ffmpeg not found — install it (brew install ffmpeg) and rerun.'); process.exit(1); }
console.log(`wrote ${path.relative(root, out)}${song ? ' (with song)' : sfx ? ' (with synthesized sfx)' : ' (no audio)'}`);

/* ---- offline version of the page's WebAudio sounds → 16-bit mono WAV ---- */
function synthesize(events, period, loops) {
  const SR = 48000, n = Math.ceil(period * loops * SR);
  const buf = new Float32Array(n);
  let seed = 1;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;

  const kick = start => {
    let phase = 0;
    for (let i = 0; i < 0.2 * SR && start + i < n; i++) {
      const t = i / SR;
      const f = t < 0.12 ? 130 * Math.pow(45 / 130, t / 0.12) : 45;
      phase += 2 * Math.PI * f / SR;
      const g = t < 0.18 ? 0.28 * Math.pow(0.001 / 0.28, t / 0.18) : 0;
      buf[start + i] += Math.sin(phase) * g;
    }
  };
  const PRESET = { click: [2600, 4, 0.5], key: [4200, 4, 0.28], tick: [1800, 4, 0.3], pop: [900, 1.5, 0.45] };
  const noise = (start, [freq, Q, gain]) => {
    // RBJ band-pass biquad (0 dB peak), same as a WebAudio 'bandpass' BiquadFilterNode
    const w0 = 2 * Math.PI * freq / SR, alpha = Math.sin(w0) / (2 * Q), a0 = 1 + alpha;
    const b0 = alpha / a0, b2 = -alpha / a0, a1 = -2 * Math.cos(w0) / a0, a2 = (1 - alpha) / a0;
    let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
    const len = 0.05 * SR;
    for (let i = 0; i < len + 0.03 * SR && start + i < n; i++) {
      const x = i < len ? rand() * Math.pow(1 - i / len, 4) : 0;
      const y = b0 * x + b2 * x2 - a1 * y1 - a2 * y2;
      x2 = x1; x1 = x; y2 = y1; y1 = y;
      buf[start + i] += y * gain;
    }
  };

  for (let l = 0; l < loops; l++) {
    for (const [t, kind] of events) {
      const start = Math.round((t + l * period) * SR);
      if (kind === 'kick') kick(start); else noise(start, PRESET[kind]);
    }
  }

  const data = Buffer.alloc(44 + n * 2);
  data.write('RIFF', 0); data.writeUInt32LE(36 + n * 2, 4); data.write('WAVE', 8);
  data.write('fmt ', 12); data.writeUInt32LE(16, 16); data.writeUInt16LE(1, 20); data.writeUInt16LE(1, 22);
  data.writeUInt32LE(SR, 24); data.writeUInt32LE(SR * 2, 28); data.writeUInt16LE(2, 32); data.writeUInt16LE(16, 34);
  data.write('data', 36); data.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) data.writeInt16LE(Math.round(Math.tanh(buf[i] * 1.2) * 32000), 44 + i * 2);
  return data;
}
