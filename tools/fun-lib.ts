/**
 * The fun card's bots and measures (docs/GOALS.md). A game's offers depend only on the yard and the shift, and everything on the yard can
 * be rearranged every shift, so a yard is a tree: three cards a shift, six shifts, and what a set of parts can earn does not depend on the
 * order they came in. `yardTree` searches a layout for every set of parts a player could hold and adds up every path, which gives what no
 * single bot's game can: what each pick was really worth. The search is local and the tree knows the offers ahead, as a player does on a
 * second try at a day's yard. Nothing here is player-facing and nothing under game/src may import it.
 */
import { DIR_DX, DIR_DY, RULES } from '../game/src/sim/rules';
import { cardParts, draftOffers, newRun, shiftTerms } from '../game/src/sim/run';
import { analyseRound } from '../game/src/sim/bottleneck';
import { createSim, step } from '../game/src/sim/sim';
import { Rng } from '../game/src/sim/rng';
import { starsFor, type Job } from '../game/src/sim/yard';
import { recipeLine } from './autoplay-lib';
import type { Dir, Layout, Machine, MachineKind, Material, RunResult } from '../game/src/sim/types';

const NO_EVENTS = { push: () => 0 } as unknown as [];
let nextPart = 100000;

export interface Earned {
  earned: number;
  shipped: Record<Material, number>;
}
/** One shift on a layout, without the event log that only the screen needs. */
export function evaluate(l: Layout): Earned {
  const s = createSim(l);
  s.events = NO_EVENTS;
  for (let i = 0; i < RULES.ticksPerRound; i++) step(s);
  return { earned: s.earned, shipped: s.shipped };
}

const blockedCell = (l: Layout, x: number, y: number) => !!l.rubble?.includes(y * l.width + x);
const takenCell = (l: Layout, x: number, y: number) => l.machines.some((m) => m.x === x && m.y === y);
const copy = (l: Layout): Layout => ({ ...l, machines: l.machines.map((m) => ({ ...m })) });

/** A feed in the order its goods pass through it. */
const FEED_ORDER: readonly MachineKind[] = ['hopper', 'crusher', 'furnace', 'press'];

/** A layout's worth to the search: what it earns, less the belts it needs beyond those the player holds, spread over the shifts they serve. */
export interface Plan {
  layout: Layout;
  value: number;
  earned: number;
  shipped: Record<Material, number>;
  belts: number;
  /** parts held and not on the layout */
  spare: MachineKind[];
}

/**
 * Local search for the best layout from a set of parts: every spot for each part not yet down, then annealing. Random cells almost never
 * make a working branch, so most moves attach something to what is already there: a part feeding into a machine, or on the end of one, or
 * set into a belt. `free` is how many conveyors the player holds; more can be laid at `beltPrice` each. `anchors` never move.
 */
