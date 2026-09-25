"""Builds film/audio/film-mix.mp3: the music as a quiet bed, plus synthesized sound design
placed so each effect's measured peak lands on its event in the film.

    python3 film/tools/make_audio.py --song path/to/surf-house-productions-island-breeze.mp3

The song ("Island Breeze" by Surf House Productions, CC BY 4.0) is cut 2 bars before its
drop (measured: 120.01 BPM, drop downbeat at 17.890 s), so the drop lands on bar 3 (t = 4.0).
All effects are synthesized here, so there are no third-party SFX licenses to track.
Needs numpy and ffmpeg.
"""
import argparse
import subprocess
from pathlib import Path

import numpy as np

SR = 44100
BPM = 120.01
B = 60 / BPM
P = 40 * B                      # 10 bars
DROP_IN_SONG = 17.890           # measured drop downbeat in the source song
CUT_START = DROP_IN_SONG - 8 * B
MUSIC_GAIN = 0.1                # music sits far under the effects (about -20 dB): a background bed

rng = np.random.default_rng(7)
ROOT = Path(__file__).resolve().parents[2]


# ---------------------------------------------------------------- filters (numpy only)
def biquad(x, f, q, kind="bp"):
    """RBJ biquad with per-sample cutoff (f may be a scalar or an array)."""
    n = len(x)
    f = np.broadcast_to(np.asarray(f, dtype=float), (n,))
    w0 = 2 * np.pi * np.clip(f, 20, SR * 0.45) / SR
    alpha = np.sin(w0) / (2 * q)
    cw = np.cos(w0)
    if kind == "bp":
        b0, b1, b2 = alpha, np.zeros(n), -alpha
    elif kind == "lp":
        b0 = b2 = (1 - cw) / 2
        b1 = 1 - cw
    else:  # hp
        b0 = b2 = (1 + cw) / 2
        b1 = -(1 + cw)
    a0 = 1 + alpha
    a1, a2 = -2 * cw / a0, (1 - alpha) / a0
    b0, b1, b2 = b0 / a0, b1 / a0, b2 / a0
    y = np.zeros(n)
    x1 = x2 = y1 = y2 = 0.0
    for i in range(n):
        yi = b0[i] * x[i] + b1[i] * x1 + b2[i] * x2 - a1[i] * y1 - a2[i] * y2
        x2, x1, y2, y1 = x1, x[i], y1, yi
        y[i] = yi
    return y


def stereo(mono, pan):
    """pan: scalar or per-sample array in [-1, 1] (equal power)."""
    pan = np.broadcast_to(np.asarray(pan, dtype=float), mono.shape)
    a = (pan + 1) * np.pi / 4
    return np.stack([mono * np.cos(a), mono * np.sin(a)], axis=1)


def lin(n):
    return np.linspace(0, 1, n, endpoint=False)


# ---------------------------------------------------------------- effects
def whoosh(dur=0.6, peak=0.5, f0=400, f1=3000, pan=(-0.5, 0.5), q=1.1, gain=0.5):
    n = int(dur * SR)
    t = lin(n)
    rise = np.clip(t / peak, 0, 1) ** 2.2
    fall = np.clip((1 - t) / (1 - peak), 0, 1) ** 1.6
    env = np.where(t < peak, rise, fall)
    f = f0 * (f1 / f0) ** np.clip(t / peak, 0, 1) if f1 > f0 else f0 * (f1 / f0) ** t
    y = biquad(rng.standard_normal(n), f, q) * env
    return stereo(y / (np.abs(y).max() + 1e-9) * gain, np.linspace(pan[0], pan[1], n))


def riser(dur=1.45, gain=0.45):
    n = int(dur * SR)
    t = lin(n)
    env = t ** 3
    noise = biquad(rng.standard_normal(n), 250 * (7000 / 250) ** t, 1.4) * env
    freq = 110 * 2 ** (3 * t)                       # three octaves up
    tone = np.sin(2 * np.pi * np.cumsum(freq) / SR) * env * 0.35
    trem = 0.75 + 0.25 * np.sin(2 * np.pi * np.cumsum(4 + 12 * t) / SR)   # tremolo speeds up into the drop
    y = (noise / (np.abs(noise).max() + 1e-9) + tone) * trem
    return stereo(y / np.abs(y).max() * gain, np.sin(2 * np.pi * 1.5 * t) * 0.3)


def impact(gain=0.95):
    n = int(1.6 * SR)
    t = np.arange(n) / SR
    sub = np.sin(2 * np.pi * np.cumsum(32 + 38 * np.exp(-t / 0.08)) / SR) * np.exp(-t / 0.55)
    body = biquad(rng.standard_normal(n), 900, 0.7, "lp") * np.exp(-t / 0.12)
    click = biquad(rng.standard_normal(n), 3500, 1.5) * np.exp(-t / 0.006)
    y = sub * 1.0 + body * 0.9 + click * 0.5
    return stereo(y / np.abs(y).max() * gain, 0)


