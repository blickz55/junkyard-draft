import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Verifier, createServer, RateLimiter, clientIp, clampInt, replayId, loadBoard, StorageError, EventStore, histogramOf, niceStep, type BoardEntry } from '../server/verify';
import { build as esbuild } from 'esbuild';
import net from 'node:net';
import { RULES_VERSION } from '../game/src/sim/types';
import { apply, newRun } from '../game/src/sim/run';
import { encodeReplay, exportReplay } from '../game/src/sim/replay';
import { RULES } from '../game/src/sim/rules';
import { dailySeedFor, isDailySeed } from '../game/src/sim/daily';

function finishedRun(seed: string) {
  const s = newRun(seed);
  for (let r = 1; r <= RULES.rounds; r++) { apply(s, { t: 'pick', i: s.offers.indexOf('crusher') >= 0 ? s.offers.indexOf('crusher') : 0 }); if (r === 1) { const conv = s.layout.machines.find((m) => m.x === 2 && m.y === 2)!; apply(s, { t: 'unplace', id: conv.id }); apply(s, { t: 'place', id: s.bin[0].id, x: 2, y: 2, dir: 0 }); } apply(s, { t: 'run' }); apply(s, { t: 'next' }); }
  return s;
}

test('verifier accepts a legal finished replay, rejects tampering, duplicates, unfinished runs', () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'jd-board-')), 'board.json');
  const v = new Verifier(file);
  const run = finishedRun('board-seed');
  const replay = exportReplay(run);
  const ok = v.submit(encodeReplay(replay), 'alice');
  assert.equal(ok.ok, true); assert.equal(ok.score, run.score);
  assert.equal(v.submit(encodeReplay(replay), 'alice').ok, false, 'duplicate rejected');
  assert.match(v.submit(encodeReplay({ ...replay, claimedScore: replay.claimedScore + 5 }), 'bob').error!, /does not match/);
  const tampered = { ...replay, actions: replay.actions.map((a) => (a.t === 'place' ? { ...a, x: 7 } : a)) };
  assert.equal(v.submit(encodeReplay(tampered), 'bob').ok, false, 'edited action changes outcome → rejected');
  const unfinished = { ...replay, actions: replay.actions.slice(0, 4), claimedScore: 0 };
  assert.match(v.submit(encodeReplay(unfinished), 'bob').error!, /not finished|does not match/);
  assert.equal(v.submit('{"format":1', 'bob').ok, false, 'garbage rejected');
  assert.match(v.submit(encodeReplay({ ...replay, rulesVersion: 99 }), 'bob').error!, /rules version/);
  const board = v.board('board-seed');
  assert.equal(board.length, 1); assert.equal(board[0].player, 'alice'); assert.equal(board[0].replayAvailable, true);
  // stored replay of a verified entry: same actions, player and score; unknown hash → null
  const stored = v.replay(board[0].replayHash)!;
  assert.deepEqual(stored.actions, replay.actions); assert.equal(stored.player, 'alice'); assert.equal(stored.score, run.score); assert.equal(stored.seed, 'board-seed');
  assert.equal(v.replay('deadbeef'), null);
  // persisted
  assert.equal(new Verifier(file).board('board-seed').length, 1);
  // daily: today's UTC seed, only entries for that seed
  const today = dailySeedFor(new Date());
  assert.ok(isDailySeed(today));
  assert.deepEqual(v.daily().entries, []);
  assert.equal(v.submit(encodeReplay(exportReplay(finishedRun(today))), 'dana').ok, true);
  const daily = v.daily();
  assert.equal(daily.seed, today); assert.equal(daily.entries.length, 1); assert.equal(daily.entries[0].player, 'dana');
  assert.equal(v.daily(10, new Date('2030-01-02T03:04:05Z')).seed, 'daily-2030-01-02', 'daily seed follows the UTC date');
});

