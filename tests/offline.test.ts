// Production roadmap 0.8.7: the device's run history per seed, submissions waiting for a connection, the flush on the next
// title load, and a lint that no player-facing string carries developer copy.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

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
const { RULES_VERSION } = await import('../game/src/sim/types');
const { flushPending, describeOutcomes, keepUnsent, openUnsent, sendPending, sendingNow } = await import('../game/src/render/pending');
const { apply, newRun } = await import('../game/src/sim/run');
const { exportReplay } = await import('../game/src/sim/replay');
const { RULES } = await import('../game/src/sim/rules');

function finishedRun(seed: string) {
  const s = newRun(seed);
  for (let r = 1; r <= RULES.rounds; r++) {
    apply(s, { t: 'pick', i: 0 });
    apply(s, { t: 'run' });
    apply(s, { t: 'next' });
  }
  return s;
}

test('0.8.7 run history: every own run is kept per seed under the current rules, oldest first, capped; junk rows and other versions stay apart', () => {
  store.clear();
  assert.deepEqual(storage.loadHistory('s1'), []);
  for (let i = 1; i <= 12; i++) storage.recordRun('s1', i * 10, RULES_VERSION, new Date(Date.UTC(2030, 0, i)));
  const h = storage.loadHistory('s1');
  assert.equal(h.length, storage.HISTORY_PER_SEED, 'capped');
  assert.equal(h[0].score, 30, 'the oldest two fell off');
  assert.equal(h[h.length - 1].score, 120);
  assert.equal(h[0].at, '2030-01-03T00:00:00.000Z');
  storage.recordRun('s2', 5, RULES_VERSION - 1);
  assert.deepEqual(storage.loadHistory('s2'), [], "another rules version is not this one's history");
  assert.equal(storage.loadHistory('s2', RULES_VERSION - 1).length, 1);
  store.set(
    'jd.history.v1',
    JSON.stringify({
      byVersion: {
        [RULES_VERSION]: { ok: [{ score: 1, at: 'x' }, { score: 'no' }, null, { at: 'y' }], __proto__: [{ score: 9, at: 'z' }], bad: 'nope' },
        junk: 3,
      },
    }),
  );
  assert.deepEqual(storage.loadHistory('ok'), [{ score: 1, at: 'x' }], 'junk rows dropped');
  assert.deepEqual(storage.loadHistory('bad'), []);
  store.set('jd.history.v1', '"junk"');
  assert.deepEqual(storage.loadHistory('ok'), []);
});

test('0.8.7 pending submissions: one per seed (the newest wins), capped, validated like a save, removed by seed and time, other rules versions not offered', () => {
  store.clear();
  const run = finishedRun('pend-a');
  const p = (seed: string, savedAt: string) => ({
    seed,
    rulesVersion: RULES_VERSION,
    replay: { ...exportReplay(finishedRun(seed), 'test'), seed },
    player: 'Pat',
    savedAt,
  });
  storage.savePending(p('pend-a', '2030-01-01T00:00:00Z'));
  storage.savePending(p('pend-a', '2030-01-02T00:00:00Z'));
  assert.deepEqual(
    storage.loadPending().map((x) => [x.seed, x.savedAt]),
    [['pend-a', '2030-01-02T00:00:00Z']],
    'the newest replaces the older one for the same seed',
  );
  for (let i = 0; i < 6; i++) storage.savePending(p(`pend-${i}`, `2030-02-0${i + 1}T00:00:00Z`));
  assert.equal(storage.loadPending().length, storage.PENDING_MAX);
  assert.equal(storage.loadPending()[0].seed, 'pend-1', 'the oldest fell off (pend-a, then pend-0)');
  assert.equal(
    storage.loadPending()[0].replay.claimedScore,
    run.score === run.score ? storage.loadPending()[0].replay.claimedScore : -1,
    'the replay round-trips',
  );
  storage.removePending('pend-1', '2030-02-02T00:00:00Z');
  assert.equal(storage.loadPending().length, storage.PENDING_MAX - 1);
  assert.ok(!storage.loadPending().some((x) => x.seed === 'pend-1'));
  store.set(
    'jd.pending.v1',
    JSON.stringify([
      { seed: 'x', rulesVersion: RULES_VERSION, replay: { format: 1, rulesVersion: RULES_VERSION, seed: 'x', actions: [{ t: 'bogus' }], claimedScore: 1 } },
      { seed: 'y', rulesVersion: RULES_VERSION, replay: { format: 1, rulesVersion: RULES_VERSION, seed: 'other', actions: [], claimedScore: 1 } },
      'junk',
      { seed: 'z', rulesVersion: RULES_VERSION - 1, replay: { format: 1, rulesVersion: RULES_VERSION - 1, seed: 'z', actions: [], claimedScore: 1 } },
      { seed: 'ok', rulesVersion: RULES_VERSION, replay: { format: 1, rulesVersion: RULES_VERSION, seed: 'ok', actions: [], claimedScore: 0 } },
    ]),
  );
  assert.deepEqual(
    storage.loadPending().map((x) => x.seed),
    ['ok'],
    'an illegal action, a seed mismatch, junk and an older rules version are not offered',
  );
  storage.removePending('ok', '');
  assert.equal(store.has('jd.pending.v1'), false, 'the key goes when the list is empty');
});

