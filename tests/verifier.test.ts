import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Verifier, createServer, RateLimiter, clientIp, clampInt, replayId, loadBoard, StorageError, EventStore, histogramOf, niceStep, computeParSync, computeParInWorker, ParService, finalMachinesOf, TIE_BREAK, playerIdFromToken, RENAME_COOLDOWN_MS, roundsOf, type Board, type BoardEntry } from '../server/verify';
import { tagFor, nameProblem } from '../game/src/identity/identity';
import { build as esbuild } from 'esbuild';
import net from 'node:net';
import { createHash } from 'node:crypto';
import { RULES_VERSION } from '../game/src/sim/types';
import { apply, newRun } from '../game/src/sim/run';
import { encodeReplay, exportReplay } from '../game/src/sim/replay';
import { RULES } from '../game/src/sim/rules';
import { dailySeedFor, isDailySeed, isMintedDailySeed } from '../game/src/sim/daily';
import { mintSeed, commitmentFor } from '../server/mint';
import { medalThresholds, type Medals } from '../game/src/daily/medals';

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
  // daily: today's minted seed (PLAN-v3 0.6.1), only entries for that seed; the practice seed is an ordinary board
  const today = v.daily()!.seed;
  assert.ok(isMintedDailySeed(today) && !isDailySeed(today)); assert.ok(isDailySeed(dailySeedFor(new Date())));
  assert.deepEqual(v.daily()!.entries, []);
  assert.equal(v.submit(encodeReplay(exportReplay(finishedRun(today))), 'dana').ok, true);
  assert.equal(v.submit(encodeReplay(exportReplay(finishedRun(dailySeedFor(new Date())))), 'practice').ok, true);
  const daily = v.daily()!;
  assert.equal(daily.seed, today); assert.equal(daily.entries.length, 1); assert.equal(daily.entries[0].player, 'dana');
  assert.match(v.daily(10, new Date('2030-01-02T03:04:05Z'))!.seed, /^daily-2030-01-02-[a-z2-7]{8}$/, 'daily seed follows the UTC date');
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
    const board = await (await fetch(`${base}/board?seed=http-seed`)).json() as { verified: boolean; entries: { player: string; score: number; finalMachines?: number }[]; tieBreak?: string };
    assert.equal(board.verified, true); assert.equal(board.entries.length, 1); assert.equal(board.entries[0].score, run.score);
    assert.equal(board.tieBreak, TIE_BREAK, 'every board response states the tie rule'); assert.equal(typeof board.entries[0].finalMachines, 'number');
    assert.equal((await fetch(`${base}/health`)).status, 200);
    const daily = await (await fetch(`${base}/daily`)).json() as { seed: string; verified: boolean; minted: boolean; commitment: string; rulesVersion: number; entries: unknown[] };
    assert.match(daily.seed, /^daily-\d{4}-\d{2}-\d{2}-[a-z2-7]{8}$/); assert.equal(daily.verified, true); assert.equal(daily.minted, true); assert.match(daily.commitment, /^[0-9a-f]{64}$/); assert.deepEqual(daily.entries, []);
    const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
    assert.equal((await fetch(`${base}/daily?date=${tomorrow}`)).status, 403, 'tomorrow has not opened'); assert.equal((await fetch(`${base}/daily?date=nope`)).status, 400);
    // window and archive over HTTP (PLAN-v3 0.6.2): two days back closed at 00:00 UTC today
    const twoBack = new Date(Date.now() - 2 * 86_400_000).toISOString().slice(0, 10);
    const old = await (await fetch(`${base}/daily?date=${twoBack}`)).json() as { final: boolean; frozenAt: string | null; closesAt: string };
    assert.equal(old.final, true); assert.equal(old.frozenAt, old.closesAt);
    const arch = await (await fetch(`${base}/archive`)).json() as { ok: boolean; days: { date: string; n: number; frozenAt: string }[]; nextTo: string | null };
    const threeBack = new Date(Date.now() - 3 * 86_400_000).toISOString().slice(0, 10);
    assert.deepEqual(arch.days.map((x) => x.date), [twoBack, threeBack], 'the looked-up day and the previous day it issued for commitment checks, both closed'); assert.equal(arch.days[0].n, 0); assert.equal(arch.nextTo, null);
    assert.equal((await fetch(`${base}/archive?from=2030-1-1`)).status, 400);
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

test('malformed events body does not kill the verifier (review F01): an event without a name gets 422 and /health still answers', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jd-ev-'));
  const server = createServer(new Verifier(path.join(dir, 'board.json')), { events: new EventStore(path.join(dir, 'events.jsonl')), eventsRateLimit: 100 });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  try {
    const bodies = [
      { installId: 'a'.repeat(32), consent: true, events: [{}] },
      { installId: 'a'.repeat(32), consent: true, events: [{ name: null }] },
      { installId: 'a'.repeat(32), consent: true, events: [{ name: 7, props: 1, at: 2 }] },
      { installId: 'a'.repeat(32), consent: true, events: [{ name: { toString: 1 } }] },
      { installId: 'a'.repeat(32), consent: true, events: ['app_start'] },
      [], 'x', 1,
    ];
    for (const b of bodies) {
      const res = await fetch(`${base}/events`, { method: 'POST', body: JSON.stringify(b), headers: { 'Content-Type': 'application/json' } });
      assert.ok(res.status >= 400 && res.status < 500, `${JSON.stringify(b)} → ${res.status}`);
      const text = await res.text(); assert.ok(text.length < 400, 'error bodies are bounded');
    }
    const verifyBodies = ['null', '[]', '"replay"', '{"replay":null}', '{"replay":{"format":1}}', '{"replay":5,"player":{}}'];
    for (const b of verifyBodies) { const res = await fetch(`${base}/verify`, { method: 'POST', body: b }); assert.ok(res.status >= 400 && res.status < 500, `/verify ${b} → ${res.status}`); }
    assert.equal((await fetch(`${base}/health`)).status, 200, 'the server is still serving');
  } finally { server.closeAllConnections(); server.close(); }
});

test('replay identity is canonical (review F03): the same actions with permuted JSON keys hash identically and a second submission is a duplicate', () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'jd-canon-')), 'board.json');
  const v = new Verifier(file);
  const run = finishedRun('canon-seed');
  const rep = exportReplay(run);
  const permuted = { ...rep, actions: rep.actions.map((a) => Object.fromEntries(Object.entries(a).reverse())) };
  assert.notEqual(JSON.stringify(permuted.actions), JSON.stringify(rep.actions), 'the permutation changes the raw JSON');
  const first = v.submit(JSON.stringify(rep), 'a'); assert.equal(first.ok, true);
  const second = v.submit(JSON.stringify(permuted), 'b');
  assert.equal(second.ok, false); assert.match(second.error ?? '', /duplicate/);
  assert.equal(v.size, 1, 'one entry, not two');
  const stored = v.replay(first.entry!.replayHash)!;
  assert.deepEqual(stored.actions, rep.actions.map((a) => ({ t: a.t, ...Object.fromEntries(Object.entries(a).filter(([k]) => k !== 't')) })), 'stored actions are canonical');
});

test('accepted submissions keep cached bot pars (review F08), across a restart from the file', () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'jd-pars-')), 'board.json');
  const v = new Verifier(file);
  v.setPar('par-a', 123, 5, 40); v.setPar('par-b', 456, 5, 40);
  const run = finishedRun('par-a');
  assert.equal(v.submit(JSON.stringify(exportReplay(run)), 'p').ok, true);
  assert.deepEqual([v.par('par-a'), v.par('par-b')], [123, 456], 'pars survive a submission in memory');
  const again = new Verifier(file);
  assert.deepEqual([again.par('par-a'), again.par('par-b')], [123, 456], 'and in the persisted file');
});

test('tie-breaker (PLAN-v2 0.5.5): equal scores rank by fewer round-6 machines, then earlier receipt; derived by the verifier and never from a payload; legacy entries derive at startup or rank last; histogram agrees with the board', () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'jd-tie-')), 'board.json');
  const v = new Verifier(file);
  // the untouched starter line always earns $228: three runs with 5, 6 and 7 machines on the grid at the end (extra parts parked where they do nothing)
  const park: [number, number][] = [[6, 0], [6, 5]];
  const mk = (extra: number, twist = false) => {
    const s = newRun('tie-seed');
    for (let r = 1; r <= RULES.rounds; r++) {
      apply(s, { t: 'pick', i: 0 });
      if (r === RULES.rounds) for (let k = 0; k < extra; k++) apply(s, { t: 'place', id: s.bin[k].id, x: park[k][0], y: park[k][1], dir: 0 });
      if (twist && r === 1) apply(s, { t: 'rotate', id: s.bin[0].id }); // a different replay with the same outcome
      apply(s, { t: 'run' }); apply(s, { t: 'next' });
    }
    return s;
  };
  const seven = mk(2), six = mk(1), five = mk(0), fiveLater = mk(0, true);
  for (const s of [seven, six, five, fiveLater]) assert.equal(s.score, 228);
  // submitted in the order 7, 6, 5, 5-later: receipt order would put 7 first, the comparator puts fewer machines first
  assert.equal(v.submit(JSON.stringify(exportReplay(seven)), 'seven').ok, true);
  assert.equal(v.submit(JSON.stringify(exportReplay(six)), 'six').ok, true);
  const r5 = v.submit(JSON.stringify(exportReplay(five)), 'five'); assert.equal(r5.ok, true);
  assert.equal(v.submit(JSON.stringify(exportReplay(fiveLater)), 'five-later').ok, true);
  const board = v.board('tie-seed');
  assert.deepEqual(board.map((e) => [e.player, e.finalMachines]), [['five', 5], ['five-later', 5], ['six', 6], ['seven', 7]]);
  assert.equal(finalMachinesOf(exportReplay(six)), 6);
  // a forged field in the submission is ignored: the stored value is derived
  const forgedReplay = { ...exportReplay(mk(1, true)), finalMachines: 1 } as unknown as object;
  const rf = v.submit(JSON.stringify(forgedReplay), 'forger'); assert.equal(rf.ok, true); assert.equal(rf.entry!.finalMachines, 6, 'derived from the replay, not the payload');
  // the histogram's rank for an entry equals its board position
  const hg = v.histogram('tie-seed', r5.entry!.replayHash);
  assert.equal(hg.mine!.rank, board.findIndex((e) => e.replayHash === r5.entry!.replayHash) + 1);
  assert.deepEqual(hg.around.map((a) => a.player).slice(0, 2), ['five', 'five-later'], 'neighbours come from the same comparator');
  // legacy entries: strip finalMachines from the file; one keeps its stored replay (derived at startup), one loses it (ranks last among equals)
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  for (const e of raw.entries) delete e.finalMachines;
  const lost = raw.entries.find((e: { player: string }) => e.player === 'five');
  delete raw.replays[lost.replayHash];
  fs.writeFileSync(file, JSON.stringify(raw));
  const again = new Verifier(file);
  const b2 = again.board('tie-seed');
  assert.deepEqual(b2.map((e) => e.player), ['five-later', 'six', 'forger', 'seven', 'five'], 'derived entries rank by machines; the one without a replay ranks last among the $228s');
  assert.equal(b2.find((e) => e.player === 'five-later')!.finalMachines, 5, 'derived at startup from the stored replay');
  assert.equal(b2.find((e) => e.player === 'five')!.finalMachines, undefined);
  const persisted = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(persisted.entries.find((e: { player: string }) => e.player === 'six').finalMachines, 6, 'the derivation was written back');
  assert.ok(TIE_BREAK.includes('round 6'));
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
    assert.match(pre.headers.get('access-control-allow-headers') ?? '', /Authorization/, 'a cross-origin page may send the identity bearer (PLAN-v3 0.6.0)'); assert.match(pre.headers.get('access-control-allow-methods') ?? '', /DELETE/, 'DELETE /me is reachable cross-origin');
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

test('docker layout bundles (review F06): the verifier builds from exactly the paths the Dockerfile copies, minus .dockerignore', async () => {
  const ROOT = process.cwd();
  const dockerfile = fs.readFileSync(path.join(ROOT, 'Dockerfile'), 'utf8');
  // COPY <src>... <dest>: several sources may share one destination (package.json package-lock.json ./)
  const copies = [...dockerfile.matchAll(/^COPY (?!--from)(.+)$/gm)].flatMap((m) => { const parts = m[1].trim().split(/\s+/); const dest = parts.pop()!; return parts.map((src) => ({ src, dest })); });
  assert.ok(copies.some((c) => c.src === 'server'), 'the Dockerfile copies the server');
  const ignore = fs.readFileSync(path.join(ROOT, '.dockerignore'), 'utf8').split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
  const ignored = (rel: string) => {
    let out = false;
    for (const rule of ignore) {
      const neg = rule.startsWith('!'); const pat = (neg ? rule.slice(1) : rule).replace(/\/\*$/, '/__CHILDREN__');
      let hit: boolean;
      if (pat.endsWith('/__CHILDREN__')) { const dir = pat.slice(0, -'/__CHILDREN__'.length); hit = rel.startsWith(dir + '/'); }
      else hit = rel === pat || rel.startsWith(pat + '/');
      if (hit) out = !neg;
    }
    return out;
  };
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'jd-docker-'));
  const copyTree = (srcRel: string, destRel: string) => {
    const src = path.join(ROOT, srcRel);
    if (fs.statSync(src).isFile()) { if (ignored(srcRel)) return; fs.mkdirSync(path.dirname(path.join(tmp, destRel)), { recursive: true }); fs.copyFileSync(src, path.join(tmp, destRel)); return; }
    for (const name of fs.readdirSync(src)) copyTree(path.posix.join(srcRel, name), path.posix.join(destRel, name));
  };
  for (const c of copies) { if (!fs.existsSync(path.join(ROOT, c.src))) continue; const destRel = c.dest.replace(/^\.\//, ''); copyTree(c.src, destRel === '' || destRel.endsWith('/') ? path.posix.join(destRel, path.posix.basename(c.src)) : destRel); } // COPY x ./ lands x inside the directory
  assert.ok(fs.existsSync(path.join(tmp, 'server', 'verify.ts')) && !fs.existsSync(path.join(tmp, 'tests')), 'only the copied paths exist in the image layout');
  const r = await esbuild({ entryPoints: [path.join(tmp, 'server', 'verify.ts')], bundle: true, platform: 'node', format: 'esm', write: false, logLevel: 'silent', absWorkingDir: tmp });
  assert.equal(r.errors.length, 0, 'the verifier bundles from the image layout');
  assert.ok(r.outputFiles[0].text.length > 10_000);
});

