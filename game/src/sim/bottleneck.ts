/**
 * The bottleneck of one round (production roadmap 0.8.8): which machine held the line, from the round's CellStats and
 * jam events, as data. Pure and deterministic; the sentence a player reads is built in game/src/content/bottleneck.ts.
 *
 * Attribution: an item that could not move (a `jam` event at its cell) was held by whatever is downstream of that cell,
 * so every cell is traced along its output to the first processor it reaches (the machine that was holding), or to a
 * dead end (nothing ahead accepts), or, when the path reaches a dock with no processor on it, to the first conveyor on
 * the path that two or more lines feed (a merge). A hopper's blocked tick is attributed through the cell ahead of it
 * the same way. The machine with the most distinct jammed ticks is the bottleneck when that count is at least
 * HELD_FRACTION of the round. Below that the round is supply-bound: the least busy processor is "starved", or, when
 * every processor kept up, the round is "balanced". A furnace fed raw scrap (slag shipped) and a line that shipped
 * nothing have their own kinds. Fixes name draft-pool machine kinds that exist for the next round (never a kind that
 * cannot be offered), in the order the sentence uses them.
 */
import { DIR_DX, DIR_DY, RULES, isProcessor } from './rules';
import { inputTravelDirs, outputDirs } from './advice';
import { cellIndex } from './sim';
import type { Layout, Machine, MachineKind, RunResult, Dir } from './types';

export type BottleneckKind = 'disconnected' | 'dead-end' | 'slag' | 'saturated' | 'starved' | 'balanced';
export interface Bottleneck {
  kind: BottleneckKind;
  /** the machine that held the line; null for disconnected and balanced */
  machine: Machine | null;
  /** distinct ticks during which something waited because of the machine (saturated, dead-end) */
  heldTicks: number;
  /** ticks the round ran */
  ticks: number;
  /** slag shipped (slag), items the named processor saw (starved), hopper tries (dead-end hopper), hoppers (balanced) */
  count: number;
  /** the named processor's busy share of the round, 0..1 (starved) */
  utilisation: number;
  /** lines feeding the named conveyor (a merge bottleneck); 0 otherwise */
  feeders: number;
  /** draft-pool kinds that would help next round, in sentence order; empty when the fix is a rotation or a rearrangement */
  fixes: MachineKind[];
}

/** A jammed-tick share of the round from which a machine counts as holding the line (10 of 80). */
export const HELD_FRACTION = 1 / 8;
/** A processor busy for at most this share of the round, in a round nothing held, is starved. */
export const STARVED_UTILISATION = 0.5;
/** Slag shipped from which the round is a slag line (one melted lump is an accident, three are a layout). */
export const SLAG_MIN = 3;

/** Whether a kind can be offered in a given round (the draft pool and its tiers; experimental kinds never). */
export const inPool = (kind: MachineKind, round: number): boolean => (RULES.draftWeights[kind] ?? 0) > 0 && (RULES.offerFromRound[kind] ?? 1) <= round;

type Blocker = { kind: 'saturated' | 'dead-end'; cell: number } | null;

