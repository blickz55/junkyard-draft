// The obvious move works (docs/UX-STANDARD.md): a drop on the belt swaps, one Undo reverses it, a conveyor fed from the side is a corner.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { apply, newRun, TUTORIAL_SEED } from '../game/src/sim/run';
import { canUndo, undo } from '../game/src/sim/undo';
import { beltShape, dropActions, feedsInto, smartFacing } from '../game/src/render/placement';
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
  assert.equal(canUndo(ctl.run), true, 'the pick can come back too, until the shift starts');
  assert.equal(ctl.undo(), true);
  assert.equal(ctl.run.phase, 'draft');
  assert.equal(canUndo(ctl.run), false, 'and that is the end of it');
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

test('a Crusher dropped beside a Hopper that feeds nothing turns that Hopper to feed it, in the same edit; a Hopper already facing it is left alone', () => {
  const s = newRun('classic-aim');
  apply(s, { t: 'pick', i: s.offers.indexOf('crusher') });
  const crusher = s.bin.find((m) => m.kind === 'crusher')!;
  const hopper = s.layout.machines.find((m) => m.kind === 'hopper')!;
  assert.deepEqual([hopper.x, hopper.y], [1, 2], 'the classic yard: a Hopper at 1,2');
  apply(s, { t: 'place', id: hopper.id, x: 1, y: 2, dir: 3 }); // turned north, into nothing
  const acts = dropActions(s, crusher, 1, 3);
  assert.deepEqual(acts, [
    { t: 'place', id: crusher.id, x: 1, y: 3, dir: 0 },
    { t: 'place', id: hopper.id, x: 1, y: 2, dir: 1 },
  ]);
  acts.forEach((a) => apply(s, a));
  assert.equal(s.layout.machines.find((m) => m.id === hopper.id)!.dir, 1, 'the Hopper now faces the Crusher');

  const t = newRun('classic-aim');
  apply(t, { t: 'pick', i: t.offers.indexOf('crusher') });
  const h2 = t.layout.machines.find((m) => m.kind === 'hopper')!;
  apply(t, { t: 'place', id: h2.id, x: 1, y: 2, dir: 1 }); // already facing the spot
  assert.deepEqual(
    dropActions(
      t,
      t.bin.find((m) => m.kind === 'crusher')!,
      1,
      3,
    ).map((a) => a.t),
    ['place'],
    'nothing to turn',
  );
});

test('a machine fed from one side goes straight on, as the line runs, and turns to what takes its load only when the way ahead is blocked', () => {
  const s = newRun('classic-aim-2');
  apply(s, { t: 'pick', i: s.offers.indexOf('crusher') });
  const hopper = s.layout.machines.find((m) => m.kind === 'hopper')!;
  const belt = s.layout.machines.find((m) => m.kind === 'conveyor' && m.x === 4 && m.y === 2)!;
  const crusher = s.bin.find((m) => m.kind === 'crusher')!;
  const facing = (x: number, y: number) => (dropActions(s, crusher, x, y)[0] as { dir: number }).dir;
  apply(s, { t: 'place', id: hopper.id, x: 1, y: 4, dir: 1 }); // pushing south into 1,5, the bottom row
  apply(s, { t: 'place', id: belt.id, x: 2, y: 5, dir: 0 }); // a belt east of 1,5, running east
  assert.equal(facing(1, 5), 0, 'the edge ahead: turned toward the belt');
  apply(s, { t: 'place', id: belt.id, x: 2, y: 3, dir: 0 });
  apply(s, { t: 'place', id: hopper.id, x: 1, y: 2, dir: 1 }); // pushing south into 1,3, with 1,4 free below it
  assert.equal(facing(1, 3), 1, 'room ahead: straight on, where the player may build next, though the belt beside it would take the load');
  apply(s, { t: 'unplace', id: belt.id });
  apply(s, { t: 'place', id: hopper.id, x: 1, y: 4, dir: 1 });
  assert.equal(facing(1, 5), 1, 'blocked ahead and nothing beside it: straight on, the way the Hopper pushes');
});

test('a Hopper faces the way its scrap reaches a Crusher, not a Tuner on the way into a Furnace, and turns to a Crusher dropped beside it', () => {
  const s = newRun('classic-aim-3');
  apply(s, { t: 'pick', i: s.offers.indexOf('crusher') });
  const id = (n: number) => 900 + n;
  // a Tuner at 4,3 running east into a Furnace at 5,3, then a Crusher at 2,3 facing south; the Hopper goes at 3,3
  s.layout.machines.push({ id: id(1), kind: 'tuner', x: 4, y: 3, dir: 0 }, { id: id(2), kind: 'furnace', x: 5, y: 3, dir: 0 });
  assert.equal(smartFacing(s.layout, 'hopper', 3, 3, 0), 3, 'with no Crusher about: up into the belts to the Dock, not through the Tuner into the Furnace');
  s.layout.machines.push({ id: id(3), kind: 'crusher', x: 2, y: 3, dir: 1 });
  assert.equal(smartFacing(s.layout, 'hopper', 3, 3, 0), 2, 'west into the Crusher');
  s.layout.machines.pop();
  s.layout.machines.push({ id: id(4), kind: 'hopper', x: 3, y: 3, dir: 0 }); // the eighth panel's: facing the Tuner
  const crusher = s.bin.find((m) => m.kind === 'crusher')!;
  assert.deepEqual(
    dropActions(s, crusher, 2, 3).slice(1),
    [{ t: 'place', id: id(4), x: 3, y: 3, dir: 2 }],
    'a Crusher dropped beside it turns it to the Crusher',
  );
});

test('a Hopper whose scrap already goes down the belts to a Dock keeps its way when a Crusher is dropped beside it: that line pays, and the Crusher may lead nowhere yet', () => {
  const s = newRun('classic-aim-4');
  apply(s, { t: 'pick', i: s.offers.indexOf('crusher') });
  const crusher = s.bin.find((m) => m.kind === 'crusher')!;
  assert.deepEqual(
    dropActions(s, crusher, 1, 3).map((a) => a.t),
    ['place'],
    'the starter Hopper at 1,2 still feeds its belts',
  );
});

test('a Crusher dropped beside the Hopper from its own card turns that Hopper to it, though it already fed another Crusher', () => {
  const s = newRun('classic-aim-5');
  apply(s, { t: 'pick', i: s.offers.indexOf('crusher') });
  // the old line's Crusher at 3,3 facing east; the card's Hopper (id 700) beside it at 3,4, facing up into it; the card's Crusher (701) goes at 2,4
  s.layout.machines.push({ id: 690, kind: 'crusher', x: 3, y: 3, dir: 0 }, { id: 700, kind: 'hopper', x: 3, y: 4, dir: 3 });
  const crusher = { id: 701, kind: 'crusher' as const, x: -1, y: -1, dir: 0 as const };
  s.bin.push(crusher);
  const acts = dropActions(s, crusher, 2, 4);
  assert.deepEqual(acts.slice(1), [{ t: 'place', id: 700, x: 3, y: 4, dir: 2 }], 'the kit belongs together');
  // a Hopper from an older card that feeds a Crusher keeps its way
  s.layout.machines.find((m) => m.id === 700)!.id = 650;
  assert.deepEqual(
    dropActions(s, crusher, 2, 4).map((a) => a.t),
    ['place'],
  );
});
