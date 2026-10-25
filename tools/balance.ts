/**
 * Balance probe for one machine (default: the press). Plays the same seeds with identical draft
 * offers under several conditions and reports what the machine is worth:
 *   - baseline (rules as shipped)
 *   - ban: the player refuses the machine (its marginal value = baseline − ban, per seed)
 *   - tuning variants (hold ticks, product value) applied by mutating RULES in-process — diagnostic
 *     only; shipping any of them requires editing rules.ts and bumping RULES_VERSION.
 *
 *   node --import tsx tools/balance.ts [--seeds 40] [--tries 120] [--prefix bal] [--json out.json]
 */
import fs from 'node:fs';
import { RULES } from '../game/src/sim/rules';
import { Rng } from '../game/src/sim/rng';
import type { MachineKind } from '../game/src/sim/types';
import { playSeed, type SeedReport } from './autoplay-lib';

const args = process.argv.slice(2);
const opt = (k: string, d: string) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };
const SEEDS = Number(opt('seeds', '40'));
const TRIES = Number(opt('tries', '120'));
const PREFIX = opt('prefix', 'bal');
const JSON_OUT = opt('json', '');
const KIND: MachineKind = 'press';

interface Variant { label: string; ban?: boolean; hold?: number; plate?: number }
const VARIANTS: Variant[] = [
  { label: 'baseline (v2: hold 2, plate $8)' },
  { label: 'ban press (never drafted)', ban: true },
  { label: 'hold 1 tick', hold: 1 },
  { label: 'plate $9', plate: 9 },
  { label: 'plate $10', plate: 10 },
  { label: 'hold 1 + plate $9', hold: 1, plate: 9 },
];

const mut = RULES as unknown as { process: Record<string, number>; value: Record<string, number> };
const orig = { hold: mut.process.press, plate: mut.value.plate };

function runVariant(v: Variant): SeedReport[] {
  mut.process.press = v.hold ?? orig.hold;
  mut.value.plate = v.plate ?? orig.plate;
  const ban = v.ban ? new Set<MachineKind>([KIND]) : undefined;
  const out: SeedReport[] = [];
  for (let i = 0; i < SEEDS; i++) { const seed = `${PREFIX}-${i}`; out.push(playSeed(seed, new Rng(`${seed}:search`), TRIES, { ban }).report); }
  mut.process.press = orig.hold; mut.value.plate = orig.plate;
  return out;
}

const q = (sorted: number[], p: number) => sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];
function summarize(label: string, reps: SeedReport[], banned?: SeedReport[]) {
  const scores = reps.map((r) => r.score).sort((a, b) => a - b);
  const offered = reps.reduce((a, r) => a + r.offers.filter((o) => o.includes(KIND)).length, 0);
  const picked = reps.reduce((a, r) => a + r.picks.filter((p) => p === KIND).length, 0);
  const seedsOffered = reps.filter((r) => r.offers.some((o) => o.includes(KIND))).length;
  const seedsPicked = reps.filter((r) => r.picks.includes(KIND)).length;
  const res: Record<string, unknown> = {
    label, min: scores[0], p25: q(scores, 0.25), median: q(scores, 0.5), p75: q(scores, 0.75), max: scores[scores.length - 1],
    mean: Math.round(scores.reduce((a, b) => a + b, 0) / scores.length),
    offeredRounds: offered, pickedRounds: picked, pickRateWhenOffered: offered ? +(picked / offered).toFixed(2) : 0, seedsOffered, seedsPicked,
  };
  if (banned) {
    const deltas = reps.map((r, i) => r.score - banned[i].score);
    const pickedDeltas = reps.map((r, i) => (r.picks.includes(KIND) ? r.score - banned[i].score : null)).filter((d): d is number => d != null);
    res.vsBan = {
      meanDelta: Math.round(deltas.reduce((a, b) => a + b, 0) / deltas.length),
      seedsBetter: deltas.filter((d) => d > 0).length, seedsWorse: deltas.filter((d) => d < 0).length,
      meanDeltaWhenPicked: pickedDeltas.length ? Math.round(pickedDeltas.reduce((a, b) => a + b, 0) / pickedDeltas.length) : 0,
      maxGain: Math.max(0, ...deltas), maxLoss: Math.min(0, ...deltas),
    };
  }
  return res;
}

const t0 = Date.now();
const results = VARIANTS.map((v) => ({ v, reps: runVariant(v) }));
const banned = results.find((r) => r.v.ban)!.reps;
const summary = results.map(({ v, reps }) => summarize(v.label, reps, v.ban ? undefined : banned));
// why the press loses when it loses: what did the searcher take instead when a press was offered but not picked?
const base = results[0].reps;
const insteadOf: Record<string, number> = {};
for (const r of base) r.offers.forEach((o, i) => { if (o.includes(KIND) && r.picks[i] !== KIND) insteadOf[r.picks[i]] = (insteadOf[r.picks[i]] || 0) + 1; });
const out = { seeds: SEEDS, triesPerRound: TRIES, ms: Date.now() - t0, kind: KIND, summary, baselinePickedInsteadOfPress: insteadOf };
console.log(JSON.stringify(out, null, 1));
if (JSON_OUT) fs.writeFileSync(JSON_OUT, JSON.stringify({ ...out, reports: Object.fromEntries(results.map((r) => [r.v.label, r.reps])) }, null, 1));
