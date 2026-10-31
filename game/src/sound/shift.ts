/**
 * An offline shift (docs/SOUND.md): the same note choice, gains and room as audio.ts, mixed in Node, so the master peak and the melody can be
 * measured without a browser or a pair of ears. Nothing here ships: the game never imports this file.
 */
import { SR, biquad, hz, ifft, limit, rng } from './dsp';
import type { Mono, Stereo } from './dsp';
import { MIX, renderAll } from './catalog';
import { channels } from './measure';
import type { Bus } from './catalog';
import { LOOKAHEAD, LineComposer, STEP_MS, stingRate, voiceOf, rootMidi } from './line';
import type { LineNote } from './line';
import { PAD_HZ } from './recipes';

export interface ShiftOptions {
  speed: 1 | 2 | 4;
  seconds: number;
  round: number;
  seed: number;
  /** ships a second at 1x; the simulation runs `speed` times as many */
  shipsPerSecond: number;
  reduced?: boolean;
  /** master volume, 1 is the worst case */
  volume?: number;
}
const VALUES = [1, 1, 1, 1, 3, 3, 3, 8, 8, 12, 24];

function fft(re: Float64Array, im: Float64Array) {
  for (const _ of ifft(im, re)) void _; // swapping the parts turns the inverse transform into the forward one
}
/** Linear convolution of a long signal with an impulse response. */
export function convolve(x: Mono, h: Mono): Mono {
  const n = 2 ** Math.ceil(Math.log2(x.length + h.length)),
    xr = new Float64Array(n),
    xi = new Float64Array(n),
    hr = new Float64Array(n),
    hi = new Float64Array(n);
  xr.set(x);
  hr.set(h);
  fft(xr, xi);
  fft(hr, hi);
  for (let i = 0; i < n; i++) {
    const a = xr[i] * hr[i] - xi[i] * hi[i];
    xi[i] = xr[i] * hi[i] + xi[i] * hr[i];
    xr[i] = a;
  }
  for (const _ of ifft(xr, xi)) void _;
  return Float32Array.from({ length: x.length + h.length - 1 }, (_, i) => xr[i] / n);
}

