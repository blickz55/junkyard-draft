/**
 * Sound primitives (docs/SOUND.md). Pure and browser-free: the browser renders the recipes with this code after the first gesture,
 * and tests/sound.test.ts and tools/make-sfx.ts render the very same samples in Node. Everything is seeded; nothing reads a clock.
 * Filters and envelopes work in place and return their input, so a recipe reads as a chain.
 */
export const SR = 24000; // warm sounds need nothing above 12 kHz, and half the rate is half the render time
const TAU = Math.PI * 2;
const { sin, cos, exp, tanh, abs, min, max, round, floor, ceil, PI } = Math;

export type Mono = Float32Array;
export type Stereo = [Float32Array, Float32Array];
export type Sound = Mono | Stereo;
/** [frequency Hz, decay time constant s, amplitude] */
export type Mode = readonly [number, number, number];

export const zeros = (sec: number, rate = SR) => new Float32Array(round(sec * rate));
export const hz = (midi: number) => 440 * 2 ** ((midi - 69) / 12);

/** A linear congruential generator in [0, 1): fast, seeded, and plenty for noise. */
export function rng(seed: number) {
  let s = seed >>> 0;
  return () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296;
}
export function noise(n: number, seed: number) {
  const r = rng(seed),
    x = new Float32Array(n);
  for (let i = 0; i < x.length; i++) x[i] = r() * 2 - 1;
  return x;
}

/** Add `x` into `out` at `at` seconds, scaled. */
export function mix(out: Mono, x: Mono, gain = 1, at = 0, rate = SR) {
  const o = round(at * rate);
  for (let i = 0, n = min(x.length, out.length - o); i < n; i++) out[o + i] += x[i] * gain;
  return out;
}

// ---------- filters ----------
export function lowpass(x: Mono, fc: number, rate = SR) {
  const a = 1 - exp((-TAU * fc) / rate);
  let y = 0;
  for (let i = 0; i < x.length; i++) x[i] = y += a * (x[i] - y);
  return x;
}
export function highpass(x: Mono, fc: number, rate = SR) {
  const a = 1 - exp((-TAU * fc) / rate);
  let y = 0;
  for (let i = 0; i < x.length; i++) {
    y += a * (x[i] - y);
    x[i] -= y;
  }
  return x;
}
/** RBJ biquad: low-pass, high-pass or band-pass (0 dB peak gain). */
export function biquad(x: Mono, mode: 'lp' | 'hp' | 'bp', fc: number, q = 0.707, rate = SR) {
  const w = (TAU * fc) / rate,
    c = cos(w),
    a = sin(w) / (2 * q),
    a0 = 1 + a,
    b1 = (mode === 'lp' ? 1 - c : mode === 'hp' ? -1 - c : 0) / a0,
    b0 = mode === 'bp' ? a / a0 : abs(b1) / 2,
    b2 = mode === 'bp' ? -b0 : b0,
    a1 = (-2 * c) / a0,
    a2 = (1 - a) / a0;
  let z1 = 0,
    z2 = 0;
  for (let i = 0; i < x.length; i++) {
    const v = x[i],
      y = b0 * v + z1;
    z1 = b1 * v - a1 * y + z2;
    z2 = b2 * v - a2 * y;
    x[i] = y;
  }
  return x;
}
/** A band-pass whose centre glides exponentially from f0 to f1 over the buffer (a Chamberlin state-variable filter; keep f under 3.5 kHz). */
export function sweep(x: Mono, f0: number, f1: number, q = 1, rate = SR) {
  const k = (f1 / f0) ** (1 / x.length),
    d = 1 / q;
  let f = (TAU * f0) / rate,
    lo = 0,
    ba = 0;
  for (let i = 0; i < x.length; i++) {
    lo += f * ba;
    ba += f * (x[i] - lo - d * ba);
    x[i] = ba;
    f *= k;
  }
  return x;
}

