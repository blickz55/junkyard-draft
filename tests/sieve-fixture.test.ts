// Sieve fixture (PLAN-v2 0.5.2, rules-v3 branch): the machine's behaviour in the simulation, and the same-inventory
// mixed-material comparison that decides whether it enters the draft pool. The decision text lives in docs/DESIGN.md;
// this test pins the numbers behind it so they cannot drift silently.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RULES } from '../game/src/sim/rules';
import { runLayout, cellIndex } from '../game/src/sim/sim';
import type { Dir, Layout, Machine, MachineKind, Material } from '../game/src/sim/types';

let nid = 1;
const m = (kind: MachineKind, x: number, y: number, dir: Dir = 0): Machine => ({ id: nid++, kind, x, y, dir });
const lay = (...machines: Machine[]): Layout => ({ width: RULES.gridWidth, height: RULES.gridHeight, machines });
const cell = (x: number, y: number) => cellIndex(x, y, RULES.gridWidth);

test('sieve: raw scrap goes forward, every processed material turns right, in all four orientations', () => {
  // east-facing: hopper → sieve → forward dock at (3,2); right (south) dock at (2,3)
  const east = runLayout(lay(m('hopper', 1, 2, 0), m('sieve', 2, 2, 0), m('dock', 3, 2), m('dock', 2, 3)), 40);
  assert.ok(east.cellStats[cell(3, 2)]?.shipped > 0 && !east.cellStats[cell(2, 3)]?.shipped, 'raw scrap only ever exits forward');
  // processed input: a crusher ahead of the sieve makes shards, which must turn right
  const shards = runLayout(lay(m('hopper', 0, 2, 0), m('crusher', 1, 2, 0), m('sieve', 2, 2, 0), m('dock', 3, 2), m('dock', 2, 3)), 60);
  assert.ok(shards.cellStats[cell(2, 3)]?.shipped > 0 && !shards.cellStats[cell(3, 2)]?.shipped, 'shards exit to the right, never forward');
  assert.equal(shards.shipped.shards, shards.cellStats[cell(2, 3)]?.shipped);
  // every processed material: feed each through a furnace/press chain is long; instead check the routing rule directly per material
  for (const mat of ['shards', 'plate', 'ingot', 'slag'] as Material[]) {
    const proc = mat === 'shards' ? 'crusher' : mat === 'ingot' ? 'furnace' : mat === 'plate' ? 'press' : 'furnace';
    const feed =
      mat === 'ingot'
        ? [m('hopper', 0, 2, 0), m('crusher', 1, 2, 0), m('furnace', 2, 2, 0)]
        : mat === 'slag'
          ? [m('hopper', 1, 2, 0), m('furnace', 2, 2, 0)]
          : mat === 'plate'
            ? [m('hopper', 0, 2, 0), m('crusher', 1, 2, 0), m('press', 2, 2, 0)]
            : [m('hopper', 1, 2, 0), m('crusher', 2, 2, 0)];
    void proc;
    const r = runLayout(lay(...feed, m('sieve', 3, 2, 0), m('dock', 4, 2), m('dock', 3, 3)), 80);
    assert.ok(r.shipped[mat] > 0, `${mat} was produced`);
    assert.ok((r.cellStats[cell(3, 3)]?.shipped ?? 0) >= r.shipped[mat], `${mat} exits to the right dock`);
    if (mat !== 'slag') assert.equal(r.cellStats[cell(4, 2)]?.shipped ?? 0, r.shipped.scrap, 'only raw scrap reaches the forward dock');
  }
  // orientations: south-facing sieve's right is west; west-facing's right is north; north-facing's right is east
  const south = runLayout(lay(m('hopper', 2, 0, 1), m('crusher', 2, 1, 1), m('sieve', 2, 2, 1), m('dock', 2, 3), m('dock', 1, 2)), 60);
  assert.ok(south.cellStats[cell(1, 2)]?.shipped > 0 && !south.cellStats[cell(2, 3)]?.shipped, 'south-facing: shards turn right = west');
  const west = runLayout(lay(m('hopper', 5, 2, 2), m('crusher', 4, 2, 2), m('sieve', 3, 2, 2), m('dock', 2, 2), m('dock', 3, 1)), 60);
  assert.ok(west.cellStats[cell(3, 1)]?.shipped > 0 && !west.cellStats[cell(2, 2)]?.shipped, 'west-facing: shards turn right = north');
  const north = runLayout(lay(m('hopper', 2, 5, 3), m('crusher', 2, 4, 3), m('sieve', 2, 3, 3), m('dock', 2, 2), m('dock', 3, 3)), 60);
  assert.ok(north.cellStats[cell(3, 3)]?.shipped > 0 && !north.cellStats[cell(2, 2)]?.shipped, 'north-facing: shards turn right = east');
});

