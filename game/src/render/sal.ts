/**
 * Sal's game (the second panel asked for a score to beat): what the foreman makes of a yard, worked out on the player's own device the way
 * the cards are. Each shift he takes the card that adds most to the line as it stands and builds it where the estimate says. He looks one
 * shift ahead and never rearranges, so a player who plans can beat him. It is a target with his name on it: nobody's score, on no board,
 * and nothing in the rules reads it. Pure but for the memo, so a yard is worked out once.
 */
import { apply, canReroll, cardParts, newRun, runStars, type Action, type RunState } from '../sim/run';
import { cardGain, type Placed } from './estimate';
import { dropActions } from './placement';

export interface SalGame {
  score: number;
  /** what each shift paid */ rounds: number[];
  stars: number;
  filled: number;
  /** the game itself, to watch */ actions: Action[];
}

/** One shift: the card that adds most, built where it pays, then run. */
function shift(s: RunState, act: (a: Action) => void) {
  if (s.phase === 'draft') {
    const belts = s.bin.filter((m) => m.kind === 'conveyor').length;
    const judge = () => s.offers.map((k) => cardGain(s.layout, cardParts(k, s.job, s.seed), belts));
    const value = (g: { gain: number; room?: boolean }) => g.gain || (g.room ? 0.5 : 0); // a Dock that gives a full line room beats a card with nowhere to go
    let cards = judge();
    // nothing fits: he deals again, as the coach suggests
    if (cards.every((g) => value(g) <= 0) && canReroll(s) === null) {
      act({ t: 'reroll' });
      cards = judge();
    }
    let best = 0;
    let top = -1;
    let plan: Placed[] = [];
    cards.forEach((g, i) => {
      if (value(g) > top) [best, top, plan] = [i, value(g), g.plan];
    });
    act({ t: 'pick', i: best });
    for (const p of plan) {
      const part = s.bin.find((m) => m.kind === p.kind);
      if (!part) break;
      dropActions(s, part, p.x, p.y, p.dir).forEach(act);
    }
    // a part he found no spot for goes for what it fetches: he never comes back for one, and a player should not beat him by the sale
    for (const m of s.bin.filter((q) => q.kind !== 'conveyor')) act({ t: 'sell', id: m.id });
  }
  act({ t: 'run' });
  act({ t: 'next' });
}

const games = new Map<string, SalGame>();
const finish = (s: RunState, actions: Action[]): SalGame => ({
  score: s.score,
  rounds: s.rounds.map((r) => r.earned),
  stars: runStars(s),
  filled: s.filled,
  actions,
});

/** Sal's game on a yard, now. */
export function salGame(seed: string): SalGame {
  const known = games.get(seed);
  if (known) return known;
  const s = newRun(seed);
  const actions: Action[] = [];
  const act = (a: Action) => {
    apply(s, a);
    actions.push(a);
  };
  while (s.phase !== 'finished') shift(s, act);
  const game = finish(s, actions);
  games.set(seed, game);
  return game;
}

/** What has been worked out already. */
export const salKnown = (seed: string): SalGame | null => games.get(seed) ?? null;

/** Sal's game a shift at a time, so a phone keeps its frames; `ready` hears it once it is known. */
export function salLater(seed: string, ready: (g: SalGame) => void) {
  const known = games.get(seed);
  if (known) return ready(known);
  const s = newRun(seed);
  const actions: Action[] = [];
  const act = (a: Action) => {
    apply(s, a);
    actions.push(a);
  };
  const step = () => {
    shift(s, act);
    if (s.phase !== 'finished') return void setTimeout(step, 0);
    const game = finish(s, actions);
    games.set(seed, game);
    ready(game);
  };
  setTimeout(step, 0);
}