test('bot par admission is bounded (review F07): queue cap with today\'s seed first, failure memory expires and is capped, cached pars are capped', async () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'jd-par-cap-')), 'board.json');
  const v = new Verifier(file, { maxSeeds: 3 });
  let release: ((n: number) => void) | null = null;
  const blocked = () => new Promise<number>((res) => { release = res; });
  let now = 1_000_000;
  const svc = new ParService(v, () => blocked(), 60_000, () => now, { maxQueue: 3, maxFailures: 4 });
  assert.equal(svc.request('busy'), true); // runs now
  const admitted = ['a', 'b', 'c', 'd', 'e', 'f'].map((s) => svc.request(s));
  assert.deepEqual(admitted, [true, true, true, false, false, false], 'three queued behind the running job, the rest refused');
  assert.equal(svc.queued, 3);
  assert.equal(svc.request('a'), false, 'duplicates are not admitted twice');
  assert.equal(svc.request(dailySeedFor(new Date()), true), true, 'today\'s seed is admitted even when the queue is full');
  assert.equal(svc.queued, 3, 'it displaced the last ordinary seed');
  assert.equal(v.par('a'), null, 'reads answer immediately while work is pending');
  // failures: each refused compute is remembered, expires after the cooldown, and the memory is capped
  const failing = new ParService(v, () => Promise.reject(new Error('no')), 60_000, () => now, { maxQueue: 50, maxFailures: 4 });
  for (const s of ['f1', 'f2', 'f3', 'f4', 'f5', 'f6']) { failing.request(s); await new Promise((r) => setTimeout(r, 0)); await new Promise((r) => setTimeout(r, 0)); }
  assert.ok(failing.failures <= 4, `failure memory capped (${failing.failures})`);
  assert.equal(failing.request('f6'), false, 'a fresh failure is not retried inside the cooldown');
  now += 61_000;
  assert.equal(failing.request('f6'), true, 'after the cooldown it may be retried');
  // cached pars never exceed maxSeeds (oldest dropped)
  v.setPar('p1', 1, 1, 1); v.setPar('p2', 2, 1, 1); v.setPar('p3', 3, 1, 1); v.setPar('p4', 4, 1, 1);
  assert.equal(v.parCount, 3); assert.equal(v.par('p1'), null, 'the oldest cached par was evicted'); assert.equal(v.par('p4'), 4);
  release!(0);
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
  assert.ok(JSON.parse(fs.readFileSync(file, 'utf8')).replays[legacyHash], 'and so does the old replay: pruning never drops the replays of another version, so a rollback keeps them (PLAN-v2 0.5.6)');
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

test('bot par (PLAN-v1 0.4.5): deterministic across runs and threads, computed off the request path, never blocks a submission, backs off after a failure', async () => {
  const a = computeParSync('par-seed', 3, 12); const b = computeParSync('par-seed', 3, 12);
  assert.equal(a, b, 'the same seed gives the same par in the same process');
  assert.ok(a > 0);
  const viaWorker = await computeParInWorker('par-seed', 60_000, 3, 12);
  assert.equal(viaWorker, a, 'a worker thread (fresh module instance) computes the identical par');
  // a service with a par job that hangs: the submission path is unaffected, the histogram says null meanwhile
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jd-par-'));
  const v = new Verifier(path.join(dir, 'board.json'));
  let release: ((n: number) => void) | null = null; const calls: string[] = [];
  const slow = new ParService(v, (seed) => { calls.push(seed); return new Promise<number>((res) => { release = res; }); }, 1000, () => Date.now());
  const server = createServer(v, { log: null, rateLimit: null, par: slow });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  const port = (server.address() as net.AddressInfo).port;
  try {
    const h0 = await (await fetch(`http://127.0.0.1:${port}/histogram?seed=hang-seed`)).json() as { botPar: number | null };
    assert.equal(h0.botPar, null, 'unknown until computed'); assert.deepEqual(calls, ['hang-seed'], 'the first request started one job');
    await fetch(`http://127.0.0.1:${port}/histogram?seed=hang-seed`); assert.equal(calls.length, 1, 'repeat requests do not start another job');
    const run = finishedRun('hang-seed');
    const t0 = Date.now();
    const r = await fetch(`http://127.0.0.1:${port}/verify`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ replay: exportReplay(run), player: 'alice' }) });
    assert.equal(r.status, 200); assert.ok(Date.now() - t0 < 1500, 'a hanging par job does not delay a submission');
    release!(1234);
    await new Promise((res) => setTimeout(res, 30));
    const h1 = await (await fetch(`http://127.0.0.1:${port}/histogram?seed=hang-seed`)).json() as { botPar: number | null; n: number };
    assert.deepEqual({ botPar: h1.botPar, n: h1.n }, { botPar: 1234, n: 1 }, 'the par lands once the job finishes and is stored');
    assert.equal(new Verifier(path.join(dir, 'board.json')).par('hang-seed'), 1234, 'pars persist in the board file');
    const d = await (await fetch(`http://127.0.0.1:${port}/daily`)).json() as { botPar: number | null };
    assert.ok('botPar' in d, '/daily carries the par (null while the daily seed computes)');
  } finally { server.close(); }
  // a failing job backs off: one attempt, then nothing until the cooldown passes
  let now = 1_000_000; let attempts = 0;
  const failing = new ParService(new Verifier(path.join(dir, 'b2.json')), () => { attempts++; return Promise.reject(new Error('boom')); }, 5000, () => now);
  failing.request('f'); await new Promise((res) => setTimeout(res, 10)); failing.request('f'); await new Promise((res) => setTimeout(res, 10));
  assert.equal(attempts, 1, 'no retry inside the cooldown');
  now += 6000; failing.request('f'); await new Promise((res) => setTimeout(res, 10));
  assert.equal(attempts, 2, 'retried after the cooldown');
});

// ---- identity without passwords (PLAN-v3 0.6.0) ----
test('identity: claim, rename within the cooldown refused, same name idempotent, refusals, renames follow the player onto the board; legacy anonymous entries untouched', () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'jd-id-')), 'board.json');
  const v = new Verifier(file);
  const token = 'a'.repeat(32), other = 'b'.repeat(32);
  const id = playerIdFromToken(token)!, id2 = playerIdFromToken(other)!;
  assert.match(id, /^[0-9a-f]{64}$/); assert.notEqual(id, id2); assert.equal(playerIdFromToken('xyz'), null); assert.equal(playerIdFromToken(undefined), null);
  assert.equal(tagFor(id), tagFor(id), 'tag is a pure function of the id');
  const t0 = new Date('2026-10-30T10:00:00Z');
  const c1 = v.claim(id, '  Jon  ', t0); assert.ok(c1.ok); if (c1.ok) { assert.equal(c1.player.name, 'Jon'); assert.equal(c1.player.tag, tagFor(id)); }
  assert.deepEqual(v.claim(id, 'Jon', new Date(t0.getTime() + 1000)), c1, 'claiming the same name again is idempotent and never counts as a rename');
  const early = v.claim(id, 'Jonathan', new Date(t0.getTime() + 60_000)); assert.equal(early.ok, false); if (!early.ok) { assert.match(early.error, /recently/); assert.ok(early.retryAfterSec! > 80_000); }
  for (const bad of ['', 'J', 'adm1n', 'the Official one', 42]) { const r = v.claim(id2, bad, t0); assert.equal(r.ok, false, `refused: ${String(bad)}`); }
  // a legacy anonymous entry and a claimed one on the same seed
  const run = finishedRun('id-seed');
  assert.equal(v.submit(JSON.stringify(exportReplay(run)), 'legacy name').ok, true);
  const s = newRun('id-seed'); for (let r = 1; r <= RULES.rounds; r++) { apply(s, { t: 'pick', i: 0 }); apply(s, { t: 'run' }); apply(s, { t: 'next' }); }
  const mine = v.submit(JSON.stringify(exportReplay(s)), 'ignored when claimed', id);
  assert.equal(mine.ok, true); assert.equal(mine.player, `Jon#${tagFor(id)}`); assert.equal(mine.entry!.playerId, id); assert.equal(mine.recorded, true);
  const legacy = v.board('id-seed').find((e) => e.player === 'legacy name')!;
  assert.equal(legacy.playerId, undefined, 'legacy entries carry no player id and are never claimable');
  const late = v.claim(id, 'Jonathan', new Date(t0.getTime() + RENAME_COOLDOWN_MS + 1)); assert.ok(late.ok);
  assert.deepEqual(new Verifier(file).board('id-seed').map((e) => e.player).sort(), [`Jonathan#${tagFor(id)}`, 'legacy name'], 'the rename followed the player onto the persisted board; the legacy entry kept its name');
  // deletion: the name goes, the entries are anonymised, the replay is gone, the id is forgotten
  assert.equal(v.deletePlayer(id).entries, 1);
  assert.equal(v.player(id), null); assert.equal(v.replay(mine.entry!.replayHash), null);
  assert.deepEqual(v.board('id-seed').map((e) => [e.player, e.playerId]).sort(), [['deleted', undefined], ['legacy name', undefined]]);
});

test('identity: keep-best per (seed, player): a better run replaces the entry and its replay, an equal or worse run is verified but not recorded; two players keep separate entries', () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'jd-kb-')), 'board.json');
  const v = new Verifier(file);
  const id = playerIdFromToken('c'.repeat(32))!, id2 = playerIdFromToken('d'.repeat(32))!;
  v.claim(id, 'Ann'); v.claim(id2, 'Bob');
  const park: [number, number][] = [[6, 0], [6, 5]];
  const mk = (extra: number, twist = false) => { const s = newRun('kb-seed'); for (let r = 1; r <= RULES.rounds; r++) { apply(s, { t: 'pick', i: 0 }); if (r === RULES.rounds) for (let k = 0; k < extra; k++) apply(s, { t: 'place', id: s.bin[k].id, x: park[k][0], y: park[k][1], dir: 0 }); if (twist && r === 1) apply(s, { t: 'rotate', id: s.bin[0].id }); apply(s, { t: 'run' }); apply(s, { t: 'next' }); } return s; };
  const seven = mk(2), five = mk(0), six = mk(1), fiveAgain = mk(0, true);
  const r1 = v.submit(JSON.stringify(exportReplay(seven)), 'x', id); assert.equal(r1.recorded, true);
  const r2 = v.submit(JSON.stringify(exportReplay(five)), 'x', id); // same score, fewer machines: better under the tie rule
  assert.equal(r2.recorded, true); assert.equal(v.board('kb-seed').length, 1); assert.equal(v.board('kb-seed')[0].replayHash, r2.entry!.replayHash);
  assert.equal(v.replay(r1.entry!.replayHash), null, 'the replaced replay is gone'); assert.ok(v.replay(r2.entry!.replayHash));
  const r3 = v.submit(JSON.stringify(exportReplay(six)), 'x', id); // worse: verified, not recorded, the kept entry is returned
  assert.equal(r3.ok, true); assert.equal(r3.recorded, false); assert.equal(r3.entry!.replayHash, r2.entry!.replayHash); assert.equal(v.board('kb-seed').length, 1);
  const r4 = v.submit(JSON.stringify(exportReplay(fiveAgain)), 'x', id); // equal: the earlier receipt stays
  assert.equal(r4.ok, true); assert.equal(r4.recorded, false); assert.equal(v.board('kb-seed')[0].replayHash, r2.entry!.replayHash);
  assert.equal(v.submit(JSON.stringify(exportReplay(fiveAgain)), 'x', id).ok, true, 'not recorded, so not a duplicate either');
  const r5 = v.submit(JSON.stringify(exportReplay(six)), 'x', id2); assert.equal(r5.recorded, true);
  assert.deepEqual(v.board('kb-seed').map((e) => e.player.split('#')[0]), ['Ann', 'Bob'], 'two players, two entries');
  const anon = v.submit(JSON.stringify(exportReplay(seven)), 'anon'); assert.equal(anon.ok, true, 'a replaced replay is no longer on the board, so an anonymous resubmission is a new (anonymous) entry'); assert.equal(anon.entry!.playerId, undefined);
});