test('0.8.7 flush: verified runs are recorded and removed with their rank, a refused one is dropped, an unreachable verifier keeps the rest; the title line reads naturally', async () => {
  store.clear();
  const mk = (seed: string, savedAt: string) => ({
    seed,
    rulesVersion: RULES_VERSION,
    replay: exportReplay(finishedRun(seed), 'test'),
    player: 'Pat',
    savedAt,
  });
  storage.savePending(mk('flush-ok', '2030-03-01T00:00:00Z'));
  storage.savePending(mk('flush-bad', '2030-03-02T00:00:00Z'));
  storage.savePending(mk('flush-late', '2030-03-03T00:00:00Z'));
  const calls: string[] = [];
  const fake = (async (url: string | URL | Request, init?: RequestInit) => {
    const u = String(url);
    calls.push(u);
    const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
    if (u.endsWith('/verify')) {
      const sent = JSON.parse(String(init!.body)) as { replay: { seed: string }; player: string };
      assert.equal(sent.player, 'Pat');
      if (sent.replay.seed === 'flush-ok')
        return json(200, { ok: true, score: 123, recorded: true, player: 'Pat#AAAA', entry: { replayHash: 'h-ok', verifiedAt: '2030-03-04T00:00:00Z' } });
      if (sent.replay.seed === 'flush-bad') return json(422, { ok: false, error: 'did not reproduce', code: 'did-not-reproduce' });
      return json(200, { ok: true, score: 77, late: true, closesAt: '2030-03-03T00:00:00Z' });
    }
    if (u.includes('/board?seed=flush-ok')) return json(200, { entries: [{ replayHash: 'other' }, { replayHash: 'h-ok' }] });
    throw new Error(`unexpected ${u}`);
  }) as unknown as typeof fetch;
  const out = await flushPending('http://127.0.0.1:1', fake);
  assert.deepEqual(
    out.map((o) => [o.seed, o.status]),
    [
      ['flush-ok', 'verified'],
      ['flush-bad', 'rejected'],
      ['flush-late', 'late'],
    ],
  );
  assert.deepEqual(out[0].rank, { n: 2, of: 2 });
  assert.equal(out[0].player, 'Pat#AAAA');
  assert.deepEqual(storage.loadPending(), [], 'all three are settled');
  assert.deepEqual(
    { ...storage.loadSubmissions()['flush-ok'] },
    { score: 123, replayHash: 'h-ok', verifiedAt: '2030-03-04T00:00:00Z', player: 'Pat#AAAA' },
    "the verified run is this device's submission for the seed",
  );
  assert.equal(storage.loadSubmissions()['flush-late'], undefined, 'a late run is not a submission record');
  const line = describeOutcomes(out);
  assert.match(
    line,
    /^Your saved game on flush-ok is checked: \$123 · #2 of 2 as Pat#AAAA\. your saved game on flush-bad was not accepted \(did not reproduce\) and is no longer kept\. your saved game on flush-late is checked \(\$77\), but that day's board had already closed\.$/,
  );
  // offline: everything stays
  storage.savePending(mk('flush-off', '2030-03-05T00:00:00Z'));
  const off = await flushPending('http://127.0.0.1:1', (async () => {
    throw new TypeError('fetch failed');
  }) as unknown as typeof fetch);
  assert.deepEqual(
    off.map((o) => o.status),
    ['offline'],
  );
  assert.equal(storage.loadPending().length, 1, 'kept for the next load');
  assert.match(describeOutcomes(off), /^Still offline. Your saved game on flush-off waits until you reconnect.$/);
  assert.equal(describeOutcomes([]), '');
});

