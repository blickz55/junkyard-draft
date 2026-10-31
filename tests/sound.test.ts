import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SR, adsr, hz, limit, limitCurve, peak, pluck, rng, zeros } from '../game/src/sound/dsp';
import { Bank, CATALOG, MIX, renderAll } from '../game/src/sound/catalog';
import type { Kind, SoundEntry } from '../game/src/sound/catalog';
import { LOOKAHEAD, LineComposer, STEP_MS, gridDelay, rootMidi, stingRate, voiceOf } from '../game/src/sound/line';
import {
  attack,
  centroid,
  channels,
  db,
  dc,
  dulling,
  energyAbove,
  firstJump,
  flatness,
  inharmonicity,
  isPlainWave,
  loudness,
  mono,
  rms,
  spectrum,
  truePeak,
} from '../game/src/sound/measure';
import { PAD_HZ } from '../game/src/sound/recipes';
import { renderShift } from '../game/src/sound/shift';

// Nobody working on this code can hear it: these numbers are the only ears it has. What they cannot judge is listed in docs/SOUND.md.
const bank = renderAll(48000);
const shots = CATALOG.filter((e) => e.kind !== 'bed' && e.kind !== 'room');
const rateOf = (e: SoundEntry) => bank.get(e.id)!.rate;
const monoOf = (e: SoundEntry) => mono(bank.get(e.id)!.sound);
const each = (entries: readonly SoundEntry[], f: (x: Float32Array, e: SoundEntry, rate: number) => void) => {
  for (const e of entries) f(monoOf(e), e, rateOf(e));
};

/** Momentary loudness per class, dBFS: nothing jumps out of its class. */
const BAND: Record<Exclude<Kind, 'room'>, [number, number]> = {
  tick: [-40, -33], // nearly subliminal
  touch: [-32, -14],
  machine: [-30, -18],
  note: [-18, -12],
  sting: [-26, -16],
  bed: [-42, -34],
};
/** Spectral centroid ceilings in Hz: warm means the energy sits low. */
const CENTROID: Record<Exclude<Kind, 'room'>, number> = { tick: 1100, touch: 1100, machine: 1700, note: 1200, sting: 1500, bed: 400 };
/** Share of the power above 6 kHz: next to nothing for what a player touches and hears all the time. */
const ABOVE_6K: Record<Exclude<Kind, 'room'>, number> = { tick: 0.002, touch: 0.002, machine: 0.02, note: 0.002, sting: 0.01, bed: 0.001 };

test('the catalog: unique ids, every row has a recipe, a bus and a class; every bus is represented', () => {
  const ids = CATALOG.map((e) => e.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const e of CATALOG) assert.equal(typeof e.recipe, 'function', e.id);
  assert.deepEqual([...new Set(CATALOG.map((e) => e.bus))].sort(), ['factory', 'music', 'ui']);
  for (const id of [
    'click',
    'place',
    'rotate',
    'invalid',
    'swap',
    'pick',
    'crush',
    'press',
    'smelt',
    'stall',
    'star-1',
    'star-2',
    'star-3',
    'job-done',
    'round-good',
    'round-flat',
    'pad',
    'belt',
  ])
    assert.ok(bank.has(id), `${id} is rendered`);
});

test('recipes are deterministic: the same seed gives the same samples, another seed another take of anything with noise in it', () => {
  const again = renderAll(48000);
  for (const e of CATALOG) {
    const theirs = channels(again.get(e.id)!.sound);
    channels(bank.get(e.id)!.sound).forEach((c, i) => assert.deepEqual(c, theirs[i], e.id));
  }
  const other = CATALOG.find((e) => e.id === 'crush')!;
  assert.notDeepEqual(other.recipe(1, SR), other.recipe(2, SR));
});

test('every sample is finite, nothing clips, no DC', () => {
  for (const e of CATALOG)
    for (const c of channels(bank.get(e.id)!.sound)) {
      assert.ok(
        c.every((v) => Number.isFinite(v)),
        `${e.id}: finite`,
      );
      assert.ok(peak(c) <= 0.5, `${e.id}: peak ${peak(c).toFixed(3)} leaves room for stacking`);
      assert.ok(Math.abs(dc(c)) <= 1e-3 * peak(c), `${e.id}: DC ${dc(c)}`);
    }
});

