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
const plain = <T extends { bySeed: object }>(b: T) => ({ ...b, bySeed: { ...b.bySeed } });
const { RULES_VERSION } = await import('../game/src/sim/types');

test('bests: null bySeed, wrong primitive types and extra junk fall back field by field (this shape crashed the title screen)', () => {
  store.set('jd.bests.v1', JSON.stringify({ bySeed: null }));
  assert.deepEqual(plain(storage.loadBests()), { overall: null, bySeed: {}, runs: 0 });
  store.set('jd.bests.v1', JSON.stringify({ overall: { score: 'high', seed: 1 }, bySeed: { a: { score: 10, at: 't' }, b: 'nope', c: { score: 'x' } }, runs: -3 }));
  const b = storage.loadBests();
  assert.equal(b.overall, null); assert.deepEqual(Object.keys(b.bySeed), ['a']); assert.equal(b.runs, 0);
  store.set('jd.bests.v1', '[1,2,3]');
  assert.deepEqual(plain(storage.loadBests()), { overall: null, bySeed: {}, runs: 0 });
  store.set('jd.bests.v1', '{not json');
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
  store.set('jd.submissions.v1', JSON.stringify({ good: { score: 1, replayHash: 'h', verifiedAt: 't', player: 'p' }, bad: { score: 'x' }, worse: 5 }));
  assert.deepEqual(Object.keys(storage.loadSubmissions()), ['good']);
  store.set('jd.submissions.v1', '"string"');
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
