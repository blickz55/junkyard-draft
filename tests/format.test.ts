// The appointment (2026-11-06): when the next yard opens, as a time of day in the player's zone.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { localTime, nextYardOpensAt } from '../game/src/content/format';

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
