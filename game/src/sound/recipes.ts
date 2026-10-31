/**
 * The recipes (docs/SOUND.md): one short pure function per sound, from a seed to samples at dsp.SR (or the rate its catalog row names).
 * The long ones are generators: they yield between stages so the browser can spread them over frames, and Node just runs them through.
 */
import {
  SR,
  biquad,
  burst,
  decay,
  ends,
  fdn,
  fit,
  highpass,
  hz,
  lowpass,
  mix,
  noise,
  pluck,
  ring,
  rng,
  saturate,
  spectralLoop,
  sweep,
  thump,
  zeros,
} from './dsp';
import type { Mode, Mono, Sound, Stereo } from './dsp';

/** `rate` is the rate the catalog asks for; only the room cares, because a ConvolverNode wants the context's own. */
export type Recipe = (seed: number, rate: number) => Sound | Generator<void, Sound>;
/** [midi note, seconds, amplitude] */
type Note = readonly [number, number, number];
/** a bar, its ring in seconds, the mallet's softness, the notes */
type Part = readonly [readonly Mode[], number, number, readonly Note[]];
const { sin, sqrt, PI } = Math;

/** Finish a one-shot: no DC, soft ends, a set peak. */
const done = (x: Mono, level: number, a = 0.0003, b = 0.02) => fit(ends(highpass(x, 28), a, b), level);

// Bars, as ratios to the fundamental: [frequency, decay, amplitude].
/** rosewood over a tube: partials tuned near 1 : 4 : 9, the tube holds the fundamental a little longer and a hair sharp */
const WOOD: Mode[] = [
  [1, 1, 1],
  [1.0021, 1.5, 0.2],
  [3.93, 0.2, 1.2],
  [9.2, 0.07, 1.6],
];
/** aluminium under felt: tuned 1 : 4 : 10 with a stray torsion mode, a longer ring */
const BAR: Mode[] = [
  [1, 1, 1],
  [1.0012, 0.8, 0.3],
  [3.98, 0.22, 0.3],
  [6.27, 0.1, 0.05],
  [9.87, 0.06, 0.08],
];
/** a free bar: the glockenspiel's stretched partials, softened */
const BELL: Mode[] = [
  [1, 1, 1],
  [2.756, 0.55, 0.42],
  [5.404, 0.24, 0.2],
  [8.933, 0.1, 0.1],
];
/** One mallet strike into `out`: `soft` is the contact time in periods of the fundamental. */
function strike(out: Mono, bar: readonly Mode[], midi: number, tau: number, soft: number, amp = 1, at = 0) {
  const f = hz(midi);
  return ring(
    out,
    soft / f,
    bar.map(([k, t, a]) => [f * k, tau * t, a * amp]),
    at,
  );
}
/** A small hard contact: three modes dying fast, the higher ones first; `tau` and `a` are the lowest mode's. */
const tap = (out: Mono, contact: number, f: readonly number[], tau: number, a: number, at = 0) =>
  ring(
    out,
    contact,
    f.map((hz, i) => [hz, tau / (i + 1), a / 2 ** i]),
    at,
  );
/** A rendered bar note: the strike and the small knock of the mallet landing. */
const note = (seed: number, bar: readonly Mode[], midi: number, tau: number, soft: number, knock: number, level: number) =>
  done(mix(strike(zeros(tau * 3.6), bar, midi, tau, soft), burst(0.03, seed, hz(midi) * 3, 0.8, 0.0006, 0.004), knock), level, 0.0014, 0.08);
/** Strikes on one or more bars, finished to a level; one yield per strike, so a long sting can share frames. */
const sting = (sec: number, level: number, ...parts: Part[]) =>
  function* (): Generator<void, Sound> {
    const out = zeros(sec);
    for (const [bar, tau, soft, notes] of parts)
      for (const [midi, at, amp] of notes) {
        strike(out, bar, midi, tau, soft, amp, at);
        yield;
      }
    return done(out, level, 0.0005, sec / 10);
  };
