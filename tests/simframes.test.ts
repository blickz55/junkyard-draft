// production roadmap 0.9.4: the live shift's look as pure functions (extracted from GameScene).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { machineFrame, itemPose, easeInOutQuad, transformColour, digestTick } from '../game/src/render/simframes';
import { RULES } from '../game/src/sim/rules';
import type { Item, SimEvent } from '../game/src/sim/types';

const item = (o: Partial<Item>): Item => ({ id: 1, mat: 'scrap', cell: 5, hold: 0, movedAt: 0, from: -1, ...o });
const sim = (o: { itemAt?: Record<number, Item>; pressStore?: Record<number, number>; splitterToggle?: Record<number, 0 | 1>; tick?: number }) => ({
  itemAt: Object.assign([], o.itemAt ?? {}) as (Item | undefined)[],
  pressStore: o.pressStore ?? {},
  splitterToggle: o.splitterToggle ?? {},
  tick: o.tick ?? 0,
});

test('machine frames: crusher jaws on odd ticks while holding, furnace glow, press ram and store tint, hopper beat, splitter flap, nothing for the rest', () => {
  const held = item({ hold: 2 });
  assert.deepEqual(machineFrame('crusher', sim({ itemAt: { 3: held }, tick: 1 }), 3, 0), { key: 'm-crusher-1' });
  assert.deepEqual(machineFrame('crusher', sim({ itemAt: { 3: held }, tick: 2 }), 3, 0), { key: 'm-crusher' }, 'even tick: jaws open');
  assert.deepEqual(machineFrame('crusher', sim({ tick: 1 }), 3, 0), { key: 'm-crusher' }, 'idle: still, so a jam stays visible');
  assert.deepEqual(machineFrame('furnace', sim({ itemAt: { 3: held } }), 3, 0), { key: 'm-furnace-1' });
  assert.deepEqual(machineFrame('furnace', sim({}), 3, 0), { key: 'm-furnace' });
  assert.deepEqual(machineFrame('press', sim({ itemAt: { 3: item({ hold: 2 }) } }), 3, 0), { key: 'm-press-1', tint: 0xffffff });
  assert.deepEqual(machineFrame('press', sim({ itemAt: { 3: item({ hold: 1 }) } }), 3, 0), { key: 'm-press-2', tint: 0xffffff });
  assert.deepEqual(machineFrame('press', sim({ pressStore: { 3: 1 } }), 3, 0), { key: 'm-press', tint: 0xcfe3ff }, 'a stored shard tints the idle press');
  assert.deepEqual(machineFrame('hopper', sim({ tick: RULES.hopperPeriod }), 0, 0.1), { scale: 1.05 });
  assert.deepEqual(machineFrame('hopper', sim({ tick: RULES.hopperPeriod }), 0, 0.5), { scale: 1 });
  assert.deepEqual(machineFrame('splitter', sim({ splitterToggle: { 3: 1 } }), 3, 0), { key: 'm-splitter-1' }, 'the next item goes south');
  assert.deepEqual(machineFrame('splitter', sim({}), 3, 0), { key: 'm-splitter' });
  assert.deepEqual(machineFrame('conveyor', sim({}), 3, 0), {});
  assert.deepEqual(machineFrame('dock', sim({}), 3, 0), {});
});

test('item pose: eased between cells on the tick it moved, at rest otherwise or under reduced motion; held items shrink', () => {
  assert.equal(easeInOutQuad(0), 0);
  assert.equal(easeInOutQuad(1), 1);
  assert.equal(easeInOutQuad(0.5), 0.5);
  assert.ok(easeInOutQuad(0.25) < 0.25 && easeInOutQuad(0.75) > 0.75);
  const moving = item({ cell: 6, from: 5, movedAt: 7 });
  assert.deepEqual(itemPose(moving, 7, 0.5, false, 0), { from: 5, t: 0.5, scale: 1 });
  assert.deepEqual(itemPose(moving, 8, 0.5, false, 0), { from: null, t: 1, scale: 1 }, 'an older move is finished');
  assert.deepEqual(itemPose(moving, 7, 0.5, true, 0), { from: null, t: 1, scale: 1 }, 'reduced motion: no travel');
  assert.deepEqual(itemPose(item({ from: -1, movedAt: 7 }), 7, 0.5, false, 0), { from: null, t: 1, scale: 1 }, 'spawned this tick: nowhere to come from');
  assert.equal(itemPose(item({ hold: 3 }), 0, 0, true, 0).scale, 0.85);
  const s = itemPose(item({ hold: 3 }), 0, 0, false, 94.2).scale;
  assert.ok(s > 0.7 && s < 0.9);
  assert.equal(transformColour('ingot'), 0xf5c542);
  assert.equal(transformColour('slag'), 0xeb6757);
  assert.equal(transformColour('plate'), 0x7f9bb8);
  assert.equal(transformColour('shards'), 0xc9d3dc);
  assert.equal(transformColour(undefined), 0xc9d3dc);
});

test('tick digest: ships coalesce per dock, jams dedupe against existing marks, sounds count what is new, containers are reused', () => {
  const ev = (kind: SimEvent['kind'], cell: number, extra: Partial<SimEvent> = {}): SimEvent => ({ tick: 1, kind, cell, ...extra });
  const ships = new Map<number, number>([[99, 1]]);
  const jammed = new Set<number>([99]);
  const d = digestTick(
    [
      ev('ship', 7, { value: 3 }),
      ev('ship', 7, { value: 12 }),
      ev('ship', 8, { value: 1 }),
      ev('transform', 2, { to: 'ingot' }),
      ev('transform', 3, { to: 'shards' }),
      ev('absorb', 4),
      ev('jam', 5),
      ev('jam', 5),
      ev('jam', 6),
      ev('spawn', 0),
      ev('move', 1),
    ],
    new Set([6]),
    ships,
    jammed,
  );
  assert.deepEqual(
    [...d.ships],
    [
      [7, 15],
      [8, 1],
    ],
  );
  assert.equal(d.ships, ships, 'the passed map is reused and cleared first');
  assert.deepEqual([...d.jammed].sort(), [5, 6]);
  assert.equal(d.jammed, jammed);
  assert.deepEqual(d.newJams, [5], 'cell 6 already had a mark; the second jam at 5 counts once');
  assert.deepEqual(d.sounds, { ships: [3, 12, 1], transforms: [3, 1], jams: 1 });
  assert.deepEqual(d.transforms, [
    { cell: 2, to: 'ingot' },
    { cell: 3, to: 'shards' },
  ]);
  assert.deepEqual(d.absorbs, [4]);
  const e = digestTick([], new Set(), ships, jammed);
  assert.equal(e.ships.size, 0);
  assert.equal(e.jammed.size, 0);
  assert.deepEqual(e.sounds, { ships: [], transforms: [], jams: 0 });
});