test('http: POST /verify and GET /board return verified data only', async () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'jd-board-')), 'board.json');
  const server = createServer(new Verifier(file));
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  const port = (server.address() as { port: number }).port;
  const base = `http://127.0.0.1:${port}`;
  try {
    const run = finishedRun('http-seed');
    const res = await fetch(`${base}/verify`, { method: 'POST', body: JSON.stringify({ replay: exportReplay(run), player: 'carol' }) });
    assert.equal(res.status, 200);
    const bad = await fetch(`${base}/verify`, { method: 'POST', body: JSON.stringify({ replay: { ...exportReplay(run), claimedScore: 999999 }, player: 'mallory' }) });
    assert.equal(bad.status, 422);
    const board = await (await fetch(`${base}/board?seed=http-seed`)).json() as { verified: boolean; entries: { player: string; score: number }[] };
    assert.equal(board.verified, true); assert.equal(board.entries.length, 1); assert.equal(board.entries[0].score, run.score);
    assert.equal((await fetch(`${base}/health`)).status, 200);
    const daily = await (await fetch(`${base}/daily`)).json() as { seed: string; verified: boolean; rulesVersion: number; entries: unknown[] };
    assert.equal(daily.seed, dailySeedFor(new Date())); assert.equal(daily.verified, true); assert.deepEqual(daily.entries, []);
    const health = await (await fetch(`${base}/health`)).json() as { entries: number; uptimeSec: number; version: string };
    assert.equal(health.entries, 1, 'health reports the number of verified entries');
    assert.equal(health.version, JSON.parse(fs.readFileSync('package.json', 'utf8')).version, 'health reports the package version');
    const hash = (board.entries[0] as unknown as { replayHash: string }).replayHash;
    const rep = await fetch(`${base}/replay?hash=${hash}`);
    assert.equal(rep.status, 200);
    const repBody = await rep.json() as { ok: boolean; hash: string; seed: string; actions: unknown[]; player: string; score: number };
    assert.equal(repBody.ok, true); assert.equal(repBody.seed, 'http-seed'); assert.equal(repBody.player, 'carol'); assert.equal(repBody.score, run.score); assert.deepEqual(repBody.actions, exportReplay(run).actions);
    assert.equal((await fetch(`${base}/replay?hash=nope`)).status, 404);
  } finally { server.closeAllConnections(); server.close(); }
});

test('rate limiter: fixed window per key, resets after the window', () => {
  let t = 1_000_000;
  const rl = new RateLimiter(3, 60_000, () => t);
  assert.deepEqual([rl.take('a').ok, rl.take('a').ok, rl.take('a').ok], [true, true, true]);
  const fourth = rl.take('a');
  assert.equal(fourth.ok, false); assert.ok(fourth.retryAfterSec >= 1 && fourth.retryAfterSec <= 60);
  assert.equal(rl.take('b').ok, true, 'other keys are independent');
  t += 60_001;
  assert.equal(rl.take('a').ok, true, 'window reset');
});

test('http: POST /verify is rate limited per client IP with Retry-After; GETs are not; CORS origin and proxy IP are configurable', async () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'jd-board-')), 'board.json');
  const logs: string[] = [];
  const server = createServer(new Verifier(file), { rateLimit: { limit: 2, windowMs: 60_000 }, corsOrigin: 'https://game.example', trustProxy: true, log: (l) => logs.push(l) });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  const port = (server.address() as { port: number }).port;
  const base = `http://127.0.0.1:${port}`;
  try {
    const run = finishedRun('rl-seed');
    const body = (claimed?: number) => JSON.stringify({ replay: { ...exportReplay(run), ...(claimed != null ? { claimedScore: claimed } : {}) }, player: 'eve' });
    const post = (ip: string, b = body()) => fetch(`${base}/verify`, { method: 'POST', headers: { 'X-Forwarded-For': ip }, body: b });
    assert.equal((await post('10.0.0.1')).status, 200);
    assert.equal((await post('10.0.0.1')).status, 422, 'duplicate replay is rejected but still counts');
    const limited = await post('10.0.0.1');
    assert.equal(limited.status, 429);
    assert.ok(Number(limited.headers.get('retry-after')) >= 1);
    assert.equal(limited.headers.get('access-control-allow-origin'), 'https://game.example');
    assert.equal((await post('10.0.0.2', body(1))).status, 422, 'a different client IP (via X-Forwarded-For, trustProxy) is not limited');
    for (let i = 0; i < 5; i++) assert.equal((await fetch(`${base}/board?seed=rl-seed`)).status, 200, 'GETs are never limited');
    const pre = await fetch(`${base}/verify`, { method: 'OPTIONS' });
    assert.equal(pre.status, 204); assert.equal(pre.headers.get('access-control-allow-origin'), 'https://game.example');
    assert.ok(logs.some((l) => / POST \/verify 429 /.test(l)), 'request log line for the limited call');
  } finally { server.closeAllConnections(); server.close(); }
  // without trustProxy the header is ignored
  const req = { headers: { 'x-forwarded-for': '10.9.9.9' }, socket: { remoteAddress: '127.0.0.1' } } as unknown as import('node:http').IncomingMessage;
  assert.equal(clientIp(req, false), '127.0.0.1'); assert.equal(clientIp(req, true), '10.9.9.9');
});