def thump(gain=0.5, f_hi=110, f_lo=45):
    n = int(0.4 * SR)
    t = np.arange(n) / SR
    body = np.sin(2 * np.pi * np.cumsum(f_lo + (f_hi - f_lo) * np.exp(-t / 0.03)) / SR) * np.exp(-t / 0.12)
    click = biquad(rng.standard_normal(n), 2400, 2, "bp") * np.exp(-t / 0.004)
    y = body + click * 0.35
    return stereo(y / np.abs(y).max() * gain, 0)


def tick(freq=3600, gain=0.18, dur=0.035, pan=0.0):
    n = int(dur * SR)
    y = biquad(rng.standard_normal(n), freq, 4) * (1 - lin(n)) ** 4
    return stereo(y / (np.abs(y).max() + 1e-9) * gain, pan)


def click(gain=0.4):
    down, up = tick(2600, gain, 0.03), tick(1800, gain * 0.6, 0.03)
    out = np.zeros((int(0.12 * SR), 2))
    out[: len(down)] += down
    out[int(0.07 * SR): int(0.07 * SR) + len(up)] += up
    return out


def pop(freq, gain=0.32, pan=0.0):
    n = int(0.25 * SR)
    t = np.arange(n) / SR
    f = freq * (1 + 0.5 * np.exp(-t / 0.012))
    ph = 2 * np.pi * np.cumsum(f) / SR
    y = (np.sin(ph) + 0.25 * np.sin(2 * ph)) * np.exp(-t / 0.07) * np.clip(t / 0.002, 0, 1)
    return stereo(y / np.abs(y).max() * gain, pan)


def scan(dur=1.05, gain=0.14):
    n = int(dur * SR)
    t = lin(n)
    env = np.sin(np.pi * t) ** 0.8
    y = biquad(rng.standard_normal(n), 1800 + 1400 * t, 7) * env
    y *= 0.8 + 0.2 * np.sin(2 * np.pi * np.cumsum(np.full(n, 24.0)) / SR)
    return stereo(y / np.abs(y).max() * gain, np.linspace(-0.85, 0.85, n))


def swell(dur=1.0, gain=0.35):
    n = int(dur * SR)
    t = lin(n)
    y = biquad(rng.standard_normal(n), 300 * (9000 / 300) ** t, 0.8, "lp") * t ** 3.5
    return stereo(y / np.abs(y).max() * gain, 0)


def shimmer(gain=0.3):
    n = int(2.2 * SR)
    t = np.arange(n) / SR
    y = np.zeros(n)
    for k, (f, a) in enumerate([(880, 1), (1320, .6), (1760, .45), (2640, .3), (3520, .18)]):
        for det in (-1.5, 1.5):
            y += a * np.sin(2 * np.pi * (f + det) * t + k) * np.exp(-t / (1.0 - k * 0.12))
    y *= np.clip(t / 0.012, 0, 1)
    left = y * (0.9 + 0.1 * np.sin(2 * np.pi * 0.7 * t))
    right = y * (0.9 + 0.1 * np.cos(2 * np.pi * 0.7 * t))
    out = np.stack([left, right], axis=1)
    return out / np.abs(out).max() * gain


# ---------------------------------------------------------------- the cue sheet (film times, seconds)
def cues():
    c = []
    for k in range(4):                                     # hook words land, camera steps back
        c.append((k * B, thump(0.26, 140, 70)))
    c.append((2.0, whoosh(0.5, 0.45, 500, 2600, (-0.3, 0.3), gain=0.3)))           # word morphs into the prompt
    for i in range(12):                                    # typing
        c.append((2.25 + i * B / 8, tick(4200 + rng.uniform(-300, 300), 0.12, pan=-0.2 + 0.03 * i)))
    c.append((3.02, whoosh(0.4, 0.6, 700, 3200, (-0.2, 0.4), gain=0.22)))          # camera races to the button
    c.append((3.5, click(0.45)))
    c.append((3.985, riser(1.45, 0.42)))                   # riser peaks right before the drop
    c.append((4.0, impact(0.95)))                          # the drop: the circle opens
    c.append((4.22, whoosh(0.75, 0.3, 3200, 280, (0.5, -0.5), gain=0.4)))          # pull out to the wall
    c.append((5.0, scan(1.05, 0.14)))
    for w, (f, pan) in enumerate([(660, -0.3), (880, 0.0), (1100, 0.3)]):          # three winners
        c.append((5.0 + w * B / 2, pop(f, 0.3, pan)))
    c.append((5.96, whoosh(0.55, 0.88, 300, 4200, (0.0, 0.0), gain=0.42)))         # zoom through the winner
    c.append((6.0, thump(0.42)))
    c.append((6.5, thump(0.24, 120, 60)))
    c.append((7.8, whoosh(0.45, 0.5, 800, 2400, (0.2, -0.3), gain=0.26)))
    c.append((8.1, whoosh(1.0, 0.35, 220, 900, (-0.4, 0.4), gain=0.32)))           # crane down to the carousel
    c.append((9.62, whoosh(0.45, 0.42, 700, 5200, (-0.8, 0.8), q=1.4, gain=0.55))) # the whip
    c.append((10.0, thump(0.4)))                                                    # match cut into the phone
    c.append((11.02, whoosh(0.28, 0.5, 1500, 4800, (0.3, -0.1), gain=0.26)))       # card flip
    c.append((11.06, tick(2800, 0.2)))
    for i in range(4):                                     # result bars fill
        c.append((11.3 + i * 0.08, tick(3200 + i * 300, 0.1, pan=0.4)))
    c.append((12.0, whoosh(0.35, 0.5, 900, 3000, (0.6, -0.6), gain=0.3)))
    for j in range(4):                                     # stats push in on the beats
        c.append((12.0 + j * B, thump(0.4 if j % 2 == 0 else 0.32)))
    c.append((14.02, whoosh(1.6, 0.3, 250, 1300, (0.6, -0.6), gain=0.26)))         # ticker
    c.append((16.0, swell(1.0, 0.3)))                                               # zoom out through the logo
    c.append((16.0, shimmer(0.26)))
    c.append((16.0, thump(0.3, 90, 40)))
    c.append((16.5, tick(3000, 0.1)))
    c.append((17.0, tick(3400, 0.08)))
    return c


