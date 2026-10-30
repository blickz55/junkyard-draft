// production roadmap 0.9.7: the record page's local memory (standings, medals, machines drafted), the longest chain and the trend.
import { test } from 'node:test';
import assert from 'node:assert/strict';

const store = new Map<string, string>();
(globalThis as unknown as { localStorage: Storage }).localStorage = {
  getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
  setItem: (k: string, v: string) => {
    store.set(k, String(v));
  },
  removeItem: (k: string) => {
    store.delete(k);
  },
  clear: () => store.clear(),
  key: (i: number) => [...store.keys()][i] ?? null,
  get length() {
    return store.size;
  },
} as Storage;

const storage = await import('../game/src/render/storage');
const { longestStreak } = await import('../game/src/daily/streak');
const { trendOf, recordData } = await import('../game/src/render/record');
const { RULES_VERSION } = await import('../game/src/sim/types');
const V = String(RULES_VERSION);
const standing = (seed: string, at: string, percentile: number, n = 10, rank = 3, score = 1000) => ({ seed, at, score, percentile, n, rank });

test('standings: one per yard, chronological, junk dropped, capped at 100, partitioned by rules version', () => {
  store.clear();
  assert.deepEqual(storage.loadStandings(), []);
  storage.recordStanding(standing('yard-b', '2026-10-02T10:00:00.000Z', 40));
  storage.recordStanding(standing('yard-a', '2026-10-01T10:00:00.000Z', 20));
  assert.deepEqual(
    storage.loadStandings().map((s) => [s.seed, s.percentile]),
    [
      ['yard-a', 20],
      ['yard-b', 40],
    ],
    'sorted by when the standing was learnt',
  );
  storage.recordStanding(standing('yard-a', '2026-10-03T10:00:00.000Z', 70));
  assert.deepEqual(
    storage.loadStandings().map((s) => [s.seed, s.percentile]),
    [
      ['yard-b', 40],
      ['yard-a', 70],
    ],
    'a later checked game on the same yard replaces the earlier standing',
  );
  store.set(
    'jd.standings.v1',
    JSON.stringify({
      byVersion: {
        [V]: [standing('ok', '2026-10-04T00:00:00.000Z', 55), { seed: 'junk' }, 'nope', standing('', '2026-10-05T00:00:00.000Z', 1)],
        '1': [standing('old', 't', 9)],
      },
    }),
  );
  assert.deepEqual(
    storage.loadStandings().map((s) => s.seed),
    ['ok'],
    'only well-formed records under the current version are read',
  );
  assert.deepEqual(
    storage.loadStandings(1).map((s) => s.seed),
    ['old'],
    'other versions keep theirs',
  );
  store.clear();
  for (let i = 0; i < 130; i++) storage.recordStanding(standing(`y-${i}`, new Date(Date.UTC(2026, 0, 1) + i * 1000).toISOString(), i % 100));
  assert.equal(storage.loadStandings().length, storage.STANDINGS_MAX, 'the oldest beyond the cap fall off');
  assert.equal(storage.loadStandings()[0].seed, 'y-30');
  assert.deepEqual(
    storage.loadStandings(1).map((s) => s.seed),
    [],
    'the other version stays empty (store cleared)',
  );
});

test('medals: one per yard, only real medal names, by version', () => {
  store.clear();
  assert.deepEqual(storage.loadMedals(), []);
  storage.recordMedal('daily-2026-10-20-abcdefgh', 'silver', 1800, RULES_VERSION, new Date('2026-10-22T00:00:00Z'));
  storage.recordMedal('daily-2026-10-20-abcdefgh', 'gold', 1900, RULES_VERSION, new Date('2026-10-22T01:00:00Z'));
  storage.recordMedal('daily-2026-10-21-abcdefgh', 'bronze', 1200, RULES_VERSION, new Date('2026-10-23T00:00:00Z'));
  assert.deepEqual(
    storage.loadMedals().map((m) => [m.seed.slice(6, 16), m.medal, m.score]),
    [
      ['2026-10-20', 'gold', 1900],
      ['2026-10-21', 'bronze', 1200],
    ],
  );
  store.set(
    'jd.medals.v1',
    JSON.stringify({
      byVersion: {
        [V]: [
          { seed: 'x', medal: 'platinum', score: 1, at: 't' },
          { seed: 'y', medal: 'gold', score: 2, at: 't' },
        ],
      },
    }),
  );
  assert.deepEqual(
    storage.loadMedals().map((m) => m.seed),
    ['y'],
    'an unknown medal name is dropped',
  );
});