test('verifier bundles to a single file that exports the server pieces (what the Docker image runs)', async () => {
  const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'jd-verifier-')), 'verify.mjs');
  // esbuild's JS API: the CLI entry is a native binary on some platforms, which `node bin/esbuild` cannot run
  await esbuild({ entryPoints: ['server/verify.ts'], bundle: true, platform: 'node', format: 'esm', target: 'node20', outfile: out, logLevel: 'warning' });
  const mod = await import(`file://${out.replace(/\\\\/g, '/')}`) as { createServer: unknown; Verifier: unknown; RateLimiter: unknown };
  assert.equal(typeof mod.createServer, 'function'); assert.equal(typeof mod.Verifier, 'function'); assert.equal(typeof mod.RateLimiter, 'function');
  assert.ok(fs.statSync(out).size < 200_000, 'bundle stays small (sim + server only)');
});

test('retention: stored replays are kept only for each seed\'s top N entries; scores stay on the board', () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'jd-board-')), 'board.json');
  const v = new Verifier(file, { replaysPerSeed: 2 });
  // three legal runs with distinct scores for one seed: crusher placed (best), crusher sold (+$10), crusher left in the bin (starter only)
  const variant = (mode: 'place' | 'sell' | 'bin') => {
    const s = newRun('prune-seed');
    for (let r = 1; r <= RULES.rounds; r++) {
      apply(s, { t: 'pick', i: r === 1 ? s.offers.indexOf('crusher') : 0 });
      if (r === 1 && mode === 'place') { const conv = s.layout.machines.find((m) => m.x === 2 && m.y === 2)!; apply(s, { t: 'unplace', id: conv.id }); apply(s, { t: 'place', id: s.bin[0].id, x: 2, y: 2, dir: 0 }); }
      if (r === 1 && mode === 'sell') apply(s, { t: 'sell', id: s.bin[0].id });
      apply(s, { t: 'run' }); apply(s, { t: 'next' });
    }
    return s;
  };
  const best = v.submit(encodeReplay(exportReplay(variant('place'))), 'a'); const mid = v.submit(encodeReplay(exportReplay(variant('sell'))), 'b'); const low = v.submit(encodeReplay(exportReplay(variant('bin'))), 'c');
  assert.ok(best.ok && mid.ok && low.ok);
  assert.ok(best.score! > mid.score! && mid.score! > low.score!, `distinct scores ${best.score} > ${mid.score} > ${low.score}`);
  const board = v.board('prune-seed');
  assert.equal(board.length, 3, 'all three scores stay on the board');
  assert.deepEqual(board.map((e) => e.replayAvailable), [true, true, false], 'only the top 2 keep a stored replay');
  assert.equal(v.replay(low.entry!.replayHash), null);
  assert.ok(v.replay(best.entry!.replayHash) && v.replay(mid.entry!.replayHash));
  // persisted: a fresh instance reads the pruned file
  const again = new Verifier(file, { replaysPerSeed: 2 });
  assert.equal(again.replay(low.entry!.replayHash), null); assert.ok(again.replay(best.entry!.replayHash));
  assert.equal(new Verifier(path.join(path.dirname(file), 'x.json')).replaysPerSeed, 100, 'default matches the /board cap');
});

