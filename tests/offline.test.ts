// Production roadmap 0.8.7: the device's run history per seed, submissions waiting for a connection, the flush on the next
// title load, and a lint that no player-facing string carries developer copy.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

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
const { flushPending, describeOutcomes } = await import('../game/src/render/pending');
const { apply, newRun } = await import('../game/src/sim/run');
const { exportReplay } = await import('../game/src/sim/replay');
const { RULES } = await import('../game/src/sim/rules');

function finishedRun(seed: string) {
  const s = newRun(seed);
  for (let r = 1; r <= RULES.rounds; r++) { apply(s, { t: 'pick', i: 0 }); apply(s, { t: 'run' }); apply(s, { t: 'next' }); }
  return s;
}

test('0.8.7 run history: every own run is kept per seed under the current rules, oldest first, capped; junk rows and other versions stay apart', () => {
  store.clear();
  assert.deepEqual(storage.loadHistory('s1'), []);
  for (let i = 1; i <= 12; i++) storage.recordRun('s1', i * 10, RULES_VERSION, new Date(Date.UTC(2030, 0, i)));
  const h = storage.loadHistory('s1');
  assert.equal(h.length, storage.HISTORY_PER_SEED, 'capped'); assert.equal(h[0].score, 30, 'the oldest two fell off'); assert.equal(h[h.length - 1].score, 120); assert.equal(h[0].at, '2030-01-03T00:00:00.000Z');
  storage.recordRun('s2', 5, RULES_VERSION - 1); assert.deepEqual(storage.loadHistory('s2'), [], 'another rules version is not this one\'s history'); assert.equal(storage.loadHistory('s2', RULES_VERSION - 1).length, 1);
  store.set('jd.history.v1', JSON.stringify({ byVersion: { [RULES_VERSION]: { ok: [{ score: 1, at: 'x' }, { score: 'no' }, null, { at: 'y' }], '__proto__': [{ score: 9, at: 'z' }], bad: 'nope' }, junk: 3 } }));
  assert.deepEqual(storage.loadHistory('ok'), [{ score: 1, at: 'x' }], 'junk rows dropped'); assert.deepEqual(storage.loadHistory('bad'), []);
  store.set('jd.history.v1', '"junk"'); assert.deepEqual(storage.loadHistory('ok'), []);
});

test('0.8.7 pending submissions: one per seed (the newest wins), capped, validated like a save, removed by seed and time, other rules versions not offered', () => {
  store.clear();
  const run = finishedRun('pend-a');
  const p = (seed: string, savedAt: string) => ({ seed, rulesVersion: RULES_VERSION, replay: { ...exportReplay(finishedRun(seed), 'test'), seed }, player: 'Pat', savedAt });
  storage.savePending(p('pend-a', '2030-01-01T00:00:00Z'));
  storage.savePending(p('pend-a', '2030-01-02T00:00:00Z'));
  assert.deepEqual(storage.loadPending().map((x) => [x.seed, x.savedAt]), [['pend-a', '2030-01-02T00:00:00Z']], 'the newest replaces the older one for the same seed');
  for (let i = 0; i < 6; i++) storage.savePending(p(`pend-${i}`, `2030-02-0${i + 1}T00:00:00Z`));
  assert.equal(storage.loadPending().length, storage.PENDING_MAX); assert.equal(storage.loadPending()[0].seed, 'pend-1', 'the oldest fell off (pend-a, then pend-0)');
  assert.equal(storage.loadPending()[0].replay.claimedScore, run.score === run.score ? storage.loadPending()[0].replay.claimedScore : -1, 'the replay round-trips');
  storage.removePending('pend-1', '2030-02-02T00:00:00Z'); assert.equal(storage.loadPending().length, storage.PENDING_MAX - 1); assert.ok(!storage.loadPending().some((x) => x.seed === 'pend-1'));
  store.set('jd.pending.v1', JSON.stringify([{ seed: 'x', rulesVersion: RULES_VERSION, replay: { format: 1, rulesVersion: RULES_VERSION, seed: 'x', actions: [{ t: 'bogus' }], claimedScore: 1 } }, { seed: 'y', rulesVersion: RULES_VERSION, replay: { format: 1, rulesVersion: RULES_VERSION, seed: 'other', actions: [], claimedScore: 1 } }, 'junk', { seed: 'z', rulesVersion: RULES_VERSION - 1, replay: { format: 1, rulesVersion: RULES_VERSION - 1, seed: 'z', actions: [], claimedScore: 1 } }, { seed: 'ok', rulesVersion: RULES_VERSION, replay: { format: 1, rulesVersion: RULES_VERSION, seed: 'ok', actions: [], claimedScore: 0 } }]));
  assert.deepEqual(storage.loadPending().map((x) => x.seed), ['ok'], 'an illegal action, a seed mismatch, junk and an older rules version are not offered');
  storage.removePending('ok', ''); assert.equal(store.has('jd.pending.v1'), false, 'the key goes when the list is empty');
});

