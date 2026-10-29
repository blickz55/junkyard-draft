import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isoWeekId, fridayOfWeek, isWeekId, weeklyWindow, currentWeekId, nextWeekId, prevWeekId, isWeeklySeed, weeklyIdOf, weeklyClosed } from '../game/src/sim/weekly';

test('weekly calendar (PLAN-v4 0.7.5): ISO week ids, the Friday of a week, the Friday 18:00 UTC window, the current week around the boundary, week 53 years', () => {
  // known ISO facts: 2030-01-04 is a Friday in week 1; 2026-12-31 (Thursday) is in 2026-W53; 2027-01-01 (Friday) is in 2026-W53; 2021-01-01 is in 2020-W53
  assert.equal(new Date('2030-01-04T00:00:00Z').getUTCDay(), 5);
  assert.equal(isoWeekId(new Date('2030-01-04T12:00:00Z')), '2030-W01');
  assert.equal(isoWeekId(new Date('2026-12-31T00:00:00Z')), '2026-W53'); assert.equal(isoWeekId(new Date('2027-01-01T00:00:00Z')), '2026-W53'); assert.equal(isoWeekId(new Date('2021-01-01T00:00:00Z')), '2020-W53');
  assert.equal(isoWeekId(new Date('2030-03-15T23:59:59Z')), '2030-W11'); assert.equal(isoWeekId(new Date('2030-03-18T00:00:00Z')), '2030-W12');
  assert.equal(fridayOfWeek('2030-W11')!.toISOString(), '2030-03-15T00:00:00.000Z'); assert.equal(fridayOfWeek('2030-W01')!.toISOString(), '2030-01-04T00:00:00.000Z');
  assert.equal(fridayOfWeek('2026-W53')!.toISOString(), '2027-01-01T00:00:00.000Z'); assert.equal(fridayOfWeek('2030-W53'), null, '2030 has 52 weeks'); assert.equal(fridayOfWeek('2030-W00'), null); assert.equal(fridayOfWeek('nope'), null);
  assert.ok(isWeekId('2026-W53')); assert.ok(!isWeekId('2030-W53')); assert.ok(!isWeekId('2030-w11')); assert.ok(!isWeekId(42));
  assert.deepEqual(weeklyWindow('2030-W11'), { opensAt: '2030-03-15T18:00:00.000Z', closesAt: '2030-03-22T18:00:00.000Z', openDate: '2030-03-15' });
  assert.equal(currentWeekId(new Date('2030-03-15T17:59:59Z')), '2030-W10', 'before Friday 18:00 UTC the previous weekly is still the current one');
  assert.equal(currentWeekId(new Date('2030-03-15T18:00:00Z')), '2030-W11', 'at 18:00 the new weekly opens');
  assert.equal(currentWeekId(new Date('2030-03-21T09:00:00Z')), '2030-W11'); assert.equal(currentWeekId(new Date('2030-03-22T17:59:59Z')), '2030-W11'); assert.equal(currentWeekId(new Date('2030-03-22T18:00:00Z')), '2030-W12');
  assert.equal(nextWeekId('2030-W11'), '2030-W12'); assert.equal(prevWeekId('2030-W11'), '2030-W10'); assert.equal(nextWeekId('2026-W53'), '2027-W01'); assert.equal(prevWeekId('2027-W01'), '2026-W53'); assert.equal(nextWeekId('bad'), null);
  // every week in a decade round-trips: its Friday maps back to the same id and windows chain without gaps
  let id = '2026-W01';
  for (let i = 0; i < 520; i++) { const w = weeklyWindow(id)!; const n = nextWeekId(id)!; assert.equal(weeklyWindow(n)!.opensAt, w.closesAt, `${id} → ${n} is seamless`); assert.equal(isoWeekId(fridayOfWeek(id)!), id); id = n; }
  assert.ok(isWeeklySeed('weekly-2030-W11-abcdefgh')); assert.ok(!isWeeklySeed('weekly-2030-W11-ABCDEFGH')); assert.ok(!isWeeklySeed('daily-2030-03-15-abcdefgh')); assert.equal(weeklyIdOf('weekly-2030-W11-abcdefgh'), '2030-W11');
  assert.equal(weeklyClosed('weekly-2030-W11-abcdefgh', new Date('2030-03-22T17:59:59Z')), false); assert.equal(weeklyClosed('weekly-2030-W11-abcdefgh', new Date('2030-03-22T18:00:00Z')), true); assert.equal(weeklyClosed('weekly-2030-W99-abcdefgh', new Date()), false);
});