test('http identity: POST/GET /identity, bearer on /verify, DELETE /me, 401 on a malformed bearer, per-player bucket, protocol 2 in /health, the token never reaches the log', async () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'jd-idhttp-')), 'board.json');
  const logs: string[] = [];
  let now = Date.parse('2026-10-30T10:00:00Z');
  const { base, close } = await listen(new Verifier(file), { rateLimit: null, log: (l: string) => logs.push(l), now: () => now, playerRateLimit: 2 });
  const token = 'e'.repeat(32);
  const auth = { Authorization: `Bearer ${token}` };
  const call = async (method: string, p: string, body?: unknown, headers: Record<string, string> = auth) => { const r = await fetch(`${base}${p}`, { method, headers: { 'Content-Type': 'application/json', ...headers }, body: body === undefined ? undefined : JSON.stringify(body) }); return { status: r.status, json: await r.json() as Record<string, unknown>, retry: r.headers.get('retry-after') }; };
  try {
    assert.equal(((await call('GET', '/health', undefined, {})).json as { protocol: number }).protocol, 2);
    assert.equal((await call('GET', '/identity', undefined, {})).status, 401, 'no bearer');
    assert.equal((await call('GET', '/identity', undefined, { Authorization: 'Bearer nope' })).status, 401, 'malformed bearer');
    const none = await call('GET', '/identity'); assert.equal(none.status, 404); assert.match(String(none.json.tag), /^[A-Z2-9]{4}$/, 'the tag is known before any claim');
    const bad = await call('POST', '/identity', { name: 'adm1n' }); assert.equal(bad.status, 422);
    const ok = await call('POST', '/identity', { name: 'Eve ' }); assert.equal(ok.status, 200); assert.equal(ok.json.name, 'Eve'); assert.equal(ok.json.playerId, playerIdFromToken(token));
    const got = await call('GET', '/identity'); assert.equal(got.status, 200); assert.equal(got.json.name, 'Eve');
    const soon = await call('POST', '/identity', { name: 'Evelyn' }); assert.equal(soon.status, 429); assert.ok(Number(soon.retry) > 0, 'rename cooldown with Retry-After');
    // submissions with the bearer carry the label and the id; the per-player bucket is 2/min
    const run = finishedRun('http-id');
    const sub = await call('POST', '/verify', { replay: exportReplay(run), player: 'ignored' });
    assert.equal(sub.status, 200); assert.equal(sub.json.player, `Eve#${ok.json.tag}`); assert.equal((sub.json.entry as { playerId: string }).playerId, playerIdFromToken(token)); assert.equal(sub.json.recorded, true);
    assert.equal((await call('POST', '/verify', { replay: exportReplay(run) })).status, 422, 'duplicate (second call in the bucket)');
    const limited = await call('POST', '/verify', { replay: exportReplay(run) }); assert.equal(limited.status, 429); assert.match(String(limited.json.error), /per player/);
    now += 61_000;
    assert.equal((await call('POST', '/verify', { replay: exportReplay(run) })).status, 422, 'bucket refilled after a minute');
    const board = (await call('GET', '/board?seed=http-id', undefined, {})).json as { entries: BoardEntry[] };
    assert.equal(board.entries.length, 1); assert.equal(board.entries[0].player, `Eve#${ok.json.tag}`);
    // deletion
    const del = await call('DELETE', '/me'); assert.equal(del.status, 200); assert.equal(del.json.anonymisedEntries, 1);
    assert.equal((await call('GET', '/identity')).status, 404);
    assert.equal(((await call('GET', '/board?seed=http-id', undefined, {})).json as { entries: BoardEntry[] }).entries[0].player, 'deleted');
    assert.ok(logs.length > 5 && logs.every((l) => !l.includes(token) && !l.includes('Bearer')), 'the bearer token is absent from every log line');
  } finally { close(); }
});

// ---- minted daily with a published commitment (PLAN-v3 0.6.1) ----
test('minted daily: seeds differ per date and per secret; the commitment published on D is the hash of the seed served on D+1; tomorrow is refused; forged, practice and closed submissions never reach the daily board; a secret rotation keeps issued days', () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'jd-mint-')), 'board.json');
  const v = new Verifier(file, { dailySecret: 'secret-one' });
  const d1 = new Date('2030-01-02T03:04:05Z'), d2 = new Date('2030-01-03T00:00:01Z');
  const a = v.daily(10, d1)!;
  assert.ok(isMintedDailySeed(a.seed)); assert.equal(a.date, '2030-01-02'); assert.equal(a.seed, mintSeed('secret-one', '2030-01-02'));
  assert.equal(a.closesAt, '2030-01-04T00:00:00.000Z', '48 h window from 00:00 UTC'); assert.equal(a.issuedAt, d1.toISOString());
  assert.notEqual(mintSeed('secret-one', '2030-01-03'), a.seed, 'per date'); assert.notEqual(mintSeed('secret-two', '2030-01-02'), a.seed, 'per secret');
  assert.equal(mintSeed('secret-one', '2030-01-02'), a.seed, 'deterministic');
  assert.throws(() => mintSeed('secret-one', '2030-13-45'), /bad date/); assert.throws(() => mintSeed('', '2030-01-02'));
  assert.equal(v.daily(10, d1, '2030-01-03'), null, 'tomorrow has not opened'); assert.equal(v.daily(10, d1, 'junk'), null);
  const b = v.daily(10, d2)!;
  assert.equal(commitmentFor(b.seed), a.commitment, 'the commitment published on day D is the hash of the seed served on D+1');
  assert.deepEqual(b.previous, { date: a.date, seed: a.seed, commitment: a.commitment }, 'yesterday travels with today for verification');
  assert.equal(v.daily(10, d2, '2030-01-02')!.seed, a.seed, 'a past day is served from its stored record');
  assert.equal(new Verifier(file, { dailySecret: 'secret-one' }).daily(10, d2, '2030-01-02')!.issuedAt, d1.toISOString(), 'records persist');
  // submissions: minted counts, practice is an ordinary board, forged is refused, closed is refused
  const twist = (seed: string) => { const s = newRun(seed); for (let r = 1; r <= RULES.rounds; r++) { const i = s.offers.indexOf('crusher'); apply(s, { t: 'pick', i: i >= 0 ? i : 0 }); if (r === 1) { const conv = s.layout.machines.find((m) => m.x === 2 && m.y === 2)!; apply(s, { t: 'unplace', id: conv.id }); apply(s, { t: 'place', id: s.bin[0].id, x: 2, y: 2, dir: 0 }); } if (r === 2) apply(s, { t: 'rotate', id: s.bin[0].id }); apply(s, { t: 'run' }); apply(s, { t: 'next' }); } return s; };
  assert.equal(v.submit(JSON.stringify(exportReplay(finishedRun(a.seed))), 'ranked', null, d1).ok, true);
  assert.equal(v.submit(JSON.stringify(exportReplay(finishedRun(dailySeedFor(d1)))), 'practice', null, d1).ok, true, 'the practice seed verifies as an ordinary seed board');
  assert.deepEqual(v.daily(10, d1)!.entries.map((e) => e.player), ['ranked'], 'the practice run never reaches the daily board');
  assert.equal(v.board(dailySeedFor(d1)).length, 1, 'but it is on its own seed board');
  const forged = v.submit(JSON.stringify(exportReplay(finishedRun('daily-2030-01-02-zzzzzzzz'))), 'forger', null, d1);
  assert.equal(forged.ok, false); assert.match(forged.error!, /not an issued daily seed/);
  const late = v.submit(JSON.stringify(exportReplay(twist(a.seed))), 'late', null, new Date('2030-01-04T00:00:00Z'));
  assert.equal(late.ok, true); assert.equal(late.late, true, 'after the close a run is verified but answered late (0.6.2)'); assert.equal(late.recorded, false); assert.equal(late.closesAt, '2030-01-04T00:00:00.000Z');
  assert.deepEqual(v.daily(10, d1)!.entries.map((e) => e.player), ['ranked'], 'and never joins the board');
  assert.equal(v.submit(JSON.stringify(exportReplay(twist(a.seed))), 'in time', null, new Date('2030-01-03T23:59:59Z')).ok, true, 'one second before the close is fine');
  // rotation: issued days keep their stored seed; unissued days mint from the new secret
  const rotated = new Verifier(file, { dailySecret: 'secret-two' });
  assert.equal(rotated.daily(10, d2, '2030-01-02')!.seed, a.seed, 'issued days keep their stored seed across a secret rotation');
  assert.equal(rotated.daily(10, d2)!.seed, b.seed, 'so does the current day');
  const d4 = new Date('2030-01-05T01:00:00Z');
  assert.equal(rotated.daily(10, d4)!.seed, mintSeed('secret-two', '2030-01-05'), 'new days mint from the new secret');
  assert.notEqual(rotated.daily(10, d4)!.seed, mintSeed('secret-one', '2030-01-05'));
});

// ---- the 48-hour window, freeze and archive (PLAN-v3 0.6.2) ----
const twistRun = (seed: string) => { const s = newRun(seed); for (let r = 1; r <= RULES.rounds; r++) { const i = s.offers.indexOf('crusher'); apply(s, { t: 'pick', i: i >= 0 ? i : 0 }); if (r === 1) { const conv = s.layout.machines.find((m) => m.x === 2 && m.y === 2)!; apply(s, { t: 'unplace', id: conv.id }); apply(s, { t: 'place', id: s.bin[0].id, x: 2, y: 2, dir: 0 }); } if (r === 2) apply(s, { t: 'rotate', id: s.bin[0].id }); apply(s, { t: 'run' }); apply(s, { t: 'next' }); } return s; };
test('daily window: closes 48 h after 00:00 UTC; freeze flips exactly at the boundary, is idempotent and survives a restart; late runs are verified, answered late and never ranked; the archive lists frozen days newest first, paged; a day\'s par survives the cap', () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'jd-freeze-')), 'board.json');
  const v = new Verifier(file, { dailySecret: 'freeze-secret' });
  const D = '2030-03-10'; const open = new Date('2030-03-11T23:59:59Z'), at = new Date('2030-03-12T00:00:00Z'), later = new Date('2030-03-13T05:00:00Z');
  const rec = v.daily(10, open, D)!;
  assert.equal(rec.closesAt, '2030-03-12T00:00:00.000Z', 'closesAt = D+2 00:00Z'); assert.equal(rec.final, false); assert.equal(rec.frozenAt, null); assert.equal(rec.now, open.toISOString());
  const first = v.submit(JSON.stringify(exportReplay(finishedRun(rec.seed))), 'early', null, open); assert.equal(first.ok, true); assert.equal(first.recorded, true);
  assert.equal(v.daily(10, new Date(at.getTime() - 1), D)!.final, false, 'one millisecond before the close the board is provisional');
  const frozen = v.daily(10, at, D)!; assert.equal(frozen.final, true); assert.equal(frozen.frozenAt, '2030-03-12T00:00:00.000Z', 'freeze flips exactly at the boundary and records the close time');
  assert.equal(v.daily(10, later, D)!.frozenAt, '2030-03-12T00:00:00.000Z', 'idempotent');
  assert.equal(new Verifier(file, { dailySecret: 'freeze-secret' }).daily(10, later, D)!.frozenAt, '2030-03-12T00:00:00.000Z', 'survives a restart');
  const lateRun = twistRun(rec.seed);
  const late = v.submit(JSON.stringify(exportReplay(lateRun)), 'late', null, later);
  assert.equal(late.ok, true); assert.equal(late.late, true); assert.equal(late.recorded, false); assert.equal(late.score, lateRun.score); assert.equal(late.closesAt, rec.closesAt); assert.equal(late.player, 'late');
  assert.deepEqual(v.board(rec.seed).map((e) => e.player), ['early'], 'late runs never join the board'); assert.equal(v.sizeAllVersions, 1);
  assert.equal(v.replay(replayId(exportReplay(lateRun))), null, 'and are not stored');
  const cheat = v.submit(JSON.stringify({ ...exportReplay(lateRun), claimedScore: lateRun.score + 1 }), 'cheat', null, later); assert.equal(cheat.ok, false, 'late submissions are still re-simulated');
  // archive: at `later` (03-13 05:00) the days 03-08..03-11 have closed, 03-12 and 03-13 are open
  for (const d of ['2030-03-08', '2030-03-09', '2030-03-11', '2030-03-12', '2030-03-13']) assert.ok(v.daily(10, later, d));
  const a = v.archive({}, later);
  assert.deepEqual(a.days.map((x) => x.date), ['2030-03-11', '2030-03-10', '2030-03-09', '2030-03-08', '2030-03-07'], 'frozen days only, newest first (03-07 was issued as 03-08\'s previous day)'); assert.equal(a.nextTo, null);
  const d10 = a.days.find((x) => x.date === D)!; assert.equal(d10.n, 1); assert.equal(d10.top[0].player, 'early'); assert.equal(d10.frozenAt, rec.closesAt); assert.equal(d10.seed, rec.seed); assert.equal(a.days[3].n, 0);
  const p1 = v.archive({ limit: 2 }, later); assert.deepEqual(p1.days.map((x) => x.date), ['2030-03-11', '2030-03-10']); assert.equal(p1.nextTo, '2030-03-09');
  const p2 = v.archive({ limit: 2, to: p1.nextTo! }, later); assert.deepEqual(p2.days.map((x) => x.date), ['2030-03-09', '2030-03-08']); assert.equal(p2.nextTo, '2030-03-07');
  const p3 = v.archive({ limit: 2, to: p2.nextTo! }, later); assert.deepEqual(p3.days.map((x) => x.date), ['2030-03-07']); assert.equal(p3.nextTo, null);
  assert.deepEqual(v.archive({ from: '2030-03-09', to: '2030-03-10' }, later).days.map((x) => x.date), ['2030-03-10', '2030-03-09']);
  assert.deepEqual(v.archive({ limit: 0 }, later).days.length, 1, 'limit is clamped to at least one');
  // a day's bot par is kept when the par cache is capped
  const small = new Verifier(path.join(path.dirname(file), 'small.json'), { dailySecret: 's', maxSeeds: 2 });
  const day = small.daily(10, later)!.seed; small.setPar(day, 100, 5, 40); small.setPar('x-1', 101, 5, 40); small.setPar('x-2', 102, 5, 40);
  assert.equal(small.par(day), 100, 'the daily keeps its par'); assert.equal(small.parCount, 2); assert.equal([small.par('x-1'), small.par('x-2')].filter((p) => p == null).length, 1, 'an ordinary seed was dropped instead');
});

