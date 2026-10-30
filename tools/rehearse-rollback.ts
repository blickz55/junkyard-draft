/**
 * Release-day rehearsal (PLAN-v2 0.5.6): deploy a rules-v3 verifier over a rules-v2 board, confirm the old entries stop
 * ranking and v2 replays are refused with the version named, submit a v3 replay, then roll back to the v2 bundle on the
 * same data and confirm the v2 entry ranks again while the v3 entry does not. Both bundles are built here: v2 from
 * `git archive main`, v3 from the working tree. Writes docs/baselines/0.5/rollback-rehearsal.json and exits 1 on any failed check.
 *   node --import tsx tools/rehearse-rollback.ts [--v2-ref main] [--out docs/baselines/0.5/rollback-rehearsal.json]
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execSync, spawn, type ChildProcess } from 'node:child_process';
import { build } from 'esbuild';
import net from 'node:net';
import { apply, newRun } from '../game/src/sim/run';
import { exportReplay } from '../game/src/sim/replay';
import { RULES } from '../game/src/sim/rules';

const args = process.argv.slice(2);
const opt = (k: string, d: string) => {
  const i = args.indexOf(`--${k}`);
  return i >= 0 ? args[i + 1] : d;
};
const V2_REF = opt('v2-ref', 'main');
const OUT = opt('out', 'docs/baselines/0.5/rollback-rehearsal.json');
const ROOT = process.cwd();
const steps: { step: string; ok: boolean; detail: unknown }[] = [];
const check = (step: string, ok: boolean, detail: unknown) => {
  steps.push({ step, ok, detail });
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${step} ${JSON.stringify(detail)}`);
};

async function freePort(): Promise<number> {
  return new Promise((res) => {
    const s = net.createServer();
    s.listen(0, '127.0.0.1', () => {
      const p = (s.address() as { port: number }).port;
      s.close(() => res(p));
    });
  });
}
async function bundle(entryRoot: string, out: string) {
  await build({
    entryPoints: [path.join(entryRoot, 'server', 'verify.ts')],
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node20',
    outfile: out,
    logLevel: 'silent',
    absWorkingDir: entryRoot,
  });
}
async function start(bundleFile: string, dataDir: string, port: number, env: Record<string, string> = {}): Promise<ChildProcess> {
  const child = spawn(process.execPath, [bundleFile, '--host', '127.0.0.1', '--port', String(port), '--data-dir', dataDir], {
    env: { ...process.env, BOT_PAR: '0', VERIFIER_LOG: '0', ...env },
    stdio: 'ignore',
  });
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${port}/health`);
      if (r.ok) return child;
    } catch {
      /* starting */
    }
    await new Promise((r) => setTimeout(r, 150));
  }
  child.kill();
  throw new Error(`verifier at ${bundleFile} did not start`);
}
const stop = (c: ChildProcess) =>
  new Promise<void>((res) => {
    c.once('exit', () => res());
    c.kill();
    setTimeout(res, 2000);
  });
const health = async (port: number) =>
  (await (await fetch(`http://127.0.0.1:${port}/health`)).json()) as { rulesVersion: number; entries: number; entriesAllVersions: number };
const board = async (port: number, seed: string) =>
  (await (await fetch(`http://127.0.0.1:${port}/board?seed=${encodeURIComponent(seed)}`)).json()) as { entries: { score: number; player: string }[] };
const daily = async (port: number) =>
  (await (await fetch(`http://127.0.0.1:${port}/daily`)).json()) as { seed: string; commitment: string; entries: { player: string }[] };