// ---- review findings (2026-10-26): each test below reproduces a reported failure and pins the fix

const listen = async (v: Verifier, opts = {}) => {
  const server = createServer(v, { log: null, ...opts });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  const port = (server.address() as { port: number }).port;
  return { server, base: `http://127.0.0.1:${port}`, port, close: () => { server.closeAllConnections(); server.close(); } };
};

test('malformed_url_does_not_kill_verifier: a request whose URL cannot be parsed gets 400 and the server keeps serving', async () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'jd-board-')), 'board.json');
  const { base, port, close } = await listen(new Verifier(file));
  try {
    const raw = await new Promise<string>((resolve, reject) => {
      const sock = net.connect(port, '127.0.0.1', () => sock.write('GET //[ HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n'));
      let data = ''; sock.on('data', (c) => { data += c; }); sock.on('end', () => resolve(data)); sock.on('error', reject);
      setTimeout(() => { sock.destroy(); resolve(data); }, 3000);
    });
    assert.match(raw, /^HTTP\/1\.1 400/, `expected a 400 for a malformed URL, got: ${raw.slice(0, 60)}`);
    assert.equal((await fetch(`${base}/health`)).status, 200, 'the process survived and still answers');
    // garbage at the HTTP level is answered with 400 by the clientError handler, not an unhandled parser error
    const junk = await new Promise<string>((resolve) => { const s = net.connect(port, '127.0.0.1', () => s.write('\x00\x01 NOT HTTP\r\n\r\n')); let d = ''; s.on('data', (c) => { d += c; }); s.on('close', () => resolve(d)); setTimeout(() => { s.destroy(); resolve(d); }, 3000); });
    assert.match(junk, /400|^$/);
    assert.equal((await fetch(`${base}/health`)).status, 200);
  } finally { close(); }
});

test('failed_persistence_preserves_previous_board: a write failure records nothing, answers 503, and the retry is not a duplicate', async () => {
  const blocker = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'jd-board-')), 'not-a-dir');
  fs.writeFileSync(blocker, 'x'); // the board's parent "directory" is a regular file, so mkdir/rename must fail
  const broken = new Verifier(path.join(blocker, 'board.json'));
  const run = finishedRun('persist-seed');
  assert.throws(() => broken.submit(encodeReplay(exportReplay(run)), 'pat'), StorageError);
  assert.equal(broken.size, 0, 'memory unchanged after the failed write');
  assert.equal(broken.board('persist-seed').length, 0);
  assert.throws(() => broken.submit(encodeReplay(exportReplay(run)), 'pat'), StorageError, 'second attempt fails the same way, not as a duplicate');
  const { base, close } = await listen(broken);
  try {
    const res = await fetch(`${base}/verify`, { method: 'POST', body: JSON.stringify({ replay: exportReplay(run), player: 'pat' }) });
    assert.equal(res.status, 503); assert.ok(res.headers.get('retry-after'));
    assert.equal(((await res.json()) as { ok: boolean }).ok, false);
    assert.equal((await fetch(`${base}/health`)).status, 200);
  } finally { close(); }
  // a working store accepts the very same replay: nothing leaked into a shared duplicate index
  const good = new Verifier(path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'jd-board-')), 'board.json'));
  assert.equal(good.submit(encodeReplay(exportReplay(run)), 'pat').ok, true);
  // the board file is written atomically: no temp files remain next to it
  assert.deepEqual(fs.readdirSync(path.dirname(good['file' as keyof Verifier] as unknown as string)).filter((f) => f.endsWith('.tmp')), []);
});

