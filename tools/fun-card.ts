/**
 * The fun card (docs/GOALS.md): what bots can say about whether the game is any good, on yards the tuning never saw.
 *   node --import tsx tools/fun-card.ts [--yards 40] [--prefix fun] [--budget 1200] [--workers 24] [--variant name] [--validate] [--json out]
 * `--variant` measures one of the versions in VARIANTS. `--validate` measures the game and every ruined version: a card that does not mark
 * them down measures nothing.
 */
import fs from 'node:fs';
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { fileURLToPath } from 'node:url';
import { RULES, TRIAL } from '../game/src/sim/rules';
import { yardFor } from '../game/src/sim/yard';
import { Rng } from '../game/src/sim/rng';
import { playSeed } from './autoplay-lib';
import { plainLine } from './job-study';
import { cardOf, printCard, yardTree, type TierGame, type YardResult, type Card } from './fun-lib';
import { override } from './balance-lib';
import { starsFor } from '../game/src/sim/yard';

interface Variant {
  label: string;
  /** dotted numeric RULES overrides */
  rules?: Record<string, number>;
  /** rules on trial to switch on */
  trial?: Partial<typeof TRIAL>;
}
/** Versions of the game made worse on purpose, each breaking one thing the card claims to see. */
export const RUINED: Variant[] = [
  {
    label: 'one card only',
    rules: {
      'draftWeights.crusher': 0,
      'draftWeights.furnace': 0,
      'draftWeights.splitter': 0,
      'draftWeights.press': 0,
      'draftWeights.dock': 0,
      'draftWeights.tuner': 0,
    },
  },
  { label: 'raw scrap pays like the job', rules: { 'value.scrap': 24, 'value.shards': 24, 'value.slag': 24 } },
  { label: 'machines crawl', rules: { 'process.crusher': 12, 'process.furnace': 16, 'process.press': 12 } },
  {
    label: 'stars for nothing',
    rules: { 'job.stars.ingot.0': 1, 'job.stars.ingot.1': 2, 'job.stars.ingot.2': 3, 'job.stars.plate.0': 1, 'job.stars.plate.1': 2, 'job.stars.plate.2': 3 },
  },
  { label: 'two-second shifts', rules: { ticksPerRound: 12 } },
  { label: 'a yard the size of a table', rules: { 'yard.rubbleMin': 18, 'yard.rubbleMax': 22 } },
];
/** Rules on trial. */
const TRIALS: Variant[] = [
  { label: 'splitter ahead', trial: { splitterAhead: 1 } },
  { label: 'side entry', trial: { sideEntry: 1 } },
  { label: 'easy wiring', trial: { splitterAhead: 1, sideEntry: 1 } },
  { label: 'ramp 4', trial: { rampFrom: 4 } },
  { label: 'buyer 4', trial: { buyerFrom: 4 } },
  { label: 'easy ramp 4', trial: { splitterAhead: 1, sideEntry: 1, rampFrom: 4 } },
  { label: 'easy buyer 4', trial: { splitterAhead: 1, sideEntry: 1, buyerFrom: 4 } },
  { label: 'easy ramp buyer', trial: { splitterAhead: 1, sideEntry: 1, rampFrom: 4, buyerFrom: 4 } },
  { label: 'head start', trial: { headStart: 1 } },
  { label: 'head easy', trial: { headStart: 1, splitterAhead: 1, sideEntry: 1 } },
  {
    label: 'head easy tuner',
    trial: { headStart: 1, splitterAhead: 1, sideEntry: 1, tunerHopper: 1, tunerStack: 1 },
    rules: { 'draftWeights.tuner': 24, 'offerFromRound.tuner': 2 },
  },
  { label: 'head easy buyer', trial: { headStart: 1, splitterAhead: 1, sideEntry: 1, buyerFrom: 4 } },
  { label: 'head easy ramp buyer', trial: { headStart: 1, splitterAhead: 1, sideEntry: 1, rampFrom: 4, buyerFrom: 4 } },
  { label: 'tuner hopper', trial: { tunerHopper: 1 } },
  { label: 'tuner all', trial: { tunerHopper: 1, tunerStack: 1 } },
  { label: 'tuner all common', trial: { tunerHopper: 1, tunerStack: 1 }, rules: { 'draftWeights.tuner': 24, 'offerFromRound.tuner': 2 } },
  {
    label: 'easy tuner',
    trial: { splitterAhead: 1, sideEntry: 1, tunerHopper: 1, tunerStack: 1 },
    rules: { 'draftWeights.tuner': 24, 'offerFromRound.tuner': 2 },
  },
  {
    label: 'easy tuner buyer',
    trial: { splitterAhead: 1, sideEntry: 1, tunerHopper: 1, tunerStack: 1, buyerFrom: 4 },
    rules: { 'draftWeights.tuner': 24, 'offerFromRound.tuner': 2 },
  },
  {
    label: 'easy tuner fast crusher',
    trial: { splitterAhead: 1, sideEntry: 1, tunerHopper: 1, tunerStack: 1 },
    rules: { 'draftWeights.tuner': 24, 'offerFromRound.tuner': 2, 'process.crusher': 1 },
  },
];
const VARIANTS: Variant[] = [...RUINED, ...TRIALS];