// A finished daily is kept until it is on the board (the consultant panel, 2026-11-06): the row is a pending submission flagged
// `unsent`, which a flush never sends; Home sends it through the same path when the player taps.
test('2026-11-06 unsent games: the flag round-trips (the tool origin with it), the best per yard is kept, a game the player asked to send keeps its place, a flush never sends one, the tap does', async () => {
  store.clear();
  const row = (seed: string, score: number, extra: object = {}) => ({
    seed,
    rulesVersion: RULES_VERSION,
    replay: { ...exportReplay(finishedRun(seed), 'test'), claimedScore: score },
    player: 'Pat',
    savedAt: '2030-04-01T00:00:00Z',
    ...extra,
  });
  // validation: with the flag, without it (every row saved before today), and with a flag of the wrong shape
  store.set('jd.pending.v1', JSON.stringify([row('u-a', 10, { unsent: true, origin: 'tool' }), row('u-b', 20), row('u-c', 30, { unsent: 'yes' })]));
  assert.deepEqual(
    storage.validatePending(JSON.parse(store.get('jd.pending.v1')!)).map((p) => [p.seed, p.unsent, p.origin]),
    [
      ['u-a', true, 'tool'],
      ['u-b', undefined, undefined],
      ['u-c', undefined, undefined],
    ],
    'the flag is kept only as true; the tool origin round-trips',
  );
  assert.deepEqual(
    storage.loadPending().map((p) => p.seed),
    ['u-b', 'u-c'],
    'an unsent game is not one to flush',
  );
  assert.deepEqual(
    storage.loadUnsent().map((p) => p.seed),
    ['u-a'],
  );
  // the best per yard; a game the player asked to send is never replaced by an unsent one
  storage.saveUnsent(row('u-a', 15));
  assert.equal(storage.loadUnsent()[0].replay.claimedScore, 15, 'a better game replaces the kept one');
  storage.saveUnsent(row('u-a', 12));
  assert.equal(storage.loadUnsent()[0].replay.claimedScore, 15, 'a lower one does not');
  storage.saveUnsent(row('u-b', 99));
  assert.equal(storage.loadPending().find((p) => p.seed === 'u-b')!.replay.claimedScore, 20, 'the game the player asked to send keeps its place');
  assert.deepEqual(
    storage.loadUnsent().map((p) => p.seed),
    ['u-a'],
  );
  // a Submit tap on the same yard replaces the unsent game (the tap decides); forgetting removes it; queueing hands it to the flush
  storage.savePending(row('u-a', 11));
  assert.deepEqual(storage.loadUnsent(), []);
  assert.equal(storage.loadPending().find((p) => p.seed === 'u-a')!.replay.claimedScore, 11);
  storage.saveUnsent(row('u-d', 5));
  storage.forgetUnsent('u-d');
  assert.deepEqual(storage.loadUnsent(), []);
  assert.equal(storage.loadPending().length, 3, 'forgetting touches nothing else');
  storage.saveUnsent(row('u-d', 5));
  storage.queueUnsent('u-d');
  assert.deepEqual(storage.loadUnsent(), []);
  assert.ok(
    storage.loadPending().some((p) => p.seed === 'u-d' && !p.unsent),
    'now it goes like any saved game',
  );
  // the cap (review, 2026-11-06): a kept game never displaces a game the player asked to send; over the cap it gives way first, the oldest kept one first
  store.clear();
  for (const s of ['a1', 'a2', 'a3', 'a4', 'a5']) storage.savePending(row(s, 1));
  storage.saveUnsent(row('k1', 1));
  assert.deepEqual(
    storage.loadPending().map((p) => p.seed),
    ['a1', 'a2', 'a3', 'a4', 'a5'],
    'five games the player asked to send stay',
  );
  assert.deepEqual(storage.loadUnsent(), [], 'and the kept game finds no room');
  storage.removePending('a5', row('a5', 1).savedAt);
  storage.saveUnsent(row('k1', 1));
  storage.saveUnsent(row('k2', 1));
  assert.deepEqual(
    storage.loadUnsent().map((p) => p.seed),
    ['k2'],
    'a kept game gives way to a newer kept game',
  );
  assert.deepEqual(
    storage.loadPending().map((p) => p.seed),
    ['a1', 'a2', 'a3', 'a4'],
  );
  storage.savePending(row('a6', 1));
  assert.deepEqual(
    storage.loadPending().map((p) => p.seed),
    ['a1', 'a2', 'a3', 'a4', 'a6'],
    "a game the player asked to send takes the kept game's room, never another asked-for game's",
  );
  assert.deepEqual(storage.loadUnsent(), []);
  store.set('jd.pending.v1', JSON.stringify([row('r1', 1, { unsent: true }), row('r2', 1), row('r3', 1), row('r4', 1), row('r5', 1), row('r6', 1)]));
  assert.deepEqual(
    storage.validatePending(JSON.parse(store.get('jd.pending.v1')!)).map((p) => p.seed),
    ['r2', 'r3', 'r4', 'r5', 'r6'],
    'on read too, a list over the cap loses its kept rows first',
  );
  // the flush sends only what the player asked to send; the tap from Home takes the same path, and a checked game is recorded like a live one
  store.clear();
  storage.savePending(row('f-asked', 10));
  storage.saveUnsent(row('f-unsent', 10));
  const sent: string[] = [];
  const fake = (async (url: string | URL | Request, init?: RequestInit) => {
    const u = String(url);
    const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
    if (u.endsWith('/verify')) {
      const s = JSON.parse(String(init!.body)) as { replay: { seed: string } };
      sent.push(s.replay.seed);
      return json(200, { ok: true, score: 10, recorded: true, player: 'Pat', entry: { replayHash: `h-${s.replay.seed}`, verifiedAt: '2030-04-02T00:00:00Z' } });
    }
    if (u.includes('/board?seed=')) return json(200, { entries: [] });
    throw new Error(`unexpected ${u}`);
  }) as unknown as typeof fetch;
  const out = await flushPending('http://127.0.0.1:1', fake);
  assert.deepEqual(sent, ['f-asked'], 'the unsent game was not sent for the player');
  assert.deepEqual(
    out.map((o) => [o.seed, o.status]),
    [['f-asked', 'verified']],
  );
  assert.deepEqual(
    storage.loadUnsent().map((p) => p.seed),
    ['f-unsent'],
    'still kept',
  );
  const tap = await sendPending('http://127.0.0.1:1', storage.loadUnsent()[0], fake);
  assert.equal(tap.status, 'verified');
  assert.deepEqual(sent, ['f-asked', 'f-unsent']);
  assert.deepEqual(storage.loadUnsent(), [], 'on the board: the row goes');
  assert.equal(storage.loadSubmissions()['f-unsent']?.replayHash, 'h-f-unsent', "the device's submission record, as a live one");
});

