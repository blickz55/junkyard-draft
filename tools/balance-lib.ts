/**
 * Balance measurement library (PLAN-v2 0.5.1). Plays identical seeds (identical draft offers, since offers come from the
 * sim's own `${seed}:draft:${round}` stream) under several conditions and reports a machine's marginal value with paired
 * per-seed deltas, enough metadata to reproduce the run, replay-verified action lists for every reported score, and an
 * executable gate. `tools/balance.ts` is the CLI; `tests/balance-tool.test.ts` exercises this module directly.
 *
 * Conditions: `baseline` (rules as shipped), `ban` (the player refuses the machine; its marginal value = baseline − ban per
 * seed) and any number of tuning variants that mutate RULES by dotted path in-process (diagnostic only: shipping a variant
 * means editing rules.ts and bumping RULES_VERSION). Two search policies run side by side: `greedy` (the control: only
 * strictly improving moves) and `neutral` (equal-score moves may be accepted, so routing setups that pay off later are
 * reachable); the review's warning stands — a bounded bot getting worse under a wider choice set is not proof about the
 * rules, so read the paired deltas and both policies, not the raw scores.
 */
import { RULES } from '../game/src/sim/rules';
import { RULES_VERSION } from '../game/src/sim/types';
import type { MachineKind } from '../game/src/sim/types';
import { Rng } from '../game/src/sim/rng';
import { exportReplay, verifyReplay } from '../game/src/sim/replay';
import { apply, newRun, type Action } from '../game/src/sim/run';
import { playSeed, scoreSanityBound, type RerollPolicy, type SearchPolicy, type SeedReport } from './autoplay-lib';
import { RULES as R2 } from '../game/src/sim/rules';

export interface Variant { label: string; ban?: boolean; /** dotted RULES paths to override, e.g. { "process.press": 1, "value.plate": 9 } */ rules?: Record<string, number> }
export interface BalanceOptions {
  machine: MachineKind;
  seeds: number;
  tries: number;
  prefix?: string;
  variants?: Variant[];
  policies?: SearchPolicy[];
  /** label for the build under test (git sha, tag); recorded in meta */
  build?: string;
}
export interface PairedDelta { seed: string; baseline: number; ban: number; delta: number; picked: boolean }
export interface VariantSummary {
  label: string; min: number; p25: number; median: number; p75: number; max: number; mean: number;
  offeredRounds: number; pickedRounds: number; pickRateWhenOffered: number; seedsOffered: number; seedsPicked: number;
  vsBan?: { meanDelta: number; seedsBetter: number; seedsWorse: number; seedsEqual: number; meanDeltaWhenPicked: number; maxGain: number; maxLoss: number; paired: PairedDelta[] };
}
export interface PolicyResult { policy: SearchPolicy; variants: VariantSummary[]; insteadOf: Record<string, number>; /** every reported score re-simulated from its action list */ verified: boolean; unverified: string[] }
export interface BalanceResult {
  meta: { rulesVersion: number; build: string; machine: MachineKind; seeds: number; tries: number; prefix: string; policies: SearchPolicy[]; searchStream: string; offerStream: string; sanityBound: number; ms: number; at: string };
  policies: PolicyResult[];
  /** action lists behind every score, by policy, variant and seed (replay-verified before they were counted) */
  actions: Record<string, Record<string, Record<string, Action[]>>>;
}

const q = (sorted: number[], p: number) => sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];
const mean = (xs: number[]) => (xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : 0);

/** Set a dotted path on RULES, returning a restore function. */
function override(rules: Record<string, number>): () => void {
  const undo: (() => void)[] = [];
  for (const [path, value] of Object.entries(rules)) {
    const parts = path.split('.'); let o = RULES as unknown as Record<string, unknown>;
    for (const p of parts.slice(0, -1)) { if (!o[p] || typeof o[p] !== 'object') throw new Error(`balance: unknown RULES path ${path}`); o = o[p] as Record<string, unknown>; }
    const key = parts[parts.length - 1]; if (typeof o[key] !== 'number') throw new Error(`balance: ${path} is not a numeric rule`);
    const prev = o[key] as number; o[key] = value; undo.push(() => { o[key] = prev; });
  }
  return () => { for (const u of undo.reverse()) u(); };
}

