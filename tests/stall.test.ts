// production roadmap 0.9.4: the stall indicator's state machine (extracted from GameScene).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { StallMonitor, stallText, STALL_TICKS } from '../game/src/render/StallMonitor';

test('stall monitor: flags the lowest jammed cell after STALL_TICKS without a ship, moves without restarting the clock, clears on a ship', () => {
  const m = new StallMonitor(8);
  assert.equal(STALL_TICKS, 8);
  assert.equal(m.update(new Set(), 3), null, 'nothing jammed: nothing to do');
  assert.equal(m.update(new Set([10]), 5), null, 'jammed, but a ship was recent (tick 0)');
  const flag = m.update(new Set([10, 3]), 8);
  assert.deepEqual(flag, { kind: 'flag', cell: 3, x: 3, y: 0, began: true });
  assert.equal(m.cell, 3); assert.equal(m.flaggedAt, 8);
  assert.equal(m.update(new Set([10, 3]), 9), null, 'the same cell stays flagged quietly');
  const moved = m.update(new Set([10, 3, 1]), 10);
  assert.deepEqual(moved, { kind: 'flag', cell: 1, x: 1, y: 0, began: false });
  assert.equal(m.flaggedAt, 8, 'moving the marker does not restart the clock');
  m.shipped(11);
  assert.deepEqual(m.update(new Set([10]), 11), { kind: 'clear' });
  assert.equal(m.cell, null); assert.equal(m.flaggedAt, -1);
  assert.equal(m.update(new Set(), 12), null, 'already clear');
  assert.equal(m.update(new Set([9]), 18), null, 'seven ticks since the ship');
  assert.deepEqual(m.update(new Set([9]), 19), { kind: 'flag', cell: 9, x: 1, y: 1, began: true });
  m.reset(); assert.equal(m.cell, null); assert.equal(m.lastShipTick, 0);
});

test('stall text: the machine, its cell (1-based) and whether it is blocked or waiting', () => {
  assert.equal(stallText('hopper', 0, 1), 'Stalled: Scrap Hopper at 1,2 is blocked — nothing shipped for 8 s');
  assert.equal(stallText('conveyor', 4, 2), 'Stalled: Conveyor at 5,3 is waiting — nothing shipped for 8 s');
  assert.match(stallText(null, 2, 2), /^Stalled: Item at 3,3 is waiting/);
});
