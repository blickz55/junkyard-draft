import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inputTravelDirs, outputDirs } from '../game/src/sim/advice';
import { explainRunError, placementWarning } from '../game/src/content/advice';
import { apply, newRun, RunError, type Action } from '../game/src/sim/run';
import type { Layout, Machine, MachineKind, Dir } from '../game/src/sim/types';

const mk = (id: number, kind: MachineKind, x: number, y: number, dir: Dir = 0): Machine => ({ id, kind, x, y, dir });
const lay = (...machines: Machine[]): Layout => ({ width: 8, height: 6, machines });

test('every RunError from apply maps to a non-empty player string', () => {
  const s = newRun('advice');
  const cases: Action[] = [
    { t: 'place', id: 1, x: 0, y: 0, dir: 0 }, // not building
    { t: 'pick', i: 3 } as Action, // malformed
    { t: 'next' }, // round not finished
    { t: 'unplace', id: 999 } as Action, // not building
  ];
  const msgs: string[] = [];
  for (const a of cases) {
    try {
      apply(s, a);
    } catch (e) {
      assert.ok(e instanceof RunError);
      msgs.push((e as Error).message);
    }
  }
  apply(s, { t: 'pick', i: 0 });
  const bin = s.bin[0];
  for (const a of [
    { t: 'place', id: bin.id, x: -1, y: 0, dir: 0 },
    { t: 'place', id: bin.id, x: 2, y: 2, dir: 0 },
    { t: 'place', id: 999, x: 0, y: 0, dir: 0 },
    { t: 'sell', id: 1 },
    { t: 'pick', i: 0 },
  ] as Action[]) {
    try {
      apply(s, a);
    } catch (e) {
      assert.ok(e instanceof RunError);
      msgs.push((e as Error).message);
    }
  }
  assert.ok(msgs.length >= 8);
  for (const m of msgs) assert.ok(explainRunError(m).length > 10, m);
  assert.match(explainRunError('cell occupied'), /^Cell occupied/);
  assert.match(explainRunError('out of bounds'), /Outside the grid/);
  assert.ok(explainRunError('action limit reached for this run: x').length > 0);
  assert.ok(explainRunError('something new').length > 0);
});

test('crusher beside a hopper warns (behind only); fed in line it does not', () => {
  const hopper = mk(1, 'hopper', 1, 2, 0);
  const warn = placementWarning(lay(hopper), 'crusher', 1, 3, 0, 50);
  assert.match(warn ?? '', /behind only/);
  assert.equal(placementWarning(lay(hopper), 'crusher', 2, 2, 0, 50), null);
  assert.match(placementWarning(lay(hopper), 'crusher', 2, 2, 1, 50) ?? '', /behind only/);
  assert.match(placementWarning(lay(), 'crusher', 3, 3, 0, 50) ?? '', /nothing feeds/);
  assert.match(placementWarning(lay(mk(2, 'hopper', 1, 2, 3)), 'crusher', 2, 2, 0, 50) ?? '', /does not point into it/);
  assert.match(placementWarning(lay(hopper), 'crusher', 7, 3, 0, 50) ?? '', /^Crusher takes items/);
  assert.match(placementWarning(lay(mk(2, 'conveyor', 6, 3, 0)), 'crusher', 7, 3, 0, 50) ?? '', /off the grid/);
});

test('tuner (rules v3): warns when no processor touches it, silent beside a crusher, furnace or press; takes and gives nothing', () => {
  const layout = {
    width: 8,
    height: 6,
    machines: [
      { id: 1, kind: 'hopper' as const, x: 1, y: 2, dir: 0 as const },
      { id: 2, kind: 'furnace' as const, x: 2, y: 2, dir: 0 as const },
      { id: 3, kind: 'dock' as const, x: 3, y: 2, dir: 0 as const },
    ],
  };
  assert.match(placementWarning(layout, 'tuner', 5, 5, 0, 9) ?? '', /nothing here to tune/);
  assert.equal(placementWarning(layout, 'tuner', 2, 1, 0, 9), null, 'above the furnace');
  assert.equal(placementWarning(layout, 'tuner', 2, 3, 0, 9), null, 'below the furnace');
  assert.match(placementWarning(layout, 'tuner', 1, 1, 0, 9) ?? '', /nothing here to tune/, 'above a hopper is not a processor');
  assert.deepEqual(inputTravelDirs('tuner', 0), []);
  assert.deepEqual(outputDirs('tuner', 0), []);
});

test('conveyors accept from the sides; splitters output left and right; docks take all', () => {
  assert.deepEqual(inputTravelDirs('conveyor', 0).sort(), [0, 1, 3]);
  assert.deepEqual(inputTravelDirs('crusher', 2), [2]);
  assert.deepEqual(inputTravelDirs('hopper', 0), []);
  assert.deepEqual(outputDirs('splitter', 0).sort(), [1, 3]);
  assert.deepEqual(outputDirs('dock', 0), []);
  assert.equal(placementWarning(lay(mk(1, 'hopper', 2, 1, 1)), 'conveyor', 2, 2, 0, 50), null);
});
