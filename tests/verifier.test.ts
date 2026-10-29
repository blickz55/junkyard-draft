import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Verifier, createServer, RateLimiter, clientIp, clampInt, replayId, loadBoard, StorageError, EventStore, histogramOf, niceStep, computeParSync, computeParInWorker, ParService, finalMachinesOf, TIE_BREAK, playerIdFromToken, RENAME_COOLDOWN_MS, type BoardEntry } from '../server/verify';
import { tagFor } from '../game/src/identity/identity';
import { build as esbuild } from 'esbuild';
import net from 'node:net';
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
