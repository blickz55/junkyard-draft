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
import { randomBytes } from 'node:crypto';

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
class CheckFailed extends Error {}
const fail = (msg: string): never => { throw new CheckFailed(msg); }; // the exit code is set in main(): process.exit() during an open fetch trips a libuv assertion on Windows

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
  // identity (PLAN-v3 0.6.0): claim a name with a fresh device token, then submit with the bearer
  const token = randomBytes(16).toString('hex');
  const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };
  const claim = await fetch(`${url}/identity`, { method: 'POST', headers, body: JSON.stringify({ name: 'image smoke' }) });
  const who = await claim.json() as { ok: boolean; name?: string; tag?: string; error?: string };
  if (claim.status !== 200 || !who.ok || !who.tag) fail(`/identity answered ${claim.status}: ${JSON.stringify(who)}`);
  const label = `${who.name}#${who.tag}`;
  console.log(`claimed ${label}`);
  const run = finishedRun(seed);
  const res = await fetch(`${url}/verify`, { method: 'POST', headers, body: JSON.stringify({ replay: exportReplay(run) }) });
  const body = await res.json() as { ok: boolean; score?: number; error?: string; player?: string; recorded?: boolean };
  if (res.status !== 200 || !body.ok) fail(`/verify answered ${res.status}: ${JSON.stringify(body)}`);
  if (body.score !== run.score) fail(`verifier score ${body.score} differs from the local ${run.score}`);
  if (body.player !== label || body.recorded !== true) fail(`submission not stamped with the claimed label: ${JSON.stringify(body)}`);
  const b = await board();
  if (b.entries.length !== 1 || b.entries[0].player !== label) fail(`board unexpected: ${JSON.stringify(b)}`);
  const d = await (await fetch(`${url}/daily`)).json() as { minted?: boolean; seed?: string; commitment?: string; date?: string };
  if (d.minted !== true || !/^daily-\d{4}-\d{2}-\d{2}-[a-z2-7]{8}$/.test(d.seed ?? '') || !/^[0-9a-f]{64}$/.test(d.commitment ?? '')) fail(`/daily is not a minted daily: ${JSON.stringify(d)}`);
  const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
  const early = await fetch(`${url}/daily?date=${tomorrow}`);
  if (early.status !== 403) fail(`tomorrow's daily should be refused with 403, got ${early.status}`);
  console.log(`daily ${d.date} minted as ${d.seed}; commitment published; tomorrow refused`);
  const wk = await (await fetch(`${url}/weekly`)).json() as { minted?: boolean; seed?: string; week?: string; commitment?: string };
  if (wk.minted !== true || !/^weekly-\d{4}-W\d{2}-[a-z2-7]{8}$/.test(wk.seed ?? '') || !/^[0-9a-f]{64}$/.test(wk.commitment ?? '')) fail(`/weekly is not a minted weekly: ${JSON.stringify(wk)}`);
  console.log(`weekly ${wk.week} minted as ${wk.seed}`);
  const twoBack = new Date(Date.now() - 2 * 86_400_000).toISOString().slice(0, 10);
  const old = await (await fetch(`${url}/daily?date=${twoBack}`)).json() as { final?: boolean; frozenAt?: string | null };
  if (old.final !== true || !old.frozenAt) fail(`a day two days back should be final: ${JSON.stringify(old)}`);
  const arch = await (await fetch(`${url}/archive`)).json() as { ok?: boolean; days?: { date: string; n: number; medals?: { n: number; bronze: number; silver: number; gold: number } | null }[] };
  if (!arch.ok || arch.days?.[0]?.date !== twoBack) fail(`/archive should list ${twoBack} first: ${JSON.stringify(arch)}`);
  const day = arch.days![0];
  if (!('medals' in day)) fail(`a frozen day carries a medals field (PLAN-v3 0.6.4): ${JSON.stringify(day)}`);
  if (day.n < 5 ? day.medals !== null : !(day.medals && day.medals.n === day.n && day.medals.bronze <= day.medals.silver && day.medals.silver <= day.medals.gold)) fail(`medals must be null below five runs and ordered thresholds from five: ${JSON.stringify(day)}`);
  console.log(`medals for ${twoBack}: ${day.medals ? `gold ≥ $${day.medals.gold} · silver ≥ $${day.medals.silver} · bronze ≥ $${day.medals.bronze}` : 'none (fewer than five runs)'}`);
  console.log(`archive lists ${twoBack} as final`);
  // name moderation (PLAN-v4 0.7.7): a report needs a bearer and a reason from the list; the moderator endpoints are off without MODERATION_TOKEN
  if ((await fetch(`${url}/report`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ hash: 'x', reason: 'spam' }) })).status !== 401) fail('/report without a bearer should be 401');
  const badReason = await fetch(`${url}/report`, { method: 'POST', headers, body: JSON.stringify({ hash: body.player, reason: 'because' }) });
  if (badReason.status !== 422) fail(`/report with a reason off the list should be 422, got ${badReason.status}`);
  const mod = await fetch(`${url}/moderation/reports`);
  if (mod.status !== 403 && mod.status !== 401) fail(`/moderation/reports without a token should be 403 (off) or 401 (on), got ${mod.status}`);
  console.log(`moderation: /report guarded (401 without a bearer, 422 off-list reason); moderator endpoints ${mod.status === 403 ? 'off' : 'on and guarded'}`);
  // 0.8.1: a group-scoped read without a bearer is refused; its code must not reach the request log (tools/log-check.ts reads the container's log after this)
  if ((await fetch(`${url}/board?seed=${encodeURIComponent(seed)}&group=smokecode`)).status !== 401) fail('a group-scoped read without a bearer should be 401');
  const h2 = await (await fetch(`${url}/health`)).json() as { hotFileBytes?: number; lastCommitMs?: number; limiters?: { read?: number }; log?: string; historyStart?: string };
  if (typeof h2.hotFileBytes !== 'number' || typeof h2.lastCommitMs !== 'number' || !h2.limiters || h2.log !== 'json' || !h2.historyStart) fail(`/health lacks the 0.8.1 fields: ${JSON.stringify(h2)}`);
  console.log(`health: hot file ${h2.hotFileBytes} B, last commit ${h2.lastCommitMs} ms, history from ${h2.historyStart}`);
  const dup = await fetch(`${url}/verify`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ replay: exportReplay(run), player: 'again' }) });
  if (dup.status !== 422) fail(`a duplicate replay should be refused with 422, got ${dup.status}`);
  console.log(`verified $${body.score} for ${seed}; board has 1 entry; duplicate refused`);
}
main().then(() => { process.exitCode = 0; }, (e: unknown) => { console.error(e instanceof CheckFailed ? `FAIL ${e.message}` : `FAIL ${String(e)}`); process.exitCode = 1; });