test('soft starts: no first-sample jump, and nothing arrives faster than a soft mallet, where softness is the point', () => {
  each(shots, (x, e, rate) => {
    assert.ok(Math.abs(x[0]) < 0.002 * peak(x), `${e.id}: first sample ${x[0]}`);
    assert.ok(firstJump(x, 0.0005, rate) < 0.2, `${e.id}: jump ${firstJump(x, 0.0005, rate).toFixed(3)} of the peak in the first half millisecond`);
    assert.ok(attack(x, 0.5, rate) >= (e.kind === 'note' ? 0.0007 : 0.00025), `${e.id}: half level after ${(attack(x, 0.5, rate) * 1000).toFixed(2)} ms`);
  });
  for (const id of ['invalid', 'pick']) assert.ok(attack(monoOf(CATALOG.find((e) => e.id === id)!)) >= 0.001, `${id} is softer still`);
  const smelt = CATALOG.find((e) => e.id === 'smelt')!;
  assert.ok(attack(monoOf(smelt)) >= 0.02, 'the furnace breathes in, it does not hit');
});

test('clean ends: every one-shot has decayed to silence by its last sample, no end click', () => {
  each(shots, (x, e, rate) => {
    assert.ok(Math.abs(x[x.length - 1]) < 1e-5, `${e.id}: last sample ${x[x.length - 1]}`);
    const tail = rms(x, x.length - Math.round(0.01 * rate));
    assert.ok(db(tail / peak(x)) < -50, `${e.id}: the last 10 ms sit at ${db(tail / peak(x)).toFixed(1)} dB of the peak`);
  });
});

test('loudness per class: nothing jumps out of its band, and the click is nearly subliminal', () => {
  each(
    CATALOG.filter((e) => e.kind !== 'room'),
    (x, e, rate) => {
      const [lo, hi] = BAND[e.kind as Exclude<Kind, 'room'>],
        l = db(loudness(x, rate));
      assert.ok(l >= lo && l <= hi, `${e.id}: ${l.toFixed(1)} dBFS against ${lo}..${hi}`);
    },
  );
  const of = (id: string) => db(loudness(monoOf(CATALOG.find((e) => e.id === id)!)));
  assert.ok(of('place') - of('click') >= 15, 'a click sits 15 dB under a placed machine');
  assert.ok(of('star-3') >= of('star-1') - 0.5, 'the third star is no quieter than the first');
});

test('warmth: the spectral centroid stays under its ceiling and the region above 6 kHz is nearly empty for everything heard all the time', () => {
  each(
    CATALOG.filter((e) => e.kind !== 'room'),
    (x, e, rate) => {
      const k = e.kind as Exclude<Kind, 'room'>;
      assert.ok(centroid(x, rate) <= CENTROID[k], `${e.id}: centroid ${centroid(x, rate).toFixed(0)} Hz`);
      assert.ok(energyAbove(x, 6000, rate) <= ABOVE_6K[k], `${e.id}: ${(energyAbove(x, 6000, rate) * 100).toFixed(2)} % above 6 kHz`);
    },
  );
});

test('no recipe is a plain periodic waveform, and the check does catch one', () => {
  const wave = (shape: (p: number) => number, f = 440) => {
    const x = zeros(0.5);
    for (let i = 0; i < x.length; i++) x[i] = shape((i * f) / SR) * Math.exp(-i / (0.15 * SR)) * 0.5;
    return x;
  };
  const square = (p: number) => (p % 1 < 0.5 ? 1 : -1),
    saw = (p: number) => 2 * (p % 1) - 1,
    tri = (p: number) => 4 * Math.abs((p % 1) - 0.5) - 1;
  for (const [name, shape] of Object.entries({ square, saw, tri })) assert.ok(isPlainWave(wave(shape)), `${name} is caught`);
  each(
    CATALOG.filter((e) => e.kind !== 'room' && e.kind !== 'bed'),
    (x, e, rate) =>
      assert.ok(
        !isPlainWave(x, rate),
        `${e.id}: flatness ${flatness(x, rate).toExponential(1)}, ${inharmonicity(x, rate).toFixed(0)} cents, dulling ${dulling(x, rate).toFixed(2)}`,
      ),
  );
  // the bars are tuned, but their overtones die first, as a struck bar's do
  for (const id of ['wood-low', 'wood-high', 'bar-low', 'bar-high'])
    assert.ok(dulling(monoOf(CATALOG.find((e) => e.id === id)!)) > 2, `${id} dulls as it rings`);
});

