/**
 * Shift orders on paper (docs/GOALS.md): a yard tree holds what every path earns each shift, so what a set of orders would do to a game is
 * arithmetic, and a schedule can be tried in seconds. Trees come from `--dump`, on the rules the orders would sit on.
 *   node --import tsx tools/fun-orders.ts --dump out.json [--yards 24] [--prefix tune] [--budget 700] [--workers 22] [--variant name]
 *   node --import tsx tools/fun-orders.ts --read out.json
 */
import fs from 'node:fs';
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { fileURLToPath } from 'node:url';
import { RULES } from '../game/src/sim/rules';
import { yardFor, type Job } from '../game/src/sim/yard';
import { litTier, yardTree, median, scale, type PathResult, type YardTree } from './fun-lib';
import { override } from './balance-lib';

/** What one kind of player earned, shift by shift. */
interface Played {
  rounds: number[];
}
interface Dumped {
  tree: YardTree;
  novice: Played;
  casual: Played;
  competent: Played;
}
export interface Orders {
  label: string;
  /** the order each shift, by what the job makes */
  ingot: readonly number[];
  plate: readonly number[];
  /** when set, each yard's orders are what the casual bot earned there, shift by shift, times this: always reachable, and a yard is judged against itself */
  ghost?: number;
  /** each order filled adds this to what the rest of the game pays (0.25 = a quarter more) */
  raise: number;
  /** a missed order: 'keep' leaves the pay as it is, 'reset' takes the raises back, 'end' closes the yard */
  miss: 'keep' | 'reset' | 'end';
}
export interface Paid {
  score: number;
  pay: number[];
  filled: number;
  /** shifts played */
  shifts: number;
  /** an order missed by under a tenth */
  close: number;
}
/** What a game's shifts pay under orders. Earnings keep their meaning: only the raise and the end of the game change the money. */
export function underOrders(rounds: readonly number[], job: Job | null, o: Orders, ghost: readonly number[] | null = null): Paid {
  const table = ghost && o.ghost ? ghost.map((v) => Math.round(v * o.ghost!)) : job?.material === 'plate' ? o.plate : o.ingot;
  let rate = 1;
  let filled = 0;
  let close = 0;
  const pay: number[] = [];
  for (let i = 0; i < rounds.length; i++) {
    const paid = Math.round(rounds[i] * rate);
    pay.push(paid);
    if (paid >= table[i]) {
      filled++;
      rate += o.raise;
    } else {
      if (paid >= table[i] * 0.9) close++;
      if (o.miss === 'end') break;
      if (o.miss === 'reset') rate = 1;
    }
  }
  return { score: pay.reduce((a, b) => a + b, 0), pay, filled, shifts: pay.length, close };
}

export interface Reading {
  label: string;
  /** expert's filled orders, and what each kind of player fills */
  filled: { novice: number; casual: number; competent: number; expert: number };
  allFilled: { casual: number; competent: number; expert: number };
  medians: { novice: number; casual: number; competent: number; expert: number };
  ratio: number;
  /** money falling or flat from one shift to the next, on the best path */
  flat: number;
  lastBest: number;
  /** picks where the top two are within 5 % and the worst 10 % behind */
  real: number;
  /** games of the middle players that end with an order missed by under a tenth */
  close: number;
  /** a third of the yards should let a good player down: shifts the expert fails */
  expertMisses: number;
  score: number;
}

