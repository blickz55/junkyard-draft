import { test } from 'node:test';
import assert from 'node:assert/strict';
import { badgesFor, MINIMALIST_MACHINES } from '../game/src/sim/badges';
import { apply, newRun, type RunState } from '../game/src/sim/run';
import { runLayout } from '../game/src/sim/sim';
import { RULES } from '../game/src/sim/rules';
import type { Layout, Machine } from '../game/src/sim/types';

const ids = (run: Pick<RunState, 'rounds' | 'score' | 'layout' | 'bin' | 'sold'>, par: number | null) => badgesFor(run, par).map((b) => b.id);

function finish(seed: string, edit?: (s: RunState) => void): RunState {
  const s = newRun(seed);
  for (let r = 1; r <= RULES.rounds; r++) { apply(s, { t: 'pick', i: 0 }); if (r === 1 && edit) edit(s); apply(s, { t: 'run' }); apply(s, { t: 'next' }); }
  return s;
}
const roundOf = (layout: Layout, round: number) => ({ round, earned: 0, layout, result: runLayout(layout) });

test('badges (PLAN-v1 0.4.6): Clean needs zero waits and zero blocked ticks in every round; a head-on conveyor forfeits it', () => {
  const clean = finish('badge-clean');
  assert.ok(ids(clean, null).includes('clean'), 'the untouched starter line never jams');
  const jammed = finish('badge-jam', (s) => { const c = s.layout.machines.find((m) => m.x === 3 && m.y === 2)!; apply(s, { t: 'rotate', id: c.id }); apply(s, { t: 'rotate', id: c.id }); });
  assert.ok(!ids(jammed, null).includes('clean'), 'a round with waits forfeits Clean for the whole run');
  assert.deepEqual(ids({ rounds: [], score: 0, layout: clean.layout, bin: [], sold: 0 }, 100), [], 'no rounds, no badges');
});

test('badges: Minimalist needs the final round at or under the machine cap and a score at or above the bot par; All Hands needs an empty bin and nothing sold at the end', () => {
  const s = finish('badge-min');
  assert.ok(s.rounds[RULES.rounds - 1].layout.machines.length <= MINIMALIST_MACHINES, 'the starter line is minimal');
  assert.ok(!ids(s, null).includes('minimalist'), 'without a par, Minimalist cannot be judged');
  assert.ok(ids(s, s.score).includes('minimalist'), 'at the par it is awarded');
  assert.ok(!ids(s, s.score + 1).includes('minimalist'), 'one dollar under the par and it is not');
  // a final round crowded past the cap loses it even with the score
  const crowded = { ...s, rounds: s.rounds.map((r, i) => (i === RULES.rounds - 1 ? roundOf({ ...r.layout, machines: [...r.layout.machines, ...Array.from({ length: MINIMALIST_MACHINES }, (_, k): Machine => ({ id: 900 + k, kind: 'conveyor', x: k, y: 5, dir: 0 }))] }, r.round) : r)) };
  assert.ok(!ids(crowded, 0).includes('minimalist'));
  // All Hands (review F16: Full Grid could never be earned with 11 machines on 48 cells): everything owned is on the grid at the end
  assert.ok(ids({ ...s, bin: [], sold: 0 }, null).includes('all-hands'), 'empty bin, nothing sold: All Hands');
  assert.ok(!ids({ ...s, bin: [{ id: 99, kind: 'conveyor', x: -1, y: -1, dir: 0 }], sold: 0 }, null).includes('all-hands'), 'a part left in the bin loses it');
  assert.ok(!ids({ ...s, bin: [], sold: RULES.sellValue }, null).includes('all-hands'), 'a sold part loses it');
  assert.ok(!ids({ ...s, rounds: s.rounds.slice(0, 2), bin: [], sold: 0 }, null).includes('all-hands'), 'only a finished run can earn it');
});