test('the mallets are in tune: each rendered note sounds the pitch voiceOf plays it as', () => {
  for (const [midi, value] of [
    [64, 1],
    [70, 3],
    [74, 8],
    [86, 12],
  ]) {
    const v = voiceOf({ midi, value, vel: 0.7 }),
      x = monoOf(CATALOG.find((e) => e.id === v.id)!),
      s = spectrum(x, SR, 0, Math.min(x.length, Math.round(0.7 * SR))),
      main = s.reduce((m, b) => (b[1] > m[1] ? b : m))[0];
    assert.ok(
      Math.abs(1200 * Math.log2((main * v.rate) / hz(midi))) < 25,
      `${v.id} at ${main.toFixed(1)} Hz times ${v.rate.toFixed(3)} for ${hz(midi).toFixed(1)} Hz`,
    );
  }
});

test('karplus-strong: a pluck is in tune within the delay line, decays and darkens', () => {
  const x = pluck(zeros(0.5), hz(45), 3),
    early = rms(x, 0, 2400),
    late = rms(x, 9600, 12000);
  assert.ok(late < early * 0.7 && late > 0, `decays: ${early} to ${late}`);
  assert.ok(centroid(x.subarray(0, 4096)) > centroid(x.subarray(7200, 11296)), 'darkens');
});

test('adsr: rises, falls to the sustain, holds, and the release ends the buffer at silence', () => {
  const x = adsr(new Float32Array(SR).fill(1), 0.1, 0.2, 0.5, 0.25);
  assert.equal(x[0], 0);
  assert.equal(x[Math.round(0.1 * SR)], 1);
  assert.ok(Math.abs(x[Math.round(0.5 * SR)] - 0.5) < 1e-6);
  assert.ok(x[SR - 1] < 1e-4);
});

test('the beds loop without a seam and stay quiet enough to be forgotten', () => {
  for (const e of CATALOG.filter((x) => x.kind === 'bed'))
    for (const c of channels(bank.get(e.id)!.sound)) {
      let step = 0;
      for (let i = 1; i < c.length; i++) step = Math.max(step, Math.abs(c[i] - c[i - 1]));
      assert.ok(Math.abs(c[0] - c[c.length - 1]) <= step, `${e.id}: the seam is no bigger than a step inside the loop`);
    }
  const pad = monoOf(CATALOG.find((e) => e.id === 'pad')!),
    note = monoOf(CATALOG.find((e) => e.id === 'wood-low')!);
  assert.ok(db(loudness(note)) - db(loudness(pad, 12000) * MIX.pad) >= 16, 'the pad sits at least 16 dB under a mallet note');
  const [l, r] = bank.get('pad')!.sound as [Float32Array, Float32Array];
  let xy = 0;
  for (let i = 0; i < l.length; i++) xy += l[i] * r[i];
  assert.ok(Math.abs(xy / (rms(l) * rms(r) * l.length)) < 0.2, 'left and right are different takes: a wide bed, not a centred tone');
});

test('the room: unit energy, about three quarters of a second, darker as it decays, different on each side', () => {
  const [l, r] = bank.get('room')!.sound as [Float32Array, Float32Array];
  assert.equal(bank.get('room')!.rate, 48000, 'rendered at the context rate a ConvolverNode demands');
  let e = 0;
  for (let i = 0; i < l.length; i++) e += (l[i] * l[i] + r[i] * r[i]) / 2;
  assert.ok(Math.abs(e - 1) < 1e-3, `energy ${e}`);
  const back = new Float64Array(l.length);
  for (let i = l.length - 2, s = 0; i >= 0; i--) back[i] = s += l[i] * l[i];
  const at = (d: number) => back.findIndex((v) => 10 * Math.log10(v / back[0]) < d) / 48000,
    rt60 = (at(-25) - at(-5)) * 3;
  assert.ok(rt60 > 0.4 && rt60 < 1.1, `RT60 ${rt60.toFixed(2)} s`);
  assert.ok(centroid(l.subarray(0, 9600), 48000) > centroid(l.subarray(14400, 24000), 48000) * 1.3, 'high frequencies die first');
  let xy = 0;
  for (let i = 0; i < l.length; i++) xy += l[i] * r[i];
  assert.ok(Math.abs(xy / (rms(l) * rms(r) * l.length)) < 0.5, 'the two sides differ');
});

test('the master limit: linear under the knee, never past the ceiling, an odd curve that maps silence to silence', () => {
  assert.equal(limit(0.3), 0.3);
  assert.equal(limit(-0.5), -0.5);
  assert.ok(limit(5) <= 0.84 && limit(0.9) < 0.84 && limit(0.9) > 0.5);
  const curve = limitCurve();
  assert.equal(curve.length % 2, 1);
  assert.equal(curve[(curve.length - 1) / 2], 0);
  assert.ok(Math.max(...curve) <= 0.84);
  assert.ok(db(0.84) < -1, 'the ceiling is under -1 dBFS');
});