const star = (notes: readonly Note[], under: number, level: number) =>
  sting(1.9, level, [BELL, 0.46, 0.2, notes], [BAR, 0.6, 0.26, [[72, notes[notes.length - 1][1], under]]]);

// ---------- ui ----------
function click(seed: number) {
  const out = ring(zeros(0.07), 0.0006, [
    [1180, 0.007, 1],
    [540, 0.012, 0.5],
    [2710, 0.004, 0.3],
  ]);
  return done(mix(out, burst(0.02, seed, 1600, 0.7, 0.0004, 0.002), 0.1), 0.085, 0.0002, 0.01);
}
function pick(seed: number) {
  const out = pluck(zeros(0.34), 165, seed, 0.5, 0.965);
  return done(mix(out, burst(0.06, seed + 1, 1300, 0.8, 0.002, 0.012), 0.1), 0.2, 0.0012, 0.04);
}
function* place(seed: number) {
  const out = thump(zeros(0.4), 170, 78, 0.025, 0.07, 0.8);
  ring(out, 0.0016, [
    [230, 0.06, 1],
    [385, 0.04, 0.8],
    [610, 0.026, 0.45],
  ]);
  ring(out, 0.0007, [
    [1720, 0.07, 0.05],
    [2640, 0.05, 0.03],
    [3910, 0.035, 0.016],
  ]);
  yield;
  return done(saturate(mix(out, burst(0.03, seed, 1100, 0.6, 0.0008, 0.006), 0.14), 1.5), 0.36, 0.0006, 0.03);
}
function rotate(seed: number) {
  const out = zeros(0.2),
    r = rng(seed);
  for (let i = 0; i < 3; i++) tap(out, 0.0005, [640, 1320 + r() * 60, 2350], 0.01, 0.5 + i * 0.2, i * 0.018);
  return done(ring(out, 0.002, [[430, 0.03, 0.5]], 0.036), 0.15, 0.0002, 0.02);
}
function swap(seed: number) {
  const out = mix(zeros(0.5), decay(sweep(noise(0.14 * SR, seed), 500, 1400, 1.2), 0.04, 0.03), 0.3);
  for (const [at, a, up] of [
    [0.09, 1, 0],
    [0.2, 0.6, 1],
  ]) {
    thump(out, 130 + up * 20, 80, 0.02, 0.05, 0.6 * a, at);
    tap(out, 0.0014, [300 + up * 60, 470 + up * 70, 1450], 0.05, 0.7 * a, at);
  }
  return done(out, 0.3, 0.002, 0.03);
}
function invalid() {
  const out = zeros(0.42);
  for (const [at, k, a] of [
    [0, 1, 1],
    [0.125, 0.89, 0.72],
  ])
    tap(out, 0.004, [186 * k, 383 * k, 590 * k], 0.07, a, at);
  return done(out, 0.26, 0.001, 0.03);
}

