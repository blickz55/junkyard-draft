// The promise after the score goes up (the consultant panel, 2026-11-06): when the places are final, in the player's own zone and calendar,
// and where this device's place lands; the count only from five games, and exact or not at all; the first on today's board said to be;
// no urgency word anywhere.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { COUNTED_FROM, boardGames, finalLine, whenFinal } from '../game/src/content/closing';
import { MORE_STRINGS } from '../game/src/content/strings-more';
import { bannedWordsIn } from '../game/src/content/glossary';

const closesAt = new Date('2026-11-08T00:00:00Z'); // the yard of 6 November closes 48 hours after it opened

test('the moment: the same local day is today, the next is tomorrow, later is the weekday, each as that zone has it', () => {
  const ny = 'America/New_York'; // the close is 7:00 PM on Saturday 7 November there
  assert.equal(whenFinal(closesAt, new Date('2026-11-06T15:00:00Z'), ny), '7:00 PM tomorrow');
  assert.equal(whenFinal(closesAt, new Date('2026-11-07T20:00:00Z'), ny), '7:00 PM today', "yesterday's yard, played in the afternoon");
  assert.equal(whenFinal(closesAt, new Date('2026-11-06T02:00:00Z'), ny), '7:00 PM on Saturday', 'two local days away: the weekday');
  assert.equal(whenFinal(closesAt, new Date('2026-11-06T15:00:00Z'), 'Europe/Berlin'), '1:00 AM on Sunday', 'east of UTC the close is past midnight');
  assert.equal(whenFinal(closesAt, new Date('2026-11-06T15:00:00Z'), 'UTC'), '12:00 AM on Sunday');
  assert.equal(whenFinal(closesAt, new Date('2026-11-07T00:00:00Z'), 'UTC'), '12:00 AM tomorrow');
  assert.equal(whenFinal(closesAt, new Date('2026-11-07T23:59:59Z'), 'UTC'), '12:00 AM tomorrow', 'the last second before: still tomorrow');
});

test('tomorrow is the next calendar day, not 24 hours on: the clocks going back or forward, a month and a year ending', () => {
  const ny = 'America/New_York';
  // 1 November 2026, the clocks go back at 2:00: a 25-hour Sunday. Played at 00:30 that night, Monday's 7:00 PM close is tomorrow
  assert.equal(whenFinal(new Date('2026-11-03T00:00:00Z'), new Date('2026-11-01T04:30:00Z'), ny), '7:00 PM tomorrow', 'the 25-hour day');
  assert.equal(whenFinal(new Date('2026-11-02T00:00:00Z'), new Date('2026-11-01T04:30:00Z'), ny), '7:00 PM today', 'that Sunday evening is today');
  // 8 March 2026, the clocks go forward at 2:00: a 23-hour Sunday. Played at 23:30 the Saturday before, Sunday is tomorrow and Monday is not
  assert.equal(whenFinal(new Date('2026-03-08T23:00:00Z'), new Date('2026-03-08T04:30:00Z'), ny), '7:00 PM tomorrow', 'the 23-hour day itself');
  assert.equal(whenFinal(new Date('2026-03-09T23:00:00Z'), new Date('2026-03-08T04:30:00Z'), ny), '7:00 PM on Monday', 'the day after it');
  assert.equal(whenFinal(new Date('2027-01-02T00:00:00Z'), new Date('2026-12-31T20:00:00Z'), ny), '7:00 PM tomorrow', 'across the turn of the year');
  assert.equal(whenFinal(new Date('2026-12-01T00:00:00Z'), new Date('2026-11-30T15:00:00Z'), 'UTC'), '12:00 AM tomorrow', 'across the turn of the month');
});

