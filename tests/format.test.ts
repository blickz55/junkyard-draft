// The appointment (2026-11-06): when the next yard opens, as a time of day in the player's zone.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { localDate, localTime, localWeekday, nextYardOpensAt } from '../game/src/content/format';

test('a calendar date and a weekday where the device is, or in the zone given (the final line, 2026-11-06)', () => {
  const d = new Date('2026-11-08T00:00:00Z');
  assert.equal(localDate(d, 'UTC'), '2026-11-08');
  assert.equal(localDate(d, 'America/New_York'), '2026-11-07', 'still the evening before, west of UTC');
  assert.equal(localDate(d, 'Asia/Kolkata'), '2026-11-08');
  assert.equal(localWeekday(d, 'UTC'), 'Sunday');
  assert.equal(localWeekday(d, 'America/New_York'), 'Saturday');
  assert.match(localDate(d), /^\d{4}-\d{2}-\d{2}$/, "the device's own zone");
  assert.match(localWeekday(d), /^(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)$/);
});

test('the next yard opens at the next 00:00 UTC', () => {
  assert.equal(nextYardOpensAt(new Date('2026-11-06T23:30:00Z')).toISOString(), '2026-11-07T00:00:00.000Z');
  assert.equal(nextYardOpensAt(new Date('2026-11-06T00:00:00Z')).toISOString(), '2026-11-07T00:00:00.000Z', 'at the stroke it is the day after');
  assert.equal(nextYardOpensAt(new Date('2026-11-06T00:00:01Z')).toISOString(), '2026-11-07T00:00:00.000Z');
});

test("the same instant reads as each zone's own time of day, in the reminder's convention", () => {
  const open = new Date('2026-11-07T00:00:00Z');
  assert.equal(localTime(open, 'America/New_York'), '7:00 PM');
  assert.equal(localTime(open, 'Asia/Kolkata'), '5:30 AM');
  assert.equal(localTime(open, 'UTC'), '12:00 AM');
  assert.equal(localTime(new Date('2026-03-29T00:00:00Z'), 'Europe/London'), '12:00 AM', 'the night the clocks go forward: midnight UTC is still midnight');
  assert.equal(localTime(new Date('2026-03-30T00:00:00Z'), 'Europe/London'), '1:00 AM');
});
