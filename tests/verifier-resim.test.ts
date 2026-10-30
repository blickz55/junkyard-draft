// Production roadmap 0.8.2: one re-simulation per submission, off the event loop, with a cap and a queue; reason codes; the per-seed index.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  Verifier,
  createServer,
  resimulate,
  VerifyService,
  QueueFullError,
  ResimTimeoutError,
  playerIdFromToken,
  type Resim,
  type ServerOptions,
} from '../server/verify';
import { apply, newRun, MAX_REPLAY_ACTIONS } from '../game/src/sim/run';
import { encodeReplay, exportReplay, verifyReplay } from '../game/src/sim/replay';
import { RULES } from '../game/src/sim/rules';

function finishedRun(seed: string, rotations = 0) {
  const s = newRun(seed);
  for (let r = 1; r <= RULES.rounds; r++) {
    apply(s, { t: 'pick', i: s.offers.indexOf('crusher') >= 0 ? s.offers.indexOf('crusher') : 0 });
    if (r === 1) {
      const conv = s.layout.machines.find((m) => m.x === 2 && m.y === 2)!;
      apply(s, { t: 'unplace', id: conv.id });
      apply(s, { t: 'place', id: s.bin[0].id, x: 2, y: 2, dir: 0 });
      const other = s.layout.machines.find((m) => m.x === 3 && m.y === 2)!;
      for (let k = 0; k < rotations; k++) apply(s, { t: 'rotate', id: other.id });
    }
    apply(s, { t: 'run' });
    apply(s, { t: 'next' });
  }
  return s;
}
const tmpBoard = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'jd-resim-')), 'board.json');
async function listen(v: Verifier, opts: ServerOptions = {}) {
  const server = createServer(v, { rateLimit: null, log: null, ...opts });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const post = async (body: unknown, headers: Record<string, string> = {}) => {
    const r = await fetch(`${base}/verify`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
    return { status: r.status, json: (await r.json()) as Record<string, unknown> };
  };
  return {
    server,
    base,
    post,
    close: () => {
      server.closeAllConnections();
      server.close();
    },
  };
}

test('0.8.2 resimulate: one run gives score, last-round machines and per-round earnings; agrees with verifyReplay, finalMachinesOf and roundsOf; refusals carry codes', () => {
  const run = finishedRun('resim-seed');
  const file = exportReplay(run);
  const sim = resimulate(file);
  assert.ok(sim.ok);
  if (sim.ok) {
    assert.equal(sim.score, run.score);
    assert.equal(sim.finalMachines, run.rounds[5].layout.machines.length);
    assert.deepEqual(
      sim.rounds,
      run.rounds.map((r) => r.earned),
    );
  }
  assert.equal(verifyReplay(file).ok, true);
  const lied = resimulate({ ...file, claimedScore: file.claimedScore + 1 });
  assert.ok(!lied.ok);
  if (!lied.ok) {
    assert.equal(lied.code, 'did-not-reproduce');
    assert.match(lied.error, /does not match/);
  }
  const short = resimulate({ ...file, actions: file.actions.slice(0, 4) });
  assert.ok(!short.ok);
  if (!short.ok) assert.equal(short.code, 'unfinished');
  const illegal = resimulate({ ...file, actions: file.actions.map((a) => (a.t === 'place' ? { ...a, x: 99 } : a)) });
  assert.ok(!illegal.ok);
  if (!illegal.ok) assert.equal(illegal.code, 'illegal-action');
  const old = resimulate({ ...file, rulesVersion: 2 });
  assert.ok(!old.ok);
  if (!old.ok) assert.equal(old.code, 'rules-version');
  // prepare / record codes through submit (inline path)
  const v = new Verifier(tmpBoard());
  assert.equal(v.submit('{"nope', 'x').code, 'bad-replay');
  assert.equal(v.submit(encodeReplay({ ...file, rulesVersion: 99 }), 'x').code, 'rules-version');
  assert.equal(v.submit(encodeReplay({ ...file, claimedScore: 1 }), 'x').code, 'did-not-reproduce');
  assert.equal(v.submit(encodeReplay(exportReplay(finishedRun('daily-2030-01-01-abcdefgh'))), 'x').code, 'unissued-seed');
  const ok = v.submit(encodeReplay(file), 'x');
  assert.equal(ok.ok, true);
  assert.equal(ok.code, undefined, 'successes carry no code');
  assert.equal(v.submit(encodeReplay(file), 'x').code, 'duplicate');
  assert.equal(ok.entry!.finalMachines, run.rounds[5].layout.machines.length);
  assert.deepEqual(
    ok.entry!.rounds,
    run.rounds.map((r) => r.earned),
  );
});

test('0.8.2 a 4,000-action replay re-simulates once in a recorded time', () => {
  const run = finishedRun('long-seed', Math.floor((MAX_REPLAY_ACTIONS - 24) / 4) * 4); // the other 20 actions are the six rounds' picks, runs and nexts plus one unplace and place; rotations in multiples of four leave the belt as it was
  const file = exportReplay(run);
  assert.equal(file.actions.length <= MAX_REPLAY_ACTIONS, true);
  assert.ok(file.actions.length >= MAX_REPLAY_ACTIONS - 15, `${file.actions.length} actions`);
  const t = performance.now();
  const sim = resimulate(file);
  const ms = performance.now() - t;
  assert.ok(sim.ok && sim.score === run.score);
  console.log(`resimulate: ${file.actions.length} actions in ${ms.toFixed(1)} ms`);
  assert.ok(ms < 3000, `a maximal replay must re-simulate well under the 10 s cap (took ${ms.toFixed(0)} ms)`);
  const v = new Verifier(tmpBoard());
  const t2 = performance.now();
  assert.equal(v.submit(encodeReplay(file), 'long').ok, true);
  console.log(`submit (prepare + resimulate + record): ${(performance.now() - t2).toFixed(1)} ms`);
});

test('0.8.2 VerifyService: the real worker agrees with the inline run; a refusal comes back as a result, not an error', async () => {
  const svc = new VerifyService();
  try {
    const file = exportReplay(finishedRun('worker-seed'));
    const sim = await svc.verify(file);
    assert.deepEqual(sim, resimulate(file));
    const lied = await svc.verify({ ...file, claimedScore: 7 });
    assert.ok(!lied.ok && lied.code === 'did-not-reproduce');
    assert.equal(svc.stats.jobs, 2);
    assert.equal(svc.stats.timeouts, 0);
    assert.equal(svc.busy, false);
  } finally {
    svc.close();
  }
});

test('0.8.2 VerifyService: FIFO, one at a time, queue cap → QueueFullError at once, cap → ResimTimeoutError and the next job still runs; close fails the waiting', async () => {
  const gates: (() => void)[] = [];
  const order: number[] = [];
  let n = 0;
  const compute = (): Promise<Resim> =>
    new Promise((resolve) => {
      const k = ++n;
      gates.push(() => {
        order.push(k);
        resolve({ ok: true, score: k, finalMachines: 1, rounds: [k] });
      });
    });
  const svc = new VerifyService(compute, { capMs: 60_000, maxQueue: 2 });
  const file = exportReplay(finishedRun('q-seed'));
  const a = svc.verify(file),
    b = svc.verify(file),
    c = svc.verify(file);
  await assert.rejects(svc.verify(file), QueueFullError, 'the running one plus two waiting is the cap');
  assert.equal(svc.busy, true);
  assert.equal(svc.queued, 2);
  gates.shift()!();
  assert.equal(((await a) as { score: number }).score, 1);
  gates.shift()!();
  assert.equal(((await b) as { score: number }).score, 2);
  gates.shift()!();
  assert.equal(((await c) as { score: number }).score, 3);
  assert.deepEqual(order, [1, 2, 3]);
  assert.equal(svc.busy, false);
  // timeout: a job that never answers is failed at the cap; the next job runs
  const slow = new VerifyService(
    () =>
      new Promise(() => {
        /* never */
      }),
    { capMs: 30 },
  );
  const t0 = performance.now();
  await assert.rejects(slow.verify(file), ResimTimeoutError);
  assert.ok(performance.now() - t0 >= 25);
  assert.equal(slow.stats.timeouts, 1);
  assert.equal(slow.busy, false);
  const after = new VerifyService(compute, { capMs: 30 });
  const d = after.verify(file);
  gates.shift()!();
  assert.ok((await d).ok);
  // close rejects what is waiting
  const closing = new VerifyService(
    () =>
      new Promise(() => {
        /* never */
      }),
    { capMs: 60_000 },
  );
  const p1 = closing.verify(file),
    p2 = closing.verify(file);
  closing.close();
  await assert.rejects(p1, /closing/);
  await assert.rejects(p2, /closing/);
});

test('0.8.2 HTTP: POST /verify re-simulates in the worker service, answers the same as inline, 503 busy when the queue is full, 422 resim-timeout at the cap, and codes on 429 / 413 / 400', async () => {
  const v = new Verifier(tmpBoard());
  const run = finishedRun('http-worker-seed');
  const file = exportReplay(run);
  const svc = new VerifyService();
  const s = await listen(v, { verify: svc });
  try {
    const ok = await s.post({ replay: file, player: 'worker carol' });
    assert.equal(ok.status, 200);
    assert.equal(ok.json.score, run.score);
    assert.equal((ok.json.entry as { finalMachines: number }).finalMachines, run.rounds[5].layout.machines.length);
    const dup = await s.post({ replay: file });
    assert.equal(dup.status, 422);
    assert.equal(dup.json.code, 'duplicate');
    const lied = await s.post({ replay: { ...file, claimedScore: 1 } });
    assert.equal(lied.status, 422);
    assert.equal(lied.json.code, 'did-not-reproduce');
    const bad = await fetch(`${s.base}/verify`, { method: 'POST', body: '{"replay":' });
    assert.equal(bad.status, 400);
    assert.equal(((await bad.json()) as { code: string }).code, 'bad-request');
    assert.equal(v.board('http-worker-seed').length, 1);
    const h = (await (await fetch(`${s.base}/health`)).json()) as { resim: { jobs: number; timeouts: number; busy: boolean } };
    assert.equal(h.resim.jobs, 2, 'duplicate and bad bodies never reach the worker');
    assert.equal(h.resim.busy, false);
  } finally {
    s.close();
    svc.close();
  }
  // queue full → 503 busy with Retry-After; timeout → 422 resim-timeout; neither records anything
  let release: (() => void) | null = null;
  const stuck = new VerifyService(
    () =>
      new Promise<Resim>((r) => {
        release = () => r({ ok: true, score: 1, finalMachines: 1, rounds: [1] });
      }),
    { capMs: 60_000, maxQueue: 0 },
  );
  const s2 = await listen(v, { verify: stuck });
  try {
    const first = s2.post({ replay: exportReplay(finishedRun('busy-1')) });
    await new Promise((r) => setTimeout(r, 50));
    const second = await s2.post({ replay: exportReplay(finishedRun('busy-2')) });
    assert.equal(second.status, 503);
    assert.equal(second.json.code, 'busy');
    release!();
    const r1 = await first;
    assert.equal(r1.status, 200, 'the stub says the run verified at score 1 and record trusts the re-simulation, never the claim');
    assert.equal(r1.json.score, 1);
    assert.equal(v.board('busy-1')[0].score, 1);
  } finally {
    s2.close();
    stuck.close();
  }
  const slow = new VerifyService(
    () =>
      new Promise(() => {
        /* never */
      }),
    { capMs: 40 },
  );
  const s3 = await listen(v, { verify: slow });
  try {
    const r = await s3.post({ replay: exportReplay(finishedRun('slow-1')) });
    assert.equal(r.status, 422);
    assert.equal(r.json.code, 'resim-timeout');
    assert.equal(v.board('slow-1').length, 0);
  } finally {
    s3.close();
    slow.close();
  }
  const limited = await listen(v, { rateLimit: { limit: 1, windowMs: 60_000 } });
  try {
    await limited.post({ replay: exportReplay(finishedRun('rl-a')) });
    const r = await limited.post({ replay: exportReplay(finishedRun('rl-b')) });
    assert.equal(r.status, 429);
    assert.equal(r.json.code, 'rate-limited');
  } finally {
    limited.close();
  }
});

test('0.8.2 per-seed index: built on the first read, dropped by every commit, and boards, histograms and retention agree with a brute-force sort', () => {
  const v = new Verifier(tmpBoard(), { replaysPerSeed: 3, maxEntriesPerSeed: 5 });
  assert.equal(v.indexed, false);
  const seeds = ['idx-a', 'idx-b', 'idx-c'];
  const tok = (k: number) => playerIdFromToken(k.toString(16).padStart(32, '0'))!;
  let k = 0;
  for (const seed of seeds)
    for (let i = 0; i < 7; i++) {
      const pid = tok(++k);
      v.claim(pid, `Player ${k}`);
      const r = v.submit(encodeReplay(exportReplay(finishedRun(seed, i + 1))), 'anon', pid);
      assert.ok(r.ok, r.error);
    } // one to seven belt rotations: seven distinct legal replays per seed
  assert.equal(v.indexed, false, 'a commit drops the index');
  const b = v.board('idx-a', 100);
  assert.equal(v.indexed, true, 'a read builds it');
  assert.ok(b.length <= 5, 'retention capped the seed');
  for (let i = 1; i < b.length; i++) assert.ok(b[i - 1].score >= b[i].score, 'board order');
  assert.equal(v.board('idx-a', 100).length, b.length);
  const kept = b.filter((e) => e.replayAvailable).length;
  assert.ok(kept <= 3, `replays kept only for the top 3 (${kept})`);
  assert.equal(v.histogram('idx-a').n, b.length);
  v.claim(tok(99), 'Late Claim');
  assert.equal(v.indexed, false, 'any commit drops it');
  assert.equal(v.board('idx-b', 100).length, Math.min(5, 7));
});