test("the count: the chart's whole board once it has loaded with this game on it; before that the board request's length, exact only under its cap and with this game on it; never a crew's", () => {
  const cap = 100; // the board request's most (MAX_BOARD_LIMIT, server/verify.ts)
  assert.equal(boardGames({ chart: null, rank: { n: 3, of: 12 }, cap, crew: false }), 12, 'twelve came back, this one third: the whole board');
  assert.equal(boardGames({ chart: null, rank: { n: 7, of: 100 }, cap, crew: false }), null, 'a hundred came back: the board may hold more, so no figure');
  assert.equal(boardGames({ chart: null, rank: { n: null, of: 100 }, cap, crew: false }), null, 'beyond the hundred: the same');
  assert.equal(boardGames({ chart: null, rank: { n: null, of: 3 }, cap, crew: false }), null, 'this game is not on the list, so the list is not its board');
  assert.equal(boardGames({ chart: null, rank: null, cap, crew: false }), null, 'the board could not be read');
  assert.equal(boardGames({ chart: 150, rank: { n: 7, of: 100 }, cap, crew: false }), 150, 'the chart counted all 150');
  assert.equal(boardGames({ chart: 12, rank: { n: 3, of: 12 }, cap, crew: false }), 12, 'under the cap the chart agrees with the list');
  assert.equal(boardGames({ chart: 150, rank: null, cap, crew: false }), 150, 'the board request failed and the chart did not');
  assert.equal(boardGames({ chart: 150, rank: { n: 7, of: 100 }, cap, crew: true }), null, "a crew's board is not the board");
  assert.equal(boardGames({ chart: null, rank: { n: 1, of: 1 }, cap, crew: false }), 1, 'the first game on the board');
});

test("the line: the first on today's board says so; from five games the count; fewer, or unknown, the final board alone; the inbox only where there is one", () => {
  assert.equal(COUNTED_FROM, 5);
  const base = { closesAt, now: new Date('2026-11-06T15:00:00Z'), timeZone: 'America/New_York', today: true, inbox: true };
  assert.equal(finalLine({ ...base, games: 1 }), 'First on the board today. Places are final at 7:00 PM tomorrow; yours then lands in your inbox.');
  assert.equal(finalLine({ ...base, games: 2 }), 'Places on the final board are set at 7:00 PM tomorrow; yours then lands in your inbox.');
  assert.equal(finalLine({ ...base, games: 4 }), 'Places on the final board are set at 7:00 PM tomorrow; yours then lands in your inbox.');
  assert.equal(finalLine({ ...base, games: 5 }), 'Places among 5 games so far are final at 7:00 PM tomorrow; yours then lands in your inbox.');
  assert.equal(finalLine({ ...base, games: 12 }), 'Places among 12 games so far are final at 7:00 PM tomorrow; yours then lands in your inbox.');
  assert.equal(
    finalLine({ ...base, games: null }),
    'Places on the final board are set at 7:00 PM tomorrow; yours then lands in your inbox.',
    'the board unread: no count',
  );
  assert.equal(
    finalLine({ ...base, games: 1, today: false }),
    'Places on the final board are set at 7:00 PM tomorrow; yours then lands in your inbox.',
    "yesterday's yard is not today's board",
  );
  assert.equal(
    finalLine({ ...base, games: 12, inbox: false }),
    'Places among 12 games so far are final at 7:00 PM tomorrow.',
    'no key at our server: no inbox',
  );
  assert.equal(finalLine({ ...base, games: 1, inbox: false }), 'First on the board today. Places are final at 7:00 PM tomorrow.');
});

test('no urgency word and no banned word in any of it (docs/UX-STANDARD.md, the glossary)', () => {
  const keys = Object.keys(MORE_STRINGS).filter((k) => k.startsWith('results.final'));
  assert.equal(keys.length, 7, keys.join(', '));
  for (const k of keys) {
    const en = MORE_STRINGS[k as keyof typeof MORE_STRINGS].en;
    assert.doesNotMatch(en, /\b(hurry|only|left|last chance|miss|don't|now|quick|soon|before it's too late|expires?)\b/i, k);
    assert.deepEqual(bannedWordsIn(en), [], k);
  }
});
