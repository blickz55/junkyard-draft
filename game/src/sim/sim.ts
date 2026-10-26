import { DIR_DX, DIR_DY, isProcessor, leftOf, opposite, rightOf, RULES, transform, type ProcessorKind } from './rules';
import type { CellStats, Dir, Item, Layout, Machine, Material, RunResult, SimEvent } from './types';

export interface SimState {
  tick: number;
  width: number;
  height: number;
  grid: (Machine | undefined)[];
  items: Item[];
  itemAt: (Item | undefined)[];
  splitterToggle: Record<number, 0 | 1>;
  /** shards currently stored in each press (by cell) */
  pressStore: Record<number, number>;
  /** items consumed by presses */
  absorbed: number;
  nextItemId: number;
  earned: number;
  shipped: Record<Material, number>;
  spawned: number;
  cellStats: Record<number, CellStats>;
  events: SimEvent[];
  /** events of the current tick only (renderer consumes these) */
  tickEvents: SimEvent[];
}

export const cellIndex = (x: number, y: number, w: number) => y * w + x;

export function validateLayout(layout: Layout): string[] {
  const errs: string[] = [];
  const seen = new Set<number>();
  for (const m of layout.machines) {
    if (m.x < 0 || m.y < 0 || m.x >= layout.width || m.y >= layout.height) errs.push(`machine ${m.id} out of bounds`);
    const c = cellIndex(m.x, m.y, layout.width);
    if (seen.has(c)) errs.push(`cell ${m.x},${m.y} occupied twice`);
    seen.add(c);
  }
  return errs;
}

export function createSim(layout: Layout): SimState {
  const n = layout.width * layout.height;
  const grid: (Machine | undefined)[] = new Array(n).fill(undefined);
  for (const m of layout.machines) grid[cellIndex(m.x, m.y, layout.width)] = m;
  return { tick: 0, width: layout.width, height: layout.height, grid, items: [], itemAt: new Array(n).fill(undefined), splitterToggle: {}, pressStore: {}, absorbed: 0, nextItemId: 1, earned: 0, shipped: { scrap: 0, shards: 0, plate: 0, ingot: 0, slag: 0 }, spawned: 0, cellStats: {}, events: [], tickEvents: [] };
}

function stats(s: SimState, cell: number): CellStats {
  return (s.cellStats[cell] ||= { processed: 0, shipped: 0, earned: 0, jammedTicks: 0, spawned: 0, blockedTicks: 0, passed: 0, stored: 0 });
}

function neighbor(s: SimState, cell: number, dir: Dir): number {
  const x = (cell % s.width) + DIR_DX[dir];
  const y = Math.floor(cell / s.width) + DIR_DY[dir];
  if (x < 0 || y < 0 || x >= s.width || y >= s.height) return -1;
  return cellIndex(x, y, s.width);
}

/** Can an item travelling in direction `travel` enter the machine at `cell`? */
function accepts(s: SimState, cell: number, travel: Dir): boolean {
  const m = s.grid[cell];
  if (!m) return false;
  switch (m.kind) {
    case 'hopper': return false;
    case 'dock': return true;
    case 'conveyor': return travel !== opposite(m.dir); // not head-on into its output
    case 'splitter': case 'crusher': case 'furnace': case 'press': return travel === m.dir; // only from behind
  }
}

function outputDirs(s: SimState, m: Machine, cell: number): Dir[] {
  if (m.kind === 'splitter') {
    const t = s.splitterToggle[cell] ?? 0;
    const first = t === 0 ? leftOf(m.dir) : rightOf(m.dir);
    const second = t === 0 ? rightOf(m.dir) : leftOf(m.dir);
    return [first, second];
  }
  return [m.dir];
}

/** An item has just entered processing machine `m` at `cell`: transform it and start its hold timer.
 *  A press stores shards until it has RULES.pressShards; each stored shard is absorbed (the item ends).
 *  Returns false when the item was absorbed. */
function enterProcessor(s: SimState, kind: ProcessorKind, cell: number, item: Item): boolean {
  if (kind === 'press' && item.mat === 'shards') {
    const have = (s.pressStore[cell] ?? 0) + 1;
    if (have < RULES.pressShards) {
      s.pressStore[cell] = have;
      s.itemAt[cell] = undefined;
      s.items.splice(s.items.indexOf(item), 1);
      s.absorbed++;
      s.tickEvents.push({ tick: s.tick, kind: 'absorb', cell, itemId: item.id, from: item.mat });
      return false;
    }
    s.pressStore[cell] = 0;
  }
  const to = transform(kind, item.mat);
  item.hold = RULES.process[kind];
  if (to !== item.mat) { s.tickEvents.push({ tick: s.tick, kind: 'transform', cell, itemId: item.id, from: item.mat, to }); stats(s, cell).processed++; }
  item.mat = to;
  return true;
}

