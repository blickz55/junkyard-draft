/**
 * Measurements (docs/SOUND.md): what tests/sound.test.ts and tools/make-sfx.ts hold the recipes to, because nobody working on this code
 * can hear it. Nothing here ships: the game never imports this file.
 */
import { SR, biquad, ifft } from './dsp';
import type { Mono, Sound } from './dsp';

export const db = (x: number) => 20 * Math.log10(Math.max(x, 1e-9));
export const channels = (s: Sound): Mono[] => (s instanceof Float32Array ? [s] : s);
export const mono = (s: Sound): Mono => {
  if (s instanceof Float32Array) return s;
  const [l, r] = s;
  return l.map((v, i) => (v + r[i]) / 2);
};
export function rms(x: Mono, from = 0, to = x.length) {
  let e = 0;
  for (let i = from; i < to; i++) e += x[i] * x[i];
  return Math.sqrt(e / Math.max(1, to - from));
}
/** The loudest stretch of `win` seconds, in linear RMS: a short sound's level is its burst, not its average over a long tail. */
export function peakRms(x: Mono, win = 0.05, rate = SR) {
  const w = Math.min(x.length, Math.round(win * rate));
  let e = 0,
    best = 0;
  for (let i = 0; i < x.length; i++) {
    e += x[i] * x[i];
    if (i >= w) e -= x[i - w] * x[i - w];
    best = Math.max(best, e);
  }
  return Math.sqrt(Math.max(best, 0) / w);
}
/** Momentary loudness: the loudest 50 ms after a 100 Hz high-pass, the low end that ears and small speakers both give away. Linear. */
export const loudness = (x: Mono, rate = SR) => peakRms(biquad(x.slice(), 'hp', 100, 0.5, rate), 0.05, rate);
export const dc = (x: Mono) => x.reduce((a, v) => a + v, 0) / x.length;
/** Seconds from the start to the first sample at `level` of the peak. */
export function attack(x: Mono, level = 0.5, rate = SR) {
  let p = 0;
  for (let i = 0; i < x.length; i++) p = Math.max(p, Math.abs(x[i]));
  const i = x.findIndex((v) => Math.abs(v) >= p * level);
  return i / rate;
}
/** Largest step between neighbouring samples in the first `sec` seconds, relative to the peak: 0.5 would be a click. */
export function firstJump(x: Mono, sec = 0.0005, rate = SR) {
  let p = 0,
    j = Math.abs(x[0]);
  for (let i = 0; i < x.length; i++) p = Math.max(p, Math.abs(x[i]));
  for (let i = 1, n = Math.min(x.length, Math.round(sec * rate)); i < n; i++) j = Math.max(j, Math.abs(x[i] - x[i - 1]));
  return j / (p || 1);
}
/** Power spectrum of a Hann-windowed stretch, as [hz, power] pairs up to Nyquist. */
export function spectrum(x: Mono, rate = SR, from = 0, len = x.length - from) {
  const n = 2 ** Math.ceil(Math.log2(len)),
    re = new Float64Array(n),
    im = new Float64Array(n);
  for (let i = 0; i < len && from + i < x.length; i++) re[i] = x[from + i] * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / len));
  for (const _ of ifft(re, im)) void _; // the inverse transform has the same magnitudes as the forward one for a real input
  const out: [number, number][] = [];
  for (let k = 1; k <= n / 2; k++) out.push([(k * rate) / n, re[k] * re[k] + im[k] * im[k]]);
  return out;
}
/** Power-weighted mean frequency. */
export function centroid(x: Mono, rate = SR) {
  let a = 0,
    b = 0;
  for (const [f, p] of spectrum(x, rate)) {
    a += f * p;
    b += p;
  }
  return a / (b || 1);
}
/** Share of the power above `hz`. */
export function energyAbove(x: Mono, hz: number, rate = SR) {
  let a = 0,
    b = 0;
  for (const [f, p] of spectrum(x, rate)) {
    if (f >= hz) a += p;
    b += p;
  }
  return a / (b || 1);
}
/** Geometric over arithmetic mean of the power spectrum between 100 Hz and 6 kHz: near 0 for lines, near 1 for white noise. */
export function flatness(x: Mono, rate = SR, from = 0, len = x.length - from) {
  let g = 0,
    a = 0,
    n = 0;
  for (const [f, p] of spectrum(x, rate, from, len))
    if (f >= 100 && f <= 6000) {
      g += Math.log(p + 1e-18);
      a += p;
      n++;
    }
  return Math.exp(g / n) / (a / n || 1);
}
/** The strongest spectral peaks of the loudest stretch (within `floor` dB of the top), lowest first, in Hz. */
export function partials(x: Mono, rate = SR, floorDb = -32, sec = 0.17) {
  let at = 0,
    e = 0,
    best = -1;
  const w = Math.min(x.length, Math.round(sec * rate));
  for (let i = 0; i < x.length; i++) {
    e += x[i] * x[i];
    if (i >= w) e -= x[i - w] * x[i - w];
    if (e > best) {
      best = e;
      at = Math.max(0, i - w + 1);
    }
  }
  const s = spectrum(x, rate, at, w),
    top = s.reduce((m, [, p]) => Math.max(m, p), 0),
    lim = top * 10 ** (floorDb / 10),
    out: number[] = [];
  for (let i = 2; i < s.length - 2; i++) {
    const p = s[i][1];
    if (p > lim && p >= s[i - 1][1] && p > s[i + 1][1] && p >= s[i - 2][1] && p > s[i + 2][1] && s[i][0] > 60 && s[i][0] < 8000) out.push(s[i][0]);
  }
  return out;
}
/** How far the peaks sit from the harmonic series of the lowest one, in cents of the worst offender. A square or a triangle scores about 0. */
export function inharmonicity(x: Mono, rate = SR) {
  const p = partials(x, rate);
  if (p.length < 2) return 0;
  let worst = 0;
  for (const f of p.slice(1)) {
    const k = f / p[0];
    worst = Math.max(worst, Math.abs(1200 * Math.log2(k / Math.max(1, Math.round(k)))));
  }
  return worst;
}
/** How much duller a sound gets as it rings: the share of its power above its main partial just after the peak, over that share a little later. A fixed waveform under an envelope scores 1. */
export function dulling(x: Mono, rate = SR) {
  const w = Math.max(256, Math.min(Math.round(0.04 * rate), Math.floor(x.length / 4))),
    p = x.reduce((best, v, i) => (Math.abs(v) > Math.abs(x[best]) ? i : best), 0),
    from = Math.min(p, x.length - 3 * w),
    early = spectrum(x, rate, from, w),
    main = early.reduce((m, b) => (b[1] > m[1] ? b : m))[0],
    share = (s: [number, number][]) => {
      let hi = 0,
        all = 1e-30;
      for (const [f, q] of s) {
        all += q;
        if (f > main * 1.6) hi += q;
      }
      return hi / all + 1e-12;
    };
  return share(early) / share(spectrum(x, rate, from + 2 * w, w));
}
/** True for what this library exists to get away from: a plain periodic waveform under an envelope. */
export const isPlainWave = (x: Mono, rate = SR) => flatness(x, rate) < 0.01 && inharmonicity(x, rate) < 10 && dulling(x, rate) < 1.1;
/** The same shape 4x oversampled through a windowed sinc: an estimate of the peak after a converter. */
export function truePeak(x: Mono) {
  const taps = 8,
    up = 4;
  let p = 0;
  for (let i = taps; i < x.length - taps; i++) {
    p = Math.max(p, Math.abs(x[i]));
    if (Math.abs(x[i]) < 0.25) continue; // only near the top can a peak between samples matter
    for (let u = 1; u < up; u++) {
      const t = u / up;
      let v = 0;
      for (let k = -taps + 1; k <= taps; k++) {
        const d = k - t,
          w = 0.5 + 0.5 * Math.cos((Math.PI * d) / taps);
        v += x[i + k] * (Math.sin(Math.PI * d) / (Math.PI * d)) * w;
      }
      p = Math.max(p, Math.abs(v));
    }
  }
  return p;
}
/** 16-bit PCM WAV of a mono or stereo sound, for the export tool. */
export function wav(s: Sound, rate = SR) {
  const ch = channels(s),
    n = ch[0].length,
    size = n * ch.length * 2,
    b = new DataView(new ArrayBuffer(44 + size)),
    text = (at: number, t: string) => [...t].forEach((c, i) => b.setUint8(at + i, c.charCodeAt(0)));
  text(0, 'RIFF');
  b.setUint32(4, 36 + size, true);
  text(8, 'WAVEfmt ');
  b.setUint32(16, 16, true);
  b.setUint16(20, 1, true);
  b.setUint16(22, ch.length, true);
  b.setUint32(24, rate, true);
  b.setUint32(28, rate * ch.length * 2, true);
  b.setUint16(32, ch.length * 2, true);
  b.setUint16(34, 16, true);
  text(36, 'data');
  b.setUint32(40, size, true);
  for (let i = 0, o = 44; i < n; i++) for (const c of ch) b.setInt16((o += 2) - 2, Math.max(-32768, Math.min(32767, Math.round(c[i] * 32767))), true);
  return new Uint8Array(b.buffer);
}