export function defaultVariants(machine: MachineKind): Variant[] { return [{ label: 'baseline' }, { label: `ban ${machine} (never drafted)`, ban: true }]; }

/** Replay the recorded actions from a fresh run and confirm the score the report claims. */
export function verifyActions(seed: string, actions: Action[], claimed: number): boolean {
  try { const s = newRun(seed); for (const a of actions) apply(s, a); const v = verifyReplay(exportReplay(s)); return v.ok && v.score === claimed && s.score === claimed; } catch { return false; }
}

export function summarize(machine: MachineKind, label: string, reps: SeedReport[], banned?: SeedReport[]): VariantSummary {
  const scores = reps.map((r) => r.score).sort((a, b) => a - b);
  const offered = reps.reduce((a, r) => a + r.offers.filter((o) => o.includes(machine)).length, 0);
  const picked = reps.reduce((a, r) => a + r.picks.filter((p) => p === machine).length, 0);
  const res: VariantSummary = {
    label, min: scores[0] ?? 0, p25: q(scores, 0.25) ?? 0, median: q(scores, 0.5) ?? 0, p75: q(scores, 0.75) ?? 0, max: scores[scores.length - 1] ?? 0, mean: mean(scores),
    offeredRounds: offered, pickedRounds: picked, pickRateWhenOffered: offered ? +(picked / offered).toFixed(2) : 0,
    seedsOffered: reps.filter((r) => r.offers.some((o) => o.includes(machine))).length, seedsPicked: reps.filter((r) => r.picks.includes(machine)).length,
  };
  if (banned) {
    const paired: PairedDelta[] = reps.map((r, i) => ({ seed: r.seed, baseline: r.score, ban: banned[i].score, delta: r.score - banned[i].score, picked: r.picks.includes(machine) }));
    const deltas = paired.map((p) => p.delta);
    res.vsBan = { meanDelta: mean(deltas), seedsBetter: deltas.filter((d) => d > 0).length, seedsWorse: deltas.filter((d) => d < 0).length, seedsEqual: deltas.filter((d) => d === 0).length, meanDeltaWhenPicked: mean(paired.filter((p) => p.picked).map((p) => p.delta)), maxGain: Math.max(0, ...deltas), maxLoss: Math.min(0, ...deltas), paired };
  }
  return res;
}

/** Run every variant under every policy on the same seeds. Deterministic for identical options (fixed rng streams). */
export function runBalance(o: BalanceOptions): BalanceResult {
  const t0 = Date.now();
  const prefix = o.prefix ?? 'bal'; const policies = o.policies ?? ['greedy', 'neutral']; const variants = o.variants ?? defaultVariants(o.machine);
  if (!variants.some((v) => !v.ban && !v.rules)) variants.unshift({ label: 'baseline' });
  if (!variants.some((v) => v.ban)) variants.push({ label: `ban ${o.machine} (never drafted)`, ban: true });
  const actions: BalanceResult['actions'] = {};
  const results: PolicyResult[] = [];
  for (const policy of policies) {
    actions[policy] = {};
    const perVariant: { v: Variant; reps: SeedReport[] }[] = [];
    const unverified: string[] = [];
    for (const v of variants) {
      const restore = v.rules ? override(v.rules) : () => {};
      const reps: SeedReport[] = []; actions[policy][v.label] = {};
      try {
        for (let i = 0; i < o.seeds; i++) {
          const seed = `${prefix}-${i}`;
          const { report, actions: acts } = playSeed(seed, new Rng(`${seed}:search:${policy}`), o.tries, { ban: v.ban ? new Set<MachineKind>([o.machine]) : undefined, policy });
          if (!verifyActions(seed, acts, report.score)) unverified.push(`${policy}/${v.label}/${seed}`);
          reps.push(report); actions[policy][v.label][seed] = acts;
        }
      } finally { restore(); }
      perVariant.push({ v, reps });
    }
    const banned = perVariant.find((p) => p.v.ban)!.reps;
    const summaries = perVariant.map(({ v, reps }) => summarize(o.machine, v.label, reps, v.ban ? undefined : banned));
    const base = perVariant[0].reps; const insteadOf: Record<string, number> = {};
    for (const r of base) r.offers.forEach((offer, i) => { if (offer.includes(o.machine) && r.picks[i] !== o.machine) insteadOf[r.picks[i]] = (insteadOf[r.picks[i]] || 0) + 1; });
    results.push({ policy, variants: summaries, insteadOf, verified: unverified.length === 0, unverified });
  }
  return {
    meta: { rulesVersion: RULES_VERSION, build: o.build ?? process.env.JD_BUILD ?? 'dev', machine: o.machine, seeds: o.seeds, tries: o.tries, prefix, policies, searchStream: '${seed}:search:${policy}', offerStream: '${seed}:draft:${round} (sim)', sanityBound: scoreSanityBound(), ms: Date.now() - t0, at: new Date().toISOString() },
    policies: results, actions,
  };
}