/** Try to move an item out of its cell; returns true if it moved (or was shipped). */
function tryAdvance(s: SimState, item: Item): boolean {
  const cell = item.cell;
  const m = s.grid[cell];
  if (!m || m.kind === 'dock') return false;
  for (const dir of outputDirs(s, m, cell)) {
    const target = neighbor(s, cell, dir);
    if (target < 0 || !accepts(s, target, dir)) continue;
    const tm = s.grid[target]!;
    if (tm.kind === 'dock') {
      s.itemAt[cell] = undefined;
      s.items.splice(s.items.indexOf(item), 1);
      const value = RULES.value[item.mat];
      s.earned += value; s.shipped[item.mat]++;
      const st = stats(s, target); st.shipped++; st.earned += value;
      s.tickEvents.push({ tick: s.tick, kind: 'ship', cell: target, itemId: item.id, from: item.mat, value });
      if (m.kind === 'splitter') s.splitterToggle[cell] = (s.splitterToggle[cell] ?? 0) === 0 ? 1 : 0;
      return true;
    }
    if (s.itemAt[target]) continue;
    s.itemAt[cell] = undefined;
    s.itemAt[target] = item;
    item.from = cell; item.cell = target; item.movedAt = s.tick;
    stats(s, target).passed++;
    s.tickEvents.push({ tick: s.tick, kind: 'move', cell: target, itemId: item.id });
    if (isProcessor(tm.kind)) enterProcessor(s, tm.kind, target, item);
    if (m.kind === 'splitter') s.splitterToggle[cell] = (s.splitterToggle[cell] ?? 0) === 0 ? 1 : 0;
    return true;
  }
  return false;
}

export function step(s: SimState): SimEvent[] {
  s.tick++;
  s.tickEvents = [];
  // 1. processing timers
  for (const it of s.items) if (it.hold > 0) it.hold--;
  // 2. movement passes (chains move as a unit, head first). Each pass moves at least one item
  //    or stops, so the bound is the item count; cell order is fixed for determinism.
  const moved = new Set<number>();
  const maxPasses = s.items.length + 1;
  for (let pass = 0; pass < maxPasses; pass++) {
    let any = false;
    for (let c = 0; c < s.itemAt.length; c++) {
      const it = s.itemAt[c];
      if (!it || moved.has(it.id) || it.hold > 0) continue;
      if (tryAdvance(s, it)) { moved.add(it.id); any = true; }
    }
    if (!any) break;
  }
  // 3. jam accounting: items that are free but could not move
  for (const it of s.items) if (it.hold === 0 && !moved.has(it.id) && s.grid[it.cell]?.kind !== 'dock') {
    stats(s, it.cell).jammedTicks++;
    s.tickEvents.push({ tick: s.tick, kind: 'jam', cell: it.cell, itemId: it.id });
  }
  // 4. hoppers spawn into the cell ahead
  if (s.tick % RULES.hopperPeriod === 0) {
    for (let c = 0; c < s.grid.length; c++) {
      const m = s.grid[c];
      if (!m || m.kind !== 'hopper') continue;
      const target = neighbor(s, c, m.dir);
      if (target >= 0 && accepts(s, target, m.dir) && !s.itemAt[target] && s.grid[target]!.kind !== 'dock') {
        const tm = s.grid[target]!;
        const item: Item = { id: s.nextItemId++, mat: 'scrap', cell: target, hold: 0, movedAt: s.tick, from: c };
        s.items.push(item); s.itemAt[target] = item; s.spawned++; stats(s, c).spawned++; stats(s, target).passed++;
        s.tickEvents.push({ tick: s.tick, kind: 'spawn', cell: target, itemId: item.id });
        if (isProcessor(tm.kind)) enterProcessor(s, tm.kind, target, item);
      } else if (target >= 0 && s.grid[target]?.kind === 'dock' && accepts(s, target, m.dir)) {
        // hopper feeding straight into a dock: sells raw scrap immediately
        const value = RULES.value.scrap; s.earned += value; s.shipped.scrap++; s.spawned++;
        const st = stats(s, target); st.shipped++; st.earned += value; stats(s, c).spawned++;
        s.tickEvents.push({ tick: s.tick, kind: 'ship', cell: target, itemId: s.nextItemId++, from: 'scrap', value });
      } else {
        stats(s, c).blockedTicks++;
        s.tickEvents.push({ tick: s.tick, kind: 'jam', cell: c });
      }
    }
  }
  s.events.push(...s.tickEvents);
  return s.tickEvents;
}

export function runLayout(layout: Layout, ticks: number = RULES.ticksPerRound): RunResult {
  const errs = validateLayout(layout);
  if (errs.length) throw new Error('invalid layout: ' + errs.join('; '));
  const s = createSim(layout);
  for (let i = 0; i < ticks; i++) step(s);
  // shards left inside presses are lost when time runs out; record them so the round badge can say so
  for (const [cell, n] of Object.entries(s.pressStore)) if (n > 0) stats(s, Number(cell)).stored = n;
  return { earned: s.earned, shipped: s.shipped, spawned: s.spawned, absorbed: s.absorbed, ticks, cellStats: s.cellStats, events: s.events };
}
