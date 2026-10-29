import { test } from 'node:test';
import assert from 'node:assert/strict';
import { medalThresholds, medalFor, nearestRank, medalsLine, MEDAL_MIN_N } from '../game/src/daily/medals';

test('medals: nearest-rank percentiles on a synthetic distribution; the exact math is documented by these numbers', () => {
  // 20 scores 10, 20, …, 200: rank ceil(p/100·20): 50th → rank 10 → 100; 80th → rank 16 → 160; 95th → rank 19 → 190
  const twenty = Array.from({ length: 20 }, (_, i) => (i + 1) * 10);
  assert.deepEqual(medalThresholds(twenty.slice().reverse()), { n: 20, bronze: 100, silver: 160, gold: 190 }, 'order of input does not matter');
  // 5 scores: ranks ceil(2.5)=3, ceil(4)=4, ceil(4.75)=5 → the median, the fourth, the top
  assert.deepEqual(medalThresholds([5, 1, 4, 2, 3]), { n: 5, bronze: 3, silver: 4, gold: 5 });
  // ties: thresholds are real scores, and a tied score earns the medal
  const tied = [100, 100, 100, 100, 100, 100, 250, 250, 300, 300];
  const m = medalThresholds(tied)!; assert.deepEqual(m, { n: 10, bronze: 100, silver: 250, gold: 300 });
  assert.equal(medalFor(100, m), 'bronze'); assert.equal(medalFor(250, m), 'silver'); assert.equal(medalFor(300, m), 'gold'); assert.equal(medalFor(99, m), null); assert.equal(medalFor(260, m), 'silver');
  // fewer than five verified runs: no medals at all
  assert.equal(MEDAL_MIN_N, 5);
  assert.equal(medalThresholds([]), null); assert.equal(medalThresholds([900, 800, 700, 600]), null); assert.equal(medalFor(900, null), null); assert.equal(medalFor(900, undefined), null);
  // junk scores are ignored, not counted
  assert.equal(medalThresholds([1, 2, 3, 4, NaN, Infinity]), null);
  assert.equal(nearestRank([1, 2, 3], 0), 1); assert.equal(nearestRank([1, 2, 3], 100), 3);
  assert.equal(medalsLine(m), 'gold ≥ $300 · silver ≥ $250 · bronze ≥ $100');
});