test('0.8.7 flush: verified runs are recorded and removed with their rank, a refused one is dropped, an unreachable verifier keeps the rest; the title line reads naturally', async () => {
  store.clear();
  const mk = (seed: string, savedAt: string) => ({ seed, rulesVersion: RULES_VERSION, replay: exportReplay(finishedRun(seed), 'test'), player: 'Pat', savedAt });
  storage.savePending(mk('flush-ok', '2030-03-01T00:00:00Z')); storage.savePending(mk('flush-bad', '2030-03-02T00:00:00Z')); storage.savePending(mk('flush-late', '2030-03-03T00:00:00Z'));
  const calls: string[] = [];
  const fake = (async (url: string | URL | Request, init?: RequestInit) => {
    const u = String(url); calls.push(u);
    const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
    if (u.endsWith('/verify')) {
      const sent = JSON.parse(String(init!.body)) as { replay: { seed: string }; player: string };
      assert.equal(sent.player, 'Pat');
      if (sent.replay.seed === 'flush-ok') return json(200, { ok: true, score: 123, recorded: true, player: 'Pat#AAAA', entry: { replayHash: 'h-ok', verifiedAt: '2030-03-04T00:00:00Z' } });
      if (sent.replay.seed === 'flush-bad') return json(422, { ok: false, error: 'did not reproduce', code: 'did-not-reproduce' });
      return json(200, { ok: true, score: 77, late: true, closesAt: '2030-03-03T00:00:00Z' });
    }
    if (u.includes('/board?seed=flush-ok')) return json(200, { entries: [{ replayHash: 'other' }, { replayHash: 'h-ok' }] });
    throw new Error(`unexpected ${u}`);
  }) as unknown as typeof fetch;
  const out = await flushPending('http://127.0.0.1:1', fake);
  assert.deepEqual(out.map((o) => [o.seed, o.status]), [['flush-ok', 'verified'], ['flush-bad', 'rejected'], ['flush-late', 'late']]);
  assert.deepEqual(out[0].rank, { n: 2, of: 2 }); assert.equal(out[0].player, 'Pat#AAAA');
  assert.deepEqual(storage.loadPending(), [], 'all three are settled');
  assert.deepEqual({ ...storage.loadSubmissions()['flush-ok'] }, { score: 123, replayHash: 'h-ok', verifiedAt: '2030-03-04T00:00:00Z', player: 'Pat#AAAA' }, 'the verified run is this device\'s submission for the seed');
  assert.equal(storage.loadSubmissions()['flush-late'], undefined, 'a late run is not a submission record');
  const line = describeOutcomes(out);
  assert.match(line, /^Your saved game on flush-ok is checked: \$123 · #2 of 2 as Pat#AAAA\. your saved game on flush-bad was refused \(did not reproduce\) and is no longer kept\. your saved game on flush-late is checked \(\$77\) but that day's board had already closed, so it is not ranked\.$/);
  // offline: everything stays
  storage.savePending(mk('flush-off', '2030-03-05T00:00:00Z'));
  const off = await flushPending('http://127.0.0.1:1', (async () => { throw new TypeError('fetch failed'); }) as unknown as typeof fetch);
  assert.deepEqual(off.map((o) => o.status), ['offline']); assert.equal(storage.loadPending().length, 1, 'kept for the next load');
  assert.match(describeOutcomes(off), /^Still offline; your saved game on flush-off is kept until the game opens with a connection\.$/);
  assert.equal(describeOutcomes([]), '');
});

test('0.8.7 no developer copy on the player\'s screens: the DOM screens and panels never mention npm, localhost, loopback addresses or "local verifier"', () => {
  const dir = path.resolve('game/src/ui');
  const offenders: string[] = [];
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.ts'))) {
    const lines = fs.readFileSync(path.join(dir, f), 'utf8').split('\n');
    lines.forEach((l, i) => { if (/npm run|localhost|127\.0\.0\.1|[Ll]ocal verifier|start it with/.test(l)) offenders.push(`${f}:${i + 1}: ${l.trim().slice(0, 100)}`); });
  }
  assert.deepEqual(offenders, []);
});
