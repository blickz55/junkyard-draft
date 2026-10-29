// malformed_storage_shapes_fall_back: localStorage is untrusted; valid JSON with the wrong shape must never crash boot.
import { test } from 'node:test';
import assert from 'node:assert/strict';

// minimal localStorage for Node (the module reads it lazily, so install before importing)
const store = new Map<string, string>();
(globalThis as unknown as { localStorage: Storage }).localStorage = {
  getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
  setItem: (k: string, v: string) => { store.set(k, String(v)); },
  removeItem: (k: string) => { store.delete(k); },
  clear: () => store.clear(),
  key: (i: number) => [...store.keys()][i] ?? null,
  get length() { return store.size; },
} as Storage;

const storage = await import('../game/src/render/storage');
/** seed dictionaries have no prototype (review F14); deep-equal against plain literals through a copy */
// legacy-key writers: records live under jd.*.v2 since 0.5.0; writing the v1 key must drop the v2 key so the one-time migration runs again
const setLegacyBests = (v: string) => { store.delete('jd.bests.v2'); store.set('jd.bests.v1', v); };
const setLegacySubs = (v: string) => { store.delete('jd.submissions.v2'); store.set('jd.submissions.v1', v); };
const plain = <T extends { bySeed: object }>(b: T) => ({ ...b, bySeed: { ...b.bySeed } });
const { RULES_VERSION } = await import('../game/src/sim/types');

test('bests: null bySeed, wrong primitive types and extra junk fall back field by field (this shape crashed the title screen)', () => {
  setLegacyBests(JSON.stringify({ bySeed: null }));
  assert.deepEqual(plain(storage.loadBests()), { overall: null, bySeed: {}, runs: 0 });
  setLegacyBests(JSON.stringify({ overall: { score: 'high', seed: 1 }, bySeed: { a: { score: 10, at: 't' }, b: 'nope', c: { score: 'x' } }, runs: -3 }));
  const b = storage.loadBests();
  assert.equal(b.overall, null); assert.deepEqual(Object.keys(b.bySeed), ['a']); assert.equal(b.runs, 0);
  setLegacyBests('[1,2,3]');
  assert.deepEqual(plain(storage.loadBests()), { overall: null, bySeed: {}, runs: 0 });
  setLegacyBests('{not json');
  assert.deepEqual(plain(storage.loadBests()), { overall: null, bySeed: {}, runs: 0 });
  // recording on top of a damaged file produces a clean file
  const rec = storage.recordBest('seed-z', 500);
  assert.deepEqual(rec, { newOverall: true, newSeed: true });
  assert.equal(storage.loadBests().overall?.score, 500);
});

test('settings: invalid types keep their defaults; valid fields survive', () => {
  store.set('jd.settings.v1', JSON.stringify({ volume: 'loud', muted: 'yes', reducedMotion: true, textScale: 9 }));
  const s = storage.loadSettings();
  assert.equal(s.volume, 0.7); assert.equal(s.muted, false); assert.equal(s.reducedMotion, true); assert.equal(s.textScale, 1);
  store.set('jd.settings.v1', JSON.stringify({ volume: 7 }));
  assert.equal(storage.loadSettings().volume, 1, 'volume is clamped to [0, 1]');
  storage.updateSettings({ textScale: 1.3 });
  assert.equal(storage.loadSettings().textScale, 1.3);
  assert.equal(storage.loadSettings().volume, 1, 'update keeps the other validated fields');
});

test('save: wrong shapes are not resumable and are reported as unusable; other rules versions are ignored', () => {
  store.set('jd.save.v1', JSON.stringify({ rulesVersion: RULES_VERSION, seed: 'ok-seed', actions: [{ t: 'pick', i: 0 }], savedAt: 'x' }));
  assert.equal(storage.loadSave()?.seed, 'ok-seed'); assert.equal(storage.hasUnusableSave(), false);
  store.set('jd.save.v1', JSON.stringify({ rulesVersion: RULES_VERSION, seed: 'ok-seed', actions: [{ t: 'pick', i: 'a' }] }));
  assert.equal(storage.loadSave(), null, 'a malformed action makes the save unusable');
  assert.equal(storage.hasUnusableSave(), true);
  store.set('jd.save.v1', JSON.stringify({ rulesVersion: RULES_VERSION, seed: 'x'.repeat(65), actions: [] }));
  assert.equal(storage.loadSave(), null, 'an over-long seed could never be replayed, so it is not offered');
  store.set('jd.save.v1', JSON.stringify({ rulesVersion: RULES_VERSION - 1, seed: 'old', actions: [] }));
  assert.equal(storage.loadSave(), null); assert.equal(storage.hasUnusableSave(), true);
  store.set('jd.save.v1', 'null');
  assert.equal(storage.loadSave(), null);
  storage.clearSave(); assert.equal(storage.hasUnusableSave(), false);
});

test('submissions and player name: junk entries are dropped, names are cleaned', () => {
  setLegacySubs(JSON.stringify({ good: { score: 1, replayHash: 'h', verifiedAt: 't', player: 'p' }, bad: { score: 'x' }, worse: 5 }));
  assert.deepEqual(Object.keys(storage.loadSubmissions()), ['good']);
  setLegacySubs('"string"');
  assert.deepEqual({ ...storage.loadSubmissions() }, {});
  storage.savePlayer('  Jon   Flynn  ');
  assert.equal(storage.loadPlayer(), 'Jon Flynn');
});

