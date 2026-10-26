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
const { RULES_VERSION } = await import('../game/src/sim/types');

test('bests: null bySeed, wrong primitive types and extra junk fall back field by field (this shape crashed the title screen)', () => {
  store.set('jd.bests.v1', JSON.stringify({ bySeed: null }));
  assert.deepEqual(storage.loadBests(), { overall: null, bySeed: {}, runs: 0 });
  store.set('jd.bests.v1', JSON.stringify({ overall: { score: 'high', seed: 1 }, bySeed: { a: { score: 10, at: 't' }, b: 'nope', c: { score: 'x' } }, runs: -3 }));
  const b = storage.loadBests();
  assert.equal(b.overall, null); assert.deepEqual(Object.keys(b.bySeed), ['a']); assert.equal(b.runs, 0);
  store.set('jd.bests.v1', '[1,2,3]');
  assert.deepEqual(storage.loadBests(), { overall: null, bySeed: {}, runs: 0 });
  store.set('jd.bests.v1', '{not json');
  assert.deepEqual(storage.loadBests(), { overall: null, bySeed: {}, runs: 0 });
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
  assert.deepEqual(storage.loadSubmissions(), {});
  storage.savePlayer('  Jon   Flynn  ');
  assert.equal(storage.loadPlayer(), 'Jon Flynn');
});
