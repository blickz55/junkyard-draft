/**
 * Dead rounds study (production roadmap 0.9.6: a tuning pass, not a system). The autoplayer (tools/autoplay-lib.ts) plays the
 * same seeds under rules v3 and under each candidate; a "flat" round is one where no offer improved the line. Candidates:
 * (a) the late-round offer guarantee (RULES.lateOfferGuarantee, inert in v3), (b) slag and sell value nudges, (c) furnace hold
 * and hopper period. The gate is the roadmap's: flatRoundsTotal under 12 of 120 (from 29), no seed worse on identical offers,
 * every score replay-verified under the candidate's rules, the derived sanity bound unchanged. Diagnostic evidence for the
 * owner's written go/no-go; shipping a candidate means editing rules.ts and bumping RULES_VERSION.
 *
 *   node --import tsx tools/dead-rounds.ts [--seeds 20] [--tries 120] [--prefix auto] [--policy greedy|neutral] [--json out.json] [--only <label substring>]
 */
import fs from 'node:fs';
import { RULES } from '../game/src/sim/rules';
import { RULES_VERSION } from '../game/src/sim/types';
import { Rng } from '../game/src/sim/rng';
import { playSeed, scoreSanityBound, type SeedReport, type SearchPolicy } from './autoplay-lib';
import { verifyActions, override } from './balance-lib';

export interface Candidate {
  label: string;
  /** dotted numeric RULES overrides */
  rules?: Record<string, number>;
  /** RULES.lateOfferGuarantee.rounds */
  lateRounds?: number[];
  note: string;
}
export const CANDIDATES: Candidate[] = [
  {
    label: 'late guarantee rounds 4-5',
    lateRounds: [4, 5],
    note: '(a) rounds 4 and 5 always offer a hopper or a crusher when the draw would have offered neither',
  },
  { label: 'late guarantee rounds 4-6', lateRounds: [4, 5, 6], note: '(a) the same guarantee through round 6' },
  { label: 'slag $2', rules: { 'value.slag': 2 }, note: '(b) slag worth $2 (raw scrap through a furnace costs less)' },
  { label: 'sell $12', rules: { sellValue: 12 }, note: '(b) a sold part pays $12; note: this moves the derived sanity bound' },
  { label: 'furnace hold 2', rules: { 'process.furnace': 2 }, note: '(c) the furnace releases a tick sooner' },
  { label: 'hopper period 3', rules: { hopperPeriod: 3 }, note: '(c) one scrap every three ticks (less supply)' },
  { label: 'late guarantee 4-5 + slag $2', lateRounds: [4, 5], rules: { 'value.slag': 2 }, note: '(a) + (b)' },
];

export interface VariantStudy {
  label: string;
  note: string;
  flatRoundsTotal: number;
  flatByRound: number[];
  deadEndSeeds: string[];
  mostlyFlatSeeds: string[];
  scores: { min: number; p25: number; median: number; p75: number; max: number; mean: number };
  verified: number;
  sanityBound: number;
  /** rounds whose offers differ from the baseline's (the guarantee variants change offers by design) */
  offersChanged: number;
  paired: { seedsWorse: number; seedsBetter: number; seedsSame: number; meanDelta: number; worst: { seed: string; delta: number } | null };
  gate: { flatUnder12: boolean; noneWorse: boolean; allVerified: boolean; boundUnchanged: boolean; pass: boolean };
  reports: SeedReport[];
}

const args = process.argv.slice(2);
const opt = (k: string, d: string) => {
  const i = args.indexOf(`--${k}`);
  return i >= 0 ? args[i + 1] : d;
};
const SEEDS = Number(opt('seeds', '20'));
const TRIES = Number(opt('tries', '120'));
const PREFIX = opt('prefix', 'auto');
const POLICY = opt('policy', 'greedy') as SearchPolicy;
const ONLY = opt('only', '');
const JSON_OUT = opt('json', '');