// ---- medals after close (PLAN-v3 0.6.4) ----
test('medals: absent while a day is open, set once at freeze from the final board (null below five runs), persisted, untouched by late runs, backfilled for days frozen before medals existed, returned by /histogram only for the frozen daily', async () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'jd-medal-')), 'board.json');
  const v = new Verifier(file, { dailySecret: 'medal-secret' });
  const D = '2030-05-10'; const open = new Date('2030-05-11T12:00:00Z'), closed = new Date('2030-05-12T00:00:00Z');
  const rec = v.daily(10, open, D)!; assert.equal(rec.medals, undefined, 'no medals while the day is open');
  // five distinct runs on the day: the park trick gives the same score with more machines, so use five players with keep-best off (anonymous)
  const park: [number, number][] = [[6, 0], [6, 5], [0, 5], [6, 2], [0, 0]];
  const mk = (extra: number) => { const s = newRun(rec.seed); for (let r = 1; r <= RULES.rounds; r++) { apply(s, { t: 'pick', i: 0 }); if (r === RULES.rounds) for (let k = 0; k < extra; k++) { const cell = park[k]; apply(s, { t: 'place', id: s.bin[k].id, x: cell[0], y: cell[1], dir: 0 }); } apply(s, { t: 'run' }); apply(s, { t: 'next' }); } return s; };
  const runs = [mk(0), mk(1), mk(2), finishedRun(rec.seed), twistRun(rec.seed)];
  for (const [i, r] of runs.entries()) { const out = v.submit(JSON.stringify(exportReplay(r)), `p${i}`, null, open); assert.equal(out.ok, true, out.error); }
  const scores = v.board(rec.seed).map((e) => e.score).sort((a, b) => a - b); assert.equal(scores.length, 5);
  assert.equal(v.daily(10, new Date(closed.getTime() - 1), D)!.medals, undefined, 'still none one millisecond before the close');
  const frozen = v.daily(10, closed, D)!;
  assert.deepEqual(frozen.medals, medalThresholds(scores), 'set at freeze from the final board');
  assert.deepEqual(frozen.medals, { n: 5, bronze: scores[2], silver: scores[3], gold: scores[4] }, 'ranks ceil(2.5)=3, ceil(4)=4, ceil(4.75)=5');
  assert.deepEqual(new Verifier(file, { dailySecret: 'medal-secret' }).daily(10, closed, D)!.medals, frozen.medals, 'persisted');
  const late = v.submit(JSON.stringify(exportReplay(mk(3))), 'late', null, new Date('2030-05-13T00:00:00Z')); assert.equal(late.late, true);
  assert.deepEqual(v.daily(10, new Date('2030-05-13T00:00:00Z'), D)!.medals, frozen.medals, 'a late run changes nothing');
  assert.deepEqual(v.archive({}, closed).days.find((d) => d.date === D)!.medals, frozen.medals, 'the archive carries them');
  assert.equal(v.medalsForSeed(rec.seed, closed)!.gold, frozen.medals!.gold); assert.equal(v.medalsForSeed('ordinary-seed', closed), null); assert.equal(v.medalsForSeed(v.daily(10, closed)!.seed, closed), null, 'today is open: no medals');
  // too few runs: null, not thresholds
  const D2 = '2030-05-09'; const r2 = v.daily(10, open, D2)!; assert.equal(v.submit(JSON.stringify(exportReplay(finishedRun(r2.seed))), 'solo', null, open).ok, true);
  assert.equal(v.daily(10, closed, D2)!.medals, null, 'one run: no medals, explicitly null');
  // a day frozen before medals existed (simulated by stripping the field from the file) gets them on the next observation
  const raw = JSON.parse(fs.readFileSync(file, 'utf8')) as { dailies: Record<string, { medals?: unknown }> }; delete raw.dailies[D].medals; fs.writeFileSync(file, JSON.stringify(raw));
  const again = new Verifier(file, { dailySecret: 'medal-secret' });
  assert.deepEqual(again.daily(10, closed, D)!.medals, frozen.medals, 'backfilled from the stored final board');
  // over HTTP: /histogram carries medals for the frozen daily only
  const { base, close } = await listen(again, { rateLimit: null, now: () => closed.getTime() });
  try {
    const hg = await (await fetch(`${base}/histogram?seed=${encodeURIComponent(rec.seed)}`)).json() as { n: number; medals: Medals | null };
    assert.equal(hg.n, 5); assert.deepEqual(hg.medals, frozen.medals);
    assert.equal(((await (await fetch(`${base}/histogram?seed=ordinary-seed`)).json()) as { medals: unknown }).medals, null);
    const d = await (await fetch(`${base}/daily?date=${D}`)).json() as { medals: Medals | null; final: boolean }; assert.equal(d.final, true); assert.deepEqual(d.medals, frozen.medals);
  } finally { close(); }
});

// ---- reveal gate (PLAN-v3 0.6.6) ----
test('reveal gate: on an open daily /replay is 403 without a qualifying bearer, 200 for a player with an entry, 200 for everyone once the day closes; ordinary seeds are never gated', async () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'jd-reveal-')), 'board.json');
  const v = new Verifier(file, { dailySecret: 'reveal-secret' });
  const D = '2030-07-10'; const open = new Date('2030-07-10T12:00:00Z'), closed = new Date('2030-07-12T00:00:00Z');
  const rec = v.daily(10, open, D)!;
  const first = v.submit(JSON.stringify(exportReplay(finishedRun(rec.seed))), 'first', null, open); assert.equal(first.ok, true);
  const hash = first.entry!.replayHash;
  const tokenA = 'a'.repeat(32), tokenB = 'b'.repeat(32); const idA = playerIdFromToken(tokenA)!;
  assert.deepEqual(v.revealGate('ordinary-seed', null, open), null, 'ordinary seeds are never gated');
  assert.deepEqual(v.revealGate(dailySeedFor(open), null, open), null, 'practice seeds are never gated');
  assert.match(v.revealGate(rec.seed, null, open)!.error, /revealed after you submit a verified run/);
  assert.equal(v.revealGate(rec.seed, null, open)!.closesAt, rec.closesAt);
  assert.ok(v.revealGate(rec.seed, idA, open), 'a known player without an entry on the seed is still gated');
  assert.equal(v.revealGate(rec.seed, idA, closed), null, 'once the day closes everyone may watch');
  let now = open.getTime();
  const { base, close } = await listen(v, { rateLimit: null, now: () => now, playerRateLimit: 100 });
  const get = (h: Record<string, string> = {}) => fetch(`${base}/replay?hash=${hash}`, { headers: h });
  try {
    const anon = await get(); assert.equal(anon.status, 403);
    const body = await anon.json() as { reason: string; error: string; closesAt: string }; assert.equal(body.reason, 'reveal-gate'); assert.match(body.error, /closes at 2030-07-12T00:00:00/); assert.equal(body.closesAt, rec.closesAt);
    assert.equal((await get({ Authorization: `Bearer ${tokenB}` })).status, 403, 'a bearer without an entry on the seed');
    assert.equal((await get({ Authorization: 'Bearer nope' })).status, 401, 'a malformed bearer');
    assert.equal((await fetch(`${base}/replay?hash=nope`)).status, 404, 'unknown hashes stay 404');
    // player A submits a verified run for the day, then may watch
    const mine = await fetch(`${base}/verify`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenA}` }, body: JSON.stringify({ replay: exportReplay(twistRun(rec.seed)) }) });
    assert.equal(mine.status, 200);
    const ok = await get({ Authorization: `Bearer ${tokenA}` }); assert.equal(ok.status, 200); assert.equal(((await ok.json()) as { hash: string }).hash, hash);
    assert.equal((await get({ Authorization: `Bearer ${tokenB}` })).status, 403, 'B still has no entry');
    // the day closes: open to all
    now = closed.getTime();
    assert.equal((await get()).status, 200); assert.equal((await get({ Authorization: `Bearer ${tokenB}` })).status, 200);
    // an ordinary seed's replay was never gated
    const plain = v.submit(JSON.stringify(exportReplay(finishedRun('plain-seed'))), 'p', null, open); assert.equal((await fetch(`${base}/replay?hash=${plain.entry!.replayHash}`)).status, 200);
  } finally { close(); }
});

// ---- cold storage (PLAN-v4 0.7.0) ----
test('cold storage: frozen days older than HOT_DAYS move to monthly files with every entry and the top 10 replays; served exactly as before; idempotent; survives a restart; late submissions and the archive still work; recent and open days stay hot', async () => {
  const { synthesise } = await import('../tools/storage-measure');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jd-cold-')); const file = path.join(dir, 'board.json');
  const board = synthesise(50, 40, 'cold-secret', '2027-01-01'); // days 2027-01-01 … 2027-02-09, 50 entries and 50 replays each
  fs.writeFileSync(file, JSON.stringify(board));
  const v = new Verifier(file, { dailySecret: 'cold-secret' });
  const now = new Date('2027-02-20T12:00:00Z'); // cutoff = 2027-01-21: days 01-01 … 01-20 move
  const before = Object.fromEntries(Object.values(board.dailies!).map((r) => [r.date, { rank: v.board(r.seed, 100).map((e) => [e.replayHash, e.score, e.replayAvailable]), hg: v.histogram(r.seed), medals: v.medalsForSeed(r.seed, now), par: v.par(r.seed) }]));
  const { moved } = v.splitCold(now);
  assert.equal(moved.length, 20); assert.equal(moved[0], '2027-01-01'); assert.equal(moved[19], '2027-01-20');
  assert.equal(v.sizeAllVersions, 20 * 50, 'the hot board keeps the 20 recent days'); assert.equal(Object.keys(JSON.parse(fs.readFileSync(file, 'utf8')).dailies).length, 20);
  assert.ok(fs.existsSync(path.join(dir, 'cold', '2027-01.json')) && fs.existsSync(path.join(dir, 'cold', 'index.json')));
  assert.equal(v.cold.dayCount, 20); assert.equal(v.cold.replayCount, 20 * 10, 'top 10 replays per cold day');
  const coldRec = board.dailies!['2027-01-05'], hotRec = board.dailies!['2027-01-25'];
  // served as before, with replayAvailable true only for the kept top 10
  const after = v.board(coldRec.seed, 100);
  assert.deepEqual(after.map((e) => [e.replayHash, e.score]), before['2027-01-05'].rank.map((x) => [x[0], x[1]]), 'the final board is unchanged');
  assert.deepEqual(after.map((e) => e.replayAvailable), after.map((_, i) => i < 10));
  assert.deepEqual(v.histogram(coldRec.seed), before['2027-01-05'].hg); assert.deepEqual(v.medalsForSeed(coldRec.seed, now), before['2027-01-05'].medals); assert.equal(v.par(coldRec.seed), before['2027-01-05'].par);
  assert.ok(v.replay(after[0].replayHash)); assert.equal(v.replay(after[10].replayHash), null, 'the 11th replay is compacted');
  assert.equal(v.replayMissingReason(after[10].replayHash, coldRec.seed), 'compacted'); assert.equal(v.replayMissingReason(after[10].replayHash), 'unknown'); assert.equal(v.replayMissingReason('nope', coldRec.seed), 'unknown');
  assert.equal(v.daily(10, now, '2027-01-05')!.final, true); assert.equal(v.daily(10, now, '2027-01-05')!.entries.length, 10); assert.equal(v.daily(10, now, '2027-01-05')!.seed, coldRec.seed, 'a cold date is served from its record, never re-minted');
  // recent and open days untouched
  assert.deepEqual(v.board(hotRec.seed, 100).map((e) => e.replayAvailable), Array(50).fill(true));
  // archive lists all 40 frozen days newest first, cold ones included, with pages crossing the boundary
  const a = v.archive({ limit: 100 }, now); assert.equal(a.days.length, 40); assert.equal(a.days[0].date, '2027-02-09'); assert.equal(a.days[39].date, '2027-01-01'); assert.ok(a.days.every((d) => d.n === 50 && d.top.length === 5 && d.medals));
  const p = v.archive({ limit: 25 }, now); assert.equal(p.nextTo, '2027-01-15'); assert.equal(v.archive({ limit: 25, to: p.nextTo! }, now).days.length, 15);
  // late submission on a cold seed: verified, answered late, never recorded
  const late = v.submit(JSON.stringify(exportReplay(finishedRun(coldRec.seed))), 'late', null, now); assert.equal(late.ok, true); assert.equal(late.late, true); assert.equal(v.board(coldRec.seed, 100).length, 50);
  // idempotent: nothing more to move, files byte-identical
  const monthBefore = fs.readFileSync(path.join(dir, 'cold', '2027-01.json'), 'utf8'), indexBefore = fs.readFileSync(path.join(dir, 'cold', 'index.json'), 'utf8');
  assert.deepEqual(v.splitCold(now).moved, []);
  assert.equal(fs.readFileSync(path.join(dir, 'cold', '2027-01.json'), 'utf8'), monthBefore); assert.equal(fs.readFileSync(path.join(dir, 'cold', 'index.json'), 'utf8'), indexBefore);
  // a later day moves into the same month file without disturbing the others
  const laterMoved = v.splitCold(new Date('2027-02-21T12:00:00Z')).moved; assert.deepEqual(laterMoved, ['2027-01-21']); assert.equal(v.cold.dayCount, 21); assert.equal(v.board(coldRec.seed, 100).length, 50);
  // restart: the cold index is read, everything above still answers
  const again = new Verifier(file, { dailySecret: 'cold-secret' });
  assert.equal(again.cold.dayCount, 21); assert.deepEqual(again.board(coldRec.seed, 100).map((e) => e.replayHash), after.map((e) => e.replayHash)); assert.ok(again.replay(after[0].replayHash)); assert.equal(again.archive({ limit: 100 }, now).days.length, 40);
  // renames and deletions follow the player onto cold boards without rewriting cold files
  const pid = after[0].playerId!; const renamed = again.claim(pid, 'Renamed One', now); assert.ok(renamed.ok);
  assert.equal(again.board(coldRec.seed, 1)[0].player, `Renamed One#${tagFor(pid)}`); assert.equal(fs.readFileSync(path.join(dir, 'cold', '2027-01.json'), 'utf8'), fs.readFileSync(path.join(dir, 'cold', '2027-01.json'), 'utf8'));
  again.deletePlayer(pid); assert.equal(again.board(coldRec.seed, 1)[0].player, 'deleted'); assert.equal(again.board(coldRec.seed, 1)[0].playerId, undefined);
  // over HTTP: a compacted replay answers 404 with the reason when the seed is given, /health counts cold days
  const { base, close } = await listen(again, { rateLimit: null, now: () => now.getTime() });
  try {
    const miss = await fetch(`${base}/replay?hash=${after[10].replayHash}&seed=${encodeURIComponent(coldRec.seed)}`); assert.equal(miss.status, 404); const body = await miss.json() as { reason: string; error: string }; assert.equal(body.reason, 'compacted'); assert.match(body.error, /top 10 replays/);
    assert.equal((await fetch(`${base}/replay?hash=${after[10].replayHash}`)).status, 404);
    assert.equal((await fetch(`${base}/replay?hash=${after[0].replayHash}`)).status, 200, 'a kept cold replay is served (the day is closed, so no reveal gate)');
    const h = await (await fetch(`${base}/health`)).json() as { cold: { days: number; replays: number } }; assert.deepEqual(h.cold, { days: 21, replays: 210 });
    const b = await (await fetch(`${base}/board?seed=${encodeURIComponent(coldRec.seed)}&limit=100`)).json() as { entries: { replayAvailable: boolean }[] }; assert.equal(b.entries.length, 50); assert.equal(b.entries.filter((e) => e.replayAvailable).length, 10);
  } finally { close(); fs.rmSync(dir, { recursive: true, force: true }); }
});

