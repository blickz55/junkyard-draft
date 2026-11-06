/**
 * "Next time" (the consultant panel, 2026-11-06): after a miss, the one card of that shift's deal that would have paid most on the yard as
 * the draft began, with the figure over what the player earned, and the try starting at that shift with that card lit. Five of six of the
 * twelfth panel asked, in their own words, for one concrete thing to change after a miss, and a try replayed the same deal into the same
 * choices. The study on the 40 held-out yards (Sal's game and a casual lit game, tools/scratch/next-time-study.ts): a figure at the shift
 * of the first miss in 24 of 60 games with a miss, 16 of them enough for the order; at some shift in 36; none in 28. The figure is allowed
 * here: the no-figure-on-a-card decision (rules 7) is about the pick, and this comes after the game. Pure: the same inputs name the same move.
 */
import { newRun, cardParts, type RunState } from '../sim/run';
import { forkFrom } from '../sim/fork';
import { runLayout } from '../sim/sim';
import { RULES } from '../sim/rules';
import type { MachineKind } from '../sim/types';
import { cardGain, type Placed } from './estimate';

export interface NextTime {
  /** the shift, from 1 */
  shift: number;
  card: MachineKind;
  /** dollars the shift would have paid over what it did, with that card where the estimate puts it */
  figure: number;
  /** whether that would have filled the shift's order */
  fillsOrder: boolean;
  /** the placements that earn it, for the test that holds the figure to the game */
  plan: Placed[];
}

/** The run as shift `n`'s draft began: a fresh run for the first shift, else the replay to there. */
export function draftOf(run: Pick<RunState, 'seed' | 'actions' | 'rulesVersion'>, n: number): RunState {
  return n <= 1 ? newRun(run.seed) : forkFrom(run.seed, run.actions, run.rulesVersion, n - 1, { hash: null, player: '' });
}

/**
 * The move to name, or null: for a finished game of the player's own with orders, that missed one or ended level with Sal or behind him.
 * The shift of the first miss first; failing a figure there, the biggest at any shift up to it.
 */
export function nextTime(run: RunState, sal: number | null): NextTime | null {
  const orders = run.job?.orders;
  if (!orders || run.forkedFrom || run.rounds.length < RULES.rounds) return null;
  const earned = run.rounds.map((r) => r.earned);
  const miss = earned.findIndex((e, i) => e < orders[i]);
  if (miss < 0 && !(sal != null && run.score <= sal)) return null;
  const lineAt = (n: number): NextTime | null => {
    const d = draftOf(run, n);
    const belts = d.bin.filter((m) => m.kind === 'conveyor').length;
    const base = runLayout(d.layout).earned;
    let best: NextTime | null = null;
    for (const card of new Set(d.offers)) {
      const g = cardGain(d.layout, cardParts(card, d.job, run.seed), belts);
      const figure = Math.floor(base + g.gain) - earned[n - 1];
      if (g.gain > 0 && figure > 0 && (!best || figure > best.figure))
        best = { shift: n, card, figure, fillsOrder: base + g.gain >= orders[n - 1], plan: g.plan };
    }
    return best;
  };
  const upTo = miss >= 0 ? miss + 1 : RULES.rounds;
  const at = miss >= 0 ? lineAt(miss + 1) : null;
  if (at) return at;
  let best: NextTime | null = null;
  for (let n = 1; n <= upTo; n++) {
    const l = lineAt(n);
    if (l && (!best || l.figure > best.figure)) best = l;
  }
  return best;
}