/** Reroll study (PLAN-v2 0.5.4): the same seeds with and without the greedy reroll policy; paired deltas, reroll rate, verified actions. */
export interface RerollStudy {
  meta: { rulesVersion: number; seeds: number; tries: number; prefix: string; policy: SearchPolicy; rerollCost: number; ms: number; at: string };
  paired: { seed: string; never: number; greedy: number; delta: number; rerolls: number }[];
  summary: { meanNever: number; meanGreedy: number; meanDelta: number; seedsBetter: number; seedsWorse: number; seedsEqual: number; rerolls: number; rounds: number; rerollRate: number; maxLoss: number };
  verified: boolean; unverified: string[];
  actions: Record<string, Record<string, Action[]>>;
}
export function runRerollStudy(o: { seeds: number; tries: number; prefix?: string; policy?: SearchPolicy }): RerollStudy {
  const t0 = Date.now(); const prefix = o.prefix ?? 'rr'; const policy = o.policy ?? 'greedy';
  const paired: RerollStudy['paired'] = []; const unverified: string[] = []; const actions: RerollStudy['actions'] = { never: {}, greedy: {} };
  for (let i = 0; i < o.seeds; i++) {
    const seed = `${prefix}-${i}`;
    const a = playSeed(seed, new Rng(`${seed}:search:${policy}`), o.tries, { policy, rerollPolicy: 'never' });
    const b = playSeed(seed, new Rng(`${seed}:search:${policy}`), o.tries, { policy, rerollPolicy: 'greedy' });
    if (!verifyActions(seed, a.actions, a.report.score)) unverified.push(`never/${seed}`);
    if (!verifyActions(seed, b.actions, b.report.score)) unverified.push(`greedy/${seed}`);
    actions.never[seed] = a.actions; actions.greedy[seed] = b.actions;
    paired.push({ seed, never: a.report.score, greedy: b.report.score, delta: b.report.score - a.report.score, rerolls: b.report.rerolls });
  }
  const deltas = paired.map((p) => p.delta); const rerolls = paired.reduce((s, p) => s + p.rerolls, 0); const rounds = o.seeds * R2.rounds;
  return {
    meta: { rulesVersion: RULES_VERSION, seeds: o.seeds, tries: o.tries, prefix, policy, rerollCost: R2.rerollCost, ms: Date.now() - t0, at: new Date().toISOString() },
    paired,
    summary: { meanNever: mean(paired.map((p) => p.never)), meanGreedy: mean(paired.map((p) => p.greedy)), meanDelta: mean(deltas), seedsBetter: deltas.filter((d) => d > 0).length, seedsWorse: deltas.filter((d) => d < 0).length, seedsEqual: deltas.filter((d) => d === 0).length, rerolls, rounds, rerollRate: rounds ? +(rerolls / rounds).toFixed(3) : 0, maxLoss: Math.min(0, ...deltas) },
    verified: unverified.length === 0, unverified, actions,
  };
}
export function gateReroll(r: RerollStudy, t: { rate?: [number, number]; maxSeedsWorse?: number } = {}): { ok: boolean; reasons: string[] } {
  const reasons: string[] = [];
  const [lo, hi] = t.rate ?? [0.1, 0.3];
  if (r.summary.rerollRate < lo || r.summary.rerollRate > hi) reasons.push(`reroll rate ${r.summary.rerollRate} outside [${lo}, ${hi}]`);
  // a fruitless reroll costs exactly its price: a seed may end worse by at most rerolls × cost (the bot paid for information it did not use). A larger loss would mean the rule itself hurts.
  const overpaid = r.paired.filter((p) => p.delta < -p.rerolls * r.meta.rerollCost);
  if (overpaid.length) reasons.push(`${overpaid.length} seed(s) lost more than their rerolls cost: ${overpaid.map((p) => `${p.seed} ${p.delta} (${p.rerolls} rerolls)`).join(', ')}`);
  if (t.maxSeedsWorse != null && r.summary.seedsWorse > t.maxSeedsWorse) reasons.push(`${r.summary.seedsWorse} seed(s) worse with rerolls available (max ${t.maxSeedsWorse}): ${r.paired.filter((p) => p.delta < 0).map((p) => `${p.seed} ${p.delta}`).join(', ')}`);
  if (!r.verified) reasons.push(`${r.unverified.length} score(s) did not replay-verify`);
  return { ok: reasons.length === 0, reasons };
}