// ---- challenge links (PLAN-v4 0.7.1) ----
test('challenge entries: per-round earnings are derived at verification and backfilled from stored replays, /entry serves earnings and standing but never actions, 404 for unknown hashes and for entries without rounds', async () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'jd-entry-')), 'board.json');
  const v = new Verifier(file, { dailySecret: 'entry-secret' });
  const run = finishedRun('entry-seed'); const replay = exportReplay(run);
  const sub = v.submit(JSON.stringify(replay), 'challenger'); assert.equal(sub.ok, true);
  assert.deepEqual(sub.entry!.rounds, run.rounds.map((r) => r.earned), 'rounds derived by re-simulation equal the client\'s per-round earnings');
  assert.equal(sub.entry!.rounds!.reduce((a, b) => a + b, 0), run.score);
  assert.deepEqual(roundsOf({ seed: replay.seed, actions: replay.actions, rulesVersion: replay.rulesVersion }), run.rounds.map((r) => r.earned), 'derivation uses seed, actions and rules version only');
  assert.equal(roundsOf({ seed: 'x', actions: [{ t: 'place', id: 999, x: 0, y: 0, dir: 0 } as never], rulesVersion: RULES_VERSION }), null, 'an illegal replay has no rounds');
  const e = v.entry(sub.entry!.replayHash)!;
  assert.deepEqual(e, { seed: 'entry-seed', score: run.score, player: 'challenger', rounds: sub.entry!.rounds, replayHash: sub.entry!.replayHash, verifiedAt: sub.entry!.verifiedAt, rulesVersion: RULES_VERSION, frozen: false, medals: null });
  assert.equal(v.entry('nope'), null);
  // a pre-0.7.1 entry (no rounds) with a stored replay is backfilled at startup; one without a replay stays without rounds
  const raw = JSON.parse(fs.readFileSync(file, 'utf8')) as Board;
  raw.entries = raw.entries.map((x) => { const { rounds: _r, ...rest } = x; return rest; });
  const orphan: BoardEntry = { seed: 'orphan-seed', score: 50, player: 'old', verifiedAt: '2026-01-01T00:00:00.000Z', rulesVersion: RULES_VERSION, actions: 20, replayHash: 'f'.repeat(64), finalMachines: 5 };
  raw.entries.push(orphan); fs.writeFileSync(file, JSON.stringify(raw));
  const again = new Verifier(file, { dailySecret: 'entry-secret' });
  assert.deepEqual(again.entry(sub.entry!.replayHash)!.rounds, run.rounds.map((r) => r.earned), 'backfilled from the stored replay');
  assert.equal(again.entry('f'.repeat(64))!.rounds, null, 'no replay, no rounds');
  // on a minted daily: an open day is not frozen and carries no medals; the entry never carries actions
  const d = again.daily(10, new Date())!; const dr = finishedRun(d.seed); const ds = again.submit(JSON.stringify(exportReplay(dr)), 'daily challenger', null, new Date()); assert.equal(ds.ok, true);
  const de = again.entry(ds.entry!.replayHash)!; assert.equal(de.frozen, false); assert.equal(de.medals, null); assert.ok(!('actions' in de));
  const { base, close } = await listen(again, { rateLimit: null });
  try {
    const ok = await (await fetch(`${base}/entry?hash=${sub.entry!.replayHash}`)).json() as Record<string, unknown>;
    assert.equal(ok.ok, true); assert.equal(ok.seed, 'entry-seed'); assert.deepEqual(ok.rounds, run.rounds.map((r) => r.earned)); assert.ok(!('actions' in ok), 'never the replay');
    const gated = await (await fetch(`${base}/entry?hash=${ds.entry!.replayHash}`)).json() as Record<string, unknown>; assert.equal(gated.ok, true); assert.ok(!('actions' in gated), 'an open daily\'s entry gives earnings only; the replay stays behind the reveal gate');
    assert.equal((await fetch(`${base}/entry?hash=nope`)).status, 404);
    const nr = await fetch(`${base}/entry?hash=${'f'.repeat(64)}`); assert.equal(nr.status, 404); assert.equal(((await nr.json()) as { reason: string }).reason, 'no-rounds');
  } finally { close(); }
});

// ---- groups (PLAN-v4 0.7.2) ----
test('groups: create/join/leave/rename/disband with caps and filtered names; a group board is members\' entries with ranks recomputed; non-members and unknown codes get one 403; deletion removes memberships', async () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'jd-groups-')), 'board.json');
  const v = new Verifier(file, { dailySecret: 'group-secret' });
  const tok = (c: string) => c.repeat(32); const ids = ['a', 'b', 'c', 'd'].map((c) => playerIdFromToken(tok(c))!);
  const t0 = new Date('2030-09-01T10:00:00Z');
  assert.equal(v.createGroup(ids[0], 'Lunch Crew', t0).ok, false, 'a group needs a claimed identity');
  for (const [i, id] of ids.entries()) assert.ok(v.claim(id, `Player ${i}`, t0).ok);
  const bad = v.createGroup(ids[0], 'adm1n squad', t0); assert.equal(bad.ok, false); if (!bad.ok) assert.match(bad.error, /not allowed/);
  const made = v.createGroup(ids[0], '  Lunch  Crew ', t0); assert.ok(made.ok); if (!made.ok) return;
  const code = made.group.code; assert.match(code, /^[a-z2-7]{8}$/); assert.deepEqual(made.group, { code, name: 'Lunch Crew', members: 1, creator: true });
  const joined = v.joinGroup(ids[1], code); assert.ok(joined.ok && joined.group.members === 2 && !joined.group.creator);
  assert.deepEqual(v.joinGroup(ids[1], code), { ok: true, group: { code, name: 'Lunch Crew', members: 2, creator: false } }, 'joining twice is idempotent');
  assert.equal(v.joinGroup(ids[2], 'zzzzzzzz').ok, false); assert.equal(v.joinGroup(ids[2], 'NOT-A-CODE').ok, false);
  assert.deepEqual(v.groupsOf(ids[1]), [{ code, name: 'Lunch Crew', members: 2, creator: false }]); assert.deepEqual(v.groupsOf(ids[2]), []);
  // caps: 5 groups per player, 50 members per group
  for (let i = 0; i < 4; i++) assert.ok(v.createGroup(ids[0], `Extra ${i}`, t0).ok);
  const sixth = v.createGroup(ids[0], 'One too many', t0); assert.equal(sixth.ok, false); if (!sixth.ok) assert.match(sixth.error, /at most 5/);
  const small = new Verifier(path.join(path.dirname(file), 'small.json'), { dailySecret: 's' });
  const many = Array.from({ length: 51 }, (_, i) => createHash('sha256').update(`m${i}`).digest('hex')); for (const m of many) small.claim(m, `M ${m.slice(0, 4)}`, t0);
  const big = small.createGroup(many[0], 'Big', t0); if (!big.ok) throw new Error('big'); for (let i = 1; i < 50; i++) assert.ok(small.joinGroup(many[i], big.group.code).ok); const full = small.joinGroup(many[50], big.group.code); assert.equal(full.ok, false); if (!full.ok) assert.match(full.error, /full/);
  // a group board: only members' verified entries, ranks over the members
  const park: [number, number][] = [[6, 0], [6, 5], [0, 5]];
  const mk = (extra: number) => { const s = newRun('group-seed'); for (let r = 1; r <= RULES.rounds; r++) { apply(s, { t: 'pick', i: 0 }); if (r === RULES.rounds) for (let k = 0; k < extra; k++) apply(s, { t: 'place', id: s.bin[k].id, x: park[k][0], y: park[k][1], dir: 0 }); apply(s, { t: 'run' }); apply(s, { t: 'next' }); } return s; };
  assert.ok(v.submit(JSON.stringify(exportReplay(mk(0))), 'x', ids[2], t0).ok, 'non-member, best run'); // 5 machines: ranks first globally
  assert.ok(v.submit(JSON.stringify(exportReplay(mk(1))), 'x', ids[0], t0).ok); assert.ok(v.submit(JSON.stringify(exportReplay(mk(2))), 'x', ids[1], t0).ok);
  assert.ok(v.submit(JSON.stringify(exportReplay(finishedRun('group-seed'))), 'anonymous', null, t0).ok, 'an anonymous entry is never in any group');
  const members = v.groupMembers(code, ids[0])!; assert.equal(members.size, 2); assert.equal(v.groupMembers(code, ids[2]), null, 'a non-member gets nothing'); assert.equal(v.groupMembers('zzzzzzzz', ids[0]), null);
  const global = v.board('group-seed', 100), scoped = v.board('group-seed', 100, members);
  assert.equal(global.length, 4); assert.deepEqual(scoped.map((e) => e.playerId), [ids[0], ids[1]], 'members only, in rank order');
  const hg = v.histogram('group-seed', scoped[1].replayHash, members); assert.equal(hg.n, 2); assert.equal(hg.mine!.rank, 2, 'rank recomputed over the group (globally this run is #3)');
  assert.equal(v.histogram('group-seed', scoped[1].replayHash).mine!.rank, 4, 'globally the anonymous crusher run and the non-member rank above it');
  // rename (creator only, cooldown), leave hands over, disband
  assert.equal(v.renameGroup(ids[1], code, 'Nope', t0).ok, false);
  const ren = v.renameGroup(ids[0], code, 'Lunch Crew 2', new Date(t0.getTime() + 60_000)); assert.equal(ren.ok, false); if (!ren.ok) assert.ok(ren.retryAfterSec! > 0, 'renamed at creation counts for the cooldown');
  assert.ok(v.renameGroup(ids[0], code, 'Lunch Crew 2', new Date(t0.getTime() + RENAME_COOLDOWN_MS + 1)).ok); assert.equal(v.group(code)!.name, 'Lunch Crew 2');
  assert.ok(v.leaveGroup(ids[0], code).ok); assert.equal(v.group(code)!.creatorId, ids[1], 'the leaving creator hands the group to the next member');
  assert.equal(v.leaveGroup(ids[0], code).ok, false, 'not a member any more');
  assert.equal(v.disbandGroup(ids[0], code).ok, false); assert.ok(v.disbandGroup(ids[1], code).ok); assert.equal(v.group(code), null);
  const solo = v.createGroup(ids[3], 'Solo', t0); if (!solo.ok) throw new Error('solo'); assert.ok(v.leaveGroup(ids[3], solo.group.code).ok); assert.equal(v.group(solo.group.code), null, 'the last member leaving removes the group');
  // deletion removes memberships; persisted across a restart
  const again = new Verifier(file, { dailySecret: 'group-secret' });
  const extra0 = again.groupsOf(ids[0])[0].code; assert.ok(again.joinGroup(ids[1], extra0).ok);
  again.deletePlayer(ids[0]); assert.deepEqual(again.groupsOf(ids[0]), []); assert.equal(again.group(extra0)!.creatorId, ids[1], 'the deleted creator\'s group passes to the remaining member');
  // over HTTP: create/join/list, a scoped board needs a member's bearer, unknown code and non-member share one 403
  const { base, close } = await listen(again, { rateLimit: null, now: () => t0.getTime() });
  const call = async (method: string, p: string, token: string | null, body?: unknown) => { const r = await fetch(`${base}${p}`, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) }); return { status: r.status, json: await r.json() as Record<string, unknown> }; };
  try {
    const created = await call('POST', '/groups', tok('b'), { name: 'Http Crew' }); assert.equal(created.status, 200); const hc = (created.json.group as { code: string }).code;
    assert.equal((await call('POST', '/groups', null, { name: 'x' })).status, 401);
    assert.equal((await call('POST', '/groups', tok('c'), { name: 'adm1n' })).status, 422);
    assert.equal((await call('POST', '/groups/join', tok('c'), { code: hc })).status, 200);
    assert.equal((await call('POST', '/groups/join', tok('d'), { code: 'zzzzzzzz' })).status, 403);
    const mine = await call('GET', '/groups', tok('c')); assert.equal(mine.status, 200); assert.ok((mine.json.groups as { code: string }[]).some((g) => g.code === hc));
    const scopedBoard = await call('GET', `/board?seed=group-seed&group=${hc}`, tok('c')); assert.equal(scopedBoard.status, 200); assert.deepEqual(((scopedBoard.json.entries as BoardEntry[]).map((e) => e.playerId)), [ids[2], ids[1]], 'members only, ranked: the fewer-machines run first'); assert.deepEqual(scopedBoard.json.group, { code: hc, name: 'Http Crew' });
    assert.equal((await call('GET', `/board?seed=group-seed&group=${hc}`, null)).status, 401, 'a group board needs the bearer');
    assert.equal((await call('GET', `/board?seed=group-seed&group=${hc}`, tok('d'))).status, 403, 'non-member');
    assert.equal((await call('GET', `/board?seed=group-seed&group=zzzzzzzz`, tok('c'))).status, 403, 'unknown code: the same answer');
    assert.equal((await call('GET', `/histogram?seed=group-seed&group=${hc}`, tok('c'))).status, 200); assert.equal((await call('GET', `/archive?group=${hc}`, tok('c'))).status, 200); assert.equal((await call('GET', `/daily?group=${hc}`, tok('c'))).status, 200);
    assert.equal((await call('GET', '/board?seed=group-seed', null)).status, 200, 'the global board is open as before');
    assert.equal((await call('POST', '/groups/leave', tok('c'), { code: hc })).status, 200); assert.equal((await call('GET', `/board?seed=group-seed&group=${hc}`, tok('c'))).status, 403);
  } finally { close(); }
});