// ---------- machines ----------
function crush(seed: number) {
  const n = 0.34 * SR,
    src = noise(n, seed),
    grit = new Float32Array(n),
    r = rng(seed + 1);
  // a handful of irregular bites of noise, weaker as the rock gives way
  for (let g = 0, at = 0; g < 9 && at < n - 900; g++) {
    const len = ((0.008 + r() * 0.018) * SR) | 0,
      a = (1 - g / 11) * (0.6 + r() * 0.4);
    for (let i = 0; i < len; i++) grit[at + i] += src[at + i] * a * sin((PI * i) / len);
    at += ((0.012 + r() * 0.03) * SR) | 0;
  }
  const out = thump(zeros(0.34), 130, 70, 0.03, 0.07, 0.28);
  mix(out, biquad(grit.slice(), 'bp', 420, 1.1), 2.4);
  return done(lowpass(mix(out, biquad(grit, 'bp', 1150, 1.4), 1), 3000), 0.26, 0.001, 0.04);
}
function smelt(seed: number) {
  const n = 0.7 * SR,
    body = decay(sweep(noise(n, seed), 320, 900, 0.9), 0.09, 0.24),
    hiss = lowpass(highpass(noise(n, seed + 1), 2200), 3600),
    r = rng(seed + 2);
  // the sizzle comes in small irregular flecks, not a steady hiss
  for (let i = 0, a = 0; i < n; i++) {
    if (r() < 0.004) a = r();
    hiss[i] *= (a *= 0.997) * (1 - i / n);
  }
  return done(lowpass(mix(body, hiss, 0.16), 4000), 0.22, 0.004, 0.05);
}
function press(seed: number) {
  const out = thump(zeros(0.9), 126, 60, 0.02, 0.09, 0.8);
  ring(out, 0.0022, [
    [208, 0.05, 0.8],
    [334, 0.035, 0.45],
  ]);
  ring(out, 0.0012, [
    [612, 0.2, 0.12],
    [1013, 0.15, 0.09],
    [1487, 0.1, 0.055],
    [2233, 0.07, 0.03],
  ]);
  return done(mix(out, burst(0.03, seed, 800, 0.7, 0.001, 0.006), 0.12), 0.3, 0.0008, 0.06);
}
function slag(seed: number) {
  const out = thump(zeros(0.34), 96, 52, 0.03, 0.06, 1);
  return done(mix(out, decay(sweep(noise(0.3 * SR, seed), 900, 240, 1), 0.01, 0.05), 0.5), 0.2, 0.001, 0.04);
}
function jam(seed: number) {
  const out = zeros(0.36),
    r = rng(seed);
  for (let i = 0, at = 0, a = 1; i < 6; i++, a *= 0.72) {
    tap(out, 0.0012, [640 + r() * 90, 1530 + r() * 200], 0.016, a, at);
    at += 0.028 + r() * 0.03;
  }
  return done(lowpass(out, 2000), 0.14, 0.0008, 0.03);
}

// ---------- the shift ----------
function run(seed: number) {
  const out = mix(zeros(1), ends(sweep(noise(0.85 * SR, seed), 200, 1000, 1.4), 0.3, 0.5), 0.45);
  strike(out, WOOD, 48, 0.2, 0.34, 0.7);
  return done(strike(out, WOOD, 55, 0.2, 0.34, 0.45, 0.075), 0.2, 0.001, 0.08);
}
function settle(seed: number) {
  const out = mix(zeros(1), decay(sweep(noise(0.8 * SR, seed), 800, 170, 1.4), 0.03, 0.22), 0.42);
  return done(strike(out, WOOD, 48, 0.28, 0.34, 0.8, 0.05), 0.26, 0.001, 0.08);
}

// ---------- beds and the room ----------
export const PAD_HZ = hz(48); // the pad is rendered on C3 and played up to each shift's root
export const BED_RATE = 12000;
function* pad(seed: number): Generator<void, Stereo> {
  const bands: Mode[] = [];
  for (const [ratio, amp] of [
    [1, 1],
    [1.5, 0.5],
    [2, 0.45],
    [3, 0.16],
  ])
    for (let h = 1; h < 6; h++) bands.push([PAD_HZ * ratio * h, 0.8 + h * 1.1, amp / h ** 1.7]);
  const [l, r] = yield* spectralLoop(1 << 16, BED_RATE, seed, bands);
  return [fit(l, 0.06), fit(r, 0.06)];
}
function* belt(seed: number): Generator<void, Stereo> {
  const n = 1 << 15,
    [l, r] = yield* spectralLoop(n, BED_RATE, seed, [
      [70, 40, 0.6],
      [150, 80, 0.7],
      [320, 170, 0.5],
      [700, 360, 0.24],
      [1400, 600, 0.1],
    ]);
  // rollers: sixteen soft swells per loop, close to the belt's step at 1x
  for (let i = 0; i < n; i++) {
    const m = 1 + 0.4 * sin((2 * PI * 16 * i) / n);
    l[i] *= m;
    r[i] *= m;
  }
  return [fit(l, 0.07), fit(r, 0.07)];
}
/** The shared room: a short diffuse burst through the delay network, scaled to unit energy so a send level means what it says. */
function* room(seed: number, rate: number): Generator<void, Stereo> {
  const [l, r] = yield* fdn(decay(noise(0.012 * rate, seed), 0.001, 0.004, rate), 0.65, 0.6, 3400, rate);
  ends(highpass(l, 60, rate), 0.001, 0.12, rate);
  yield;
  ends(highpass(r, 60, rate), 0.001, 0.12, rate);
  yield;
  let e = 0;
  for (let i = 0; i < l.length; i++) e += (l[i] * l[i] + r[i] * r[i]) / 2;
  e = 1 / sqrt(e);
  for (let i = 0; i < l.length; i++) {
    l[i] *= e;
    r[i] *= e;
  }
  yield; // the convolver takes the result in a slice of its own
  return [l, r];
}

