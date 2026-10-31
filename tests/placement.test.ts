// The obvious move works (docs/UX-STANDARD.md): a drop on the belt swaps, one Undo reverses it, a conveyor fed from the side is a corner.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { apply, newRun, TUTORIAL_SEED } from '../game/src/sim/run';
import { canUndo, undo } from '../game/src/sim/undo';
import { beltShape, dropActions, feedsInto } from '../game/src/render/placement';
import { RoundController } from '../game/src/render/RoundController';

test('a shelf part dropped on a belt piece takes its place; the belt piece goes to the shelf; the part faces the way the line runs', () => {
  const s = newRun('classic-swap');
  apply(s, { t: 'pick', i: s.offers.indexOf('crusher') });
  const crusher = s.bin[s.bin.length - 1];
  const belt = s.layout.machines.find((m) => m.kind === 'conveyor')!;
  const { x: bx, y: by, dir: bd } = belt;
  const acts = dropActions(s, crusher, bx, by);
  assert.deepEqual(
    acts.map((a) => a.t),
    ['unplace', 'place'],
  );
  acts.forEach((a) => apply(s, a));
  const placed = s.layout.machines.find((m) => m.id === crusher.id)!;
  assert.deepEqual([placed.x, placed.y, placed.dir], [bx, by, bd], 'in line: the same way the belt piece ran');
  assert.ok(
    s.bin.some((m) => m.id === belt.id),
    'the belt piece is on the shelf',
  );
});

test('two machines in the yard swap places; dropping a machine on itself does nothing', () => {
  const s = newRun('classic-swap-2');
  apply(s, { t: 'pick', i: 0 });
  const [a, b] = s.layout.machines.filter((m) => m.kind === 'conveyor');
  const acts = dropActions(s, a, b.x, b.y);
  assert.equal(acts.length, 3);
  const before = [a.x, a.y, b.x, b.y];
  acts.forEach((x) => apply(s, x));
  const na = s.layout.machines.find((m) => m.id === a.id)!;
  const nb = s.layout.machines.find((m) => m.id === b.id)!;
  assert.deepEqual([nb.x, nb.y, na.x, na.y], before);
  assert.deepEqual(dropActions(s, na, na.x, na.y), []);
});

test('undo takes a whole swap back in one step, through the controller; redo puts it back', () => {
  const ctl = new RoundController({ seed: 'classic-swap-3', fresh: true }, {});
  ctl.act({ t: 'pick', i: 0 });
  const part = ctl.run.bin[ctl.run.bin.length - 1];
  const belt = ctl.run.layout.machines.find((m) => m.kind === 'conveyor')!;
  const before = JSON.stringify(ctl.run.layout.machines);
  assert.equal(ctl.actAll(dropActions(ctl.run, part, belt.x, belt.y)), true);
  assert.notEqual(JSON.stringify(ctl.run.layout.machines), before);
  assert.equal(ctl.undo(), true);
  assert.equal(JSON.stringify(ctl.run.layout.machines), before, 'one undo, all of it');
  assert.equal(ctl.redo(), true);
  assert.ok(ctl.run.layout.machines.some((m) => m.id === part.id));
  assert.equal(ctl.undo(), true);
  assert.equal(canUndo(ctl.run), false, 'nothing left: the pick is not a build edit');
  assert.equal(undo(ctl.run), null);
});

test('a conveyor fed only from its side draws as a corner; fed from behind or from both sides it stays straight', () => {
  const s = newRun(TUTORIAL_SEED);
  const gap = s.bin[0];
  apply(s, { t: 'place', id: gap.id, x: 4, y: 1, dir: 1 });
  const corner = s.layout.machines.find((m) => m.id === gap.id)!;
  assert.deepEqual(feedsInto(s.layout, 4, 1), [0], 'the belt pushes east into it');
  assert.equal(beltShape(s.layout, corner), 'right', 'travelling east then south is a right turn');
  const straight = s.layout.machines.find((m) => m.x === 3 && m.y === 1)!;
  assert.equal(beltShape(s.layout, straight), 'straight');
  const flipped = { ...corner, dir: 3 as const };
  const l = { ...s.layout, machines: s.layout.machines.map((m) => (m.id === corner.id ? flipped : m)) };
  assert.equal(beltShape(l, flipped), 'left', 'travelling east then north is a left turn');
});