test('old_rules_board_is_not_current_verified_board: entries persisted under another rules version never rank, count or replay', () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'jd-board-')), 'board.json');
  const run = finishedRun('mixed-seed');
  const legacyHash = 'deadbeef';
  fs.writeFileSync(file, JSON.stringify({
    entries: [{ seed: 'mixed-seed', score: 999999, player: 'old', verifiedAt: '2026-01-01T00:00:00.000Z', rulesVersion: RULES_VERSION - 1, actions: 3, replayHash: legacyHash }],
    replays: { [legacyHash]: { seed: 'mixed-seed', rulesVersion: RULES_VERSION - 1, actions: [], score: 999999, player: 'old', verifiedAt: '2026-01-01T00:00:00.000Z' } },
  }));
  const v = new Verifier(file);
  assert.equal(v.size, 0, 'old entries are not counted as current');
  assert.equal(v.sizeAllVersions, 1, 'but they are still in the file');
  assert.deepEqual(v.board('mixed-seed'), [], 'old entries never enter the current board');
  assert.equal(v.replay(legacyHash), null, 'old replays are not served for playback');
  assert.equal(v.submit(encodeReplay(exportReplay(run)), 'new').ok, true);
  const board = v.board('mixed-seed');
  assert.equal(board.length, 1); assert.equal(board[0].player, 'new'); assert.equal(board[0].rulesVersion, RULES_VERSION);
  assert.equal(new Verifier(file).sizeAllVersions, 2, 'old rows survive on disk for a future migration');
});

test('bounds: query limits are finite integers clamped to [1, max]; limiter cardinality is capped; a damaged board file loads empty', async () => {
  assert.equal(clampInt('-1', 20, 100), 1); assert.equal(clampInt('0', 20, 100), 1); assert.equal(clampInt('abc', 20, 100), 20);
  assert.equal(clampInt('1e9', 20, 100), 100); assert.equal(clampInt('7.5', 20, 100), 20); assert.equal(clampInt('Infinity', 20, 100), 20); assert.equal(clampInt(null, 20, 100), 20);
  const rl = new RateLimiter(60, 60_000, () => 1_000_000, 100);
  for (let i = 0; i < 20_000; i++) rl.take(`ip-${i}`);
  assert.ok(rl.keys <= 100, `limiter keys bounded: ${rl.keys}`);
  assert.deepEqual(loadBoard('{not json'), { entries: [] });
  assert.deepEqual(loadBoard(JSON.stringify({ entries: [{ seed: 'x' }, null, 5], replays: { a: { nope: true } } })), { entries: [], replays: {} });
  // HTTP: limit=-1 and absurd limits never exceed the cap
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'jd-board-')), 'board.json');
  const { base, close } = await listen(new Verifier(file));
  try {
    for (const q of ['-1', '1e9', 'abc', '']) { const b = await (await fetch(`${base}/board?seed=x&limit=${q}`)).json() as { entries: unknown[] }; assert.ok(Array.isArray(b.entries) && b.entries.length <= 100); }
    assert.equal((await fetch(`${base}/daily?limit=-5`)).status, 200);
  } finally { close(); }
});

test('replay identity is SHA-256 of the canonical content; legacy 8-hex ids still resolve for playback', () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'jd-board-')), 'board.json');
  const run = finishedRun('id-seed');
  const r = exportReplay(run);
  assert.match(replayId(r), /^[0-9a-f]{64}$/);
  assert.notEqual(replayId(r), replayId({ ...r, actions: r.actions.slice(0, -1) }));
  assert.equal(replayId(r), replayId({ ...r, claimedScore: 0, createdAt: 'other' } as typeof r), 'identity ignores claimed score and timestamps');
  const legacy = 'abcd1234';
  fs.writeFileSync(file, JSON.stringify({ entries: [{ seed: 'legacy-seed', score: 300, player: 'old', verifiedAt: '2026-10-25T00:00:00.000Z', rulesVersion: RULES_VERSION, actions: 20, replayHash: legacy }], replays: { [legacy]: { seed: 'legacy-seed', rulesVersion: RULES_VERSION, actions: r.actions, score: 300, player: 'old', verifiedAt: '2026-10-25T00:00:00.000Z' } } }));
  const v = new Verifier(file);
  assert.equal(v.board('legacy-seed')[0]?.replayAvailable, true);
  assert.equal(v.replay(legacy)?.player, 'old');
  const e = v.submit(encodeReplay(r), 'new');
  assert.equal(e.ok, true); assert.match(e.entry!.replayHash, /^[0-9a-f]{64}$/);
});