export function solve(
  start: Layout,
  shelf: readonly MachineKind[],
  free: number,
  beltPrice: number,
  budget: number,
  rng: Rng,
  anchors: ReadonlySet<number> = new Set(),
  job: Job | null = null,
): Plan {
  const count = (l: Layout) => l.machines.filter((m) => m.kind === 'conveyor').length;
  const worth = (l: Layout) => {
    const r = evaluate(l);
    return { ...r, value: r.earned - Math.max(0, count(l) - free) * beltPrice };
  };
  let best = copy(start);
  let bestWorth = worth(best);
  let bestPool: MachineKind[] = [];
  const spots: { x: number; y: number }[] = [];
  for (let y = 0; y < start.height; y++) for (let x = 0; x < start.width; x++) if (!blockedCell(start, x, y)) spots.push({ x, y });
  const open = (l: Layout, x: number, y: number) => x >= 0 && y >= 0 && x < l.width && y < l.height && !blockedCell(l, x, y) && !takenCell(l, x, y);

  // the job's recipe along the belt: moving a crusher one cell back pays nothing until the second machine is in, so no single move finds it
  let held = shelf.slice();
  if (job) {
    const bin: Machine[] = held.map((kind) => ({ id: nextPart++, kind, x: -1, y: -1, dir: 0 }));
    const recipe = recipeLine(best, bin, job);
    if (recipe) {
      const w = worth(recipe);
      if (w.value > bestWorth.value) {
        best = recipe;
        bestWorth = w;
        held = bin.filter((b) => !recipe.machines.some((m) => m.id === b.id)).map((b) => b.kind);
      }
    }
  }

  // each part in turn: every spot and facing, on a free cell or in place of a belt piece
  for (const kind of held) {
    let found: Layout | null = null;
    let foundWorth = bestWorth;
    for (const { x, y } of spots) {
      const under = best.machines.find((m) => m.x === x && m.y === y);
      if (under && under.kind !== 'conveyor') continue;
      for (let d = 0; d < 4; d++) {
        const c = copy(best);
        if (under)
          c.machines.splice(
            c.machines.findIndex((m) => m.id === under.id),
            1,
          );
        c.machines.push({ id: nextPart++, kind, x, y, dir: d as Dir });
        const w = worth(c);
        if (w.value > foundWorth.value) {
          found = c;
          foundWorth = w;
        }
      }
    }
    if (found) {
      best = found;
      bestWorth = foundWorth;
    } else bestPool.push(kind);
  }

  let cur = copy(best);
  let curWorth = bestWorth;
  let pool = bestPool.slice();
  const heat = Math.max(40, bestWorth.value * 0.06);
  for (let t = 0; t < budget; t++) {
    const temp = heat * (1 - t / budget) ** 2 + 0.01;
    const c = copy(cur);
    let nextPool = pool;
    const roll = rng.next();
    const movable = c.machines.filter((m) => !anchors.has(m.id));
    const any = c.machines[rng.int(c.machines.length)];
    const pick = movable.length ? movable[rng.int(movable.length)] : any;
    const newPart = (): MachineKind => {
      if (pool.length && rng.next() < 0.75) {
        const i = rng.int(pool.length);
        const kind = pool[i];
        nextPool = pool.filter((_, k) => k !== i);
        return kind;
      }
      return 'conveyor';
    };
    if (roll < 0.28) {
      // something new feeding into a machine, from one of its sides
      const d = rng.int(4) as Dir;
      const x = any.x + DIR_DX[d],
        y = any.y + DIR_DY[d];
      if (!open(c, x, y)) continue;
      c.machines.push({ id: nextPart++, kind: newPart(), x, y, dir: ((d + 2) % 4) as Dir });
    } else if (roll < 0.46) {
      // something new on the end of a machine's output
      const x = any.x + DIR_DX[any.dir],
        y = any.y + DIR_DY[any.dir];
      if (!open(c, x, y)) continue;
      const turn = rng.int(3);
      c.machines.push({ id: nextPart++, kind: newPart(), x, y, dir: ((any.dir + (turn === 2 ? 3 : turn)) % 4) as Dir });
    } else if (roll < 0.6) {
      // a held part set into a belt
      const belts = c.machines.filter((m) => m.kind === 'conveyor');
      if (!pool.length || !belts.length) continue;
      const under = belts[rng.int(belts.length)];
      const i = rng.int(pool.length);
      c.machines.splice(c.machines.indexOf(under), 1);
      c.machines.push({ id: nextPart++, kind: pool[i], x: under.x, y: under.y, dir: under.dir });
      nextPool = pool.filter((_, k) => k !== i);
    } else if (roll < 0.63) {
      // a whole new feed from what is on the shelf, walked backwards from something that takes its goods
      const chain = pool.filter((k) => FEED_ORDER.includes(k)).sort((a, b) => FEED_ORDER.indexOf(b) - FEED_ORDER.indexOf(a));
      if (chain.length < 2) continue;
      const ends = c.machines.filter((m) => m.kind === 'dock' || m.kind === 'conveyor');
      let at = ends[rng.int(ends.length)];
      let laid = 0;
      for (const kind of chain) {
        const d = rng.int(4) as Dir;
        const x = at.x + DIR_DX[d],
          y = at.y + DIR_DY[d];
        if (!open(c, x, y)) break;
        const m: Machine = { id: nextPart++, kind, x, y, dir: ((d + 2) % 4) as Dir };
        c.machines.push(m);
        at = m;
        laid++;
      }
      if (!laid) continue;
      nextPool = pool.slice();
      for (const kind of chain.slice(0, laid)) nextPool.splice(nextPool.indexOf(kind), 1);
    } else if (roll < 0.67) {
      // a machine one step back along its belt, which frees the cell ahead of it
      const bx = pick.x - DIR_DX[pick.dir],
        by = pick.y - DIR_DY[pick.dir];
      const behind = c.machines.find((m) => m.x === bx && m.y === by);
      if (!behind || behind.kind !== 'conveyor' || anchors.has(pick.id)) continue;
      [pick.x, behind.x] = [behind.x, pick.x];
      [pick.y, behind.y] = [behind.y, pick.y];
    } else if (roll < 0.76) {
      pick.dir = rng.int(4) as Dir;
    } else if (roll < 0.86) {
      const spot = spots[rng.int(spots.length)];
      if (takenCell(c, spot.x, spot.y) || anchors.has(pick.id)) continue;
      pick.x = spot.x;
      pick.y = spot.y;
      if (rng.next() < 0.5) pick.dir = rng.int(4) as Dir;
    } else if (roll < 0.92) {
      const other = movable.length ? movable[rng.int(movable.length)] : any;
      if (other === pick || anchors.has(pick.id) || anchors.has(other.id)) continue;
      [pick.x, other.x] = [other.x, pick.x];
      [pick.y, other.y] = [other.y, pick.y];
    } else {
      // something lifted back onto the shelf
      if (anchors.has(pick.id)) continue;
      c.machines.splice(c.machines.indexOf(pick), 1);
      if (pick.kind !== 'conveyor') nextPool = [...pool, pick.kind];
    }
    const w = worth(c);
    const delta = w.value - curWorth.value;
    if (delta >= 0 || rng.next() < Math.exp(delta / temp)) {
      cur = c;
      curWorth = w;
      pool = nextPool;
      if (w.value > bestWorth.value) {
        best = copy(c);
        bestWorth = w;
        bestPool = nextPool.slice();
      }
    }
  }
  return { layout: best, value: bestWorth.value, earned: bestWorth.earned, shipped: bestWorth.shipped, belts: count(best), spare: bestPool };
}