// ---------- the line ----------
const feed = (line: LineComposer, ticks: number, speed: number, ships: (k: number) => number[], reduced = false) => {
  const out: { step: number; midi: number; value: number; vel: number; tick: number }[] = [];
  for (let k = 0; k < ticks; k++) {
    const s = ships(k),
      step = Math.round(k / speed);
    for (const n of line.tick(
      [...new Set(s)].sort((a, b) => b - a),
      s.length,
      step,
      reduced,
    ))
      out.push({ ...n, step, tick: k });
  }
  return out;
};
const worst = (m: number[]) => {
  let run = 1,
    most = 1;
  for (let i = 1; i < m.length; i++) {
    run = m[i] === m[i - 1] ? run + 1 : 1;
    most = Math.max(most, run);
  }
  return most;
};

test('line: every note is in the shift scale, each shift has its own root, and the root climbs from C3', () => {
  assert.equal(rootMidi(1), 48);
  assert.equal(rootMidi(6), 60);
  for (let round = 1; round <= 6; round++) {
    const r = rng(round),
      notes = feed(new LineComposer(round), 4000, 1, () => (r() < 0.4 ? [[1, 3, 8, 12][Math.floor(r() * 4)]] : [])),
      pcs = new Set(notes.map((n) => ((n.midi - rootMidi(round)) % 12) + 12).map((p) => p % 12));
    assert.ok(pcs.size <= 5, `round ${round}: ${[...pcs]}`);
    assert.ok(pcs.has(0) && pcs.has(7), `round ${round} has its root and fifth`);
  }
  for (let round = 1; round <= 6; round++) {
    const k = stingRate(round);
    assert.ok(k > 0.7 && k < 1.42, 'stings move at most a tritone');
  }
});

test('line: higher value sits higher, and the richest goods play two bars', () => {
  const mean = (v: number) => {
    const notes = feed(new LineComposer(1, 3), 2000, 1, (k) => (k % 3 === 0 ? [v] : []));
    return notes.reduce((a, n) => a + n.midi, 0) / notes.length;
  };
  const m = [1, 3, 8, 12].map(mean);
  for (let i = 1; i < m.length; i++) assert.ok(m[i] > m[i - 1] + 2, `means ${m}`);
  assert.equal(voiceOf({ midi: 64, value: 1, vel: 0.5 }).id, 'wood-low');
  assert.equal(voiceOf({ midi: 70, value: 3, vel: 0.5 }).id, 'wood-high');
  assert.equal(voiceOf({ midi: 74, value: 8, vel: 0.5 }).id, 'bar-low');
  assert.equal(voiceOf({ midi: 86, value: 12, vel: 0.5 }).id, 'bar-high');
  for (let round = 1; round <= 6; round++)
    for (const value of [1, 3, 8, 12, 24])
      for (const n of feed(new LineComposer(round, 4), 1500, 1, (k) => (k % 3 === 0 ? [value] : []))) {
        const v = voiceOf(n);
        assert.ok(v.rate >= 0.5 && v.rate <= 1.7, `no rendered note is stretched far: round ${round} ${n.midi} ${v.id} ${v.rate}`);
      }
  const rich = feed(new LineComposer(1, 3), 300, 1, (k) => (k % 5 === 0 ? [24] : []));
  assert.ok(rich.length >= 2 * 45, 'a product ship plays a dyad');
  const worth = voiceOf({ midi: 70, value: 1, vel: 1 }).cutoff;
  assert.ok(worth > voiceOf({ midi: 70, value: 1, vel: 0.4 }).cutoff, 'a harder stroke is brighter');
});

test('line: a lone ship speaks at once; the same note never comes three times running; the walk stays varied', () => {
  const first = new LineComposer(1, 5);
  assert.equal(first.tick([3], 1, 0).length, 1, 'the first ship of a shift has its note on its own tick');
  assert.equal(first.tick([3], 1, 1).length, 0, 'a pulse is two steps');
  assert.equal(first.tick([], 0, 2).length, 1, 'the ship that waited plays on the next step that may sound');
  for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
    const r = rng(seed),
      played = feed(new LineComposer(1 + (seed % 6), seed), 3000, 1, () => (r() < 0.5 ? [[1, 1, 3, 8][Math.floor(r() * 4)]] : [])),
      notes = played.filter((n, i, a) => n.step !== a[i - 1]?.step),
      midi = notes.map((n) => n.midi);
    assert.ok(worst(midi) <= 2, `seed ${seed}: ${worst(midi)} in a row`);
    assert.ok(new Set(midi).size >= 6, `seed ${seed}: ${new Set(midi).size} different notes`);
    const vel = notes.map((n) => n.vel);
    assert.ok(Math.max(...vel) - Math.min(...vel) > 0.25, 'the strokes differ');
  }
});

