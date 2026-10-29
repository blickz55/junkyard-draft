/**
 * Smoke test for a running verifier (the Docker image in CI, or any URL): waits for /health, builds a legal finished
 * replay with the real simulation, submits it, and checks the board. With --expect-entries N it only checks that the
 * board for the smoke seed holds N entries (used after a container restart to prove the volume persisted).
 *   node --import tsx tools/image-smoke.ts http://127.0.0.1:4400 [--expect-entries 1] [--seed image-smoke]
 * Exit 0 on success, 1 on any failed check, 2 on usage.
 */
import { apply, newRun } from '../game/src/sim/run';
import { exportReplay } from '../game/src/sim/replay';
import { RULES } from '../game/src/sim/rules';

const args = process.argv.slice(2);
const url = args.find((a) => /^https?:\/\//.test(a));
const flag = (k: string) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : undefined; };
if (!url) { console.error('usage: image-smoke <url> [--expect-entries N] [--seed name]'); process.exit(2); }
const seed = flag('seed') ?? 'image-smoke';
const expectEntries = flag('expect-entries') != null ? Number(flag('expect-entries')) : null;

function finishedRun(s: string) {
  const run = newRun(s);
  for (let r = 1; r <= RULES.rounds; r++) {
    const i = run.offers.indexOf('crusher');
    apply(run, { t: 'pick', i: i >= 0 ? i : 0 });
    if (r === 1) { const conv = run.layout.machines.find((m) => m.x === 2 && m.y === 2)!; apply(run, { t: 'unplace', id: conv.id }); apply(run, { t: 'place', id: run.bin[0].id, x: 2, y: 2, dir: 0 }); }
    apply(run, { t: 'run' }); apply(run, { t: 'next' });
  }
  return run;
}
const fail = (msg: string): never => { console.error(`FAIL ${msg}`); process.exit(1); };

async function main() {
  interface Health { ok?: boolean; rulesVersion?: number }
  let health: Health | null = null;
  for (let i = 0; i < 60 && !health; i++) { try { const r = await fetch(`${url}/health`); if (r.ok) health = await r.json() as Health; } catch { /* not up yet */ } if (!health) await new Promise((r) => setTimeout(r, 1000)); }
  if (!health?.ok) fail('/health never answered ok');
  console.log(`health ok, rules v${health!.rulesVersion}`);
  const board = async () => (await (await fetch(`${url}/board?seed=${encodeURIComponent(seed)}`)).json()) as { entries: { score: number; player: string }[] };
  if (expectEntries != null) {
    const b = await board();
    if (b.entries.length !== expectEntries) fail(`expected ${expectEntries} entries for ${seed}, found ${b.entries.length}`);
    console.log(`board for ${seed}: ${b.entries.length} entr${b.entries.length === 1 ? 'y' : 'ies'} after restart`);
    return;
  }
  const run = finishedRun(seed);
  const res = await fetch(`${url}/verify`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ replay: exportReplay(run), player: 'image smoke' }) });
  const body = await res.json() as { ok: boolean; score?: number; error?: string };
  if (res.status !== 200 || !body.ok) fail(`/verify answered ${res.status}: ${JSON.stringify(body)}`);
  if (body.score !== run.score) fail(`verifier score ${body.score} differs from the local ${run.score}`);
  const b = await board();
  if (b.entries.length !== 1 || b.entries[0].player !== 'image smoke') fail(`board unexpected: ${JSON.stringify(b)}`);
  const dup = await fetch(`${url}/verify`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ replay: exportReplay(run), player: 'again' }) });
  if (dup.status !== 422) fail(`a duplicate replay should be refused with 422, got ${dup.status}`);
  console.log(`verified $${body.score} for ${seed}; board has 1 entry; duplicate refused`);
}
main().catch((e) => fail(String(e)));