test('sieve: only from behind; a blocked chosen exit waits and is reported as a jam; nothing is lost or duplicated', () => {
  const sideways = runLayout(lay(m('hopper', 2, 1, 1), m('sieve', 2, 2, 0), m('dock', 3, 2), m('dock', 2, 3)), 20);
  assert.equal(sideways.spawned, 0, 'a sieve does not accept from its side');
  // shards must turn right but the right cell is empty grid: they wait in the sieve (jam ticks), scrap keeps flowing forward
  const blocked = runLayout(lay(m('hopper', 0, 2, 0), m('crusher', 1, 2, 0), m('sieve', 2, 2, 0), m('dock', 3, 2)), 40);
  assert.equal(blocked.shipped.shards, 0, 'no overflow: shards never take the forward exit');
  assert.ok((blocked.cellStats[cell(2, 2)]?.jammedTicks ?? 0) > 0, 'the waiting shard is reported as a jam');
  const r = runLayout(lay(m('hopper', 0, 2, 0), m('crusher', 1, 2, 0), m('sieve', 2, 2, 0), m('dock', 3, 2), m('dock', 2, 3)), 80);
  const shippedAll = Object.values(r.shipped).reduce((a, b) => a + b, 0);
  assert.ok(r.spawned >= shippedAll, 'conservation: nothing ships that was not spawned');
  assert.equal(r.absorbed, 0);
});

/**
 * The decision fixture: eleven machines (five starters + six picks), two inventories differing in one part (Sieve vs one
 * more Conveyor). Hand-authored best-effort lines for each. The Sieve line merges a raw belt with a crusher's shards and sorts
 * them before a furnace; the separated line keeps the two routes apart. On an 8×6 grid with eleven machines the separation
 * always fits, and the merge costs throughput at the shared conveyor, so the Sieve earns less. docs/DESIGN.md records the
 * go/no-go; these numbers are what it rests on (tools/sieve-fixture.ts prints them with searched layouts as well).
 */
test('sieve fixture (PLAN-v2 0.5.2): on the same inventory the separated routes beat the Sieve line, with and without an export dock — no convincing benefit, Sieve deferred', () => {
  const hand = lay(
    m('hopper', 0, 2, 0),
    m('conveyor', 1, 2, 0),
    m('sieve', 2, 2, 0),
    m('conveyor', 3, 2, 0),
    m('dock', 4, 2),
    m('hopper', 1, 0, 1),
    m('crusher', 1, 1, 1),
    m('furnace', 2, 3, 1),
    m('dock', 2, 4),
    m('conveyor', 6, 5, 0),
    m('conveyor', 7, 5, 0),
  );
  const separated = lay(
    m('hopper', 0, 2, 0),
    m('conveyor', 1, 2, 0),
    m('conveyor', 2, 2, 0),
    m('conveyor', 3, 2, 0),
    m('dock', 4, 2),
    m('hopper', 0, 4, 0),
    m('crusher', 1, 4, 0),
    m('furnace', 2, 4, 0),
    m('dock', 3, 4),
    m('conveyor', 6, 5, 0),
    m('conveyor', 7, 5, 0),
  );
  assert.equal(hand.machines.length, separated.machines.length, 'same inventory size');
  const a = runLayout(hand),
    b = runLayout(separated);
  assert.equal(a.earned, 289);
  assert.equal(b.earned, 338);
  assert.ok(b.earned > a.earned * 1.1, `separated $${b.earned} beats the Sieve line $${a.earned} by more than the 10 % the Sieve would have needed to win`);
  assert.ok(a.shipped.ingot > 0 && a.shipped.slag === 0, 'the Sieve line does protect the furnace (ingots, no slag) — it just pays for it in throughput');
  // export-dock hypothesis (the second dock pays double for ingots, nothing for other materials): separation still wins
  const exportPrice = (l: Layout) => {
    const docks = l.machines.filter((x) => x.kind === 'dock');
    const ex = cellIndex(docks[1].x, docks[1].y, l.width);
    let e = 0;
    for (const ev of runLayout(l).events) if (ev.kind === 'ship' && ev.value != null) e += ev.cell === ex ? (ev.from === 'ingot' ? ev.value * 2 : 0) : ev.value;
    return e;
  };
  assert.equal(exportPrice(hand), 577);
  assert.equal(exportPrice(separated), 638);
});