def peak_index(buf):
    mono = np.abs(buf).sum(axis=1)
    w = max(1, int(0.004 * SR))
    smooth = np.convolve(mono, np.ones(w) / w, mode="same")
    return int(np.argmax(smooth))


def reverb(x, secs=1.3, decay=0.33, wet=0.18):
    n = int(secs * SR)
    t = np.arange(n) / SR
    out = np.zeros_like(x)
    for ch in range(2):
        ir = rng.standard_normal(n) * np.exp(-t / decay)
        ir[: int(0.012 * SR)] = 0                     # small pre-delay
        ir /= np.sqrt((ir ** 2).sum())
        m = len(x[:, ch]) + n - 1
        size = 1 << (m - 1).bit_length()
        out[:, ch] = np.fft.irfft(np.fft.rfft(x[:, ch], size) * np.fft.rfft(ir, size), size)[: len(x)]
    return x + wet * out


def load(path, start, dur):
    raw = subprocess.run(["ffmpeg", "-v", "error", "-ss", f"{start:.4f}", "-t", f"{dur:.4f}", "-i", str(path),
                          "-ac", "2", "-ar", str(SR), "-f", "f32le", "-"], capture_output=True, check=True).stdout
    return np.frombuffer(raw, np.float32).reshape(-1, 2).astype(np.float64)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--song", required=True)
    ap.add_argument("--out", default=str(ROOT / "film" / "audio" / "film-mix.mp3"))
    args = ap.parse_args()

    n = int(round(P * SR))
    music = load(args.song, CUT_START, P)[:n]
    music = np.pad(music, ((0, n - len(music)), (0, 0)))
    t = np.arange(n) / SR
    music *= np.clip(t / 0.02, 0, 1)[:, None] * np.clip((P - t) / 2.0, 0, 1)[:, None]   # fade out with the picture

    sfx = np.zeros((n + SR * 3, 2))
    for when, buf in cues():
        start = int(round(when * SR)) - peak_index(buf)        # the peak, not the file start, lands on the event
        a, b = max(0, start), start + len(buf)
        sfx[a:b] += buf[a - start:]
    sfx = reverb(sfx)[:n]

    # duck the music under the effects (sidechain from the effects' envelope)
    env = np.convolve(np.abs(sfx).max(axis=1), np.ones(int(0.03 * SR)) / int(0.03 * SR), mode="same")
    target = 1 / (1 + 2.2 * env / (env.max() + 1e-9))
    duck = np.empty(n)
    cur, att, rel = 1.0, np.exp(-1 / (0.005 * SR)), np.exp(-1 / (0.25 * SR))   # fast attack, slow release
    for i in range(n):
        c = att if target[i] < cur else rel
        cur = target[i] + (cur - target[i]) * c
        duck[i] = cur
    mix = music * MUSIC_GAIN * duck[:, None] + sfx
    mix /= max(1.0, np.abs(mix).max() / 0.95)

    tmp = Path(args.out).with_suffix(".wav")
    pcm = (np.clip(mix, -1, 1) * 32767).astype("<i2")
    with open(tmp, "wb") as fh:
        size = pcm.nbytes
        fh.write(b"RIFF" + (36 + size).to_bytes(4, "little") + b"WAVEfmt " + (16).to_bytes(4, "little"))
        fh.write((1).to_bytes(2, "little") + (2).to_bytes(2, "little") + SR.to_bytes(4, "little"))
        fh.write((SR * 4).to_bytes(4, "little") + (4).to_bytes(2, "little") + (16).to_bytes(2, "little"))
        fh.write(b"data" + size.to_bytes(4, "little") + pcm.tobytes())
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", str(tmp), "-af", "loudnorm=I=-12.4:TP=-1.5:LRA=11",
                    "-ar", str(SR), "-c:a", "libmp3lame", "-b:a", "192k", args.out], check=True)
    tmp.unlink()
    print(f"wrote {args.out} ({P:.3f}s, {len(cues())} cues)")


if __name__ == "__main__":
    main()