// ---------- envelopes ----------
/** Multiply by a raised-cosine rise of `a` seconds, then an exponential fall with time constant `tau`. */
export function decay(x: Mono, a: number, tau: number, rate = SR) {
  const r = exp(-1 / (tau * rate)),
    n = a * rate;
  let e = 1;
  for (let i = 0; i < x.length; i++) x[i] *= i < n ? 0.5 - 0.5 * cos((PI * i) / n) : (e *= r);
  return x;
}
/** Attack, decay, sustain level, release, all in seconds; smooth segments, and the buffer ends with the release. */
export function adsr(x: Mono, a: number, d: number, s: number, r: number, rate = SR) {
  const n = x.length,
    na = a * rate,
    nd = d * rate,
    nr = r * rate,
    smooth = (p: number) => 0.5 - 0.5 * cos(PI * p);
  for (let i = 0; i < n; i++) {
    let e = i < na ? smooth(i / na) : i < na + nd ? 1 - (1 - s) * smooth((i - na) / nd) : s;
    if (n - i < nr) e *= smooth((n - i) / nr);
    x[i] *= e;
  }
  return x;
}
/** Soften both ends with raised-cosine fades: no first-sample jump, no end click. */
export function ends(x: Mono, a: number, b: number, rate = SR) {
  const na = max(1, a * rate),
    nb = max(1, b * rate),
    n = x.length;
  for (let i = 0; i < na && i < n; i++) x[i] *= 0.5 - 0.5 * cos((PI * i) / na);
  for (let i = 0; i < nb && i < n; i++) x[n - 1 - i] *= 0.5 - 0.5 * cos((PI * i) / nb);
  return x;
}

// ---------- bodies ----------
/** A contact pulse of `sec` seconds with unit area: the longer the contact, the softer the mallet and the fewer high modes it wakes. */
function pulse(sec: number, rate = SR) {
  const n = max(4, round(sec * rate));
  return Float32Array.from({ length: n }, (_, i) => (1 - cos((TAU * (i + 0.5)) / n)) / n);
}
/** Modal synthesis: a contact of `contact` seconds rings a bank of two-pole resonators, one per mode, added into `out` from `at` seconds. */
export function ring(out: Mono, contact: number, modes: readonly Mode[], at = 0, rate = SR) {
  const exciter = pulse(contact, rate),
    o = round(at * rate),
    e = exciter.length;
  for (const [f, tau, amp] of modes) {
    const w = (TAU * f) / rate,
      r = exp(-1 / (tau * rate)),
      a1 = 2 * r * cos(w),
      a2 = -r * r,
      g = amp * sin(w),
      n = min(out.length - o, e + round(tau * 10 * rate)); // past -87 dB a mode costs time and adds nothing
    let y1 = 0,
      y2 = 0;
    for (let i = 0; i < n; i++) {
      const y = (i < e ? exciter[i] * g : 0) + a1 * y1 + a2 * y2;
      y2 = y1;
      y1 = y;
      out[o + i] += y;
    }
  }
  return out;
}
/** A falling sine: the low part of a heavy impact. Starts at f0, settles on f1 with time constant `drop`, dies with `tau`. */
export function thump(out: Mono, f0: number, f1: number, drop: number, tau: number, amp: number, at = 0, rate = SR) {
  const o = round(at * rate),
    n = min(out.length - o, round(tau * 10 * rate));
  let ph = 0;
  for (let i = 0; i < n; i++) {
    const t = i / rate;
    ph += (TAU * (f1 + (f0 - f1) * exp(-t / drop))) / rate;
    out[o + i] += amp * sin(ph) * exp(-t / tau) * min(1, t / 0.002);
  }
  return out;
}
/** Filtered noise with a soft rise and an exponential fall: scuffs, knocks, the grit in a crunch. */
export function burst(sec: number, seed: number, fc: number, q: number, a: number, tau: number, rate = SR) {
  return decay(biquad(noise(round(sec * rate), seed), 'bp', fc, q, rate), a, tau, rate);
}
/** Karplus-Strong: a noise-filled delay line, averaged a little on every pass; `damp` 0.5 is a dull string, `loss` under 1 mutes it. */
export function pluck(out: Mono, f: number, seed: number, damp = 0.5, loss = 0.995, at = 0, rate = SR) {
  const n = max(2, round(rate / f - damp)),
    d = lowpass(noise(n, seed), f * 6, rate),
    o = round(at * rate);
  let p = 0,
    prev = 0;
  for (let i = o; i < out.length; i++) {
    const v = d[p];
    d[p] = (v * (1 - damp) + prev * damp) * loss;
    prev = v;
    out[i] += v;
    p = (p + 1) % n;
  }
  return out;
}

