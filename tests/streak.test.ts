import { test } from 'node:test';
import assert from 'node:assert/strict';
import { streakOf, normaliseDates, shiftUtcDate } from '../game/src/daily/streak';
import { streakLine } from '../game/src/content/streak';

const at = (iso: string) => new Date(iso);

test('streak: consecutive daily dates ending today or yesterday; gaps break it; the next daily starts a new count', () => {
  const now = at('2026-10-29T15:00:00Z');
  assert.deepEqual(streakOf([], now), { dailies: 0, streak: 0, lastDate: null });
  assert.deepEqual(streakOf(['2026-10-29'], now), { dailies: 1, streak: 1, lastDate: '2026-10-29' });
  assert.deepEqual(streakOf(['2026-10-25', '2026-10-26', '2026-10-27', '2026-10-28', '2026-10-29'], now), { dailies: 5, streak: 5, lastDate: '2026-10-29' });
  assert.deepEqual(streakOf(['2026-10-25', '2026-10-27', '2026-10-28', '2026-10-29'], now), { dailies: 4, streak: 3, lastDate: '2026-10-29' }, 'a gap before the run does not count');
  assert.deepEqual(streakOf(['2026-10-20', '2026-10-21'], now), { dailies: 2, streak: 0, lastDate: '2026-10-21' }, 'an old chain reads 0: no loss copy, just the number');
  assert.deepEqual(streakOf(['2026-10-20', '2026-10-21', '2026-10-29'], now), { dailies: 3, streak: 1, lastDate: '2026-10-29' }, 'after a break the new count starts at 1');
});

test('streak: grace — yesterday\'s daily is still open, so a chain ending yesterday is alive; two days back is not', () => {
  const now = at('2026-10-29T23:59:59Z');
  assert.equal(streakOf(['2026-10-27', '2026-10-28'], now).streak, 2, 'ending yesterday: alive (the 48-hour window still accepts yesterday\'s daily)');
  assert.equal(streakOf(['2026-10-26', '2026-10-27'], now).streak, 0, 'ending two days back: the window closed at 00:00 UTC today');
  // the chain is by the daily's date, not by when it was submitted: yesterday's daily submitted today keeps the chain whole
  assert.equal(streakOf(['2026-10-27', '2026-10-28', '2026-10-29'], at('2026-10-29T00:00:01Z')).streak, 3);
});

test('streak: UTC only — the same instant in any zone gives the same answer; the date boundary is 00:00 UTC', () => {
  const dates = ['2026-10-27', '2026-10-28'];
  const sameInstant = [new Date('2026-10-29T03:00:00Z'), new Date('2026-10-28T22:00:00-05:00'), new Date('2026-10-29T12:00:00+09:00')];
  for (const d of sameInstant) assert.equal(streakOf(dates, d).streak, 2, d.toISOString());
  assert.equal(streakOf(dates, at('2026-10-29T23:59:59.999Z')).streak, 2);
  assert.equal(streakOf(dates, at('2026-10-30T00:00:00.000Z')).streak, 0, 'at midnight UTC the 28th\'s window closes and the chain is over');
  assert.equal(shiftUtcDate('2026-03-01', -1), '2026-02-28'); assert.equal(shiftUtcDate('2024-02-28', 1), '2024-02-29'); assert.equal(shiftUtcDate('2026-12-31', 1), '2027-01-01');
});

test('streak: idempotent and tolerant — duplicates, order and junk never change the count', () => {
  const now = at('2026-10-29T10:00:00Z');
  const a = streakOf(['2026-10-29', '2026-10-28', '2026-10-29', '2026-10-28'], now);
  const b = streakOf(['2026-10-28', '2026-10-29'], now);
  assert.deepEqual(a, b); assert.equal(a.streak, 2); assert.equal(a.dailies, 2);
  assert.deepEqual(normaliseDates(['2026-10-29', 'nope', '2026-13-40', '', '2026-10-28', '2026-10-29']), ['2026-10-28', '2026-10-29']);
  assert.equal(streakOf(['junk', '2026-02-30'], now).dailies, 0);
});

test('streak line: "17 days played · 5 in a row", the streak part only from two', () => {
  assert.equal(streakLine(17, 5), '17 days played · 5 in a row');
  assert.equal(streakLine(1, 1), '1 day played'); assert.equal(streakLine(3, 0), '3 days played'); assert.equal(streakLine(2, 2), '2 days played · 2 in a row');
});
