// What a card says it would add, and a machine lifted out of the line. The first panel lost whole shifts to parts that did nothing until
// the shift ran, and to a hole left in the belt by "Back to the shelf".
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { apply, newRun } from '../game/src/sim/run';
import { runLayout } from '../game/src/sim/sim';
import { cardGain } from '../game/src/render/estimate';
import { liftActions } from '../game/src/render/placement';
import { RULES } from '../game/src/sim/rules';
import type { RunState } from '../game/src/sim/run';

/** The classic straight line with a crusher and a furnace in it: hopper, crusher, furnace, belt, dock. */
function line(): RunState {
  const s = newRun('classic-estimate');
  const belts = s.layout.machines.filter((m) => m.kind === 'conveyor');
  s.layout.machines = s.layout.machines.filter((m) => m !== belts[0] && m !== belts[1]);
  s.layout.machines.push({ id: 90, kind: 'crusher', x: belts[0].x, y: belts[0].y, dir: 0 }, { id: 91, kind: 'furnace', x: belts[1].x, y: belts[1].y, dir: 0 });
  return s;
}

test('a Crusher on a raw line adds what shards pay over scrap', () => {
  const s = newRun('classic-estimate');
  const scrap = runLayout(s.layout).shipped.scrap;
  assert.equal(cardGain(s.layout, ['crusher']).gain, scrap * (RULES.value.shards - RULES.value.scrap));
});

test('a Tuner beside a slow Furnace reads as a gain, and it is the one the line really gets', () => {
  const s = line();
  const before = runLayout(s.layout).earned;
  const { gain } = cardGain(s.layout, ['tuner']);
  assert.ok(gain > 0);
  const furnace = s.layout.machines.find((m) => m.kind === 'furnace')!;
  const after = runLayout({ ...s.layout, machines: [...s.layout.machines, { id: 92, kind: 'tuner', x: furnace.x, y: furnace.y + 1, dir: 0 }] }).earned;
  assert.equal(before + gain, after);
});

test('a card that needs a partner reads as nothing yet, which is true', () => {
  const s = line();
  assert.equal(cardGain(s.layout, ['press']).gain, 0);
});

test('a machine lifted out of the line leaves a belt piece behind when the shelf has one', () => {
  const s = line();
  s.bin.push({ id: 93, kind: 'conveyor', x: -1, y: -1, dir: 0 });
  s.phase = 'build';
  const crusher = s.layout.machines.find((m) => m.kind === 'crusher')!;
  const { x, y } = crusher;
  for (const a of liftActions(s, crusher)) apply(s, a);
  assert.equal(s.layout.machines.find((m) => m.x === x && m.y === y)?.kind, 'conveyor');
  assert.ok(runLayout(s.layout).earned > 0, 'the line still runs, without the crusher');
});

test('with no belt on the shelf, or for a part beside the line, it just comes off', () => {
  const s = line();
  s.phase = 'build';
  const crusher = s.layout.machines.find((m) => m.kind === 'crusher')!;
  assert.deepEqual(liftActions(s, crusher), [{ t: 'unplace', id: crusher.id }]);
  s.layout.machines.push({ id: 94, kind: 'tuner', x: 3, y: 4, dir: 0 });
  s.bin.push({ id: 95, kind: 'conveyor', x: -1, y: -1, dir: 0 });
  assert.deepEqual(
    liftActions(
      s,
      s.layout.machines.find((m) => m.id === 94)!,
    ),
    [{ t: 'unplace', id: 94 }],
  );
});