export interface PathResult {
  picks: MachineKind[];
  /** earned in each shift */
  rounds: number[];
  /** the job's product shipped in each shift */
  units: number[];
  score: number;
  stars: number;
  belts: number;
}

export interface YardTree {
  seed: string;
  job: Job | null;
  offers: MachineKind[][];
  best: PathResult;
  /** every path's score, for the spread of what picks are worth */
  scores: number[];
  /** the part sets (sorted, joined) of paths within 5 % of the best */
  nearBestSets: string[];
  /** for each shift on the best path: what each card was worth, playing the rest of the game as well as the tree can */
  choices: { offered: MachineKind[]; values: number[]; taken: number }[];
  /** what limited the line on the best path, one per shift, as `kind:machine` */
  limits: string[];
  /** the worst single pick's cost: the best game after taking the worst card at each shift, as a share of the best */
  forgiving: number;
  nodes: number;
  /** every path, best first, when asked for */
  paths?: PathResult[];
}

const setKey = (parts: readonly MachineKind[]) => parts.slice().sort().join('+');
const POLISH_PATHS = 12;
const POLISH_FACTOR = 6;

/** Search every set of parts on a yard and add up every path through its offers. `budget` is the annealing steps per set. */
export function yardTree(seed: string, budget: number, keepPaths = false): YardTree {
  const run = newRun(seed);
  const rounds = RULES.rounds;
  const offers: MachineKind[][] = [];
  for (let r = 1; r <= rounds; r++) offers.push(draftOffers(seed, r));
  const free = run.layout.machines.filter((m) => m.kind === 'conveyor').length + run.bin.filter((m) => m.kind === 'conveyor').length;
  const memo = new Map<string, Plan>();
  // the yard's own hopper and dock stay put: the search otherwise shortens the belt for a few sales and strands everything after
  const anchors: ReadonlySet<number> = new Set(run.layout.machines.filter((m) => m.kind === 'hopper' || m.kind === 'dock').map((m) => m.id));
  const rng = new Rng(`${seed}:fun:tree`);
  const plan = (held: readonly MachineKind[], parent: Plan | null, added: MachineKind | null): Plan => {
    const key = `${held.length}|${setKey(held)}`;
    const known = memo.get(key);
    if (known) return known;
    const price = RULES.beltCost / Math.max(1, rounds - held.length + 1);
    const p = solve(
      { ...(parent ? parent.layout : run.layout), ...shiftTerms(seed, Math.max(1, held.length), run.job) },
      [...(parent?.spare ?? []), ...(added ? cardParts(added) : [])],
      free,
      price,
      parent ? budget : 0,
      rng,
      anchors,
      run.job,
    );
    memo.set(key, p);
    return p;
  };
  const root = plan([], null, null);

  const unitsOf = (p: Plan) => (run.job ? p.shipped[run.job.material] : 0);
  interface Walk {
    picks: MachineKind[];
    plans: Plan[];
  }
  const paths: Walk[] = [];
  const walk = (level: number, picks: MachineKind[], plans: Plan[]) => {
    if (level === rounds) {
      paths.push({ picks, plans });
      return;
    }
    for (const kind of new Set(offers[level])) {
      const held = [...picks, kind];
      walk(level + 1, held, [...plans, plan(held, plans[plans.length - 1] ?? root, kind)]);
    }
  };
  walk(0, [], []);

  const beltsUsed = (w: Walk) => Math.max(0, ...w.plans.map((p) => p.belts - free));
  const scoreOf = (w: Walk) => w.plans.reduce((n, p) => n + p.earned, 0) - beltsUsed(w) * RULES.beltCost;
  const rank = () => paths.map((w) => ({ w, score: scoreOf(w) })).sort((a, b) => b.score - a.score);
  // the sets the best paths run through get a much longer search: wide lines are found there or not at all
  const polished = new Set<Plan>();
  for (const pass of [0, 1]) {
    for (const { w } of rank().slice(0, POLISH_PATHS)) {
      for (let level = 2; level < rounds; level++) {
        const p = w.plans[level];
        if (polished.has(p)) continue;
        polished.add(p);
        const price = RULES.beltCost / Math.max(1, rounds - level);
        const better = solve(
          p.layout,
          p.spare,
          free,
          price,
          budget * POLISH_FACTOR,
          new Rng(`${seed}:fun:polish:${pass}:${level}:${setKey(w.picks.slice(0, level + 1))}`),
          anchors,
          run.job,
        );
        if (better.value > p.value) Object.assign(p, better);
      }
    }
    polished.clear();
  }
  const scored = rank();
  const top = scored[0];
  const result = (w: Walk, score: number): PathResult => {
    const units = w.plans.map(unitsOf);
    const shipped = units.reduce((a, b) => a + b, 0);
    return { picks: w.picks, rounds: w.plans.map((p) => p.earned), units, score, stars: run.job ? starsFor(run.job, shipped) : 0, belts: beltsUsed(w) };
  };
  const best = result(top.w, top.score);

  // what each card on the best path was worth: the best path that takes it there, keeping the picks before it
  const choices: YardTree['choices'] = [];
  for (let level = 0; level < rounds; level++) {
    const prefix = top.w.picks.slice(0, level).join();
    const offered = offers[level];
    const values = offered.map((kind) => {
      const v = scored.find((s) => s.w.picks.slice(0, level).join() === prefix && s.w.picks[level] === kind);
      return v ? v.score : 0;
    });
    choices.push({ offered, values, taken: offered.indexOf(top.w.picks[level]) });
  }
  const forgiving = Math.min(...choices.map((c) => Math.min(...c.values) / top.score));

  // what limited the line, shift by shift, on the best path
  const limits = top.w.plans.map((p, i) => {
    const r = fullRun(p.layout);
    const b = analyseRound(p.layout, r, i + 2);
    return `${b.kind}:${b.machine?.kind ?? '-'}`;
  });

  const cut = top.score * 0.95;
  const nearBestSets = [...new Set(scored.filter((s) => s.score >= cut).map((s) => setKey(s.w.picks)))];
  const all = keepPaths ? scored.map((s) => result(s.w, s.score)) : undefined;
  return { seed, job: run.job, offers, best, scores: scored.map((s) => s.score), nearBestSets, choices, limits, forgiving, nodes: memo.size, paths: all };
}

