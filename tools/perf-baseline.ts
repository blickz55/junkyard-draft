/**
 * The perf baseline from several CI reports. GitHub's runners differ, so one artifact says more about the host it landed on than about the code: this
 * takes the sample with the middle total script time for each label, and the worst drop rate seen, so a slow host passes on identical code.
 *   node --import tsx tools/perf-baseline.ts <report.json> [<report.json> …] --out docs/baselines/ci/perf-ci.json
 * Read reports from runs of the same code where you can: rerunning one green run a few times is the cheapest way to meet several hosts.
 */
import fs from 'node:fs';
import { scriptTotal, type GateReport, type GateSample } from './perf-gate';

/** One sample per label: the middle of the runs by total script time, carrying the highest drop rate any of them showed. */
export function baselineFrom(reports: readonly GateReport[]): GateReport {
  const byLabel = new Map<string, GateSample[]>();
  for (const r of reports)
    for (const s of r.samples ?? []) if (s.scriptMsPerFrame != null && s.frames > 0) byLabel.set(s.label, [...(byLabel.get(s.label) ?? []), s]);
  const samples = [...byLabel.values()].map((list) => {
    const sorted = [...list].sort((a, b) => scriptTotal(a)! - scriptTotal(b)!);
    const middle = sorted[Math.floor((sorted.length - 1) / 2)];
    const worst = Math.max(...list.map((s) => s.dropped / s.frames));
    return { ...middle, dropped: Math.ceil(worst * middle.frames) };
  });
  return { samples };
}

const isMain = process.argv[1] && /perf-baseline\.(ts|mjs|js)$/.test(process.argv[1]);
if (isMain) {
  const args = process.argv.slice(2);
  const at = args.indexOf('--out');
  const files = args.filter((_, i) => i !== at && i !== at + 1);
  if (at < 0 || !args[at + 1] || !files.length) {
    console.error('usage: perf-baseline <report.json> [<report.json> …] --out <file>');
    process.exit(2);
  }
  const out = baselineFrom(files.map((f) => JSON.parse(fs.readFileSync(f, 'utf8')) as GateReport));
  fs.writeFileSync(args[at + 1], `${JSON.stringify(out, null, 2)}\n`);
  for (const s of out.samples) console.log(`${s.label}: ${Math.round(scriptTotal(s)!)} ms over ${s.frames} frames, ${s.dropped} dropped at the worst rate`);
}