export function read(yards: readonly Dumped[], o: Orders): Reading {
  const paidBest: { paid: Paid; path: PathResult; tree: YardTree }[] = [];
  let realPicks = 0;
  let picks = 0;
  for (const y of yards) {
    const paths = y.tree.paths!.map((p) => ({ p, paid: underOrders(p.rounds, y.tree.job, o, y.casual.rounds) }));
    // the belts a path buys come off its score, as they do under no orders
    const value = (x: (typeof paths)[number]) => x.paid.score - x.p.belts * RULES.beltCost;
    paths.sort((a, b) => value(b) - value(a));
    const top = paths[0];
    paidBest.push({ paid: top.paid, path: top.p, tree: y.tree });
    for (let level = 0; level < RULES.rounds; level++) {
      const prefix = top.p.picks.slice(0, level).join();
      const values = [...new Set(y.tree.offers[level])]
        .map((kind) => {
          const v = paths.find((x) => x.p.picks.slice(0, level).join() === prefix && x.p.picks[level] === kind);
          return v ? value(v) : 0;
        })
        .sort((a, b) => b - a);
      picks++;
      const best = values[0] || 1;
      if (values.length > 1 && (best - values[1]) / best <= 0.05 && (best - values[values.length - 1]) / best >= 0.1) realPicks++;
    }
  }
  const tier = (k: 'novice' | 'casual' | 'competent') => yards.map((y) => underOrders(y[k].rounds, y.tree.job, o, y.casual.rounds));
  const novice = tier('novice');
  const casual = tier('casual');
  const competent = tier('competent');
  const expert = paidBest.map((b) => b.paid);
  const medians = {
    novice: median(novice.map((p) => p.score)),
    casual: median(casual.map((p) => p.score)),
    competent: median(competent.map((p) => p.score)),
    expert: median(expert.map((p) => p.score)),
  };
  const steps = expert.flatMap((p) => p.pay.slice(1).map((v, i) => ({ now: v, before: p.pay[i] })));
  const flat = steps.filter((s) => s.now <= s.before * 1.02).length / Math.max(1, steps.length);
  const lastBest = expert.filter((p) => p.pay[p.pay.length - 1] > Math.max(...p.pay.slice(0, -1)) * 1.02).length / expert.length;
  const middle = [...casual, ...competent];
  const close = middle.filter((p) => p.close > 0).length / middle.length;
  const allFilled = (ps: Paid[]) => ps.filter((p) => p.filled === RULES.rounds).length / ps.length;
  const expertMisses = expert.filter((p) => p.filled < RULES.rounds).length / expert.length;
  const ratio = medians.expert / Math.max(1, medians.novice);
  const real = realPicks / Math.max(1, picks);
  const band = allFilled(expert) < 0.4 ? scale(allFilled(expert), 0, 0.4) : allFilled(expert) > 0.75 ? scale(allFilled(expert), 1, 0.75) : 100;
  const score =
    0.25 * scale(flat, 0.5, 0.02) +
    0.15 * scale(lastBest, 0.2, 0.9) +
    0.2 * scale(real, 0.05, 0.6) +
    0.15 * scale(ratio, 1.5, 6) +
    0.1 * scale(close, 0.05, 0.33) +
    0.15 * band;
  return {
    label: o.label,
    filled: {
      novice: median(novice.map((p) => p.filled)),
      casual: median(casual.map((p) => p.filled)),
      competent: median(competent.map((p) => p.filled)),
      expert: median(expert.map((p) => p.filled)),
    },
    allFilled: { casual: allFilled(casual), competent: allFilled(competent), expert: allFilled(expert) },
    medians,
    ratio: Math.round(ratio * 100) / 100,
    flat: Math.round(flat * 1000) / 1000,
    lastBest: Math.round(lastBest * 1000) / 1000,
    real: Math.round(real * 1000) / 1000,
    close: Math.round(close * 1000) / 1000,
    expertMisses: Math.round(expertMisses * 1000) / 1000,
    score: Math.round(score),
  };
}

function dumpYard(seed: string, budget: number): Dumped {
  const tree = yardTree(seed, budget, true);
  return {
    tree,
    novice: { rounds: litTier(seed, 'any').rounds },
    casual: { rounds: litTier(seed, 'helps').rounds },
    competent: { rounds: litTier(seed, 'most').rounds },
  };
}

