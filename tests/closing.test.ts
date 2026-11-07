// The promise after the score goes up (the consultant panel, 2026-11-06): when the places are final, in the player's own zone and calendar,
// and where this device's place lands; the count only from five games; the first on today's board said to be; no urgency word anywhere.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { COUNTED_FROM, finalLine, whenFinal } from '../game/src/content/closing';
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