test('events: POST /events accepts only consented batches from the fixed vocabulary, stores a salted IP hash, never a seed; GET /funnel counts installs per step; retention prunes old rows', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jd-events-'));
  const store = new EventStore(path.join(dir, 'events.jsonl'), 30);
  const server = createServer(new Verifier(path.join(dir, 'board.json')), { log: null, events: store, rateLimit: null });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  const port = (server.address() as net.AddressInfo).port;
  const post = async (body: unknown) => { const r = await fetch(`http://127.0.0.1:${port}/events`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); return { status: r.status, json: await r.json() as { ok: boolean; error?: string; stored?: number } }; };
  const id = 'a'.repeat(32), id2 = 'b'.repeat(32);
  const at = new Date().toISOString();
  try {
    let r = await post({ installId: id, events: [{ name: 'app_start', at }] });
    assert.equal(r.status, 422); assert.match(r.json.error!, /no consent/, 'events without explicit consent are refused');
    r = await post({ installId: id, consent: true, events: [{ name: 'layout_saved', at }] });
    assert.equal(r.status, 422); assert.match(r.json.error!, /unknown event/);
    r = await post({ installId: id, consent: true, events: [{ name: 'game_complete', props: { mode: 'seed', seed: 'my-secret-layout' }, at }] });
    assert.equal(r.status, 422); assert.match(r.json.error!, /seed strings are not recorded/, 'a seed that is not a daily/tutorial label is refused');
    r = await post({ installId: id, consent: true, events: [{ name: 'first_place_rejected', props: { why: 'x' }, at }] });
    assert.equal(r.status, 422); assert.match(r.json.error!, /not in the vocabulary/);
    r = await post({ installId: 'short', consent: true, events: [{ name: 'app_start', at }] });
    assert.equal(r.status, 422);
    r = await post({ installId: id, consent: true, events: [{ name: 'app_start', at }, { name: 'first_draft_pick', at }, { name: 'first_run_complete', props: { money: 38 }, at }, { name: 'daily_start', props: {}, at }] });
    assert.equal(r.status, 200); assert.equal(r.json.stored, 4);
    r = await post({ installId: id2, consent: true, events: [{ name: 'app_start', at }, { name: 'first_draft_pick', at }] });
    assert.equal(r.status, 200);
    const text = fs.readFileSync(store.file, 'utf8');
    assert.ok(!text.includes('127.0.0.1'), 'the client address is never stored');
    const rows = store.rows();
    assert.equal(rows.length, 6);
    assert.ok(rows.every((x) => /^[0-9a-f]{16}$/.test(x.ip)), 'ips are 16-hex daily-salted hashes');
    assert.equal(new Set(rows.map((x) => x.ip)).size, 1, 'the same client hashes to one key within a day');
    assert.notEqual(store.ipHash('127.0.0.1', new Date('2026-01-01')), store.ipHash('127.0.0.1', new Date('2026-01-02')), 'and to a different key on another day');
    const f = await (await fetch(`http://127.0.0.1:${port}/funnel`)).json() as { installs: number; steps: { name: string; installs: number }[]; counts: Record<string, number> };
    assert.equal(f.installs, 2);
    assert.deepEqual(f.steps.slice(0, 5).map((s) => [s.name, s.installs]), [['app_start', 2], ['first_draft_pick', 2], ['first_place_attempt', 0], ['first_run_start', 0], ['first_run_complete', 1]]);
    assert.equal(f.counts.daily_start, 1);
    // retention: a row received 40 days ago is pruned, fresh rows stay
    const old = { ...rows[0], receivedAt: new Date(Date.now() - 40 * 86_400_000).toISOString() };
    fs.appendFileSync(store.file, JSON.stringify(old) + '\n');
    assert.equal(store.rows().length, 7);
    assert.equal(store.prune(), 1);
    assert.equal(store.rows().length, 6);
    assert.equal(store.prune(), 0);
  } finally { server.close(); }
});