// ---- weekly seed (PLAN-v4 0.7.5) ----
test('weekly: minted from the same secret under its own domain, opens exactly Friday 18:00 UTC and closes seven days later; a Friday daily publishes the commitment; weeks chain; freeze sets medals; the archive lists weeklies with their kind; cold split keys by week; forged and daily seeds never cross; HTTP 200/400/403', async () => {
  const { mintWeeklySeed, currentWeekId, weeklyWindow } = await import('../server/verify');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jd-weekly-')); const file = path.join(dir, 'board.json');
  const v = new Verifier(file, { dailySecret: 'week-secret' });
  // 2030-03-15 is a Friday (ISO 2030-W11); the weekly opens 18:00 UTC that day and closes 2030-03-22 18:00 UTC
  const W = '2030-W11', before = new Date('2030-03-15T17:59:59Z'), at = new Date('2030-03-15T18:00:00Z'), mid = new Date('2030-03-19T09:00:00Z'), close = new Date('2030-03-22T18:00:00Z'), after = new Date('2030-03-23T10:00:00Z');
  assert.equal(mintWeeklySeed('week-secret', W), mintWeeklySeed('week-secret', W)); assert.notEqual(mintWeeklySeed('week-secret', W), mintWeeklySeed('other', W)); assert.notEqual(mintWeeklySeed('week-secret', W), mintWeeklySeed('week-secret', '2030-W12'));
  assert.match(mintWeeklySeed('week-secret', W), /^weekly-2030-W11-[a-z2-7]{8}$/); assert.throws(() => mintWeeklySeed('week-secret', '2030-W53'));
  // the Friday's daily commits to the weekly opening that evening; a Thursday's does not
  const fri = v.daily(10, before, '2030-03-15')!; assert.equal(fri.weeklyCommitment, commitmentFor(mintWeeklySeed('week-secret', W))); assert.equal(v.daily(10, before, '2030-03-14')!.weeklyCommitment, undefined);
  // not open one millisecond before 18:00 UTC; the previous week is the current one
  assert.equal(v.weekly(10, before, W), null); assert.equal(currentWeekId(before), '2030-W10'); assert.equal(v.weekly(10, before)!.week, '2030-W10');
  const rec = v.weekly(10, at)!;
  assert.equal(rec.week, W); assert.equal(rec.kind, 'weekly'); assert.equal(rec.seed, mintWeeklySeed('week-secret', W)); assert.equal(rec.opensAt, '2030-03-15T18:00:00.000Z'); assert.equal(rec.closesAt, '2030-03-22T18:00:00.000Z'); assert.equal(rec.date, '2030-03-15');
  assert.equal(rec.final, false); assert.equal(rec.frozenAt, null); assert.equal(rec.minted, true); assert.equal(rec.now, at.toISOString()); assert.deepEqual(rec.entries, []);
  assert.equal(rec.commitment, commitmentFor(mintWeeklySeed('week-secret', '2030-W12')), 'commits to next week'); assert.equal(rec.previous!.week, '2030-W10'); assert.equal(commitmentFor(rec.seed), rec.previous!.commitment, 'this week matches the commitment published with the previous week');
  assert.equal(v.weekly(10, mid)!.seed, rec.seed, 'never re-minted'); assert.equal(new Verifier(file, { dailySecret: 'rotated' }).weekly(10, mid, W)!.seed, rec.seed, 'a secret rotation keeps the issued week');
  // submissions: an issued weekly lands on its own board, not the daily one; forged weeklies and closed weeks are refused or answered late
  const park: [number, number][] = [[6, 0], [6, 5], [0, 5], [6, 2], [0, 0]];
  const mk = (extra: number) => { const s = newRun(rec.seed); for (let r = 1; r <= RULES.rounds; r++) { apply(s, { t: 'pick', i: 0 }); if (r === RULES.rounds) for (let k = 0; k < extra; k++) { const cell = park[k]; apply(s, { t: 'place', id: s.bin[k].id, x: cell[0], y: cell[1], dir: 0 }); } apply(s, { t: 'run' }); apply(s, { t: 'next' }); } return s; };
  const runs = [mk(0), mk(1), mk(2), finishedRun(rec.seed), twistRun(rec.seed)];
  for (const [i, r] of runs.entries()) { const out = v.submit(JSON.stringify(exportReplay(r)), `w${i}`, null, mid); assert.equal(out.ok, true, out.error); assert.equal(out.recorded, true); }
  assert.equal(v.weekly(10, mid)!.entries.length, 5); assert.equal(v.daily(10, mid)!.entries.length, 0, 'the daily board is untouched');
  const forged = v.submit(JSON.stringify(exportReplay(finishedRun('weekly-2030-W11-aaaaaaaa'))), 'forger', null, mid); assert.equal(forged.ok, false); assert.match(forged.error!, /not an issued weekly seed/);
  const unissued = v.submit(JSON.stringify(exportReplay(finishedRun(mintWeeklySeed('week-secret', '2030-W12')))), 'early', null, mid); assert.equal(unissued.ok, false, "next week's seed is not issued yet even though the secret would mint it");
  // reveal gate and medals: gated while open, medals only once frozen
  assert.ok(v.revealGate(rec.seed, null, mid)); assert.equal(v.revealGate(rec.seed, null, after), null); assert.equal(v.medalsForSeed(rec.seed, mid), null);
  assert.equal(v.weekly(10, new Date(close.getTime() - 1), W)!.final, false);
  const frozen = v.weekly(10, close, W)!; assert.equal(frozen.final, true); assert.equal(frozen.frozenAt, close.toISOString(), 'freeze flips exactly at Friday 18:00 UTC');
  const scores = v.board(rec.seed).map((e) => e.score).sort((a, b) => a - b); assert.deepEqual(frozen.medals, medalThresholds(scores)); assert.equal(frozen.medals!.n, 5); assert.deepEqual(v.medalsForSeed(rec.seed, after), frozen.medals);
  assert.equal(currentWeekId(close), '2030-W12'); assert.equal(v.weekly(10, close)!.week, '2030-W12'); assert.equal(v.weekly(10, close)!.previous!.seed, rec.seed);
  const late = v.submit(JSON.stringify(exportReplay(mk(3))), 'late', null, after); assert.equal(late.ok, true); assert.equal(late.late, true); assert.equal(late.recorded, false); assert.equal(v.board(rec.seed).length, 5);
  // archive: the weekly sorts by the Friday it opened, with its kind and key, among the dailies
  for (const d of ['2030-03-13', '2030-03-14', '2030-03-15', '2030-03-16']) v.daily(10, after, d);
  const a = v.archive({ limit: 100 }, after);
  const wk = a.days.find((d) => d.kind === 'weekly')!; assert.ok(wk); assert.equal(wk.key, W); assert.equal(wk.date, '2030-03-15'); assert.equal(wk.seed, rec.seed); assert.equal(wk.n, 5); assert.equal(wk.frozenAt, close.toISOString()); assert.deepEqual(wk.medals, frozen.medals);
  const i = a.days.indexOf(wk); assert.equal(a.days[i + 1].date, '2030-03-15', 'the weekly comes right before the daily of the same date'); assert.ok(a.days.slice(0, i).every((d) => d.kind === 'daily' && d.date > '2030-03-15'));
  assert.deepEqual(v.archive({ from: '2030-03-15', to: '2030-03-15' }, after).days.map((d) => d.kind), ['weekly', 'daily']);
  // persisted under its week id; a restart serves it; the loader accepts the record
  const raw = JSON.parse(fs.readFileSync(file, 'utf8')) as Board; assert.equal(raw.dailies![W].kind, 'weekly'); assert.equal(raw.dailies![W].seed, rec.seed);
  assert.equal(new Verifier(file, { dailySecret: 'week-secret' }).weekly(10, after, W)!.frozenAt, close.toISOString());
  // cold split keys by the week id and keeps serving it
  const far = new Date('2030-05-01T12:00:00Z'); const moved = v.splitCold(far).moved; assert.ok(moved.includes(W), `moved ${moved.join(',')}`);
  assert.equal(v.cold.day(W)!.record.seed, rec.seed); assert.equal(v.weekly(10, far, W)!.seed, rec.seed); assert.equal(v.weekly(10, far, W)!.entries.length, 5); assert.equal(v.weekly(10, far, W)!.final, true);
  assert.ok(v.archive({ limit: 100 }, far).days.some((d) => d.kind === 'weekly' && d.key === W), 'listed from cold'); assert.equal(v.submit(JSON.stringify(exportReplay(mk(3))), 'late2', null, far).late, true);
  assert.equal(v.revealGate(rec.seed, null, far), null); assert.deepEqual(v.medalsForSeed(rec.seed, far), frozen.medals);
  assert.deepEqual(weeklyWindow(W), { opensAt: '2030-03-15T18:00:00.000Z', closesAt: '2030-03-22T18:00:00.000Z', openDate: '2030-03-15' });
  // HTTP
  let clock = mid.getTime();
  const { base, close: stop } = await listen(v, { rateLimit: null, now: () => clock });
  try {
    const cur = await (await fetch(`${base}/weekly`)).json() as { ok: boolean; week: string; seed: string; final: boolean; entries: unknown[]; previous: { week: string } | null; tieBreak: string; minted: boolean };
    assert.equal(cur.ok, true); assert.equal(cur.week, W); assert.equal(cur.seed, rec.seed); assert.equal(cur.final, true); assert.equal(cur.entries.length, 5); assert.equal(cur.previous!.week, '2030-W10'); assert.equal(cur.minted, true); assert.equal(cur.tieBreak, TIE_BREAK);
    const byWeek = await (await fetch(`${base}/weekly?week=2030-W10&limit=1`)).json() as { ok: boolean; week: string; entries: unknown[] }; assert.equal(byWeek.week, '2030-W10'); assert.equal(byWeek.entries.length, 0);
    const bad = await fetch(`${base}/weekly?week=2030-03-15`); assert.equal(bad.status, 400);
    const bad2 = await fetch(`${base}/weekly?week=2030-W53`); assert.equal(bad2.status, 400, 'a week that does not exist in that year');
    clock = before.getTime(); const early = await fetch(`${base}/weekly?week=${W}`); assert.equal(early.status, 403); const eb = await early.json() as { currentWeek: string }; assert.equal(eb.currentWeek, '2030-W10');
    clock = mid.getTime(); const h = await (await fetch(`${base}/histogram?seed=${encodeURIComponent(rec.seed)}`)).json() as { medals?: Medals | null }; assert.deepEqual(h.medals, frozen.medals, 'the frozen weekly carries its medals on /histogram');
  } finally { stop(); fs.rmSync(dir, { recursive: true, force: true }); }
});

