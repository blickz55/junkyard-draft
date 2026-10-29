import { test } from 'node:test';
import assert from 'node:assert/strict';
import { VoiceAllocator, coalesceShips, capTransforms, planTick, CAPS } from '../game/src/render/mixer';

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