export function renderShift(o: ShiftOptions, bank = renderAll(SR)) {
  const n = Math.round((o.seconds + 3.5) * SR),
    dry: Stereo = [new Float32Array(n), new Float32Array(n)],
    send = new Float32Array(n),
    volume = o.volume ?? 1,
    line = new LineComposer(o.round),
    r = rng(o.seed),
    notes: LineNote[] = [],
    times: number[] = [];
  /** One voice: a buffer through its rate, an optional low-pass, its gain, a pan, into the bus and the send. */
  const play = (id: string, bus: Bus, at: number, gain = 1, rate = 1, pan: number | null = null, cutoff = 0) => {
    const e = bank.get(id);
    if (!e) return;
    const src = channels(e.sound),
      step = (rate * e.rate) / SR,
      len = Math.floor(src[0].length / step),
      o0 = Math.round(at * SR);
    const v = new Float32Array(len);
    for (let i = 0; i < len; i++) {
      const p = i * step,
        k = Math.floor(p),
        f = p - k;
      v[i] = (src[0][k] + f * ((src[0][k + 1] ?? 0) - src[0][k])) * gain;
    }
    if (cutoff) biquad(v, 'lp', cutoff, 0.8);
    const x = pan === null ? 0 : (pan + 1) / 2,
      gl = pan === null ? 1 : Math.cos((x * Math.PI) / 2),
      gr = pan === null ? 1 : Math.sin((x * Math.PI) / 2),
      s = MIX.send[bus];
    for (let i = 0; i < len && o0 + i < n; i++) {
      dry[0][o0 + i] += v[i] * gl;
      dry[1][o0 + i] += v[i] * gr;
      send[o0 + i] += v[i] * ((gl + gr) / 2) * s;
    }
  };
  // the bed: the pad on the shift's root, the belt at a busy line's cutoff, both faded as audio.ts fades them
  const bed = (id: string, gain: number, rate: number, cutoff: number) => {
    const e = bank.get(id);
    if (!e) return;
    const [l, rr] = e.sound as Stereo,
      step = (rate * e.rate) / SR,
      len = Math.round((o.seconds + 1) * SR),
      v: Stereo = [new Float32Array(len), new Float32Array(len)];
    for (let i = 0; i < len; i++) {
      const p = (i * step) % l.length,
        k = Math.floor(p),
        f = p - k,
        fade = Math.min(1, i / (1.2 * SR)) * Math.min(1, (len - i) / (0.9 * SR)) * gain;
      v[0][i] = (l[k] + f * (l[(k + 1) % l.length] - l[k])) * fade;
      v[1][i] = (rr[k] + f * (rr[(k + 1) % l.length] - rr[k])) * fade;
    }
    for (const c of v) if (cutoff) biquad(c, 'lp', cutoff, 0.8);
    for (let i = 0; i < len; i++) {
      dry[0][i] += v[0][i];
      dry[1][i] += v[1][i];
      send[i] += ((v[0][i] + v[1][i]) / 2) * MIX.send.music;
    }
  };
  if (!o.reduced) {
    bed('pad', MIX.pad, hz(rootMidi(o.round)) / PAD_HZ, 0);
    bed('belt', MIX.belt, 1, 1600);
  }
  play('run', 'music', 0, 1, stingRate(o.round));

  const ticks = Math.round((o.seconds * 1000 * o.speed) / STEP_MS),
    perTick = o.shipsPerSecond * (STEP_MS / 1000);
  let hits = 0,
    jam = -1e9;
  for (let k = 0; k < ticks; k++) {
    const ms = (k * STEP_MS) / o.speed,
      step = Math.round(ms / STEP_MS),
      ships: number[] = [],
      made: number[] = [];
    for (let e = perTick; e > 0; e--) if (r() < e) ships.push(VALUES[Math.floor(r() * VALUES.length)]);
    for (let e = perTick * 0.8; e > 0; e--) if (r() < e) made.push(Math.floor(r() * 4));
    const chord = o.reduced ? ships.slice(0, 1) : [...new Set(ships)].sort((a, b) => b - a);
    const at = ms / 1000 + LOOKAHEAD;
    for (const note of line.tick(chord, ships.length, step, o.reduced)) {
      const v = voiceOf(note);
      notes.push(note);
      times.push(step * (STEP_MS / 1000));
      play(v.id, 'factory', step * (STEP_MS / 1000) + LOOKAHEAD, v.gain, v.rate, v.pan, v.cutoff);
    }
    if (o.reduced && ships.length) continue;
    const hit = line.machine(
      made.sort((a, b) => b - a),
      made.length,
      step,
    );
    if (hit) {
      hits++;
      play(['slag', 'crush', 'press', 'smelt'][hit.tier], 'factory', at, hit.gain * MIX.machine, hit.rate);
    }
    if (r() < 0.02 && ms - jam > 900) {
      jam = ms;
      play('jam', 'factory', at, 0.8);
    }
  }
  // the stings a shift can stack on top of all that
  if (!o.reduced) {
    play('star-1', 'music', o.seconds * 0.3, 1, stingRate(o.round));
    play('star-2', 'music', o.seconds * 0.6, 1, stingRate(o.round));
    play('star-3', 'music', o.seconds * 0.9, 1, stingRate(o.round));
    play('job-done', 'music', o.seconds * 0.9 + 0.3, 1, stingRate(o.round));
  }
  play('settle', 'music', o.seconds, 1, stingRate(o.round));
  play('round-good', 'music', o.seconds + 0.1, 1, stingRate(o.round));

  const ir = bank.get('room')!.sound as Stereo,
    wet: Stereo = [convolve(send, ir[0]), convolve(send, ir[1])],
    out: Stereo = [new Float32Array(n), new Float32Array(n)];
  let before = 0;
  for (let c = 0; c < 2; c++)
    for (let i = 0; i < n; i++) {
      const v = (dry[c][i] + wet[c][i]) * volume;
      before = Math.max(before, Math.abs(v));
      out[c][i] = limit(v);
    }
  return { out, notes, times, hits, before, ticks };
}
