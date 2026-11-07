// Yesterday's yard, still open (2026-11-06): the rule has taken it for 48 hours since PLAN-v3 0.6.3; Home now offers it while this device has not had it checked.
import { test } from 'node:test';
import assert from 'node:assert/strict';

// a minimal localStorage for Node (the module reads it lazily, so install before importing)
const store = new Map<string, string>();
(globalThis as unknown as { localStorage: Storage }).localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, String(v)),
  removeItem: (k: string) => void store.delete(k),
  clear: () => store.clear(),
  key: (i: number) => [...store.keys()][i] ?? null,
  get length() {
    return store.size;
  },
} as Storage;
const { acceptDaily, cachedDaily, yesterdayOffer, dailyClosesAt } = await import('../game/src/render/daily');

const now = new Date('2026-11-06T15:00:00Z');
const seedOf = (date: string) => `daily-${date}-abcdefgh`; // the minted form: a date and eight base32 letters
const body = (extra: object = {}) => ({
  minted: true,
  date: '2026-11-06',
  seed: seedOf('2026-11-06'),
  closesAt: '2026-11-08T00:00:00.000Z',
  commitment: 'c',
  ...extra,
});
const prev = { date: '2026-11-05', seed: seedOf('2026-11-05'), commitment: 'p' };

test("today's daily keeps the day before it, and the cache carries it to the next load", () => {
  const info = acceptDaily(body({ previous: prev }), now)!;
  assert.deepEqual(info.previous, { date: '2026-11-05', seed: seedOf('2026-11-05') });
  assert.deepEqual(cachedDaily(now)?.previous, info.previous, 'round-tripped');
  assert.equal(acceptDaily(body({ previous: { date: '2026-11-05', seed: 'not-a-daily' } }), now)!.previous, undefined, 'a malformed previous is dropped');
  assert.equal(acceptDaily(body({ previous: null }), now)!.previous, undefined);
});

test('the offer: null with no yard known, once this device has it checked, once the window is closed; the open yard otherwise', () => {
  const info = acceptDaily(body({ previous: prev }), now)!;
  assert.equal(yesterdayOffer(null, [], now), null, 'nothing known');
  assert.equal(yesterdayOffer(acceptDaily(body(), now), [], now), null, 'no previous named');
  assert.equal(yesterdayOffer(info, ['2026-11-05'], now), null, 'already checked on this device');
  assert.deepEqual(yesterdayOffer(info, ['2026-11-04'], now), { seed: seedOf('2026-11-05'), date: '2026-11-05', closesAt: '2026-11-07T00:00:00.000Z' });
  assert.equal(yesterdayOffer(info, [], new Date('2026-11-07T00:00:00Z')), null, 'at the stroke of the day after, it is gone (and today has moved on)');
  // the window closes 48 hours after yesterday's 00:00 UTC, which is the stroke of tomorrow: a minute before, it is still open
  const late = new Date('2026-11-06T23:59:59Z');
  assert.ok(yesterdayOffer(info, [], late), 'open until the last second of today');
});

test("when a daily's places are final (2026-11-06): the server's moment for the yard it named today, the 48-hour rule for any other minted yard, nothing else", () => {
  store.clear();
  assert.equal(dailyClosesAt('classic-e2e-seed', now), null);
  assert.equal(dailyClosesAt('daily-2026-11-05', now), null, 'the practice yard is on no board');
  assert.equal(dailyClosesAt(seedOf('2026-11-05'), now)!.toISOString(), '2026-11-07T00:00:00.000Z', "yesterday's yard: 00:00 UTC two days after its date");
  assert.equal(dailyClosesAt(seedOf('2026-11-06'), now)!.toISOString(), '2026-11-08T00:00:00.000Z', 'today, before the server has said');
  acceptDaily(body({ closesAt: '2026-11-08T06:00:00.000Z' }), now); // a re-issued day closes later than the rule: the server's word stands
  assert.equal(dailyClosesAt(seedOf('2026-11-06'), now)!.toISOString(), '2026-11-08T06:00:00.000Z');
  assert.equal(dailyClosesAt(seedOf('2026-11-05'), now)!.toISOString(), '2026-11-07T00:00:00.000Z', 'another yard keeps the rule');
});