if (!isMainThread && parentPort) {
  const { rules, budget } = workerData as { rules?: Record<string, number>; budget: number };
  // earnings at list prices: a table is laid over them here, so the game's own raises stay out of the dump
  override({ ...rules, 'job.raise': 0 });
  parentPort.on('message', (seed: string) => parentPort!.postMessage(dumpYard(seed, budget)));
}

function dumpAll(seeds: string[], budget: number, workers: number, rules?: Record<string, number>): Promise<Dumped[]> {
  return new Promise((resolve, reject) => {
    const out: Dumped[] = [];
    const queue = seeds.slice();
    const pool: Worker[] = [];
    for (let i = 0; i < Math.min(workers, seeds.length); i++) {
      const w = new Worker(fileURLToPath(import.meta.url), { workerData: { rules, budget }, execArgv: process.execArgv });
      pool.push(w);
      w.on('error', reject);
      w.on('message', (r: Dumped) => {
        out.push(r);
        process.stderr.write(`\r${out.length}/${seeds.length} `);
        if (out.length === seeds.length) {
          process.stderr.write('\n');
          for (const p of pool) void p.terminate();
          resolve(out);
        } else if (queue.length) w.postMessage(queue.shift());
      });
      w.postMessage(queue.shift());
    }
  });
}

/** A family of schedules around a shape: the orders rise from a start to a peak, as a share of what a good line ships. */
function schedules(): Orders[] {
  const out: Orders[] = [];
  for (const raise of [0, 0.1, 0.2, 0.3])
    for (const miss of ['keep', 'reset', 'end'] as const)
      for (const ghost of [1, 1.05, 1.1, 1.2, 1.3])
        out.push({ label: `ghost ${ghost}, raise ${raise}, miss ${miss}`, ingot: [], plate: [], ghost, raise, miss });
  for (const raise of [0, 0.1, 0.2, 0.3])
    for (const miss of ['keep', 'reset', 'end'] as const)
      for (const peak of [1000, 1300, 1600, 2000, 2600, 3200, 4000]) {
        const ingot = [90, 450, 0.55, 0.7, 0.85, 1].map((f) => (f < 1.01 && f > 0.1 ? Math.round(peak * f) : f));
        ingot[5] = peak;
        const plate = ingot.map((v) => Math.round(v * 0.72));
        out.push({ label: `peak ${peak}, raise ${raise}, miss ${miss}`, ingot, plate, raise, miss });
      }
  return out;
}

if (isMainThread && process.argv[1] && /fun-orders\.ts$/.test(process.argv[1])) {
  const args = process.argv.slice(2);
  const opt = (k: string, d: string) => (args.includes(`--${k}`) ? args[args.indexOf(`--${k}`) + 1] : d);
  const dump = opt('dump', '');
  if (dump) {
    const seeds = Array.from({ length: Number(opt('yards', '24')) }, (_, i) => `${opt('prefix', 'tune')}-${i}`);
    const rules = opt('rules', '') ? (JSON.parse(opt('rules', '')) as Record<string, number>) : undefined;
    const yards = await dumpAll(seeds, Number(opt('budget', '700')), Number(opt('workers', '22')), rules);
    fs.writeFileSync(dump, JSON.stringify(yards));
    console.log(`wrote ${dump}: ${yards.length} yards, ${yardFor(seeds[0]).job?.material}`);
  } else {
    const yards = JSON.parse(fs.readFileSync(opt('read', ''), 'utf8')) as Dumped[];
    const results = schedules().map((o) => read(yards, o));
    results.sort((a, b) => b.score - a.score);
    const none = read(yards, { label: 'no orders', ingot: [0, 0, 0, 0, 0, 0], plate: [0, 0, 0, 0, 0, 0], raise: 0, miss: 'keep' });
    console.log(JSON.stringify(none));
    for (const r of results.slice(0, Number(opt('top', '12')))) console.log(JSON.stringify(r));
  }
}