test('seeds that collide with inherited object properties round-trip as ordinary records (review F14)', () => {
  for (const seed of ['__proto__', 'constructor', 'toString', 'hasOwnProperty']) {
    store.clear();
    const r = storage.recordBest(seed, 150);
    assert.deepEqual(r, { newOverall: true, newSeed: true }, `${seed}: first record is a new best`);
    const b = storage.loadBests();
    assert.equal(b.bySeed[seed]?.score, 150, `${seed}: best stored and read back`);
    assert.deepEqual(storage.recordBest(seed, 120), { newOverall: false, newSeed: false }, `${seed}: a lower score is not a new best`);
    assert.equal(storage.loadBests().bySeed[seed]?.score, 150);
    storage.recordSubmission(seed, { score: 150, replayHash: 'h1', verifiedAt: '', player: 'p' });
    assert.equal(storage.loadSubmissions()[seed]?.replayHash, 'h1', `${seed}: submission stored and read back`);
    storage.recordSubmission(seed, { score: 100, replayHash: 'h2', verifiedAt: '', player: 'p' });
    assert.equal(storage.loadSubmissions()[seed]?.replayHash, 'h1', `${seed}: a lower submission does not replace it`);
    assert.equal(Object.getPrototypeOf(storage.loadBests().bySeed), null, 'dictionaries carry no prototype');
  }
  store.clear();
});

test('records are partitioned by rules version (PLAN-v2 0.5.0): a real v2 profile migrates once, other versions stay apart, archived bests are listed', async () => {
  const fs = await import('node:fs');
  const fixture = JSON.parse(fs.readFileSync('tests/fixtures/profile-v2.json', 'utf8')) as Record<string, string>;
  store.clear();
  for (const [k, v] of Object.entries(fixture)) if (k.startsWith('jd.')) store.set(k, v);
  // migration on first read
  const b = storage.loadBests();
  assert.equal(b.overall?.score, 1814); assert.equal(b.runs, 7); assert.equal(b.bySeed['daily-2026-10-28']?.score, 912);
  assert.equal(store.has('jd.bests.v1'), false, 'the legacy key is removed after migration');
  const all = JSON.parse(store.get('jd.bests.v2')!);
  assert.deepEqual(Object.keys(all.byVersion), [String(RULES_VERSION)], 'pre-0.5.0 records land in the current version\'s slot');
  const subs = storage.loadSubmissions();
  assert.equal(subs['daily-2026-10-28']?.replayHash.length, 64); assert.equal(store.has('jd.submissions.v1'), false);
  // everything version-independent is untouched
  assert.equal(storage.loadPlayer(), 'Jon'); assert.deepEqual(storage.loadReadTips(), ['press', 'crusher']); assert.equal(storage.loadSettings().textScale, 1.15); assert.equal(storage.daysPlayed(), 3);
  // idempotent: a second read changes nothing
  const snapshot = [...store.entries()].sort().join('|');
  storage.loadBests(); storage.loadSubmissions();
  assert.equal([...store.entries()].sort().join('|'), snapshot);
  // writing under another version leaves this one alone, and shows up as archived from that version's point of view
  storage.recordBest('future-seed', 2500, RULES_VERSION + 1);
  storage.recordSubmission('future-seed', { score: 2500, replayHash: 'f'.repeat(64), verifiedAt: '', player: 'Jon' }, RULES_VERSION + 1);
  assert.equal(storage.loadBests().overall?.score, 1814, 'current version unchanged');
  assert.equal(storage.loadBests(RULES_VERSION + 1).overall?.score, 2500);
  assert.equal(storage.loadSubmissions()['future-seed'], undefined); assert.equal(storage.loadSubmissions(RULES_VERSION + 1)['future-seed']?.score, 2500);
  const archived = storage.loadArchivedBests();
  assert.deepEqual(archived.map((a) => [a.version, a.bests.overall?.score, a.bests.runs]), [[RULES_VERSION + 1, 2500, 1]]);
  // a device with no legacy data migrates to an empty partition without inventing records
  store.clear();
  assert.deepEqual(plain(storage.loadBests()), { overall: null, bySeed: {}, runs: 0 });
  assert.deepEqual(storage.loadArchivedBests(), []);
  store.clear();
});

test('days played: one entry per UTC date, malformed rows dropped, bounded', () => {
  store.delete('jd.days.v1');
  assert.equal(storage.daysPlayed(), 0);
  assert.equal(storage.recordDayPlayed(new Date('2026-10-29T23:59:00Z')), 1);
  assert.equal(storage.recordDayPlayed(new Date('2026-10-29T01:00:00Z')), 1, 'the same UTC day counts once');
  assert.equal(storage.recordDayPlayed(new Date('2026-10-30T00:00:01Z')), 2);
  store.set('jd.days.v1', JSON.stringify(['2026-01-01', 5, 'nope', null, '2026-01-02']));
  assert.deepEqual(storage.loadDaysPlayed(), ['2026-01-01', '2026-01-02']);
  store.set('jd.days.v1', '"junk"');
  assert.equal(storage.daysPlayed(), 0);
});
