/**
 * Load probe for a running verifier (production roadmap 0.8.2 acceptance): distinct legal replays are submitted at `--rate`
 * per minute from each of `--ips` simulated addresses (X-Forwarded-For; start the target with TRUST_PROXY=1) for `--minutes`,
 * while /health is sampled every 250 ms. Prints the submission outcomes and the latency distributions and exits 1 when the
 * /health p95 is over `--budget` ms (default 100). The replays are built locally with the real simulation (one per seed).
 *   node --import tsx tools/load.ts http://127.0.0.1:4477 [--rate 60] [--ips 3] [--minutes 2] [--budget 100] [--json out.json]
 */
import fs from 'node:fs';
import { apply, newRun } from '../game/src/sim/run';
import { exportReplay } from '../game/src/sim/replay';
import { RULES } from '../game/src/sim/rules';

const args = process.argv.slice(2);
const url = args.find((a) => /^https?:\/\//.test(a));
const flag = (k: string, d: string) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };
if (!url) { console.error('usage: load <url> [--rate 60] [--ips 3] [--minutes 2] [--budget 100] [--json out.json]'); process.exit(2); }
const rate = Number(flag('rate', '60')), ips = Number(flag('ips', '3')), minutes = Number(flag('minutes', '2')), budget = Number(flag('budget', '100')), out = flag('json', '');

function finishedRun(seed: string) {
  const s = newRun(seed);
  for (let r = 1; r <= RULES.rounds; r++) { const i = s.offers.indexOf('crusher'); apply(s, { t: 'pick', i: i >= 0 ? i : 0 }); if (r === 1) { const conv = s.layout.machines.find((m) => m.x === 2 && m.y === 2)!; apply(s, { t: 'unplace', id: conv.id }); apply(s, { t: 'place', id: s.bin[0].id, x: 2, y: 2, dir: 0 }); } apply(s, { t: 'run' }); apply(s, { t: 'next' }); }
  return s;
}
const pct = (xs: number[], p: number) => { if (!xs.length) return 0; const a = [...xs].sort((x, y) => x - y); return a[Math.min(a.length - 1, Math.floor((p / 100) * a.length))]; };
const summary = (xs: number[]) => ({ samples: xs.length, p50: pct(xs, 50), p95: pct(xs, 95), p99: pct(xs, 99), max: xs.length ? Math.max(...xs) : 0 });

async function main() {
  const total = Math.ceil(rate * minutes) * ips;
  console.log(`building ${total} distinct replays…`);
  const t0 = performance.now();
  const replays: { ip: string; body: string }[] = [];
  for (let k = 0; k < ips; k++) for (let i = 0; i < Math.ceil(rate * minutes); i++) replays.push({ ip: `198.51.100.${k + 1}`, body: JSON.stringify({ replay: exportReplay(finishedRun(`load-${Date.now().toString(36)}-${k}-${i}`)), player: `load ${k + 1}` }) });
  console.log(`built in ${((performance.now() - t0) / 1000).toFixed(1)} s; submitting at ${rate}/min from ${ips} address(es) for ${minutes} min`);
  const statuses: Record<string, number> = {}; const codes: Record<string, number> = {}; const verifyMs: number[] = []; const healthMs: number[] = []; let healthErrors = 0;
  const interval = 60_000 / rate; const end = Date.now() + minutes * 60_000;
  const perIp = new Map<string, { ip: string; body: string }[]>(); for (const r of replays) { const a = perIp.get(r.ip) ?? []; a.push(r); perIp.set(r.ip, a); }
  const senders = [...perIp.values()].map(async (list) => {
    for (const r of list) {
      if (Date.now() > end) break;
      const started = Date.now();
      const t = performance.now();
      try { const res = await fetch(`${url}/verify`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': r.ip }, body: r.body }); verifyMs.push(performance.now() - t); statuses[res.status] = (statuses[res.status] ?? 0) + 1; const j = await res.json() as { code?: string }; if (j.code) codes[j.code] = (codes[j.code] ?? 0) + 1; } catch { statuses.error = (statuses.error ?? 0) + 1; }
      const wait = interval - (Date.now() - started); if (wait > 0) await new Promise((res) => setTimeout(res, wait));
    }
  });
  const sampler = (async () => {
    while (Date.now() < end) {
      const t = performance.now();
      try { const r = await fetch(`${url}/health`); await r.json(); healthMs.push(performance.now() - t); } catch { healthErrors++; }
      await new Promise((res) => setTimeout(res, 250));
    }
  })();
  await Promise.all([...senders, sampler]);
  const health = await (await fetch(`${url}/health`)).json() as Record<string, unknown>;
  const report = { url, rate, ips, minutes, submissions: statuses, codes, verifyMs: summary(verifyMs), healthMs: summary(healthMs), healthErrors, healthAfter: { hotFileBytes: health.hotFileBytes, lastCommitMs: health.lastCommitMs, commits: health.commits, resim: health.resim, limiters: health.limiters }, at: new Date().toISOString() };
  console.log(JSON.stringify(report, null, 2));
  if (out) { fs.writeFileSync(out, JSON.stringify(report, null, 2) + '\n'); console.log(`wrote ${out}`); }
  const ok = report.healthMs.p95 <= budget && healthErrors === 0;
  console.log(ok ? `OK   /health p95 ${report.healthMs.p95.toFixed(1)} ms ≤ ${budget} ms budget` : `FAIL /health p95 ${report.healthMs.p95.toFixed(1)} ms over the ${budget} ms budget or ${healthErrors} health error(s)`);
  process.exitCode = ok ? 0 : 1;
}
main().catch((e) => { console.error(String(e)); process.exitCode = 1; });