export const RECIPES: Record<string, Recipe> = {
  click,
  pick,
  place,
  rotate,
  swap,
  invalid,
  lock: sting(0.6, 0.24, [
    WOOD,
    0.13,
    0.3,
    [
      [67, 0, 0.8],
      [72, 0.065, 1],
    ],
  ]),
  'wood-low': (s) => note(s, WOOD, 60, 0.32, 0.3, 0.1, 0.36),
  'wood-high': (s) => note(s, WOOD, 72, 0.22, 0.3, 0.1, 0.36),
  'bar-low': (s) => note(s, BAR, 72, 0.62, 0.24, 0.03, 0.34),
  'bar-high': (s) => note(s, BAR, 84, 0.5, 0.24, 0.03, 0.34),
  crush,
  press,
  smelt,
  slag,
  jam,
  stall: sting(1.3, 0.24, [
    BAR,
    0.38,
    0.3,
    [
      [67, 0, 0.9],
      [62, 0.17, 1],
    ],
  ]),
  run,
  settle,
  'round-good': sting(
    2,
    0.3,
    [
      WOOD,
      0.34,
      0.3,
      [
        [60, 0, 0.7],
        [67, 0.11, 0.8],
        [72, 0.22, 1],
        [48, 0.33, 0.6],
      ],
    ],
    [
      BAR,
      0.6,
      0.26,
      [
        [79, 0.33, 0.5],
        [74, 0.34, 0.42],
      ],
    ],
  ),
  'round-flat': sting(
    1.5,
    0.26,
    [
      WOOD,
      0.34,
      0.32,
      [
        [67, 0, 0.8],
        [62, 0.17, 0.85],
      ],
    ],
    [BAR, 0.5, 0.3, [[48, 0.17, 0.5]]],
  ),
  'star-1': star([[79, 0, 1]], 0.25, 0.2),
  'star-2': star(
    [
      [79, 0, 0.8],
      [84, 0.09, 1],
    ],
    0.3,
    0.23,
  ),
  'star-3': star(
    [
      [79, 0, 0.7],
      [84, 0.085, 0.85],
      [86, 0.17, 0.9],
      [91, 0.255, 1],
    ],
    0.35,
    0.26,
  ),
  'job-done': sting(
    2.6,
    0.3,
    [
      WOOD,
      0.4,
      0.3,
      [
        [48, 0, 0.7],
        [60, 0.07, 0.6],
        [67, 0.14, 0.7],
      ],
    ],
    [
      BAR,
      0.8,
      0.26,
      [
        [72, 0.21, 0.6],
        [74, 0.28, 0.55],
        [79, 0.35, 0.6],
      ],
    ],
    [BELL, 0.6, 0.2, [[84, 0.42, 0.42]]],
  ),
  pad,
  belt,
  room,
};
