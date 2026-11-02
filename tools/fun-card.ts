/**
 * The fun card (docs/GOALS.md): what bots can say about whether the game is any good, on yards the tuning never saw.
 *   node --import tsx tools/fun-card.ts [--yards 40] [--prefix fun] [--budget 1200] [--workers 24] [--variant name] [--validate] [--json out]
 * `--variant` measures one of the versions in VARIANTS. `--validate` measures the game and every ruined version: a card that does not mark
 * them down measures nothing.
 */
import fs from 'node:fs';
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { fileURLToPath } from 'node:url';
import { RULES } from '../game/src/sim/rules';
import { cardOf, litTier, printCard, yardTree, type TierGame, type YardResult, type Card } from './fun-lib';
import { override } from './balance-lib';

interface Variant {
  label: string;
  /** dotted numeric RULES overrides */
  rules?: Record<string, number>;
}
/** Versions of the game made worse on purpose, each breaking one thing the card claims to see. */
export const RUINED: Variant[] = [
  { label: 'one card only', rules: { 'job.deal.job': 0, 'job.deal.other': 0, 'job.deal.dock': 0, 'job.deal.tuner': 0 } },
  { label: 'raw scrap pays like the job', rules: { 'value.scrap': 24, 'value.shards': 24, 'value.slag': 24 } },
  { label: 'machines crawl', rules: { 'process.crusher': 12, 'process.furnace': 16, 'process.press': 12 } },
  {
    label: 'stars for nothing',
    rules: Object.fromEntries(['ingot', 'plate'].flatMap((m) => [0, 1, 2, 3, 4, 5].map((i) => [`job.orders.${m}.${i}`, 1]))),
  },
  { label: 'two-second shifts', rules: { ticksPerRound: 12 } },
  {
    label: 'every yard alike',
    rules: {
      'yard.shapes.bend': 0,
      'yard.shapes.zigzag': 0,
      'yard.rubbleMin': 0,
      'yard.rubbleMax': 0,
      'job.weights.plate': 0,
      'yard.variants.twoMakers': 0,
      'yard.variants.tuned': 0,
    },
  },
];
/** Rules on trial: nothing just now. A trial goes in `game/src/sim` behind a value here, and comes out with the result. */
const TRIALS: Variant[] = [];
const VARIANTS: Variant[] = [...RUINED, ...TRIALS];

function measure(seed: string, budget: number, deep: boolean, keepPaths = false): YardResult {
  const tree = yardTree(seed, budget, keepPaths);
  const asPlain = (p: { score: number; units: number[]; stars: number; close: number }): TierGame => ({
    score: p.score,
    units: p.units.reduce((a, b) => a + b, 0),
    stars: p.stars,
    close: p.close,
  });
  // all three go where the coach points and move nothing after: a novice takes any card, a casual player one that says it helps, and a
  // competent one the card that helps most, which is Sal's game
  const tiers = { novice: asPlain(litTier(seed, 'any')), casual: asPlain(litTier(seed, 'helps')), competent: asPlain(litTier(seed, 'most')) };
  return { tree, tiers, deeper: deep ? yardTree(seed, budget * 8).best.score : undefined };
}

if (!isMainThread && parentPort) {
  const { variant, budget } = workerData as { variant: Variant | null; budget: number };
  if (variant?.rules) override(variant.rules);
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
