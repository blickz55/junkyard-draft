/**
 * Tips with live mini-simulations (PLAN-v1 0.3.6). Each tip is a tiny real layout run by the real simulation,
 * so what the panel shows can never drift from the rules (Factorio replaced static tip screenshots with
 * in-engine simulations for the same reason). `check` is what the loop must demonstrate; tests/tips.test.ts
 * runs every layout and asserts it. Directions: 0 east, 1 south, 2 west, 3 north. The title, text and "what to watch"
 * live in game/src/content/tips.ts (0.9.0): this file is data for the simulation only.
 */
import { runLayout } from './sim';
import type { Dir, Layout, Machine, MachineKind, RunResult } from './types';

export interface TipDemo {
  id: string;
  /** drafting this machine for the first time suggests the tip (null: never suggested, only listed) */
  machine: MachineKind | null;
  /** the demo layout (small grid); null for text-only tips */
  layout: Layout | null;
  /** ticks per loop of the demo */
  ticks: number;
  /** what the demo must show; tested */
  check: (res: RunResult) => boolean;
}

let id = 1;
const m = (kind: MachineKind, x: number, y: number, dir: Dir = 0): Machine => ({ id: id++, kind, x, y, dir });
const lay = (width: number, height: number, ...machines: Machine[]): Layout => ({ width, height, machines });
const cell = (x: number, y: number, w: number) => y * w + x;

export const TIP_DEMOS: readonly TipDemo[] = [
  {
    id: 'crusher',
    machine: 'crusher',
    layout: lay(4, 3, m('hopper', 0, 1), m('crusher', 1, 1), m('conveyor', 2, 1), m('dock', 3, 1)),
    ticks: 24,
    check: (r) => r.shipped.shards >= 1 && r.shipped.scrap === 0,
  },
  {
    id: 'sideload',
    machine: 'conveyor',
    layout: lay(4, 3, m('hopper', 0, 1), m('conveyor', 1, 1), m('conveyor', 2, 1), m('dock', 3, 1), m('hopper', 2, 0, 1)),
    ticks: 24,
    check: (r) => r.shipped.scrap >= 12 && (r.cellStats[cell(2, 0, 4)]?.spawned ?? 0) > 0 && (r.cellStats[cell(0, 1, 4)]?.spawned ?? 0) > 0,
  },
  {
    id: 'splitter',
    machine: 'splitter',
    layout: lay(4, 3, m('hopper', 0, 1), m('splitter', 1, 1), m('dock', 1, 0), m('dock', 1, 2)),
    ticks: 24,
    check: (r) => (r.cellStats[cell(1, 0, 4)]?.shipped ?? 0) >= 1 && (r.cellStats[cell(1, 2, 4)]?.shipped ?? 0) >= 1,
  },
  {
    id: 'furnace',
    machine: 'furnace',
    layout: lay(4, 3, m('hopper', 0, 1), m('furnace', 1, 1), m('conveyor', 2, 1), m('dock', 3, 1)),
    ticks: 30,
    check: (r) => r.shipped.slag >= 1 && r.shipped.ingot === 0,
  },
  {
    id: 'press',
    machine: 'press',
    layout: lay(5, 3, m('hopper', 0, 1), m('crusher', 1, 1), m('press', 2, 1), m('conveyor', 3, 1), m('dock', 4, 1)),
    ticks: 30,
    check: (r) => r.shipped.plate >= 1 && r.absorbed >= 1,
  },
  {
    id: 'tuner',
    machine: 'tuner',
    layout: lay(5, 3, m('hopper', 0, 1), m('crusher', 1, 1), m('furnace', 2, 1), m('dock', 3, 1), m('tuner', 2, 0)),
    ticks: 30,
    check: (r) => r.shipped.ingot >= 11 && (r.cellStats[cell(2, 0, 5)]?.tuned ?? 0) >= 11,
  },
  { id: 'sell', machine: null, layout: null, ticks: 0, check: () => true },
  { id: 'controls', machine: null, layout: null, ticks: 0, check: () => true }, // 0.10.1: the action table, rendered by the panel from content/controls.ts
];

/** Run a tip's demo for one loop (what the panel animates) and return the result. */
export function runTip(tip: Pick<TipDemo, 'layout' | 'ticks'>): RunResult | null {
  return tip.layout ? runLayout(tip.layout, tip.ticks) : null;
}
