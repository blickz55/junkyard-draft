// A stroke across the yard lays a belt: what the first panel asked for after twenty taps on one branch. Pure: `strokeActions` turns the cells
// a finger crossed into rule-checked actions, and these run them through the rules.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { apply, newRun, type RunState } from '../game/src/sim/run';
import { strokeActions, type Cell } from '../game/src/render/placement';
import { RULES } from '../game/src/sim/rules';

/** A yard with the crusher and a clear area: classic yards have the belt in row 2, and rows 3 to 5 stay empty. */
function yard(score = 0): RunState {
  const s = newRun('classic-stroke');
  apply(s, { t: 'pick', i: 0 });
  s.score = score;
  return s;
}
const run = (s: RunState, cells: Cell[]) => {
  const out = strokeActions(s, cells);
  for (const a of out.actions) apply(s, a);
  return out;
};
const at = (s: RunState, x: number, y: number) => s.layout.machines.find((m) => m.x === x && m.y === y);

test('each piece faces the next cell, and the last runs on the way the stroke was going', () => {
  const s = yard();
  for (let i = 0; i < 3; i++) s.bin.push({ id: s.nextId++, kind: 'conveyor', x: -1, y: -1, dir: 0 });
  const out = run(s, [
    { x: 1, y: 4 },
    { x: 2, y: 4 },
    { x: 2, y: 5 },
  ]);
  assert.equal(out.laid, 3);
  assert.equal(out.bought, 0);
  assert.deepEqual([at(s, 1, 4)?.dir, at(s, 2, 4)?.dir, at(s, 2, 5)?.dir], [0, 1, 1]);
});

test('a stroke from a machine aims it and lays on from the next cell', () => {
  const s = yard();
  s.bin.push({ id: s.nextId++, kind: 'conveyor', x: -1, y: -1, dir: 0 });
  const hopper = s.layout.machines.find((m) => m.kind === 'hopper')!;
  const out = run(s, [
    { x: hopper.x, y: hopper.y },
    { x: hopper.x, y: hopper.y + 1 },
  ]);
  assert.equal(out.laid, 1);
  assert.equal(at(s, hopper.x, hopper.y)?.dir, 1, 'the hopper now points down the stroke');
  assert.equal(at(s, hopper.x, hopper.y + 1)?.kind, 'conveyor');
});

test('a flick from one machine at the one beside it only aims it', () => {
  const s = yard();
  const belt = at(s, 3, 2)!;
  const before = s.layout.machines.length;
  const out = run(s, [
    { x: 3, y: 2 },
    { x: 3, y: 3 },
  ]);
  assert.equal(out.laid, 0, 'there are no belts to lay and no money');
  assert.equal(s.layout.machines.length, before);
  assert.equal(at(s, 3, 2)?.id, belt.id);
  assert.equal(at(s, 3, 2)?.dir, 1);
});

test('the stroke ends at what is in the way, with the last piece facing it, so a belt joins a line by being drawn into it', () => {
  const s = yard();
  for (let i = 0; i < 2; i++) s.bin.push({ id: s.nextId++, kind: 'conveyor', x: -1, y: -1, dir: 0 });
  const out = run(s, [
    { x: 3, y: 4 },
    { x: 3, y: 3 },
    { x: 3, y: 2 },
    { x: 3, y: 1 },
  ]);
  assert.equal(out.laid, 2);
  assert.equal(at(s, 3, 3)?.dir, 3, 'it points at the belt it joins');
  assert.equal(at(s, 3, 1), undefined, 'nothing is laid past the belt');
});

test('the last piece bends toward whatever will take its load', () => {
  const s = yard();
  s.bin.push({ id: s.nextId++, kind: 'conveyor', x: -1, y: -1, dir: 0 });
  s.bin.push({ id: s.nextId++, kind: 'conveyor', x: -1, y: -1, dir: 0 });
  run(s, [
    { x: 2, y: 3 },
    { x: 3, y: 3 },
  ]);
  assert.equal(at(s, 3, 3)?.dir, 3, 'the belt above takes it, so it turns up rather than running on');
});

test('past the shelf a stroke buys belts while the money lasts, and says so', () => {
  const s = yard(RULES.beltCost * 2 + 5);
  const score = s.score;
  const out = run(s, [
    { x: 0, y: 5 },
    { x: 1, y: 5 },
    { x: 2, y: 5 },
    { x: 3, y: 5 },
  ]);
  assert.equal(out.laid, 2);
  assert.equal(out.bought, 2);
  assert.equal(out.short, true);
  assert.equal(s.score, score - RULES.beltCost * 2);
  assert.equal(s.belts, 2);
});

test('a junk pile ends a stroke, and a tap is no stroke', () => {
  const s = newRun('stroke-yard-1');
  apply(s, { t: 'pick', i: 0 });
  assert.deepEqual(strokeActions(s, [{ x: 0, y: 0 }]).actions, []);
  const pile = s.layout.rubble![0];
  const x = pile % s.layout.width;
  const y = Math.floor(pile / s.layout.width);
  const from = x > 0 ? { x: x - 1, y } : { x: x + 1, y };
  if (!at(s, from.x, from.y)) {
    const out = strokeActions(s, [from, { x, y }]);
    assert.equal(out.laid, 1, 'one piece, facing the pile');
  }
});
