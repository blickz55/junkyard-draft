// Sal's game: a target worked out on the device, the same for everyone on a yard, legal move for move, and it reads nothing but the yard.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { salGame, salKnown, salLater } from '../game/src/render/sal';
import { replay } from '../game/src/sim/run';
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