function play(): { reports: SeedReport[]; verified: number; ms: number } {
  const t0 = Date.now();
  const reports: SeedReport[] = [];
  let verified = 0;
  for (let i = 0; i < SEEDS; i++) {
    const seed = `${PREFIX}-${i}`;
    const { report, actions } = playSeed(seed, new Rng(`${seed}:search:${POLICY}`), TRIES, { policy: POLICY });
    reports.push(report);
    if (verifyActions(seed, actions, report.score)) verified++;
  }
  return { reports, verified, ms: Date.now() - t0 };
}
const quantiles = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const q = (p: number) => s[Math.min(s.length - 1, Math.floor(p * s.length))];
  return { min: s[0], p25: q(0.25), median: q(0.5), p75: q(0.75), max: s[s.length - 1], mean: Math.round((s.reduce((a, b) => a + b, 0) / s.length) * 10) / 10 };
};
function study(label: string, note: string, reports: SeedReport[], verified: number, baseline: SeedReport[] | null, baseBound: number): VariantStudy {
  const flatByRound = Array.from({ length: RULES.rounds }, () => 0);
  for (const r of reports) {
    // a round is flat when the pick did not raise what the line earns; the autoplayer counts them in flatRounds, by round we rederive from earnings
    for (let k = 1; k < r.rounds.length; k++) if (r.rounds[k] <= r.rounds[k - 1]) flatByRound[k]++;
    if (r.rounds.length && r.rounds[0] <= 38) flatByRound[0]++; // the starter line alone earns 38
  }
  const flatRoundsTotal = reports.reduce((n, r) => n + r.flatRounds, 0);
  let offersChanged = 0;
  const deltas: { seed: string; delta: number }[] = [];
  if (baseline) {
    for (let i = 0; i < reports.length; i++) {
      const b = baseline[i];
      const r = reports[i];
      for (let k = 0; k < r.offers.length; k++) if (JSON.stringify(r.offers[k]) !== JSON.stringify(b.offers[k])) offersChanged++;
      deltas.push({ seed: r.seed, delta: r.score - b.score });
    }
  }
  const seedsWorse = deltas.filter((d) => d.delta < 0).length;
  const seedsBetter = deltas.filter((d) => d.delta > 0).length;
  const worst = deltas.length ? deltas.reduce((w, d) => (d.delta < w.delta ? d : w)) : null;
  const sanityBound = scoreSanityBound();
  const gate = {
    flatUnder12: flatRoundsTotal < 12,
    noneWorse: seedsWorse === 0,
    allVerified: verified === reports.length,
    boundUnchanged: sanityBound === baseBound,
    pass: false,
  };
  gate.pass = gate.flatUnder12 && gate.noneWorse && gate.allVerified && gate.boundUnchanged;
  return {
    label,
    note,
    flatRoundsTotal,
    flatByRound,
    deadEndSeeds: reports.filter((r) => r.deadEnd).map((r) => r.seed),
    mostlyFlatSeeds: reports.filter((r) => r.mostlyFlat).map((r) => r.seed),
    scores: quantiles(reports.map((r) => r.score)),
    verified,
    sanityBound,
    offersChanged,
    paired: {
      seedsWorse,
      seedsBetter,
      seedsSame: deltas.length - seedsWorse - seedsBetter,
      meanDelta: deltas.length ? Math.round((deltas.reduce((a, d) => a + d.delta, 0) / deltas.length) * 10) / 10 : 0,
      worst: worst && worst.delta < 0 ? worst : null,
    },
    gate,
    reports,
  };
}

const t0 = Date.now();
const base = play();
const baseBound = scoreSanityBound();
const baseline = study('rules v3 (baseline)', 'the rules as they ship', base.reports, base.verified, null, baseBound);
console.log(
  `baseline: flatRoundsTotal ${baseline.flatRoundsTotal} of ${SEEDS * RULES.rounds}, median $${baseline.scores.median}, verified ${baseline.verified}/${SEEDS}, bound ${baseBound} (${base.ms} ms)`,
);
const variants: VariantStudy[] = [];
for (const c of CANDIDATES) {
  if (ONLY && !c.label.includes(ONLY)) continue;
  const restoreRules = c.rules ? override(c.rules) : () => {};
  const late = RULES.lateOfferGuarantee as { rounds: number[] };
  const prevRounds = late.rounds;
  if (c.lateRounds) late.rounds = c.lateRounds;
  try {
    const r = play();
    const v = study(c.label, c.note, r.reports, r.verified, base.reports, baseBound);
    variants.push(v);
    console.log(
      `${c.label}: flat ${v.flatRoundsTotal} (${v.flatByRound.join('/')}), median $${v.scores.median}, worse ${v.paired.seedsWorse} better ${v.paired.seedsBetter} mean ${v.paired.meanDelta >= 0 ? '+' : ''}${v.paired.meanDelta}, offers changed ${v.offersChanged}, verified ${v.verified}/${SEEDS}, bound ${v.sanityBound} → ${
        v.gate.pass
          ? 'GATE PASS'
          : 'gate fail: ' +
            Object.entries(v.gate)
              .filter(([k, ok]) => k !== 'pass' && !ok)
              .map(([k]) => k)
              .join(', ')
      } (${r.ms} ms)`,
    );
  } finally {
    late.rounds = prevRounds;
    restoreRules();
  }
}
const out = {
  study: 'dead rounds (production roadmap 0.9.6)',
  date: new Date().toISOString().slice(0, 10),
  rulesVersion: RULES_VERSION,
  seeds: SEEDS,
  triesPerRound: TRIES,
  prefix: PREFIX,
  policy: POLICY,
  rounds: RULES.rounds,
  gate: { flatRoundsTotalUnder: 12, noSeedWorse: true, allVerified: true, sanityBoundUnchanged: true },
  ms: Date.now() - t0,
  baseline: { ...baseline },
  variants,
  passing: variants.filter((v) => v.gate.pass).map((v) => v.label),
};
if (JSON_OUT) {
  fs.mkdirSync(JSON_OUT.split(/[\\/]/).slice(0, -1).join('/') || '.', { recursive: true });
  fs.writeFileSync(JSON_OUT, JSON.stringify(out, null, 1));
  console.log(`wrote ${JSON_OUT}`);
}
console.log(out.passing.length ? `passing: ${out.passing.join('; ')}` : 'no candidate passes the gate');
