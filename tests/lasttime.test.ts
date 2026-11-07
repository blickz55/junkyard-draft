// The consultant backlog, 2026-11-06: a try shows the previous line as faint outlines (render/lasttime.ts). The spots are a pure diff of two
// layouts, the drawing goes through a fake graphics, and the mirror says them for a screen reader.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { drawLastTime, lastTimeCells, LAST_TIME, type LastTimeGraphics } from '../game/src/render/lasttime';
import { cellLine, yardLines } from '../game/src/render/mirror';
import { newRun } from '../game/src/sim/run';
import { P } from '../game/src/render/palette';
import type { Dir, Layout, Machine, MachineKind } from '../game/src/sim/types';

let id = 1;
const m = (kind: MachineKind, x: number, y: number, dir: Dir = 0): Machine => ({ id: id++, kind, x, y, dir });
const lay = (...machines: Machine[]): Layout => ({ width: 8, height: 6, machines });
const grid = (x: number, y: number) => ({ px: x * 72, py: y * 72 });

test('the spots to outline: where the previous line had a part and nothing stands now, row by row; a part there, the same or another, shows nothing', () => {
  const previous = lay(m('hopper', 0, 0), m('crusher', 2, 1), m('conveyor', 3, 1), m('dock', 4, 1, 1), m('furnace', 1, 3, 2));
  const current = lay(m('hopper', 0, 0), m('furnace', 2, 1), m('conveyor', 6, 5));
  assert.deepEqual(lastTimeCells(previous, current), [
    { x: 3, y: 1, kind: 'conveyor', dir: 0 },
    { x: 4, y: 1, kind: 'dock', dir: 1 },
    { x: 1, y: 3, kind: 'furnace', dir: 2 },
  ]);
  assert.deepEqual(lastTimeCells(current, current), [], 'the same line: nothing');
  assert.deepEqual(lastTimeCells(lay(), current), [], 'nothing stood there last time: nothing');
  assert.deepEqual(
    lastTimeCells(previous, lay()),
    previous.machines.map(({ x, y, kind, dir }) => ({ x, y, kind, dir })),
    'an empty yard outlines every part, in reading order',
  );
  const shuffled = lay(m('conveyor', 5, 2), m('conveyor', 1, 2), m('conveyor', 3, 0));
  assert.deepEqual(
    lastTimeCells(shuffled, lay()).map((c) => [c.x, c.y]),
    [
      [3, 0],
      [1, 2],
      [5, 2],
    ],
    'row by row, left to right, whatever order the parts were placed in',
  );
});

test('drawing: clear first; one dim steel frame per spot and an arrow the way the part faced, no arrow for a dock; an empty list leaves nothing', () => {
  const calls: string[] = [];
  const g: LastTimeGraphics = {
    clear: () => calls.push('clear'),
    lineStyle: (w, c, a) => calls.push(`style:${w}:${c.toString(16)}:${a}`),
    strokeRoundedRect: (x, y, w, h, r) => calls.push(`frame:${x},${y},${w},${h},${r}`),
    lineBetween: (x1, y1, x2, y2) => calls.push(`line:${x1},${y1},${x2},${y2}`),
  };
  drawLastTime(g, [], grid);
  assert.deepEqual(calls, ['clear']);
  calls.length = 0;
  drawLastTime(
    g,
    [
      { x: 1, y: 0, kind: 'crusher', dir: 0 },
      { x: 2, y: 0, kind: 'dock', dir: 0 },
      { x: 0, y: 1, kind: 'conveyor', dir: 1 },
    ],
    grid,
  );
  assert.equal(LAST_TIME.colour, P.steel, "the yard's own steel");
  assert.deepEqual(calls, [
    'clear',
    'style:2:8e9aa6:0.7',
    'frame:79,7,58,58,6',
    'line:96,36,122,36',
    'line:122,36,116,41',
    'line:122,36,116,31',
    'frame:151,7,58,58,6',
    'frame:7,79,58,58,6',
    'line:36,96,36,122',
    'line:36,122,31,116',
    'line:36,122,41,116',
  ]);
});

test("the mirror says it: a line per outlined spot after the yard's own, the cursor on one says what stood there, and nothing once a part stands there", () => {
  const run = newRun('classic-mirror');
  run.layout.machines = [{ id: 1, kind: 'hopper', x: 1, y: 1, dir: 0 }];
  run.layout.rubble = [];
  delete run.layout.reserved;
  run.bin = [{ id: 9, kind: 'furnace', x: -1, y: -1, dir: 0 }];
  const previous: Layout = { ...run.layout, machines: [...run.layout.machines, { id: 2, kind: 'crusher', x: 2, y: 1, dir: 0 }] };
  const lines = yardLines(run, previous);
  assert.equal(lines[1], 'Row 2, column 2: Scrap Hopper, facing right, its way out goes nowhere');
  assert.equal(lines[2], 'Row 2, column 3: empty; last time a Crusher stood here, facing right');
  assert.equal(lines[3], 'On the shelf: Furnace', 'after the yard, before the shelf');
  assert.equal(cellLine(run, 2, 1, null, previous), 'Row 2, column 3: empty; last time a Crusher stood here, facing right');
  assert.equal(cellLine(run, 2, 1, 'furnace', previous), 'Row 2, column 3: empty; last time a Crusher stood here, facing right. Holding Furnace');
  assert.equal(cellLine(run, 3, 1, null, previous), 'Row 2, column 4: empty', 'any other spot as before');
  assert.deepEqual(yardLines(run, null), yardLines(run), 'no try: the yard as before');
  run.layout.machines.push({ id: 3, kind: 'furnace', x: 2, y: 1, dir: 0 });
  assert.ok(!yardLines(run, previous).some((l) => /last time/.test(l)), 'a part there: nothing to say');
  assert.equal(cellLine(run, 2, 1, null, previous), 'Row 2, column 3: Furnace, facing right, its way out goes nowhere');
});