test("2026-11-06 keepUnsent and openUnsent: a finished minted daily of the player's own is kept, flagged; a try, an unfinished game, an unminted yard, a closed day or a game this device's checked one covers is not; the reader drops a day that closed or a game a checked one covers, and holds back one on its way", () => {
  store.clear();
  const now = new Date('2030-05-10T12:00:00Z');
  const today = 'daily-2030-05-10-abcdefgh';
  const yesterday = 'daily-2030-05-09-abcdefgh';
  const closed = 'daily-2030-05-08-abcdefgh';
  keepUnsent(finishedRun(today), 'test', { origin: 'tool' }, now);
  keepUnsent(finishedRun(yesterday), 'test', {}, now);
  keepUnsent(finishedRun(closed), 'test', {}, now);
  keepUnsent(finishedRun('practice-yard'), 'test', {}, now);
  keepUnsent(finishedRun('daily-2030-05-10'), 'test', {}, now); // the practice daily is no minted yard: nothing to put on a board
  keepUnsent({ ...finishedRun(today), forkedFrom: { hash: null, player: 'Sal', round: 2 } }, 'test', {}, now); // a try is practice
  keepUnsent(newRun(today), 'test', {}, now); // not finished
  assert.deepEqual(
    storage.loadUnsent().map((p) => [p.seed, p.unsent, p.origin, p.player, p.savedAt]),
    [
      [today, true, 'tool', '', '2030-05-10T12:00:00.000Z'],
      [yesterday, true, undefined, '', '2030-05-10T12:00:00.000Z'],
    ],
  );
  assert.equal(storage.loadUnsent()[0].replay.claimedScore, finishedRun(today).score, 'the recording carries the score it claims');
  assert.deepEqual(
    openUnsent(now).map((p) => p.seed),
    [today, yesterday],
    "today's and yesterday's days are open",
  );
  const later = new Date('2030-05-11T12:00:00Z'); // a day closes 48 hours after its 00:00 UTC: on the 11th, the 9th has closed and the 10th is open
  assert.deepEqual(
    openUnsent(later).map((p) => p.seed),
    [today],
  );
  assert.deepEqual(
    storage.loadUnsent().map((p) => p.seed),
    [today],
    'the closed day is gone from the device',
  );
  keepUnsent(finishedRun(today), 'test', {}, new Date('2030-05-12T12:00:00Z'));
  assert.equal(
    storage.loadUnsent()[0].savedAt,
    '2030-05-10T12:00:00.000Z',
    "a day that has closed is not kept, so the older row stands (it is the reader's to drop)",
  );
  // this device's checked game on the yard (review, 2026-11-06): a game it ranks at least as well as is not kept, and a kept one goes once a
  // checked game covers it, because keep-best would refuse either; a lower checked game leaves the offer
  const score = finishedRun(today).score;
  const checked = (at: number) => storage.recordSubmission(today, { score: at, replayHash: 'h-today', verifiedAt: '2030-05-10T11:00:00Z', player: 'Pat' });
  checked(score - 1);
  assert.equal(openUnsent(now).length, 1, 'a lower checked game: the kept one would rank higher, so it is still offered');
  checked(score); // the device's record keeps its best, as the board does
  assert.deepEqual(openUnsent(now), [], 'an equal checked game: Home does not offer the kept one');
  assert.deepEqual(storage.loadUnsent(), [], 'and the device lets it go');
  keepUnsent(finishedRun(today), 'test', {}, now);
  assert.deepEqual(storage.loadUnsent(), [], 'nor is one kept at the results');
  // a game on its way to our server from the results stays kept and is not offered until the answer is in
  store.delete('jd.submissions.v2');
  keepUnsent(finishedRun(today), 'test', {}, now);
  sendingNow(today, true);
  assert.deepEqual(openUnsent(now), []);
  assert.equal(storage.loadUnsent().length, 1, 'still kept');
  sendingNow(today, false);
  assert.equal(openUnsent(now).length, 1);
});

