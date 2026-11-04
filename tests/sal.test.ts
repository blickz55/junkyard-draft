// Sal's game: a target worked out on the device, the same for everyone on a yard, legal move for move, and it reads nothing but the yard.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { salGame, salKnown, salLater } from '../game/src/render/sal';
import { apply, newRun, replay } from '../game/src/sim/run';
import { hintFor } from '../game/src/render/guide';
import { RULES_VERSION } from '../game/src/sim/types';
import { RULES } from '../game/src/sim/rules';

test('the same yard gives the same game, and a recording of it checks out to the same money', () => {
  const a = salGame('sal-a');
  const b = salGame('sal-a');
  assert.equal(a, b, 'worked out once');
  const s = replay('sal-a', a.actions, RULES_VERSION);
  assert.equal(s.score, a.score);
  assert.deepEqual(
    s.rounds.map((r) => r.earned),
    a.rounds,
  );
  assert.equal(s.filled, a.filled);
  assert.equal(a.rounds.length, RULES.rounds);
  assert.ok(a.score > a.rounds[0] * RULES.rounds, 'Sal builds as the game goes');
});

test('worked out a shift at a time it comes to the same game, and stays known', async () => {
  assert.equal(salKnown('sal-later'), null);
  const later = await new Promise<ReturnType<typeof salGame>>((resolve) => salLater('sal-later', resolve));
  assert.equal(salKnown('sal-later'), later);
  assert.equal(salGame('sal-later'), later);
  const again = await new Promise<ReturnType<typeof salGame>>((resolve) => salLater('sal-later', resolve));
  assert.equal(again, later);
});

test('yards differ, so Sal does too', () => {
  const scores = new Set(Array.from({ length: 6 }, (_, i) => salGame(`sal-${i}`).score));
  assert.ok(scores.size >= 4, [...scores].join());
});

test("Sal's money after each shift counts what he spent and sold, so the race against him ends where the results do", () => {
  const g = salGame('sal-after');
  assert.equal(g.after.length, g.rounds.length);
  assert.equal(g.after[g.after.length - 1], g.score, 'the last shift ends on his score');
  const s = replay('sal-after', g.actions, RULES_VERSION);
  assert.equal(s.score, g.score);
});

test('Sal sells only what the coach offers to sell, the moment it offers it: following the coach ties him to the dollar (the seventh panel sat $10 behind a Sal who sold what the coach never mentioned)', () => {
  let sold = 0;
  for (const seed of ['sal-sells-1', 'sal-sells-2', 'sal-sells-3', 'sal-sells-4', 'sal-sells-5', 'sal-sells-6']) {
    const r = newRun(seed);
    for (const a of salGame(seed).actions) {
      if (a.t === 'sell') {
        const offer = hintFor(r, { tutorial: false, touch: false, watching: null, mode: 'build', lights: false }).sell;
        assert.equal(offer?.id, a.id, `${seed}, shift ${r.round}: the coach offers the part he sells`);
        sold++;
      }
      apply(r, a);
    }
  }
  assert.ok(sold > 0, 'he sold a spare on these yards');
});
