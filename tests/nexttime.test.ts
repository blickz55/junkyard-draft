// "Next time" (2026-11-06): the card and the figure the results name after a miss are the game's own: a try to that shift, that card, placed
// where the estimate puts it, earns exactly the figure over what the game earned, and fills the order when the line says so.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { apply, newRun } from '../game/src/sim/run';
import { RULES } from '../game/src/sim/rules';
import { draftOf, nextTime } from '../game/src/render/nexttime';
import { dropActions } from '../game/src/render/placement';
import { salGame } from '../game/src/render/sal';

test("the figure is the game's own: a try to the shift with that card earns it exactly, and fills the order iff the line says so", () => {
  let named = 0;
  let atMiss = 0;
  for (let i = 0; i < 24; i++) {
    const seed = `next-${i}`;
    const sal = salGame(seed);
    // a game that follows nothing: the first card each shift, nothing built, which misses early
    const run = newRun(seed);
    while (run.phase !== 'finished') {
      if (run.phase === 'draft') apply(run, { t: 'pick', i: 0 });
      apply(run, { t: 'run' });
      apply(run, { t: 'next' });
    }
    const line = nextTime(run, sal.score);
    if (!line) continue;
    named++;
    const orders = run.job!.orders!;
    const miss = run.rounds.findIndex((r, k) => r.earned < orders[k]);
    if (line.shift === miss + 1) atMiss++;
    const d = draftOf(run, line.shift);
    assert.ok(d.offers.includes(line.card), `${seed}: the card was in that deal`);
    apply(d, { t: 'pick', i: d.offers.indexOf(line.card) });
    for (const p of line.plan) {
      const part = d.bin.find((m) => m.kind === p.kind)!;
      for (const a of dropActions(d, part, p.x, p.y, p.dir)) apply(d, a);
    }
    apply(d, { t: 'run' });
    const paid = d.rounds[line.shift - 1].earned;
    assert.equal(paid, run.rounds[line.shift - 1].earned + line.figure, `${seed} shift ${line.shift} ${line.card}`);
    assert.equal(paid >= orders[line.shift - 1], line.fillsOrder, `${seed}: fills the order iff the line says so`);
    assert.ok(line.figure > 0 && line.shift >= 1 && line.shift <= RULES.rounds);
  }
  assert.ok(named >= 12 && atMiss >= 6, `lines named ${named}, at the shift of the miss ${atMiss}`);
});

test('nothing to say: a game with no job, a try, a game that filled every order and beat Sal', () => {
  const classic = newRun('classic-next');
  while (classic.phase !== 'finished') {
    if (classic.phase === 'draft') apply(classic, { t: 'pick', i: 0 });
    apply(classic, { t: 'run' });
    apply(classic, { t: 'next' });
  }
  assert.equal(nextTime(classic, 100), null, 'no orders, nothing to miss');
  const sal = salGame('next-0');
  const own = newRun('next-0');
  for (const a of sal.actions) apply(own, a);
  const line = nextTime(own, sal.score - 1);
  if (own.filled === RULES.rounds) assert.equal(line, null, 'every order filled and ahead of Sal: nothing to name');
  own.forkedFrom = { hash: null, player: 'x', round: 2 };
  assert.equal(nextTime(own, null), null, 'a try is not read');
});
