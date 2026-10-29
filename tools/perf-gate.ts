/**
 * Performance regression gate: compares a perf.ts JSON report against a committed baseline.
 *   node --import tsx tools/perf-gate.ts <report.json> <baseline.json> [--tolerance 0.25] [--dropped-slack 0.05]
 * Exit 1 when any sample whose label exists in the baseline regresses:
 *   - scriptMsPerFrame above baseline × (1 + tolerance), or
 *   - dropped frames above baseline dropped + droppedSlack × frames (so a software-rendered CI runner that
 *     always drops some frames still gates on *more* drops than its own baseline).
 * Samples with no baseline label are reported, never failed. The comparison is a pure function (tested).
 */
import fs from 'node:fs';

export interface GateSample { label: string; frames: number; dropped: number; scriptMsPerFrame: number | null }
export interface GateReport { samples: GateSample[] }
export interface GateOptions { tolerance?: number; droppedSlack?: number }
export interface Verdict { label: string; ok: boolean; reasons: string[]; baseline: GateSample | null; sample: GateSample }

export function compare(report: GateReport, baseline: GateReport, opts: GateOptions = {}): { ok: boolean; verdicts: Verdict[] } {
  const tolerance = opts.tolerance ?? 0.25;
  const slack = opts.droppedSlack ?? 0.05;
  const verdicts: Verdict[] = report.samples.map((sample) => {
    const base = baseline.samples.find((b) => b.label === sample.label) ?? null;
    const reasons: string[] = [];
    if (base) {
      if (sample.scriptMsPerFrame != null && base.scriptMsPerFrame != null && sample.scriptMsPerFrame > base.scriptMsPerFrame * (1 + tolerance)) {
        reasons.push(`scriptMsPerFrame ${sample.scriptMsPerFrame} > ${(base.scriptMsPerFrame * (1 + tolerance)).toFixed(2)} (baseline ${base.scriptMsPerFrame} + ${Math.round(tolerance * 100)} %)`);
      }
      const allowedDropped = base.dropped + Math.ceil(slack * sample.frames);
      if (sample.dropped > allowedDropped) reasons.push(`dropped ${sample.dropped} > ${allowedDropped} (baseline ${base.dropped} + ${Math.round(slack * 100)} % of ${sample.frames} frames)`);
    }
    return { label: sample.label, ok: reasons.length === 0, reasons, baseline: base, sample };
  });
  return { ok: verdicts.every((v) => v.ok), verdicts };
}

const isMain = process.argv[1] && /perf-gate\.(ts|mjs|js)$/.test(process.argv[1]);
if (isMain) {
  const args = process.argv.slice(2);
  const files = args.filter((a) => !a.startsWith('--') && !/^[0-9.]+$/.test(a));
  const opt = (k: string, d: string) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };
  const [reportFile, baselineFile] = files;
  if (!reportFile || !baselineFile) { console.error('usage: perf-gate <report.json> <baseline.json> [--tolerance 0.25] [--dropped-slack 0.05]'); process.exit(2); }
  const report = JSON.parse(fs.readFileSync(reportFile, 'utf8')) as GateReport;
  const baseline = JSON.parse(fs.readFileSync(baselineFile, 'utf8')) as GateReport;
  const { ok, verdicts } = compare(report, baseline, { tolerance: Number(opt('tolerance', '0.25')), droppedSlack: Number(opt('dropped-slack', '0.05')) });
  for (const v of verdicts) {
    const base = v.baseline;
    console.log(`${v.ok ? 'PASS' : 'FAIL'} ${v.label}: script ${v.sample.scriptMsPerFrame ?? '-'} ms (baseline ${base?.scriptMsPerFrame ?? 'none'}), dropped ${v.sample.dropped}/${v.sample.frames} (baseline ${base?.dropped ?? 'none'})${v.reasons.length ? '\n  ' + v.reasons.join('\n  ') : ''}`);
  }
  process.exit(ok ? 0 : 1);
}