/** One shift with the event log, for what reads it. */
function fullRun(l: Layout): RunResult {
  const s = createSim(l);
  for (let i = 0; i < RULES.ticksPerRound; i++) step(s);
  return {
    earned: s.earned,
    shipped: s.shipped,
    spawned: s.spawned,
    absorbed: s.absorbed,
    ticks: RULES.ticksPerRound,
    cellStats: s.cellStats,
    events: s.events,
  };
}

/** Machine type a pick adds, for anything that wants to name it. */
export type { Machine };

/** How one kind of player did on a yard. */
export interface TierGame {
  score: number;
  units: number;
  stars: number;
}
export interface YardResult {
  tree: YardTree;
  tiers: { novice: TierGame; casual: TierGame; competent: TierGame };
  /** the best path's score under 8× the search, on the yards sampled for it */
  deeper?: number;
}
export interface Dimension {
  name: string;
  weight: number;
  score: number;
  /** the numbers behind the score, as read */
  read: Record<string, number>;
}
export interface Card {
  total: number;
  lowest: number;
  dimensions: Dimension[];
  medians: { novice: number; casual: number; competent: number; expert: number };
  takeRates: Record<string, number>;
}

/** 0 at `bad`, 100 at `good`, straight between; either may be the larger. */
export const scale = (x: number, bad: number, good: number): number => Math.round(Math.max(0, Math.min(1, (x - bad) / (good - bad))) * 100);
const mean = (xs: readonly number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const share = <T>(xs: readonly T[], f: (x: T) => boolean) => (xs.length ? xs.filter(f).length / xs.length : 0);
export const median = (xs: readonly number[]) => {
  const s = xs.slice().sort((a, b) => a - b);
  return s.length ? s[Math.floor(s.length / 2)] : 0;
};
const round3 = (x: number) => Math.round(x * 1000) / 1000;
const dim = (name: string, weight: number, score: number, read: Record<string, number>): Dimension => ({
  name,
  weight,
  score: Math.round(score),
  read: Object.fromEntries(Object.entries(read).map(([k, v]) => [k, round3(v)])),
});

/** A game shipped within 10 % under its next star, so one more try could reach it. */
export const nearMiss = (units: number, job: Job | null): boolean => {
  if (!job) return false;
  const next = job.stars.find((n) => units < n);
  return next !== undefined && units >= next * 0.9;
};
/** The shift a game's last star landed in, 0 when it earned none. */
export const lastStarShift = (units: readonly number[], job: Job | null): number => {
  if (!job) return 0;
  const stars = starsFor(
    job,
    units.reduce((a, b) => a + b, 0),
  );
  if (!stars) return 0;
  const mark = job.stars[stars - 1];
  let total = 0;
  for (let i = 0; i < units.length; i++) {
    total += units[i];
    if (total >= mark) return i + 1;
  }
  return 0;
};

/** The card, from the yards as measured. docs/GOALS.md says what the bars are and why. */
export function cardOf(yards: readonly YardResult[]): Card {
  const trees = yards.map((y) => y.tree);
  const bests = trees.map((t) => t.best);
  const steps = bests.flatMap((b) => b.rounds.slice(1).map((r, i) => ({ now: r, before: b.rounds[i] })));
  const flat = share(steps, (s) => s.now <= s.before * 1.02);
  const lastBest = share(bests, (b) => b.rounds[b.rounds.length - 1] > Math.max(...b.rounds.slice(0, -1)) * 1.02);
  const alive = 0.7 * scale(flat, 0.5, 0.02) + 0.3 * scale(lastBest, 0.2, 0.9);

  const picks = trees.flatMap((t) => t.choices);
  const real = share(picks, (c) => {
    const v = c.values.slice().sort((a, b) => b - a);
    const top = v[0] || 1;
    return v.length > 1 && (top - v[1]) / top <= 0.05 && (top - v[v.length - 1]) / top >= 0.1;
  });
  const offered: Record<string, number> = {};
  const taken: Record<string, number> = {};
  for (const c of picks) {
    for (const k of new Set(c.offered)) offered[k] = (offered[k] ?? 0) + 1;
    const t = c.offered[c.taken];
    taken[t] = (taken[t] ?? 0) + 1;
  }
  const takeRates = Object.fromEntries(Object.keys(offered).map((k) => [k, round3((taken[k] ?? 0) / offered[k])]));
  const rates = Object.values(takeRates);
  const healthy = share(rates, (r) => r >= 0.1 && r <= 0.6);
  const choices = 0.7 * scale(real, 0.05, 0.6) + 0.3 * scale(healthy, 0.3, 1);

  const med = (f: (y: YardResult) => number) => median(yards.map(f));
  const medians = {
    novice: med((y) => y.tiers.novice.score),
    casual: med((y) => y.tiers.casual.score),
    competent: med((y) => y.tiers.competent.score),
    expert: med((y) => y.tree.best.score),
  };
  const ordered = share(
    yards,
    (y) => y.tiers.novice.score < y.tiers.casual.score && y.tiers.casual.score < y.tiers.competent.score && y.tiers.competent.score < y.tree.best.score,
  );
  const ratio = medians.expert / Math.max(1, medians.novice);
  const sampled = yards.filter((y) => y.deeper !== undefined);
  const deeper = sampled.length ? mean(sampled.map((y) => y.deeper! / Math.max(1, y.tree.best.score))) - 1 : 0;
  const skill = 0.45 * scale(ordered, 0.3, 0.95) + 0.35 * scale(ratio, 1.5, 4) + 0.2 * scale(deeper, 0, 0.05);

  const distinct = mean(trees.map((t) => new Set(t.limits).size));
  const moving = scale(distinct, 1, 4);

  const threeWays = share(trees, (t) => t.nearBestSets.length >= 3);
  const bestSets: Record<string, number> = {};
  for (const b of bests) {
    const k = b.picks.slice().sort().join('+');
    bestSets[k] = (bestSets[k] ?? 0) + 1;
  }
  const modal = Math.max(...Object.values(bestSets), 0) / Math.max(1, bests.length);
  const ways = 0.7 * scale(threeWays, 0.1, 0.8) + 0.3 * scale(modal, 0.5, 0.15);

  const novice1 = share(yards, (y) => y.tiers.novice.stars >= 1);
  const competent2 = share(yards, (y) => y.tiers.competent.stars >= 2);
  const expert3 = share(bests, (b) => b.stars >= 3);
  const expertBand = expert3 < 0.4 ? scale(expert3, 0, 0.4) : expert3 > 0.7 ? scale(expert3, 1, 0.7) : 100;
  const ladder = 0.3 * scale(novice1, 0.3, 0.9) + 0.3 * scale(competent2, 0.2, 0.7) + 0.4 * expertBand;

  const games = yards.flatMap((y) => [
    { units: y.tiers.casual.units, job: y.tree.job },
    { units: y.tiers.competent.units, job: y.tree.job },
    { units: y.tree.best.units.reduce((a, b) => a + b, 0), job: y.tree.job },
  ]);
  const near = share(games, (g) => nearMiss(g.units, g.job));
  const oneMore = scale(near, 0.05, 0.33);

  const lateStar = share(trees, (t) => lastStarShift(t.best.units, t.job) >= RULES.rounds - 1);
  const growth = median(bests.map((b) => b.rounds[b.rounds.length - 1] / Math.max(1, b.rounds[1] ?? 1)));
  const climax = 0.6 * scale(lateStar, 0.1, 0.7) + 0.4 * scale(growth, 1.1, 3);

  const scores = bests.map((b) => b.score);
  const avg = mean(scores);
  const spread = avg ? Math.sqrt(mean(scores.map((s) => (s - avg) ** 2))) / avg : 0;
  const distinctBest = Object.keys(bestSets).length / Math.max(1, bests.length);
  const differ = 0.5 * scale(spread, 0.02, 0.12) + 0.5 * scale(distinctBest, 0.2, 0.8);

  const forgive = median(trees.map((t) => t.forgiving));
  const forgiving = scale(forgive, 0.2, 0.7);

  const dimensions = [
    dim('Alive to the last shift', 15, alive, { flatSteps: flat, lastShiftBest: lastBest }),
    dim('Every pick a real choice', 15, choices, { realPicks: real, healthyCards: healthy }),
    dim('Skill shows', 15, skill, { tiersInOrder: ordered, expertOverNovice: ratio, deeperGain: deeper }),
    dim('The problem keeps moving', 10, moving, { limitsPerGame: distinct }),
    dim('More than one way to win', 10, ways, { threeWaysYards: threeWays, modalBestSet: modal }),
    dim('The stars are a ladder', 10, ladder, { novice1: novice1, competent2: competent2, expert3: expert3 }),
    dim('One more try', 10, oneMore, { nearMisses: near }),
    dim('A climax', 5, climax, { lastStarLate: lateStar, growthShift2ToLast: growth }),
    dim('Yards differ', 5, differ, { scoreSpread: spread, distinctBestSets: distinctBest }),
    dim('One bad pick is not fatal', 5, forgiving, { worstPickKeeps: forgive }),
  ];
  const weight = dimensions.reduce((n, d) => n + d.weight, 0);
  const total = Math.round(dimensions.reduce((n, d) => n + d.score * d.weight, 0) / weight);
  return { total, lowest: Math.min(...dimensions.map((d) => d.score)), dimensions, medians, takeRates };
}

/** The card as a person reads it. */
export function printCard(label: string, c: Card): string {
  const lines = [`${label}: ${c.total} of 100, lowest dimension ${c.lowest}`];
  for (const d of c.dimensions) {
    const read = Object.entries(d.read)
      .map(([k, v]) => `${k} ${v}`)
      .join(', ');
    lines.push(`  ${String(d.score).padStart(3)}  ${d.name.padEnd(28)} ${read}`);
  }
  lines.push(`  medians: novice $${c.medians.novice}, casual $${c.medians.casual}, competent $${c.medians.competent}, expert $${c.medians.expert}`);
  lines.push(
    `  cards taken when offered: ${Object.entries(c.takeRates)
      .map(([k, v]) => `${k} ${v}`)
      .join(', ')}`,
  );
  return lines.join('\n');
}