test('machines drafted: totals per kind, unknown kinds ignored, junk floored or dropped', () => {
  store.clear();
  assert.deepEqual(storage.loadKinds(), {});
  storage.recordKinds(['crusher', 'hopper', 'crusher']);
  storage.recordKinds(['furnace', 'crusher', 'sieve', 'bogus' as never]);
  assert.deepEqual(storage.loadKinds(), { crusher: 3, hopper: 1, furnace: 1, sieve: 1 });
  store.set('jd.kinds.v1', JSON.stringify({ byVersion: { [V]: { crusher: 2.7, hopper: -1, dock: 'many', tuner: 4 } } }));
  assert.deepEqual(storage.loadKinds(), { crusher: 2, tuner: 4 });
});

test('longest chain and the trend', () => {
  assert.equal(longestStreak([]), 0);
  assert.equal(longestStreak(['2026-10-01']), 1);
  assert.equal(longestStreak(['2026-10-01', '2026-10-02', '2026-10-03', '2026-10-07', '2026-10-08']), 3);
  assert.equal(longestStreak(['2026-10-08', '2026-10-07', '2026-10-01', '2026-10-07']), 2, 'order and duplicates do not matter');
  const s = (p: number[]) => p.map((pct, i) => standing(`y-${i}`, `2026-10-${String(i + 1).padStart(2, '0')}T00:00:00.000Z`, pct));
  assert.equal(trendOf(s([10, 20, 30, 40, 50])), null, 'under six: no trend yet');
  assert.equal(trendOf(s([10, 20, 30, 60, 70, 80])), 'up');
  assert.equal(trendOf(s([80, 70, 60, 30, 20, 10])), 'down');
  assert.equal(trendOf(s([50, 52, 48, 51, 49, 50])), 'flat');
});

test('the record page data reads days, the chain, medals, bests, standings and kinds from this device', () => {
  store.clear();
  storage.recordDayPlayed(new Date('2026-10-28T12:00:00Z'));
  storage.recordDayPlayed(new Date('2026-10-30T12:00:00Z'));
  storage.recordDailyDate('2026-10-29');
  storage.recordDailyDate('2026-10-30');
  storage.recordBest('yard-one', 1500);
  storage.recordBest('yard-two', 900);
  storage.recordKinds(['crusher', 'crusher', 'furnace']);
  storage.recordStanding(standing('yard-one', '2026-10-30T12:00:00.000Z', 61, 412, 160, 1500));
  storage.recordMedal('daily-2026-10-29-abcdefgh', 'bronze', 1300, RULES_VERSION, new Date('2026-10-31T00:00:00Z'));
  const d = recordData(new Date('2026-10-30T13:00:00Z'));
  assert.deepEqual(d.days, { played: 2, first: '2026-10-28', last: '2026-10-30' });
  assert.deepEqual(d.dailies, { checked: 2, current: 2, longest: 2 });
  assert.deepEqual(
    d.medals.map((m) => m.medal),
    ['bronze'],
  );
  assert.equal(d.bests.overall?.score, 1500);
  assert.equal(d.bests.games, 2);
  assert.equal(d.bests.yards, 2);
  assert.deepEqual(
    d.bests.top.map((b) => b.seed),
    ['yard-one', 'yard-two'],
  );
  assert.deepEqual(
    d.standings.map((s) => s.percentile),
    [61],
  );
  assert.equal(d.trend, null);
  assert.deepEqual(d.kinds, [
    { kind: 'crusher', count: 2 },
    { kind: 'furnace', count: 1 },
  ]);
});