test('line: the pace holds at every speed and a busy line thins out with a groove instead of a machine gun', () => {
  for (const speed of [1, 2, 4]) {
    const ticks = Math.round((30 * 1000 * speed) / STEP_MS),
      r = rng(speed),
      steps = feed(new LineComposer(2, 9), ticks, speed, () => [1, 3, 8].filter(() => r() < 0.6)).map((n) => n.step),
      starts = [...new Set(steps)],
      perSecond = starts.length / 30,
      gaps = starts.slice(1).map((s, i) => s - starts[i]);
    assert.ok(perSecond <= 3 && perSecond >= 1.5, `${speed}x: ${perSecond.toFixed(2)} notes a second`);
    assert.ok(Math.min(...gaps) >= 2, `${speed}x: at least a pulse between notes, saw ${Math.min(...gaps)}`);
    if (speed === 4) assert.ok(new Set(gaps).size >= 2, 'a busy line swings between gaps, it does not tick evenly');
  }
});

test('line under reduced audio: at most one note a tick, never a dyad, only on the tick of a ship', () => {
  const r = rng(11),
    line = new LineComposer(1, 11);
  for (let k = 0; k < 2000; k++) {
    const ships = r() < 0.5 ? [[1, 3, 8, 12, 24][Math.floor(r() * 5)]] : [],
      notes = line.tick(ships, ships.length, Math.round(k / 4), true);
    assert.ok(notes.length <= 1, 'one sound');
    if (!ships.length) assert.equal(notes.length, 0, 'nothing waits for a later tick');
  }
});

test('machines: one a step, the same machine at most every two pulses, and a busier floor plays each hit softer', () => {
  const line = new LineComposer(1, 2),
    hits: { tier: number; step: number; gain: number }[] = [];
  for (let k = 0; k < 800; k++) {
    const step = Math.round(k / 4);
    line.tick([], 0, step);
    const h = line.machine([3, 2, 1], 3, step);
    if (h) hits.push({ ...h, step });
  }
  const steps = hits.map((h) => h.step);
  assert.equal(new Set(steps).size, steps.length, 'one hit a step');
  for (const tier of [1, 2, 3]) {
    const mine = hits.filter((h) => h.tier === tier).map((h) => h.step);
    assert.ok(
      mine.slice(1).every((s, i) => s - mine[i] >= 4),
      `tier ${tier} rests`,
    );
  }
  assert.ok(hits[hits.length - 1].gain < hits[0].gain * 0.8, `softer once busy: ${hits[0].gain} then ${hits[hits.length - 1].gain}`);
  assert.equal(new LineComposer(1).machine([], 0, 0), null);
});

test('the step grid: a tick late by a frame still lands on the grid, and nothing is scheduled in the past', () => {
  assert.ok(Math.abs(gridDelay(1016, 0, 6) - (1020 - 1016) / 1000 - LOOKAHEAD) < 1e-9);
  assert.ok(gridDelay(5000, 0, 6) >= 0.002);
  const a = gridDelay(1020, 0, 6) + 1.02,
    b = gridDelay(1030, 0, 6) + 1.03;
  assert.ok(Math.abs(a - b) < 1e-9, 'jitter does not reach the ear');
});

// ---------- a whole shift, mixed ----------
const trueDb = (s: [Float32Array, Float32Array]) => db(Math.max(truePeak(s[0]), truePeak(s[1])));