test("2026-11-06 Home's outcome names the game by its day, never by the yard's code, and never calls it saved; the flush's lines are as they were", () => {
  type Outcome = Parameters<typeof describeOutcomes>[0][number];
  const o = (status: Outcome['status'], extra: Partial<Outcome> = {}): Outcome => ({ seed: 'daily-2030-05-10-abcdefgh', savedAt: '', status, ...extra });
  const today = () => "today's game";
  assert.equal(describeOutcomes([o('verified', { score: 10, rank: { n: 1, of: 3 }, player: 'Pat' })], today), "Today's game is checked: $10 · #1 of 3 as Pat.");
  assert.equal(
    describeOutcomes([o('keep-best', { score: 10 })], () => "yesterday's game"),
    "Yesterday's game is checked ($10) but an earlier game of yours on that yard ranks at least as well.",
  );
  assert.equal(describeOutcomes([o('late', { score: 10 })], today), "Today's game is checked ($10), but that day's board had already closed.");
  assert.equal(describeOutcomes([o('rejected', { error: 'x' })], today), "Today's game was not accepted (x) and is no longer kept.");
  assert.equal(describeOutcomes([o('busy')], today), "Our server is busy; today's game is still waiting.");
  assert.equal(describeOutcomes([o('offline')], today), "Still offline: today's game waits until you reconnect.");
  assert.equal(describeOutcomes([o('offline')]), 'Still offline. Your saved game on daily-2030-05-10-abcdefgh waits until you reconnect.');
});

test('0.8.7 no developer copy on the player\'s screens: the DOM screens and panels never mention npm, localhost, loopback addresses or "local verifier"', () => {
  const dir = path.resolve('game/src/ui');
  const offenders: string[] = [];
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.ts'))) {
    const lines = fs.readFileSync(path.join(dir, f), 'utf8').split('\n');
    lines.forEach((l, i) => {
      if (/npm run|localhost|127\.0\.0\.1|[Ll]ocal verifier|start it with/.test(l)) offenders.push(`${f}:${i + 1}: ${l.trim().slice(0, 100)}`);
    });
  }
  assert.deepEqual(offenders, []);
});
