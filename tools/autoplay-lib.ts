import { apply, newRun, type Action, type RunState } from '../game/src/sim/run';
import { runLayout } from '../game/src/sim/sim';
import { Rng } from '../game/src/sim/rng';
import type { Dir, Layout, Machine, MachineKind } from '../game/src/sim/types';

export const clone = (l: Layout): Layout => ({ width: l.width, height: l.height, machines: l.machines.map((m) => ({ ...m })) });
export const score = (l: Layout) => runLayout(l).earned;

/** Local search: exhaustive placement of unplaced parts (swapping with occupants allowed),
 *  then random nudges/swaps/rotations of existing parts. Keeps the best scoring layout. */
export function improve(base: Layout, bin: Machine[], rng: Rng, tries: number, reach = 2): { layout: Layout; earned: number } {
  let best = clone(base); let bestScore = score(best);
  const consider = (cand: Layout) => { const s = score(cand); if (s > bestScore) { best = cand; bestScore = s; return true; } return false; };
  // exhaustive placement for each part still in the bin
  for (const part of bin) {
    if (best.machines.some((m) => m.id === part.id)) continue;
    // evaluate every placement against the layout as it was before this part was added
    const before = clone(best);
    for (let y = 0; y < best.height; y++) for (let x = 0; x < best.width; x++) for (let dir = 0; dir < 4; dir++) {
      const cand = clone(before);
      const occ = cand.machines.find((o) => o.x === x && o.y === y);
      if (occ) {
        // relocate the occupant to any free cell within reach (insert-into-line and friends), else replace it
        for (let ny = Math.max(0, occ.y - reach); ny <= Math.min(cand.height - 1, occ.y + reach); ny++) for (let nx = Math.max(0, occ.x - reach); nx <= Math.min(cand.width - 1, occ.x + reach); nx++) {
          if ((nx === occ.x && ny === occ.y) || cand.machines.some((o) => o.x === nx && o.y === ny)) continue;
          const c2 = clone(cand); const o2 = c2.machines.find((o) => o.id === occ.id)!; o2.x = nx; o2.y = ny;
          c2.machines.push({ ...part, x, y, dir: dir as Dir }); consider(c2);
        }
        cand.machines.splice(cand.machines.indexOf(occ), 1);
      }
      cand.machines.push({ ...part, x, y, dir: dir as Dir });
      consider(cand);
    }
  }
  for (let t = 0; t < tries; t++) {
    const cand = clone(best);
    if (!cand.machines.length) break;
    const m = cand.machines[rng.int(cand.machines.length)];
    const kind = rng.int(4);
    if (kind === 0) { m.dir = rng.int(4) as Dir; }
    else if (kind === 1) { const o = cand.machines[rng.int(cand.machines.length)]; if (o === m) continue; [m.x, o.x] = [o.x, m.x]; [m.y, o.y] = [o.y, m.y]; }
    else {
      const x = rng.int(cand.width), y = rng.int(cand.height);
      if (cand.machines.some((o) => o.x === x && o.y === y)) continue;
      m.x = x; m.y = y; if (kind === 3) m.dir = rng.int(4) as Dir;
    }
    consider(cand);
    // occasionally try re-adding a binned part after a nudge
    if (t % 10 === 0) for (const part of bin) if (!best.machines.some((mm) => mm.id === part.id)) {
      const c2 = clone(best); const x = rng.int(c2.width), y = rng.int(c2.height);
      if (!c2.machines.some((o) => o.x === x && o.y === y)) { c2.machines.push({ ...part, x, y, dir: rng.int(4) as Dir }); consider(c2); }
    }
  }
  return { layout: best, earned: bestScore };
}

export interface SeedReport { seed: string; score: number; rounds: number[]; picks: string[]; offers: MachineKind[][]; deadEnd: boolean; flatRounds: number; ingots: number; peakRound: number }

export interface PlayOptions {
  /** machine kinds the player refuses to draft (used by the balance tool to measure a machine's marginal value on identical offers) */
  ban?: ReadonlySet<MachineKind>;
}

export function playSeed(seed: string, rng: Rng, tries = 150, opts: PlayOptions = {}): { report: SeedReport; actions: Action[] } {
  const s: RunState = newRun(seed);
  let flatRounds = 0; let ingots = 0;
  const offers: MachineKind[][] = [];
  while (s.phase !== 'finished') {
    // pick: evaluate each offer by a short search, choose the best resulting score
    let bestI = 0, bestVal = -1;
    const baseScore = score(s.layout);
    offers.push(s.offers.slice());
    const allowed = s.offers.map((k, i) => i).filter((i) => !opts.ban?.has(s.offers[i]));
    for (const i of allowed.length ? allowed : s.offers.map((_, i) => i)) {
      const trial = { ...s, layout: clone(s.layout), bin: s.bin.slice() };
      const part: Machine = { id: 9000 + i, kind: s.offers[i], x: -1, y: -1, dir: 0 };
      const r = improve(trial.layout, [...trial.bin, part], new Rng(`${seed}:${s.round}:${i}`), Math.max(10, Math.floor(tries / 3)), 4);
      if (r.earned > bestVal) { bestVal = r.earned; bestI = i; }
    }
    if (bestVal <= baseScore) flatRounds++; // no offer improved the line this round
    apply(s, { t: 'pick', i: bestI });
    const r = improve(s.layout, s.bin, rng, tries, 8);
    // translate the found layout into legal actions
    for (const m of s.layout.machines.slice()) apply(s, { t: 'unplace', id: m.id });
    for (const m of r.layout.machines) apply(s, { t: 'place', id: m.id, x: m.x, y: m.y, dir: m.dir });
    apply(s, { t: 'run' });
    ingots += s.rounds[s.rounds.length - 1].result.shipped.ingot;
    apply(s, { t: 'next' });
  }
  const rounds = s.rounds.map((r) => r.earned);
  return { report: { seed, score: s.score, rounds, picks: s.picks, offers, deadEnd: flatRounds >= 4, flatRounds, ingots, peakRound: rounds.indexOf(Math.max(...rounds)) + 1 }, actions: s.actions };
}

