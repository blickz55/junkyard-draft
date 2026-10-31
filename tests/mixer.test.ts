import { test } from 'node:test';
import assert from 'node:assert/strict';
import { VoiceAllocator, coalesceShips, capTransforms, planTick, CAPS, humRoot, humCutoff, humTarget, JAM_CENTS } from '../game/src/render/mixer';

test('voice allocator: caps per group, value priority steals the lowest voice, voices expire with time', () => {
  const a = new VoiceAllocator({ ...CAPS, ship: 3 });
  assert.equal(a.acquire('ship', 1, 0, 100), true);
  assert.equal(a.acquire('ship', 3, 0, 100), true);
  assert.equal(a.acquire('ship', 12, 0, 100), true);
  assert.equal(a.active('ship', 0), 3);
  assert.equal(a.acquire('ship', 1, 10, 100), false, 'full, and a $1 cannot steal from a $1');
  assert.equal(a.acquire('ship', 8, 10, 100), true, 'a plate steals the $1 voice');
  assert.equal(a.active('ship', 10), 3);
  assert.equal(a.acquire('ui', 1, 10, 50), true, 'groups are independent');
  assert.equal(a.active('ship', 120), 0, 'voices expire');
  assert.equal(a.acquire('ship', 1, 120, 100), true);
});

test('ships coalesce into one chord of distinct values, highest first, capped; transforms keep the highest tiers', () => {
  assert.deepEqual(coalesceShips([1, 3, 3, 12, 1, 8]), [12, 8, 3, 1]);
  assert.deepEqual(coalesceShips(Array.from({ length: 20 }, (_, i) => i + 1)).length, CAPS.ship);
  assert.deepEqual(coalesceShips([]), []);
  assert.deepEqual(capTransforms([0, 1, 3, 2, 1, 3]), [3, 3, 2, 1], 'slag (0) is dropped first');
  assert.deepEqual(capTransforms([1]), [1]);
});

test('tick plan: normal mode plays one chord plus capped transforms plus a jam; reduced audio plays at most one sound per tick', () => {
  const busy = { ships: [1, 3, 12, 12], transforms: [1, 1, 3, 0, 2], jams: 3 };
  const full = planTick(busy, false);
  assert.deepEqual(full, { chord: [12, 3, 1], transforms: [3, 2, 1, 1], jam: true, count: 6 });
  const quiet = planTick(busy, true);
  assert.deepEqual(quiet, { chord: [12], transforms: [], jam: false, count: 1 }, 'ship beats everything, as the highest value only');
  assert.deepEqual(planTick({ ships: [], transforms: [0, 3], jams: 1 }, true), { chord: [], transforms: [3], jam: false, count: 1 });
  assert.deepEqual(planTick({ ships: [], transforms: [], jams: 2 }, true), { chord: [], transforms: [], jam: true, count: 1 });
  assert.deepEqual(planTick({ ships: [], transforms: [], jams: 0 }, true).count, 0);
  assert.deepEqual(planTick({ ships: [], transforms: [], jams: 0 }, false).count, 0);
});

test('ambient bed: pentatonic roots by round, cutoff 300 Hz → 2 kHz by items in flight, a jam detunes the pad slightly, the last ten ticks swell without a pitch climb', () => {
  assert.ok(Math.abs(humRoot(1) - 130.81) < 0.01, 'round 1 is C3');
  assert.ok(Math.abs(humRoot(6) - 261.62) < 0.05, 'round 6 is the octave');
  const roots = [1, 2, 3, 4, 5, 6].map(humRoot);
  for (let i = 1; i < roots.length; i++) assert.ok(roots[i] > roots[i - 1], 'roots climb');
  assert.equal(humCutoff(0), 300);
  assert.ok(Math.abs(humCutoff(12) - 2000) < 1e-6 && Math.abs(humCutoff(30) - 2000) < 1e-6, '12+ items saturate at 2 kHz');
  assert.ok(humCutoff(6) > 300 && humCutoff(6) < 2000 && humCutoff(6) > humCutoff(3));
  const r = humRoot(1);
  const calm = humTarget(r, { inFlight: 0, jammed: false, tick: 10, ticksPerRound: 80 });
  assert.deepEqual([calm.freq, calm.cutoff, calm.detuned, calm.rise], [r, 300, false, 0]);
  const jam = humTarget(r, { inFlight: 3, jammed: true, tick: 10, ticksPerRound: 80 });
  assert.ok(Math.abs(jam.freq / r - Math.pow(2, JAM_CENTS / 1200)) < 1e-9, 'a shade sharp while jammed');
  assert.ok(JAM_CENTS > 5 && JAM_CENTS < 30, 'tension, never a sour quarter tone');
  assert.equal(jam.detuned, true);
  assert.equal(humTarget(r, { inFlight: 0, jammed: false, tick: 70, ticksPerRound: 80 }).rise, 0);
  assert.equal(humTarget(r, { inFlight: 0, jammed: false, tick: 75, ticksPerRound: 80 }).rise, 0.5);
  const end = humTarget(r, { inFlight: 0, jammed: false, tick: 80, ticksPerRound: 80 });
  assert.equal(end.rise, 1);
  assert.equal(end.freq, r, 'the pad holds its pitch to the end');
});
