// production roadmap 0.9.3 / 0.9.4: the flow overlay's geometry (pure) and its drawing through a fake graphics.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { flowLinks, drawFlowLinks, type FlowGraphics } from '../game/src/render/FlowOverlay';
import type { Layout, Machine, MachineKind, Dir } from '../game/src/sim/types';

let id = 1;
const m = (kind: MachineKind, x: number, y: number, dir: Dir = 0): Machine => ({ id: id++, kind, x, y, dir });
const lay = (...machines: Machine[]): Layout => ({ width: 8, height: 6, machines });

test('flow links: an output connects when the neighbour takes items from that side; head-on, empty and wrong-side outputs are loose', () => {
  const L = lay(m('hopper', 0, 1), m('conveyor', 1, 1), m('crusher', 2, 1), m('dock', 3, 1), m('conveyor', 5, 1, 2), m('conveyor', 4, 1, 0), m('splitter', 6, 3, 0), m('furnace', 2, 3, 3), m('conveyor', 2, 2, 0));
  const links = flowLinks(L);
  const at = (x: number, y: number) => links.filter((l) => l.x === x && l.y === y);
  assert.deepEqual(at(0, 1), [{ x: 0, y: 1, dir: 0, ok: true }], 'hopper → conveyor');
  assert.deepEqual(at(1, 1), [{ x: 1, y: 1, dir: 0, ok: true }], 'conveyor → crusher from behind');
  assert.deepEqual(at(2, 1), [{ x: 2, y: 1, dir: 0, ok: true }], 'crusher → dock (any side)');
  assert.deepEqual(at(3, 1), [], 'a dock has no output');
  assert.deepEqual(at(5, 1), [{ x: 5, y: 1, dir: 2, ok: false }], 'head-on into another conveyor\'s output: loose');
  assert.deepEqual(at(4, 1), [{ x: 4, y: 1, dir: 0, ok: false }], 'into the back of a conveyor that points at it: loose');
  assert.deepEqual(at(6, 3).map((l) => [l.dir, l.ok]), [[3, false], [1, false]], 'a splitter\'s two outputs into empty cells');
  assert.deepEqual(at(2, 3), [{ x: 2, y: 3, dir: 3, ok: true }], 'a furnace pointing up into the side of an eastbound conveyor: conveyors take items from behind and both sides');
  assert.deepEqual(at(2, 2), [{ x: 2, y: 2, dir: 0, ok: false }], 'that conveyor points east into an empty cell: loose');
});

test('flow drawing: one chevron per connected link, a chevron and a bar per loose one; clear first', () => {
  const calls: string[] = [];
  const g: FlowGraphics = { clear: () => calls.push('clear'), fillStyle: (c, a) => calls.push(`style:${c.toString(16)}:${a}`), fillTriangle: () => calls.push('tri'), fillRect: () => calls.push('rect') };
  drawFlowLinks(g, [{ x: 0, y: 0, dir: 0, ok: true }, { x: 1, y: 0, dir: 1, ok: false }], (x, y) => ({ px: x * 72, py: y * 72 }));
  assert.deepEqual(calls, ['clear', 'style:f0a830:0.5', 'tri', 'style:eb6757:0.55', 'tri', 'style:eb6757:0.6', 'rect']);
  calls.length = 0; drawFlowLinks(g, [], () => ({ px: 0, py: 0 })); assert.deepEqual(calls, ['clear']);
});