export interface GateThresholds { /** baseline vs ban: no seed may be worse with the machine allowed */ maxSeedsWorse?: number; /** mean paired delta must exceed this */ minMeanDelta?: number; /** pick rate when offered, inclusive band */ pickRate?: [number, number]; /** every reported score must be replay-verified */ requireVerified?: boolean; /** no score above the derived sanity bound */ sanity?: boolean; /** which policy the gate reads (default greedy, the control) */ policy?: SearchPolicy }
export function gateVerdict(r: BalanceResult, t: GateThresholds = {}): { ok: boolean; reasons: string[] } {
  const reasons: string[] = [];
  const policy = t.policy ?? 'greedy';
  const pr = r.policies.find((p) => p.policy === policy); if (!pr) return { ok: false, reasons: [`no results for policy ${policy}`] };
  const base = pr.variants.find((v) => v.vsBan); if (!base) return { ok: false, reasons: ['no baseline-vs-ban comparison'] };
  const vs = base.vsBan!;
  if (vs.seedsWorse > (t.maxSeedsWorse ?? 0)) reasons.push(`${vs.seedsWorse} seed(s) worse with ${r.meta.machine} allowed (max ${t.maxSeedsWorse ?? 0}): ${vs.paired.filter((p) => p.delta < 0).map((p) => `${p.seed} ${p.delta}`).join(', ')}`);
  if (vs.meanDelta <= (t.minMeanDelta ?? 0)) reasons.push(`mean paired delta ${vs.meanDelta} ≤ ${t.minMeanDelta ?? 0}`);
  if (t.pickRate && (base.pickRateWhenOffered < t.pickRate[0] || base.pickRateWhenOffered > t.pickRate[1])) reasons.push(`pick rate when offered ${base.pickRateWhenOffered} outside [${t.pickRate[0]}, ${t.pickRate[1]}]`);
  if ((t.requireVerified ?? true) && !pr.verified) reasons.push(`${pr.unverified.length} reported score(s) did not replay-verify: ${pr.unverified.slice(0, 5).join(', ')}`);
  if (t.sanity ?? true) for (const v of pr.variants) if (v.max > r.meta.sanityBound) reasons.push(`${v.label}: max score ${v.max} exceeds the sanity bound ${r.meta.sanityBound}`);
  return { ok: reasons.length === 0, reasons };
}