test('histogram (PLAN-v1 0.4.1): bins and percentile for 1, 4 and 200 entries; nice steps; the caller located by hash; never a fabricated population', async () => {
  const mk = (scores: number[]): BoardEntry[] => scores.slice().sort((a, b) => b - a).map((score, i) => ({ seed: 'h', score, player: `p${i}`, verifiedAt: new Date(2026, 0, 1, 0, 0, i).toISOString(), rulesVersion: RULES_VERSION, actions: 10, replayHash: `hash-${score}-${i}` }));
  assert.deepEqual(histogramOf([]), { n: 0, step: 1, bins: [], mine: null, around: [] }, 'no entries: empty, nothing invented');
  assert.deepEqual([niceStep(0), niceStep(3), niceStep(17), niceStep(42), niceStep(70), niceStep(230), niceStep(0.4)], [1, 5, 20, 50, 100, 250, 1]);
  // one entry: one bin that holds it, rank 1, percentile 0 (nobody to beat)
  const one = histogramOf(mk([228]), 'hash-228-0');
  assert.equal(one.n, 1); assert.equal(one.bins.reduce((a, b) => a + b.count, 0), 1); assert.deepEqual(one.mine, { score: 228, rank: 1, bin: one.bins.length - 1, percentile: 0 });
  assert.deepEqual(one.around, [{ rank: 1, player: 'p0', score: 228, mine: true }]);
  // four entries: the third-best beats one of three others
  const four = histogramOf(mk([2088, 1697, 1210, 400]), 'hash-1210-2');
  assert.equal(four.n, 4); assert.equal(four.mine?.rank, 3); assert.equal(four.mine?.percentile, 33);
  assert.equal(four.bins.reduce((a, b) => a + b.count, 0), 4, 'every entry lands in exactly one bin');
  assert.ok(four.bins.every((b) => b.to - b.from === four.step) && four.bins[0].from === 0, 'bins are contiguous from zero');
  assert.equal(four.around.length, 4); assert.equal(four.around.filter((a) => a.mine).length, 1);
  assert.equal(histogramOf(mk([1, 2, 3]), 'unknown').mine, null, 'an unknown hash gets no "mine" and no neighbours');
  // two hundred entries: percentile of the median is about 50, ties are not beaten, around has 11 rows
  const scores = Array.from({ length: 200 }, (_, i) => 100 + i * 10); scores[57] = scores[58]; // a tie
  const two = histogramOf(mk(scores), 'hash-' + scores[100] + '-99');
  assert.equal(two.n, 200); assert.ok(two.bins.length >= 8 && two.bins.length <= 12, `about ten nice bins (${two.bins.length} of ${two.step})`);
  assert.ok(two.mine && two.mine.percentile >= 48 && two.mine.percentile <= 51, `median percentile ${two.mine?.percentile}`);
  assert.equal(two.around.length, 11); assert.equal(two.around[5].mine, true);
  const tieHash = mk(scores).find((e) => e.score === scores[57] && e.player !== 'p0')!.replayHash;
  const tied = histogramOf(mk(scores), tieHash);
  assert.ok(tied.mine && tied.mine.percentile === Math.floor((100 * scores.filter((s) => s < scores[57]).length) / 199), 'a tied score does not count as beaten');
  // the route: a real verified entry shows up with mine located by its hash
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jd-hist-'));
  const v = new Verifier(path.join(dir, 'board.json'));
  const run = finishedRun('hist-seed'); const sub = v.submit(encodeReplay(exportReplay(run)), 'alice');
  const server = createServer(v, { log: null, rateLimit: null });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  const port = (server.address() as net.AddressInfo).port;
  try {
    const h = await (await fetch(`http://127.0.0.1:${port}/histogram?seed=hist-seed&hash=${sub.entry!.replayHash}`)).json() as { ok: boolean; n: number; mine: { rank: number; score: number } | null; seed: string };
    assert.equal(h.ok, true); assert.equal(h.seed, 'hist-seed'); assert.equal(h.n, 1); assert.deepEqual({ rank: h.mine?.rank, score: h.mine?.score }, { rank: 1, score: run.score });
    const empty = await (await fetch(`http://127.0.0.1:${port}/histogram?seed=nobody-played`)).json() as { n: number; bins: unknown[] };
    assert.deepEqual([empty.n, empty.bins], [0, []]);
  } finally { server.close(); }
});