// ---- Discord webhook (PLAN-v4 0.7.6) ----
test('discord webhook: seed openings, a new #1 and freezes post once each with a mocked webhook; a 429 waits Retry-After and retries; a 500 or a network error is logged and dropped; retries exhaust; dry run prints; a submission never waits for the post', async () => {
  const { Announcer, formatAnnouncement, retryAfterMs } = await import('../server/webhook');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jd-hook-')); const file = path.join(dir, 'board.json');
  const calls: { url: string; body: { content: string; allowed_mentions: { parse: string[] } } }[] = []; const delays: number[] = []; const logs: string[] = [];
  let responses: (() => Response)[] = [];
  const f = (async (url: string | URL | Request, init?: RequestInit) => { calls.push({ url: String(url), body: JSON.parse(String(init!.body)) }); const r = responses.shift(); return r ? r() : new Response(null, { status: 204 }); }) as typeof fetch;
  const a = new Announcer({ url: 'https://discord.test/hook', fetch: f, sleep: async (ms) => { delays.push(ms); }, log: (l) => logs.push(l) });
  const v = new Verifier(file, { dailySecret: 'hook-secret', announce: (ev) => a.announce(ev) });
  // 2030-05-10 is a Friday (ISO 2030-W19): at 19:00 UTC the daily and the weekly are both open
  const D = '2030-05-10', t1 = new Date('2030-05-10T19:00:00Z');
  const day = v.daily(10, t1)!; v.daily(10, t1); v.dailyRecord('2030-05-09', t1);
  const wk = v.weekly(10, t1)!; v.weekly(10, t1); assert.equal(wk.week, '2030-W19');
  await a.idle();
  assert.deepEqual(calls.map((c) => c.body.content), [
    `Daily ${D} is open — seed \`${day.seed}\` · closes 2030-05-12 00:00 UTC · commitment to the next day: ${day.commitment.slice(0, 16)}…`,
    `Weekly 2030-W19 is open — seed \`${wk.seed}\` · closes 2030-05-17 18:00 UTC · commitment to the next week: ${wk.commitment.slice(0, 16)}…`,
  ], 'today and this week once each; the previous day and week minted for the chain are not announced');
  assert.ok(calls.every((c) => c.url === 'https://discord.test/hook' && c.body.allowed_mentions.parse.length === 0), 'no mentions ever');
  assert.equal(a.stats.deduped, 0, 'the verifier only announces at mint time, so no duplicate reached the announcer'); a.announce({ kind: 'seed', record: v.dailyRecord(D, t1)! }); await a.idle(); assert.equal(calls.length, 2); assert.equal(a.stats.deduped, 1, 'the announcer itself refuses a second message for the same key');
  // a new #1 on the daily: one message per leader change, none for a run that does not lead; an ordinary seed is never announced
  const park: [number, number][] = [[6, 0], [6, 5], [0, 5], [6, 2], [0, 0]];
  const mk = (seed: string, extra: number) => { const s = newRun(seed); for (let r = 1; r <= RULES.rounds; r++) { apply(s, { t: 'pick', i: 0 }); if (r === RULES.rounds) for (let k = 0; k < extra; k++) { const cell = park[k]; apply(s, { t: 'place', id: s.bin[k].id, x: cell[0], y: cell[1], dir: 0 }); } apply(s, { t: 'run' }); apply(s, { t: 'next' }); } return s; };
  const runs = [mk(day.seed, 0), mk(day.seed, 1), mk(day.seed, 2), finishedRun(day.seed), twistRun(day.seed)];
  let leader: string | undefined; const changes: string[] = [];
  for (const [i, r] of runs.entries()) { const out = v.submit(JSON.stringify(exportReplay(r)), `p${i}`, null, t1); assert.equal(out.ok, true, out.error); const top = v.board(day.seed, 1)[0]; if (top.replayHash !== leader) { leader = top.replayHash; changes.push(`New #1 on Daily ${D}: ${top.player} with $${top.score}`); } }
  assert.equal(v.submit(JSON.stringify(exportReplay(finishedRun('plain-seed'))), 'plain', null, t1).ok, true);
  await a.idle();
  const leadMsgs = calls.slice(2).map((c) => c.body.content);
  assert.equal(leadMsgs.length, changes.length, 'one message per change of leader'); assert.ok(changes.length >= 1);
  leadMsgs.forEach((m, k) => { assert.ok(m.startsWith(changes[k]), `${m} starts with ${changes[k]}`); if (k > 0) assert.match(m, / \(was p\d, \$\d+\)$/); else assert.ok(!m.includes('(was')); });
  // a claimed player improving their own leading run is not news
  const pid = playerIdFromToken('b'.repeat(32))!; assert.ok(v.claim(pid, 'Hook Player', t1).ok);
  const [lo, hi] = [mk(wk.seed, 0), finishedRun(wk.seed)].sort((x, y) => x.score - y.score); assert.ok(lo.score < hi.score, 'two distinct scores on the weekly');
  const n0 = calls.length;
  assert.equal(v.submit(JSON.stringify(exportReplay(lo)), 'x', pid, t1).recorded, true); assert.equal(v.submit(JSON.stringify(exportReplay(hi)), 'x', pid, t1).recorded, true);
  await a.idle();
  assert.equal(calls.length, n0 + 1); assert.match(calls[n0].body.content, new RegExp(`^New #1 on Weekly 2030-W19: Hook Player#[A-Z2-9]{4} with \\$${lo.score}$`));
  // freeze: the daily closes 2030-05-12 00:00 UTC with five runs → medals; the chain-minted 2030-05-09 closes too with no runs and is not announced; observing again posts nothing
  const t2 = new Date('2030-05-12T00:00:00Z'); const n1 = calls.length;
  const frozen = v.daily(10, t2, D)!; assert.equal(frozen.final, true); v.daily(10, t2, D); v.archive({}, t2);
  await a.idle();
  assert.equal(calls.length, n1 + 1);
  const top = v.board(day.seed, 1)[0]; const m = frozen.medals!;
  assert.equal(calls[n1].body.content, `Daily ${D} is final: 5 verified runs · #1 ${top.player} $${top.score} · medals: gold ≥ $${m.gold} · silver ≥ $${m.silver} · bronze ≥ $${m.bronze}`);
  // 429 with Retry-After: wait exactly that long, retry once, deliver; the weekly closes 2030-05-17 18:00 UTC with two runs
  responses = [() => new Response('{"retry_after":1.5}', { status: 429, headers: { 'retry-after': '2' } })];
  const t3 = new Date('2030-05-17T18:00:00Z'); const n2 = calls.length;
  assert.equal(v.weekly(10, t3, '2030-W19')!.final, true);
  await a.idle();
  assert.deepEqual(delays, [2000]); assert.equal(calls.length, n2 + 2); assert.equal(calls[n2].body.content, calls[n2 + 1].body.content);
  assert.match(calls[n2].body.content, /^Weekly 2030-W19 is final: 1 verified run · #1 Hook Player#[A-Z2-9]{4} \$\d+ · fewer than five runs: no medals$/);
  assert.equal(a.stats.retried, 1); assert.match(logs.at(-1)!, /rate limited, retrying in 2000 ms \(1\/3\)/);
  // a 500 is dropped and logged; the queue goes on with the next message
  responses = [() => new Response('', { status: 500 })]; const n3 = calls.length;
  const d17 = v.daily(10, t3)!; const w20 = v.weekly(10, t3)!; assert.equal(w20.week, '2030-W20');
  await a.idle();
  assert.equal(calls.length, n3 + 2); assert.equal(a.stats.dropped, 1); assert.match(logs.at(-1)!, new RegExp(`^discord seed:${D.slice(0, 8)}17: dropped, HTTP 500$`));
  assert.match(calls[n3].body.content, new RegExp(`^Daily 2030-05-17 is open — seed \`${d17.seed}\``)); assert.match(calls[n3 + 1].body.content, /^Weekly 2030-W20 is open/);
  // a network error is dropped and logged
  responses = [() => { throw new Error('ECONNRESET'); }];
  v.daily(10, new Date('2030-05-18T01:00:00Z'));
  await a.idle(); assert.equal(a.stats.dropped, 2); assert.match(logs.at(-1)!, /^discord seed:2030-05-18: dropped, request failed: ECONNRESET$/);
  // retries exhaust after maxRetries 429s (default 3): three waits, then dropped
  responses = [1, 2, 3, 4].map(() => () => new Response('', { status: 429, headers: { 'retry-after': '1' } })); const n4 = calls.length;
  v.daily(10, new Date('2030-05-19T01:00:00Z'));
  await a.idle(); assert.deepEqual(delays, [2000, 1000, 1000, 1000]); assert.equal(calls.length, n4 + 4); assert.equal(a.stats.dropped, 3); assert.match(logs.at(-1)!, /dropped, HTTP 429 after retries$/);
  assert.equal(a.stats.posted + a.stats.dropped, calls.length - a.stats.retried, 'posted + dropped = distinct messages that reached the queue');
  // Retry-After forms
  assert.equal(await retryAfterMs(new Response('', { status: 429, headers: { 'retry-after': '2' } })), 2000);
  assert.equal(await retryAfterMs(new Response('', { status: 429, headers: { 'retry-after': new Date(5_000_000).toUTCString() } }), 2_000_000), 3_000_000);
  assert.equal(await retryAfterMs(new Response('{"retry_after":0.25}', { status: 429 })), 250);
  assert.equal(await retryAfterMs(new Response('', { status: 429 })), 1000);
  // wording pins
  assert.equal(formatAnnouncement({ kind: 'freeze', record: { ...v.dailyRecord(D, t2)!, medals: null }, n: 1, top: [top] }), `Daily ${D} is final: 1 verified run · #1 ${top.player} $${top.score} · fewer than five runs: no medals`);
  assert.equal(formatAnnouncement({ kind: 'lead', record: v.dailyRecord(D, t2)!, entry: top, previous: { ...top, player: 'old', score: 1 } }), `New #1 on Daily ${D}: ${top.player} with $${top.score} (was old, $1)`);
  // dry run prints and never fetches; a disabled announcer does nothing
  const dryLogs: string[] = []; const dry = new Announcer({ url: null, dryRun: true, fetch: (() => { throw new Error('must not fetch'); }) as unknown as typeof fetch, log: (l) => dryLogs.push(l) });
  const v2 = new Verifier(path.join(dir, 'dry.json'), { dailySecret: 'hook-secret', announce: (ev) => dry.announce(ev) }); v2.daily(10, t1); await dry.idle();
  assert.deepEqual(dryLogs, [`discord (dry run) seed:${D}: ${calls[0].body.content}`]); assert.equal(dry.stats.posted, 1);
  const off = new Announcer({ url: null }); assert.equal(off.enabled, false); off.announce({ kind: 'seed', record: v.dailyRecord(D, t2)! }); await off.idle(); assert.deepEqual(off.stats, { posted: 0, dropped: 0, deduped: 0, retried: 0 });
  // a submission over HTTP answers before the webhook does; /health counts the announcer
  let release!: () => void; const gate = new Promise<void>((r) => { release = r; });
  const slow = new Announcer({ url: 'https://discord.test/slow', fetch: (async () => { await gate; return new Response(null, { status: 204 }); }) as typeof fetch, log: null });
  const v3 = new Verifier(path.join(dir, 'slow.json'), { dailySecret: 'slow-secret', announce: (ev) => slow.announce(ev) });
  const { base, close } = await listen(v3, { rateLimit: null, now: () => t1.getTime(), announcer: slow });
  try {
    const seed = v3.daily(10, t1)!.seed; // the opening message is now stuck behind the gate
    const t0 = Date.now();
    const res = await fetch(`${base}/verify`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ replay: exportReplay(finishedRun(seed)), player: 'quick' }) });
    assert.equal(res.status, 200); assert.equal((await res.json() as { recorded: boolean }).recorded, true); assert.ok(Date.now() - t0 < 5000, 'answered while the webhook is still pending');
    assert.deepEqual(slow.stats, { posted: 0, dropped: 0, deduped: 0, retried: 0 }, 'nothing posted yet');
    release(); await slow.idle(); assert.deepEqual(slow.stats, { posted: 2, dropped: 0, deduped: 0, retried: 0 }, 'the opening and the new #1 both went out afterwards');
    const h = await (await fetch(`${base}/health`)).json() as { discord?: { posted: number } }; assert.equal(h.discord?.posted, 2);
  } finally { close(); fs.rmSync(dir, { recursive: true, force: true }); }
});