for (const speed of [1, 4] as const)
  test(`a simulated 60 s busy shift at ${speed}x: the master stays under -1 dBFS with room to spare, the melody stays varied`, () => {
    const s = renderShift({ speed, seconds: 60, round: 1, seed: 7, shipsPerSecond: 5 }, bank48()),
      starts = s.notes.filter((_, i) => s.times[i] !== s.times[i - 1]),
      level = db(Math.hypot(rms(s.out[0]), rms(s.out[1])) / Math.SQRT2);
    assert.ok(trueDb(s.out) < -1, `true peak ${trueDb(s.out).toFixed(2)} dBFS`);
    assert.ok(db(s.before) < -2, `the limiter is a safety net, not the mix: ${db(s.before).toFixed(2)} dBFS before it`);
    assert.ok(level > -28 && level < -18, `mean level ${level.toFixed(1)} dBFS`);
    assert.ok(starts.length / 60 <= 3, `${(starts.length / 60).toFixed(2)} notes a second`);
    const midi = starts.map((n) => n.midi);
    assert.ok(worst(midi) <= 2, `${worst(midi)} in a row`);
    assert.ok(new Set(midi).size >= 8, `${new Set(midi).size} different notes`);
    const grams = new Map<string, number>();
    for (let i = 0; i + 4 <= midi.length; i++) {
      const g = midi.slice(i, i + 4).join();
      grams.set(g, (grams.get(g) ?? 0) + 1);
    }
    assert.ok(Math.max(...grams.values()) / midi.length < 0.05, 'no four-note figure dominates');
    assert.ok(s.hits / 60 <= 6, `${(s.hits / 60).toFixed(1)} machine hits a second`);
  });

test('a stacked worst case at full volume never reaches the ceiling: the limit holds whatever the mix does', () => {
  const s = renderShift({ speed: 4, seconds: 20, round: 6, seed: 3, shipsPerSecond: 12, volume: 2.5 }, bank48());
  assert.ok(trueDb(s.out) < -1, `true peak ${trueDb(s.out).toFixed(2)} dBFS at an absurd gain`);
});

test('reduced audio in a whole shift: no dyads, no bed, one voice at a time on the tick grid', () => {
  const s = renderShift({ speed: 4, seconds: 20, round: 1, seed: 5, shipsPerSecond: 5, reduced: true }, bank48());
  assert.equal(new Set(s.times).size, s.times.length, 'never two notes at one time');
});

let bank48Cache: ReturnType<typeof renderAll> | null = null;
function bank48() {
  return (bank48Cache ??= renderAll(SR));
}

// ---------- the bank ----------
test('bank: renders a unit at a time, respects the budget, skips a recipe that fails', () => {
  let clock = 0;
  const made: string[] = [];
  function* long() {
    clock += 1;
    yield;
    clock += 1;
    yield;
    clock += 1;
    return new Float32Array(1);
  }
  const entry = (id: string, recipe: SoundEntry['recipe']): SoundEntry => ({ id, bus: 'ui', kind: 'touch', seed: 1, rate: 8000, recipe });
  const b = new Bank(
    [
      entry('a', () => {
        clock += 3;
        return new Float32Array(1);
      }),
      entry('bad', () => {
        throw new Error('recipe bug');
      }),
      entry('long', long),
      entry('z', () => new Float32Array(1)),
    ],
    (_, rate, e) => {
      made.push(e.id);
      return rate;
    },
  );
  assert.equal(b.get('a'), undefined, 'nothing before the first slice');
  assert.equal(
    b.pump(2, () => clock),
    true,
    'one slice',
  );
  assert.deepEqual(made, ['a'], 'the unit that overran the budget ended the slice');
  assert.equal(b.get('a'), 8000);
  assert.equal(
    b.pump(2, () => clock),
    true,
  );
  assert.equal(b.failed, 1, 'a failing recipe is skipped');
  assert.deepEqual(made, ['a'], 'the long recipe is still rendering');
  while (b.step());
  assert.deepEqual(made, ['a', 'long', 'z']);
  assert.equal(b.step(), false);
  assert.equal(b.size, 3);
});

test('rendering is cheap: the whole catalog in well under a second, no single unit near a frame (Node, this machine)', () => {
  const units: number[] = [];
  const b = new Bank(CATALOG, () => 0, 48000);
  const t = performance.now();
  for (let more = true; more;) {
    const u = performance.now();
    more = b.step();
    units.push(performance.now() - u);
  }
  const total = performance.now() - t;
  assert.ok(total < 400, `${total.toFixed(0)} ms`);
  assert.ok(Math.max(...units) < 16, `worst unit ${Math.max(...units).toFixed(1)} ms`);
});

test('the pad is rendered where the shifts can reach it: every root is at most an octave above it', () => {
  for (let round = 1; round <= 6; round++) {
    const k = hz(rootMidi(round)) / PAD_HZ;
    assert.ok(k >= 1 && k <= 2.0001, `round ${round}: rate ${k}`);
  }
});