// ---------- shape ----------
/** tanh saturation: rounds peaks and adds odd harmonics, which is how a low thump survives on a phone speaker. */
export function saturate(x: Mono, drive: number) {
  const k = tanh(drive);
  for (let i = 0; i < x.length; i++) x[i] = tanh(x[i] * drive) / k;
  return x;
}
export function peak(x: Mono) {
  let p = 0;
  for (let i = 0; i < x.length; i++) p = max(p, abs(x[i]));
  return p;
}
/** Scale to a peak level. */
export function fit(x: Mono, level: number) {
  const k = level / (peak(x) || 1);
  for (let i = 0; i < x.length; i++) x[i] *= k;
  return x;
}
/** The master's soft limit: linear to `knee`, then bending toward `ceil`, which it never passes. */
export function limit(x: number, knee = 0.5, ceil = 0.84) {
  const a = abs(x),
    h = ceil - knee;
  return a <= knee ? x : Math.sign(x) * (knee + h * tanh((a - knee) / h));
}
/** The same limit as a transfer curve for a WaveShaperNode. */
export function limitCurve(n = 2049) {
  return Float32Array.from({ length: n }, (_, i) => limit((i * 2) / (n - 1) - 1));
}

// ---------- space ----------
/** A four-line feedback delay network with Householder feedback and damped lines: `sec` seconds of [left, right] wet signal for input `x`. */
export function* fdn(x: Mono, sec: number, rt60: number, fc: number, rate = SR): Generator<void, Stereo> {
  const n = round(sec * rate),
    l = new Float32Array(n),
    r = new Float32Array(n),
    size = [0.0191, 0.0239, 0.0293, 0.0347].map((s) => round(s * rate)),
    lines = size.map((s) => new Float32Array(s)),
    gain = size.map((s) => 10 ** ((-3 * s) / (rate * rt60))),
    a = 1 - exp((-TAU * fc) / rate),
    z = [0, 0, 0, 0],
    v = [0, 0, 0, 0];
  for (let i = 0; i < n; i++) {
    if (!(i % 8192)) yield;
    for (let k = 0; k < 4; k++) v[k] = lines[k][i % size[k]];
    const input = i < x.length ? x[i] : 0,
      s = (v[0] + v[1] + v[2] + v[3]) * 0.5;
    l[i] = v[0] + v[2];
    r[i] = v[1] + v[3];
    for (let k = 0; k < 4; k++) {
      z[k] += a * ((s - v[k]) * gain[k] - z[k]);
      lines[k][i % size[k]] = z[k] + input;
    }
  }
  return [l, r];
}

// ---------- spectra ----------
/** In-place inverse FFT (n a power of two), one yield per stage so a long transform can share frames. */
export function* ifft(re: Float64Array, im: Float64Array): Generator<void, void> {
  const n = re.length;
  for (let i = 0, j = 0; i < n; i++) {
    if (i < j) {
      let t = re[i];
      re[i] = re[j];
      re[j] = t;
      t = im[i];
      im[i] = im[j];
      im[j] = t;
    }
    let m = n >> 1;
    for (; m && j & m; m >>= 1) j ^= m;
    j |= m;
  }
  for (let size = 2; size <= n; size *= 2) {
    const h = size / 2,
      wr = cos(TAU / size),
      wi = sin(TAU / size);
    for (let s = 0; s < n; s += size) {
      let cr = 1,
        ci = 0;
      for (let j = s; j < s + h; j++) {
        const k = j + h,
          tr = re[k] * cr - im[k] * ci,
          ti = re[k] * ci + im[k] * cr;
        re[k] = re[j] - tr;
        im[k] = im[j] - ti;
        re[j] += tr;
        im[j] += ti;
        const c = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = c;
      }
    }
    yield;
  }
}
/**
 * The PADsynth idea: draw gaussian bands of [centre Hz, width Hz, amplitude] into a spectrum, give every bin a random phase and transform
 * back. The result is a stereo pair of uncorrelated signals with that spectrum, and it loops without a seam because a DFT is periodic.
 */
export function* spectralLoop(n: number, rate: number, seed: number, bands: readonly Mode[]): Generator<void, Stereo> {
  const re = new Float64Array(n),
    im = new Float64Array(n),
    r = rng(seed),
    bin = rate / n;
  for (const [hz, width, amp] of bands) {
    const c = hz / bin,
      s = max(1, width / bin);
    for (let k = max(1, floor(c - 3 * s)), e = min(n / 2 - 1, ceil(c + 3 * s)); k <= e; k++) {
      const g = amp * exp(-0.5 * ((k - c) / s) ** 2);
      for (const b of [k, n - k]) {
        const p = r() * TAU;
        re[b] += g * cos(p);
        im[b] += g * sin(p);
      }
    }
    yield;
  }
  yield* ifft(re, im);
  return [new Float32Array(re), new Float32Array(im)];
}