// ---- name moderation (PLAN-v4 0.7.7) ----
test('name moderation: a report hides the name as "player" on every board, /entry and /replay (hot and cold); one report per reporter; a rename does not lift it; clear restores; after two clears a report no longer hides; a forced rename follows the player everywhere and restarts the cooldown; deletion drops the record; one audit row per action; HTTP guards and the moderator token', async () => {
  const { REPORT_REASONS, HIDDEN_LABEL, MAX_HIDES_PER_NAME, REPORT_RATE_LIMIT } = await import('../server/verify');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jd-mod-')); const file = path.join(dir, 'board.json'); const audit = path.join(dir, 'moderation.jsonl');
  const t0 = new Date('2030-03-12T10:00:00Z');
  const v = new Verifier(file, { dailySecret: 'mod-secret' });
  const tok = (c: string) => c.repeat(32); const [rep, tgt, third, unnamed] = ['a', 'b', 'c', 'd'].map((c) => playerIdFromToken(tok(c))!);
  assert.ok(v.claim(rep, 'Reporter', t0).ok && v.claim(tgt, 'Rude Name', t0).ok && v.claim(third, 'Third', t0).ok);
  const tag = tagFor(tgt); const label = `Rude Name#${tag}`;
  const sub = (seed: string, pid: string | null, when = t0) => { const r = v.submit(JSON.stringify(exportReplay(finishedRun(seed))), 'anon label', pid, when); assert.ok(r.ok && r.recorded, JSON.stringify(r)); return r.entry!; };
  // the target's entries: an ordinary seed, today's daily (hot) and a day old enough to go cold
  const e1 = sub('mod-seed', tgt);
  const today = v.dailyRecord('2030-03-12', t0)!; sub(today.seed, tgt);
  const oldRec = v.dailyRecord('2030-01-10', new Date('2030-01-10T10:00:00Z'))!; const e3 = sub(oldRec.seed, tgt, new Date('2030-01-10T11:00:00Z'));
  assert.ok(v.splitCold(t0).moved.includes('2030-01-10')); assert.equal(v.board(oldRec.seed)[0].player, label, 'a cold entry resolves its label');
  const anonEntry = v.submit(JSON.stringify(exportReplay(twistRun('mod-seed'))), 'anon label', null, t0).entry!;
  const where = (x: Verifier) => [x.board('mod-seed').find((e) => e.replayHash === e1.replayHash)!.player, x.daily(10, t0)!.entries[0].player, x.board(oldRec.seed)[0].player, x.entry(e1.replayHash)!.player, x.replay(e1.replayHash)!.player, x.replay(e3.replayHash)!.player, x.archive({}, t0).days.find((d) => d.date === '2030-01-10')!.top[0].player];
  assert.deepEqual(where(v), Array(7).fill(label));
  // refusals: reporter without a name, reason off the list, anonymous target, unknown targets, self
  assert.deepEqual(v.report(unnamed, { playerId: tgt }, 'spam', t0), { ok: false, error: 'claim a name before reporting', status: 422 });
  assert.deepEqual(REPORT_REASONS, ['offensive', 'impersonation', 'personal-info', 'spam', 'other']);
  assert.equal((v.report(rep, { playerId: tgt }, 'because', t0) as { error: string }).error, `reason must be one of ${REPORT_REASONS.join(', ')}`);
  assert.deepEqual(v.report(rep, { hash: anonEntry.replayHash }, 'spam', t0), { ok: false, error: 'anonymous entries cannot be reported', status: 422 });
  assert.equal((v.report(rep, { hash: 'nope' }, 'spam', t0) as { status: number }).status, 404);
  assert.equal((v.report(rep, { playerId: 'f'.repeat(64) }, 'spam', t0) as { status: number }).status, 404);
  assert.equal((v.report(rep, {}, 'spam', t0) as { status: number }).status, 422);
  assert.equal((v.report(rep, { playerId: rep }, 'spam', t0) as { error: string }).error, 'you cannot report yourself');
  assert.equal(fs.existsSync(audit), false, 'refusals write no audit row');
  // a report by hash hides the name everywhere; nothing else moves
  assert.deepEqual(v.report(rep, { hash: e1.replayHash }, 'offensive', t0), { ok: true, playerId: tgt, hidden: true, duplicate: false });
  assert.equal(v.hidden(tgt), true); assert.equal(HIDDEN_LABEL, 'player');
  assert.deepEqual(where(v), Array(7).fill(HIDDEN_LABEL), 'hot board, daily, cold board, /entry, hot and cold replay, archive');
  assert.equal(v.board('mod-seed').find((e) => e.replayHash === anonEntry.replayHash)!.player, 'anon label', 'other entries untouched');
  assert.equal(v.board('mod-seed').find((e) => e.replayHash === e1.replayHash)!.score, e1.score, 'scores never change');
  assert.equal(v.player(tgt)!.name, 'Rude Name', 'the record keeps the name; only its display is hidden');
  // one report per reporter; a second reporter counts; the moderator's list
  assert.deepEqual(v.report(rep, { playerId: tgt }, 'spam', t0), { ok: true, playerId: tgt, hidden: true, duplicate: true });
  assert.deepEqual(v.report(third, { playerId: tgt }, 'impersonation', new Date(t0.getTime() + 1000)), { ok: true, playerId: tgt, hidden: true, duplicate: false });
  const list = v.reports(); assert.equal(list.length, 1);
  assert.deepEqual([list[0].playerId, list[0].name, list[0].currentName, list[0].tag, list[0].hidden, list[0].hiddenAt, list[0].clears], [tgt, 'Rude Name', 'Rude Name', tag, true, t0.toISOString(), 0]);
  assert.deepEqual(list[0].reports.map((r) => [r.reporterId, r.reason]), [[rep, 'offensive'], [third, 'impersonation']]);
  // the player renames while hidden: still hidden, the moderator sees both names; the hide survives a restart
  const t1 = new Date(t0.getTime() + RENAME_COOLDOWN_MS + 1);
  assert.ok(v.claim(tgt, 'Nicer', t1).ok); assert.equal(v.board('mod-seed').find((e) => e.replayHash === e1.replayHash)!.player, HIDDEN_LABEL, 'a rename does not lift a hide'); assert.equal(v.reports()[0].currentName, 'Nicer');
  const again = new Verifier(file, { dailySecret: 'mod-secret' }); assert.equal(again.hidden(tgt), true); assert.equal(again.board('mod-seed').find((e) => e.replayHash === e1.replayHash)!.player, HIDDEN_LABEL);
  // clear: shown again under the current name, reports closed, clears 1; nothing left to clear
  assert.deepEqual(again.clearReports(tgt, t1), { ok: true, playerId: tgt, name: 'Nicer', clears: 1 });
  assert.equal((again.clearReports(tgt, t1) as { status: number }).status, 404);
  assert.deepEqual([again.board('mod-seed').find((e) => e.replayHash === e1.replayHash)!.player, again.board(oldRec.seed)[0].player, again.entry(e1.replayHash)!.player, again.replay(e3.replayHash)!.player], Array(4).fill(`Nicer#${tag}`));
  assert.deepEqual(again.reports(), []);
  // re-reported once more: hidden again; cleared again: clears 2; a third report is recorded but no longer hides
  assert.equal((again.report(rep, { playerId: tgt }, 'other', t1) as { hidden: boolean }).hidden, true);
  assert.equal(again.clearReports(tgt, t1).ok, true);
  assert.deepEqual(again.report(third, { playerId: tgt }, 'spam', t1), { ok: true, playerId: tgt, hidden: false, duplicate: false });
  assert.equal(again.board('mod-seed').find((e) => e.replayHash === e1.replayHash)!.player, `Nicer#${tag}`, `after ${MAX_HIDES_PER_NAME} clears a report no longer hides the name`);
  assert.equal(again.reports()[0].reports.length, 1); assert.equal(again.reports()[0].clears, 2);
  // a new name after a clear starts clean (the record goes with the rename) and can be hidden again
  const t2 = new Date(t1.getTime() + RENAME_COOLDOWN_MS + 1);
  assert.ok(again.claim(tgt, 'Newest', t2).ok); assert.deepEqual(again.reports(), []);
  assert.equal((again.report(rep, { playerId: tgt }, 'offensive', t2) as { hidden: boolean }).hidden, true);
  // forced rename: filtered, follows the player onto every board, drops the record, restarts the cooldown
  assert.equal((again.forceRename(tgt, 'adm1n', t2) as { status: number }).status, 422);
  assert.equal((again.forceRename('f'.repeat(64), 'Fine', t2) as { status: number }).status, 404);
  const forced = again.forceRename(tgt, 'Player 1234', t2); assert.ok(forced.ok); if (forced.ok) { assert.equal(forced.player.name, 'Player 1234'); assert.equal(forced.player.tag, tag); }
  assert.deepEqual([again.board('mod-seed').find((e) => e.replayHash === e1.replayHash)!.player, again.board(oldRec.seed)[0].player, again.daily(10, t2, '2030-03-12')!.entries[0].player, again.replay(e3.replayHash)!.player], Array(4).fill(`Player 1234#${tag}`)); // t2 is two days on: the 12th is final by then, still relabelled
  assert.equal(again.hidden(tgt), false); assert.deepEqual(again.reports(), []);
  const own = again.claim(tgt, 'Rude Again', new Date(t2.getTime() + 60_000)); assert.equal(own.ok, false); if (!own.ok) assert.match(own.error, /recently/);
  // forced group rename, filtered too
  const g = again.createGroup(rep, 'Lunch Crew', t2); assert.ok(g.ok); const code = g.ok ? g.group.code : '';
  assert.equal((again.forceRenameGroup(code, 'adm1n', t2) as { status: number }).status, 422); assert.equal((again.forceRenameGroup('zzzzzzzz', 'x', t2) as { status: number }).status, 404);
  assert.deepEqual(again.forceRenameGroup(code, 'Lunch Club', t2), { ok: true, group: { code, name: 'Lunch Club' } }); assert.equal(again.group(code)!.name, 'Lunch Club');
  // deletion drops the record
  assert.equal((again.report(rep, { playerId: third }, 'spam', t2) as { hidden: boolean }).hidden, true); again.deletePlayer(third); assert.equal(again.hidden(third), false); assert.deepEqual(again.reports(), []);
  // the audit file: one row per report and moderator action, in order, nothing for refusals or duplicates
  const rows = fs.readFileSync(audit, 'utf8').trim().split('\n').map((l) => JSON.parse(l) as Record<string, unknown>);
  assert.deepEqual(rows.map((r) => r.action), ['report', 'report', 'clear', 'report', 'clear', 'report', 'report', 'rename', 'rename-group', 'report']);
  assert.deepEqual(rows[0], { at: t0.toISOString(), action: 'report', playerId: tgt, name: 'Rude Name', reason: 'offensive', by: rep, hidden: true, reports: 1 });
  assert.deepEqual(rows[2], { at: t1.toISOString(), action: 'clear', playerId: tgt, name: 'Nicer', by: 'moderator', clears: 1, closed: 2 });
  assert.deepEqual(rows[7], { at: t2.toISOString(), action: 'rename', playerId: tgt, from: 'Newest', to: 'Player 1234', by: 'moderator', closed: 1 });
  assert.deepEqual(rows[8], { at: t2.toISOString(), action: 'rename-group', code, from: 'Lunch Crew', to: 'Lunch Club', by: 'moderator' });
  // HTTP: a bearer and the per-player bucket on /report; the reported player is told; moderator endpoints 403 when off, 401 on a wrong or a player token, 200 with the token
  const srv = await listen(again, { rateLimit: null, now: () => t2.getTime(), moderationToken: 'mod-token' });
  const call = async (method: string, p: string, headers: Record<string, string>, body?: unknown) => { const r = await fetch(`${srv.base}${p}`, { method, headers: { 'Content-Type': 'application/json', ...headers }, body: body === undefined ? undefined : JSON.stringify(body) }); return { status: r.status, json: await r.json() as Record<string, unknown> }; };
  const bear = (c: string) => ({ Authorization: `Bearer ${tok(c)}` });
  try {
    assert.equal((await call('POST', '/report', {}, { playerId: tgt, reason: 'spam' })).status, 401);
    assert.equal((await call('POST', '/identity', bear('e'), { name: 'Eve' })).status, 200);
    const r1 = await call('POST', '/report', bear('e'), { playerId: tgt, reason: 'spam' }); assert.equal(r1.status, 200); assert.equal(r1.json.hidden, true);
    const me = await call('GET', '/identity', bear('b')); assert.equal(me.json.hidden, true); assert.equal(me.json.hiddenLabel, HIDDEN_LABEL); assert.equal(me.json.name, 'Player 1234', 'the player is told, and keeps their name');
    assert.equal((await call('POST', '/report', bear('e'), { playerId: tgt, reason: 'nope' })).status, 422);
    assert.equal((await call('POST', '/report', bear('e'), { hash: 'nope', reason: 'spam' })).status, 404);
    for (let i = 0; i < REPORT_RATE_LIMIT - 3; i++) assert.equal((await call('POST', '/report', bear('e'), { playerId: tgt, reason: 'spam' })).status, 200);
    const limited = await call('POST', '/report', bear('e'), { playerId: tgt, reason: 'spam' }); assert.equal(limited.status, 429, 'every call counts against the bucket, duplicates and refusals too');
    const off = await listen(again, { rateLimit: null });
    try { assert.equal((await fetch(`${off.base}/moderation/reports`, { headers: { 'X-Moderation-Token': 'mod-token' } })).status, 403, 'off without MODERATION_TOKEN'); } finally { off.close(); }
    assert.equal((await call('GET', '/moderation/reports', {})).status, 401);
    assert.equal((await call('GET', '/moderation/reports', { 'X-Moderation-Token': 'mod-tokem' })).status, 401);
    assert.equal((await call('GET', '/moderation/reports', bear('b'))).status, 401, 'a player bearer is not a moderator token');
    const mod = { 'X-Moderation-Token': 'mod-token' };
    const lst = await call('GET', '/moderation/reports', mod); assert.equal(lst.status, 200);
    const reps = lst.json.reports as { playerId: string; hidden: boolean; name: string; reports: unknown[] }[]; assert.equal(reps.length, 1); assert.deepEqual([reps[0].playerId, reps[0].hidden, reps[0].name, reps[0].reports.length], [tgt, true, 'Player 1234', 1]); assert.deepEqual(lst.json.reasons, REPORT_REASONS);
    assert.equal((await call('POST', '/moderation/clear', mod, { playerId: 'f'.repeat(64) })).status, 404);
    assert.equal((await call('POST', '/moderation/clear', mod, { playerId: tgt })).status, 200); assert.equal((await call('GET', '/identity', bear('b'))).json.hidden, undefined);
    assert.equal((await call('POST', '/moderation/rename', mod, { playerId: tgt, name: 'adm1n' })).status, 422);
    const rn = await call('POST', '/moderation/rename', mod, { playerId: tgt, name: 'Renamed Http' }); assert.equal(rn.status, 200); assert.equal((rn.json.player as { name: string }).name, 'Renamed Http');
    assert.equal(((await call('GET', '/board?seed=mod-seed', {})).json.entries as BoardEntry[]).find((e) => e.replayHash === e1.replayHash)!.player, `Renamed Http#${tag}`);
    assert.equal((await call('POST', '/moderation/rename-group', mod, { code, name: 'Http Club' })).status, 200); assert.equal(again.group(code)!.name, 'Http Club');
    assert.equal((await call('POST', '/moderation/other', mod, {})).status, 404);
    assert.equal((await call('GET', '/health', {})).status, 200);
  } finally { srv.close(); }
});

test('every user-written field passes the one name filter (PLAN-v4 §1): a blocked string is kept out of storage by each of USER_WRITTEN_FIELDS, and the verifier has exactly one nameProblem call site per field', async () => {
  const { USER_WRITTEN_FIELDS } = await import('../server/verify');
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'jd-fields-')), 'board.json');
  const v = new Verifier(file, { auditFile: null });
  const t0 = new Date('2030-03-12T10:00:00Z');
  const a = playerIdFromToken('a'.repeat(32))!, b = playerIdFromToken('b'.repeat(32))!;
  assert.ok(v.claim(a, 'Alice', t0).ok); const g = v.createGroup(a, 'Fine Group', t0); const code = g.ok ? g.group.code : '';
  const BLOCKED = 'the 0ff1cial one'; // folds to "theofficialone": refused after leetspeak folding
  assert.equal(nameProblem(BLOCKED), 'name is not allowed');
  const pushes: Record<typeof USER_WRITTEN_FIELDS[number], () => boolean> = { // true when the blocked string was kept out of storage
    'display name (POST /identity)': () => !v.claim(b, BLOCKED, t0).ok && v.player(b) === null,
    'group name (POST /groups)': () => !v.createGroup(a, BLOCKED, t0).ok && v.groupsOf(a).every((x) => x.name !== BLOCKED),
    'group name (POST /groups/rename)': () => !v.renameGroup(a, code, BLOCKED, t0).ok && v.group(code)!.name === 'Fine Group',
    'anonymous label (POST /verify player)': () => { const r = v.submit(JSON.stringify(exportReplay(finishedRun('fields-seed'))), BLOCKED, null, t0); return r.ok === true && r.recorded === true && r.player === 'anonymous' && v.board('fields-seed')[0].player === 'anonymous' && v.replay(r.entry!.replayHash)!.player === 'anonymous'; },
    'forced display name (POST /moderation/rename)': () => !v.forceRename(a, BLOCKED, t0).ok && v.player(a)!.name === 'Alice',
    'forced group name (POST /moderation/rename-group)': () => !v.forceRenameGroup(code, BLOCKED, t0).ok && v.group(code)!.name === 'Fine Group',
  };
  assert.deepEqual(Object.keys(pushes).sort(), [...USER_WRITTEN_FIELDS].sort(), 'the enumeration and the verifier\'s list agree');
  for (const field of USER_WRITTEN_FIELDS) assert.equal(pushes[field](), true, `${field} let a blocked string through`);
  assert.equal(fs.readFileSync(file, 'utf8').includes(BLOCKED), false, 'the blocked string is nowhere in the stored board');
  const src = fs.readFileSync(path.join(process.cwd(), 'server', 'verify.ts'), 'utf8');
  assert.equal((src.match(/\bnameProblem\(/g) ?? []).length, USER_WRITTEN_FIELDS.length, 'a new nameProblem call site means a new user-written field: add it to USER_WRITTEN_FIELDS and to this test (the bugnet lesson)');
});