function tierGame(seed: string, tries: number, reach: number): TierGame {
  const { report } = playSeed(seed, new Rng(`${seed}:fun:${tries}`), tries, { reach: { final: reach, pick: reach } });
  const job = yardFor(seed).job!;
  const units = job.material === 'ingot' ? report.ingots : report.plates;
  return { score: report.score, units, stars: starsFor(job, units) };
}
function measure(seed: string, budget: number, deep: boolean, keepPaths = false): YardResult {
  const tree = yardTree(seed, budget, keepPaths);
  const job = yardFor(seed).job!;
  const asPlain = (p: { score: number; shipped: number }): TierGame => ({ score: p.score, units: p.shipped, stars: starsFor(job, p.shipped) });
  // a novice gets the recipe going two shifts late and adds nothing; a casual player has it from shift 2 and adds nothing
  const tiers = { novice: asPlain(plainLine(seed, 2)), casual: asPlain(plainLine(seed, 0)), competent: tierGame(seed, 30, 3) };
  return { tree, tiers, deeper: deep ? yardTree(seed, budget * 8).best.score : undefined };
}

if (!isMainThread && parentPort) {
  const { variant, budget } = workerData as { variant: Variant | null; budget: number };
  if (variant?.rules) override(variant.rules);
  if (variant?.trial) Object.assign(TRIAL, variant.trial);
  parentPort.on('message', (m: { seed: string; deep: boolean }) => parentPort!.postMessage(measure(m.seed, budget, m.deep)));
}

function measureAll(seeds: string[], variant: Variant | null, budget: number, workers: number, deepen = true): Promise<YardResult[]> {
  return new Promise((resolve, reject) => {
    const out: YardResult[] = [];
    const queue = seeds.map((seed, i) => ({ seed, deep: deepen && i % 7 === 0 }));
    const pool: Worker[] = [];
    const next = (w: Worker) => {
      const job = queue.shift();
      if (job) w.postMessage(job);
    };
    for (let i = 0; i < Math.min(workers, seeds.length); i++) {
      const w = new Worker(fileURLToPath(import.meta.url), { workerData: { variant, budget }, execArgv: process.execArgv });
      pool.push(w);
      w.on('error', reject);
      w.on('message', (r: YardResult) => {
        out.push(r);
        process.stderr.write(`\r${variant?.label ?? 'the game'}: ${out.length}/${seeds.length}   `);
        if (out.length === seeds.length) {
          process.stderr.write('\n');
          for (const p of pool) void p.terminate();
          resolve(out.sort((a, b) => a.tree.seed.localeCompare(b.tree.seed)));
        } else next(w);
      });
      next(w);
    }
  });
}

if (isMainThread) {
  const args = process.argv.slice(2);
  const opt = (k: string, d: string) => (args.includes(`--${k}`) ? args[args.indexOf(`--${k}`) + 1] : d);
  const YARDS = Number(opt('yards', '40'));
  const PREFIX = opt('prefix', 'fun');
  const BUDGET = Number(opt('budget', '1200'));
  const WORKERS = Number(opt('workers', '24'));
  const seeds = Array.from({ length: YARDS }, (_, i) => `${PREFIX}-${i}`);
  const t0 = Date.now();
  const named = opt('variant', '');
  const chosen = named ? (VARIANTS.find((v) => v.label === named) ?? VARIANTS.find((v) => v.label.includes(named))) : null;
  if (named && !chosen) throw new Error(`no variant ${named}`);
  const base = cardOf(await measureAll(seeds, chosen ?? null, BUDGET, WORKERS, !args.includes('--trials')));
  console.log(printCard(chosen?.label ?? `the game, rules as they stand (${RULES.rounds} shifts)`, base));
  const report: { yards: number; budget: number; ms: number; card: Card; ruined?: { label: string; total: number; drop: number }[] } = {
    yards: YARDS,
    budget: BUDGET,
    ms: 0,
    card: base,
  };
  if (args.includes('--trials')) {
    const list = opt('trials', '')
      .split(',')
      .map((n) => VARIANTS.find((v) => v.label === n));
    const rows: string[] = [];
    for (const v of list) {
      if (!v) throw new Error('no such trial');
      const c = cardOf(await measureAll(seeds, v, BUDGET, WORKERS, false));
      console.log(printCard(v.label, c));
      rows.push(`${c.total - base.total >= 0 ? '+' : ''}${c.total - base.total}  ${v.label}: ${c.total}, lowest ${c.lowest}, expert $${c.medians.expert}`);
    }
    console.log(`\nAgainst the game as it stands, ${base.total}:\n${rows.join('\n')}`);
  }
  if (args.includes('--validate')) {
    report.ruined = [];
    for (const v of RUINED) {
      const c = cardOf(await measureAll(seeds, v, BUDGET, WORKERS));
      console.log(printCard(v.label, c));
      report.ruined.push({ label: v.label, total: c.total, drop: base.total - c.total });
    }
    console.log(`\nValidation: ${report.ruined.map((r) => `${r.label} -${r.drop}`).join(', ')}`);
  }
  report.ms = Date.now() - t0;
  console.log(`${Math.round(report.ms / 1000)} s`);
  const out = opt('json', '');
  if (out) fs.writeFileSync(out, JSON.stringify(report, null, 1) + '\n');
}