export function analyseRound(layout: Layout, result: RunResult, nextRound: number): Bottleneck {
  const W = layout.width, H = layout.height, ticks = result.ticks;
  const grid: (Machine | undefined)[] = new Array(W * H).fill(undefined);
  for (const m of layout.machines) grid[cellIndex(m.x, m.y, W)] = m;
  const cellOf = (m: Machine) => cellIndex(m.x, m.y, W);
  /** the machines whose output enters `cell` */
  const feederCount = new Map<number, number>();
  const targetsOf = (m: Machine): { cell: number; accepted: boolean }[] => outputDirs(m.kind, m.dir).map((o: Dir) => {
    const nx = m.x + DIR_DX[o], ny = m.y + DIR_DY[o];
    if (nx < 0 || ny < 0 || nx >= W || ny >= H) return { cell: -1, accepted: false };
    const t = grid[cellIndex(nx, ny, W)];
    return { cell: cellIndex(nx, ny, W), accepted: !!t && inputTravelDirs(t.kind, t.dir).includes(o) };
  });
  for (const m of layout.machines) for (const t of targetsOf(m)) if (t.accepted) feederCount.set(t.cell, (feederCount.get(t.cell) ?? 0) + 1);

  /** Trace a jam at `cell` to the machine that held it. */
  const blockerOf = (cell: number): Blocker => {
    const m = grid[cell]; if (!m) return null;
    const first = targetsOf(m).find((t) => t.accepted);
    if (!first) return m.kind === 'dock' ? null : { kind: 'dead-end', cell }; // nothing ahead takes what this machine pushes out
    let cur = first.cell; const path: number[] = [];
    for (let i = 0; i < W * H; i++) {
      const c = grid[cur]!; path.push(cur);
      if (isProcessor(c.kind)) return { kind: 'saturated', cell: cur };
      if (c.kind === 'dock') break;
      const next = targetsOf(c).find((t) => t.accepted);
      if (!next) return { kind: 'dead-end', cell: cur };
      cur = next.cell;
    }
    const merge = path.find((p) => grid[p]?.kind === 'conveyor' && (feederCount.get(p) ?? 0) >= 2);
    return merge != null ? { kind: 'saturated', cell: merge } : null;
  };
  const blockerCache = new Map<number, Blocker>();
  const blocker = (cell: number) => { if (!blockerCache.has(cell)) blockerCache.set(cell, blockerOf(cell)); return blockerCache.get(cell)!; };
  const held = new Map<string, Set<number>>();
  for (const e of result.events) {
    if (e.kind !== 'jam') continue;
    const b = blocker(e.cell); if (!b) continue;
    const key = `${b.kind}:${b.cell}`;
    if (!held.has(key)) held.set(key, new Set()); held.get(key)!.add(e.tick);
  }
  const ranked = [...held.entries()].map(([key, set]) => { const [kind, cell] = key.split(':'); return { kind: kind as 'saturated' | 'dead-end', cell: Number(cell), ticks: set.size }; }).sort((a, b) => b.ticks - a.ticks || a.cell - b.cell);
  const minHeld = Math.ceil(ticks * HELD_FRACTION);
  const shippedAny = Object.values(result.shipped).some((n) => n > 0);
  const base = { ticks, count: 0, utilisation: 1, feeders: 0 };

  // 1. a dead end that held items (or a hopper with nothing ahead): a rotation, not a draft, fixes it
  const dead = ranked.find((r) => r.kind === 'dead-end' && r.ticks >= minHeld);
  if (dead) { const m = grid[dead.cell]!; return { ...base, kind: 'dead-end', machine: m, heldTicks: dead.ticks, count: m.kind === 'hopper' ? Math.floor(ticks / RULES.hopperPeriod) : 0, fixes: [] }; }
  // 2. nothing shipped and nothing explains it as a dead end: the line is disconnected
  if (!shippedAny) return { ...base, kind: 'disconnected', machine: null, heldTicks: 0, fixes: [] };
  // 3. a slag line: raw scrap reached a furnace
  if (result.shipped.slag >= SLAG_MIN) {
    const rawFed = layout.machines.find((m) => m.kind === 'furnace' && fedRaw(m));
    if (rawFed) return { ...base, kind: 'slag', machine: rawFed, heldTicks: 0, count: result.shipped.slag, fixes: ['crusher'].filter((k) => inPool(k as MachineKind, nextRound)) as MachineKind[] };
  }
  // 4. a machine held the line
  const top = ranked.find((r) => r.kind === 'saturated' && r.ticks >= minHeld);
  if (top) {
    const m = grid[top.cell]!;
    if (m.kind === 'conveyor') return { ...base, kind: 'saturated', machine: m, heldTicks: top.ticks, feeders: feederCount.get(top.cell) ?? 0, fixes: (['dock', 'press'] as MachineKind[]).filter((k) => inPool(k, nextRound)) };
    const fixes: MachineKind[] = []; if (inPool('tuner', nextRound)) fixes.push('tuner'); if (inPool('splitter', nextRound) && inPool(m.kind, nextRound)) fixes.push('splitter');
    return { ...base, kind: 'saturated', machine: m, heldTicks: top.ticks, fixes };
  }
  // 5. supply-bound: the least busy processor that saw items
  let starved: { m: Machine; u: number; passed: number } | null = null;
  for (const m of layout.machines) {
    if (!isProcessor(m.kind)) continue;
    const st = result.cellStats[cellOf(m)]; if (!st || !st.passed) continue;
    const hold = Math.max(1, RULES.process[m.kind] - (st.tuned > 0 ? RULES.tunerBonus : 0));
    const u = Math.min(1, (st.processed * hold) / ticks);
    if (!starved || u < starved.u) starved = { m, u, passed: st.passed };
  }
  if (starved && starved.u <= STARVED_UTILISATION) return { ...base, kind: 'starved', machine: starved.m, heldTicks: 0, count: starved.passed, utilisation: starved.u, fixes: (['hopper'] as MachineKind[]).filter((k) => inPool(k, nextRound)) };
  // 6. balanced
  return { ...base, kind: 'balanced', machine: null, heldTicks: 0, count: layout.machines.filter((m) => m.kind === 'hopper').length, fixes: (['hopper'] as MachineKind[]).filter((k) => inPool(k, nextRound)) };

  /** Does raw scrap reach this furnace: tracing its feeders back, is a hopper reached before any crusher? */
  function fedRaw(f: Machine): boolean {
    const seen = new Set<number>(); const stack = [cellOf(f)];
    while (stack.length) {
      const c = stack.pop()!; if (seen.has(c)) continue; seen.add(c);
      for (const m of layout.machines) {
        if (m.kind === 'crusher') continue; // shards from here on: this branch is safe
        if (!targetsOf(m).some((t) => t.accepted && t.cell === c)) continue;
        if (m.kind === 'hopper') return true;
        stack.push(cellOf(m));
      }
    }
    return false;
  }
}
