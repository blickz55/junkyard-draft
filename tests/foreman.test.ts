// Production roadmap 0.9.1: the foreman's lines (three to five per situation, deterministic per day, pinned by snapshot),
// the "lessons only" setting, the results band and the character sheet's rules.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const store = new Map<string, string>();
(globalThis as unknown as { localStorage: Storage }).localStorage = {
  getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
  setItem: (k: string, v: string) => { store.set(k, String(v)); },
  removeItem: (k: string) => { store.delete(k); },
  clear: () => store.clear(),
  key: (i: number) => [...store.keys()][i] ?? null,
  get length() { return store.size; },
} as Storage;
const { SITUATIONS, TEACHING, variantKeys, foremanLine, foremanSays, resultsBand, foremanName } = await import('../game/src/content/foreman');
const { buildSnapshot, SNAPSHOT_PATH, SNAPSHOT_DAYS } = await import('../tools/make-foreman-snapshot');
const { bannedWordsIn } = await import('../game/src/content/glossary');
const storage = await import('../game/src/render/storage');

test('foreman: every situation has three to five variants, none with a banned word, a graded word, fake urgency or gaming slang', () => {
  for (const s of SITUATIONS) {
    const keys = variantKeys(s);
    assert.ok(keys.length >= 3 && keys.length <= 5, `${s}: ${keys.length} variants`);
    assert.ok(foremanLine(s, {}, '2026-10-30').length > 0, `${s}: a line for the day`);
    const all = [1, 2, 3, 4, 5].map((i) => foremanLine(s, {}, `2026-10-${String(i).padStart(2, '0')}`));
    for (const line of all) {
      assert.deepEqual(bannedWordsIn(line), [], `${s}: "${line}"`);
      assert.doesNotMatch(line, /\b(wrong|fail|failed|bad|stupid|noob|loser|hurry|last chance|don't miss|meta|buff|nerf|grind|RNG|GG)\b/i, `${s}: the sheet forbids "${line}"`);
      assert.doesNotMatch(line, /!!|[\u{1F300}-\u{1FAFF}]/u, `${s}: no doubled exclamation, no emoji: "${line}"`);
      assert.ok(line.length > 10 && line.length < 140, `${s}: one or two short sentences: "${line}"`);
    }
  }
  assert.equal(foremanName(), 'SAL');
});

test('foreman: the choice is deterministic per day, differs across days for most situations, and the snapshot pins it', () => {
  const snap = JSON.parse(fs.readFileSync(SNAPSHOT_PATH, 'utf8')) as Record<string, Record<string, string>>;
  assert.deepEqual(buildSnapshot(), snap, `${SNAPSHOT_PATH} is stale: run node --import tsx tools/make-foreman-snapshot.ts`);
  assert.deepEqual(Object.keys(snap), SNAPSHOT_DAYS);
  assert.equal(foremanLine('welcome', {}, '2026-10-30'), foremanLine('welcome', {}, '2026-10-30'));
  let differing = 0;
  for (const s of SITUATIONS) { const set = new Set(SNAPSHOT_DAYS.map((d) => snap[d][s])); if (set.size > 1) differing++; }
  assert.ok(differing >= SITUATIONS.length / 2, `${differing} of ${SITUATIONS.length} situations vary across the four days`);
});

test('foreman: "lessons only" keeps the teaching lines and silences the rest; the setting is validated and persisted', () => {
  store.clear();
  assert.equal(storage.loadSettings().chatter, 'full', 'the default is the full foreman');
  assert.ok(foremanSays('welcome').length > 0); assert.ok(foremanSays('refused').length > 0);
  storage.updateSettings({ chatter: 'less' });
  assert.equal(storage.loadSettings().chatter, 'less');
  assert.equal(foremanSays('welcome'), '', 'flavour goes quiet'); assert.equal(foremanSays('resultsTop'), ''); assert.equal(foremanSays('roundGood'), '');
  assert.ok(foremanSays('refused').length > 0, 'a refusal still teaches'); assert.ok(foremanSays('bottleneckSlag').length > 0); assert.ok(foremanSays('lesson2').length > 0); assert.ok(foremanSays('firstDraft').length > 0);
  for (const s of TEACHING) assert.ok(foremanSays(s).length > 0, `${s} is a teaching line`);
  store.set('jd.settings.v1', JSON.stringify({ chatter: 'loud' })); assert.equal(storage.loadSettings().chatter, 'full', 'an unknown value falls back');
  store.set('jd.settings.v1', JSON.stringify({ chatter: 'less' })); assert.equal(storage.loadSettings().chatter, 'less');
  store.clear();
});

test('foreman: the results band and the once-only flags', () => {
  assert.equal(resultsBand(92, 40), 'resultsTop'); assert.equal(resultsBand(80, 40), 'resultsTop'); assert.equal(resultsBand(61, 40), 'resultsUpper'); assert.equal(resultsBand(12, 40), 'resultsLower');
  assert.equal(resultsBand(90, 3), 'resultsFew', 'under five games no band is claimed'); assert.equal(resultsBand(null, 40), 'resultsFew');
  store.clear();
  assert.equal(storage.firstTime('share'), true); assert.equal(storage.firstTime('share'), false, 'the second time is not the first'); assert.equal(storage.firstTime('crew'), true);
  store.set('jd.firsts.v1', '"junk"'); assert.equal(storage.firstTime('share'), true, 'junk storage counts as nothing seen');
  store.clear();
});