function finishedRun(seed: string) {
  const s = newRun(seed);
  for (let r = 1; r <= RULES.rounds; r++) {
    const i = s.offers.indexOf('crusher');
    apply(s, { t: 'pick', i: i >= 0 ? i : 0 });
    if (r === 1) {
      const conv = s.layout.machines.find((m) => m.x === 2 && m.y === 2)!;
      apply(s, { t: 'unplace', id: conv.id });
      apply(s, { t: 'place', id: s.bin[0].id, x: 2, y: 2, dir: 0 });
    }
    apply(s, { t: 'run' });
    apply(s, { t: 'next' });
  }
  return s;
}
const submit = async (port: number, replay: unknown, player: string) => {
  const r = await fetch(`http://127.0.0.1:${port}/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ replay, player }),
  });
  return { status: r.status, body: (await r.json()) as { ok: boolean; error?: string; score?: number } };
};

async function main() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'jd-rehearse-'));
  const v2src = path.join(tmp, 'v2');
  fs.mkdirSync(v2src);
  // run from the temp dir with a relative target so bash never sees a Windows path
  execSync(
    `git -C "${ROOT.replace(/\\/g, '/')}" archive --format=tar ${V2_REF} server game/src/sim game/src/telemetry tools/autoplay-lib.ts package.json | tar -x -C v2`,
    { cwd: tmp, stdio: 'inherit', shell: 'bash' },
  );
  const v2bundle = path.join(tmp, 'verify-v2.mjs'),
    v3bundle = path.join(tmp, 'verify-v3.mjs');
  await bundle(v2src, v2bundle);
  await bundle(ROOT, v3bundle);
  const v2replay = JSON.parse(fs.readFileSync(path.join(ROOT, 'tests/golden/archive/v2/golden-press.json'), 'utf8')) as {
    seed: string;
    rulesVersion: number;
    claimedScore: number;
  };
  const v3replay = JSON.parse(fs.readFileSync(path.join(ROOT, 'tests/golden/golden-press.json'), 'utf8')) as {
    seed: string;
    rulesVersion: number;
    claimedScore: number;
  };
  check('corpus versions', v2replay.rulesVersion === 2 && v3replay.rulesVersion === 3, { v2: v2replay.rulesVersion, v3: v3replay.rulesVersion });
  const data = path.join(tmp, 'data');
  fs.mkdirSync(data);
  const port = await freePort();
  // 1. the old service, with a verified v2 entry
  let srv = await start(v2bundle, data, port);
  let h = await health(port);
  check('v2 service up', h.rulesVersion === 2, h);
  let s = await submit(port, v2replay, 'v2 player');
  check('v2 replay accepted by v2', s.status === 200 && s.body.ok && s.body.score === v2replay.claimedScore, s);
  let b = await board(port, v2replay.seed);
  check('v2 board ranks it', b.entries.length === 1, b.entries);
  await stop(srv);
  // 2. deploy v3 over the same data
  srv = await start(v3bundle, data, port);
  h = await health(port);
  check('v3 service up on the same data: v2 entry kept but not ranked', h.rulesVersion === 3 && h.entries === 0 && h.entriesAllVersions === 1, h);
  b = await board(port, v2replay.seed);
  check('v2 board empty under v3', b.entries.length === 0, b.entries);
  s = await submit(port, v2replay, 'v2 player again');
  check('v2 replay refused by v3 with its version named', s.status === 422 && /version 2/.test(s.body.error ?? ''), s);
  s = await submit(port, v3replay, 'v3 player');
  check('v3 replay accepted by v3', s.status === 200 && s.body.ok && s.body.score === v3replay.claimedScore, s);
  h = await health(port);
  check('v3 counts', h.entries === 1 && h.entriesAllVersions === 2, h);
  await stop(srv);
  // 3. roll back to v2 on the same data
  srv = await start(v2bundle, data, port);
  h = await health(port);
  check('rollback: v2 service up, v3 entry kept but not ranked', h.rulesVersion === 2 && h.entries === 1 && h.entriesAllVersions === 2, h);
  b = await board(port, v2replay.seed);
  check(
    'rollback: the v2 entry ranks again, with its replay intact',
    b.entries.length === 1 && b.entries[0].player === 'v2 player' && (b.entries[0] as { replayAvailable?: boolean }).replayAvailable === true,
    b.entries,
  );
  s = await submit(port, v3replay, 'v3 again');
  check('rollback: a v3 replay is refused by v2 with its version named', s.status === 422 && /version 3/.test(s.body.error ?? ''), s);
  await stop(srv);
  // 4. forward again: nothing lost
  srv = await start(v3bundle, data, port);
  h = await health(port);
  check('re-deploy v3: both entries still stored, v3 ranks', h.rulesVersion === 3 && h.entries === 1 && h.entriesAllVersions === 2, h);
  await stop(srv);
  // 5. rotate the daily secret (PLAN-v3 0.6.1): an issued day keeps its stored seed and still accepts submissions; only unissued days mint anew
  srv = await start(v3bundle, data, port, { DAILY_SECRET: 'rehearsal-secret-A' });
  const dA = await daily(port);
  check('daily minted under secret A with a commitment', /^daily-\d{4}-\d{2}-\d{2}-[a-z2-7]{8}$/.test(dA.seed) && /^[0-9a-f]{64}$/.test(dA.commitment), {
    seed: dA.seed,
  });
  await stop(srv);
  srv = await start(v3bundle, data, port, { DAILY_SECRET: 'rehearsal-secret-B' });
  const dB = await daily(port);
  check('after rotating the secret the issued day keeps its stored seed and commitment', dB.seed === dA.seed && dB.commitment === dA.commitment, {
    before: dA.seed,
    after: dB.seed,
  });
  s = await submit(port, exportReplay(finishedRun(dA.seed)), 'rotated');
  check('a run on the stored daily seed still verifies after rotation', s.status === 200 && s.body.ok === true, s);
  const dC = await daily(port);
  check('and reaches the daily board', dC.entries.length === 1 && dC.entries[0].player === 'rotated', dC.entries);
  await stop(srv);
  const ok = steps.every((x) => x.ok);
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify({ at: new Date().toISOString(), v2Ref: V2_REF, ok, steps }, null, 1) + '\n');
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(ok ? 'REHEARSAL PASS' : 'REHEARSAL FAIL');
  process.exit(ok ? 0 : 1);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
