/**
 * Tips with live mini-simulations (PLAN-v1 0.3.6). Each tip is a tiny real layout run by the real simulation,
 * so what the panel shows can never drift from the rules (Factorio replaced static tip screenshots with
 * in-engine simulations for the same reason). `check` is what the loop must demonstrate; tests/tips.test.ts
 * runs every layout and asserts it. Directions: 0 east, 1 south, 2 west, 3 north.
 */
import { runLayout } from './sim';
import { RULES } from './rules';
import type { Dir, Layout, Machine, MachineKind, RunResult } from './types';

export interface Tip {
  id: string;
  title: string;
  text: string;
  /** drafting this machine for the first time suggests the tip (null: never suggested, only listed) */
  machine: MachineKind | null;
  /** the demo layout (small grid); null for text-only tips */
  layout: Layout | null;
  /** ticks per loop of the demo */
  ticks: number;
  /** what the demo must show; tested */
  check: (res: RunResult) => boolean;
  /** one line describing what to watch for */
  watch: string;
}

let id = 1;
const m = (kind: MachineKind, x: number, y: number, dir: Dir = 0): Machine => ({ id: id++, kind, x, y, dir });
const lay = (width: number, height: number, ...machines: Machine[]): Layout => ({ width, height, machines });
const cell = (x: number, y: number, w: number) => y * w + x;

export const TIPS: readonly Tip[] = [
  {
    id: 'crusher', machine: 'crusher', title: 'Crushers take items from behind',
    text: `A crusher only accepts an item that enters through its back, and pushes shards out of its arrow. Line it up with the belt: hopper → crusher → dock. Scrap $${RULES.value.scrap} becomes shards $${RULES.value.shards}; a crusher that faces across the line starves instead.`,
    layout: lay(4, 3, m('hopper', 0, 1), m('crusher', 1, 1), m('conveyor', 2, 1), m('dock', 3, 1)),
    ticks: 24, check: (r) => r.shipped.shards >= 1 && r.shipped.scrap === 0, watch: 'Every lump that reaches the dock is a shard.',
  },
  {
    id: 'sideload', machine: 'conveyor', title: 'Conveyors merge from the side',
    text: 'A conveyor accepts items from behind and from either side, so two lines can share one belt: aim a second hopper at the belt from above or below and both streams reach the dock. Only conveyors and docks take side inputs; crushers, furnaces, presses and splitters do not.',
    layout: lay(4, 3, m('hopper', 0, 1), m('conveyor', 1, 1), m('conveyor', 2, 1), m('dock', 3, 1), m('hopper', 2, 0, 1)),
    ticks: 24, check: (r) => r.shipped.scrap >= 12 && (r.cellStats[cell(2, 0, 4)]?.spawned ?? 0) > 0 && (r.cellStats[cell(0, 1, 4)]?.spawned ?? 0) > 0, watch: 'Scrap from both hoppers rides the same belt.',
  },
  {
    id: 'splitter', machine: 'splitter', title: 'Splitters alternate left and right',
    text: 'A splitter takes from behind and sends items out of its two sides in turn, so one hopper can feed two machines. Two furnaces behind a splitter beat one furnace on a straight line, because a furnace is the slowest machine.',
    layout: lay(4, 3, m('hopper', 0, 1), m('splitter', 1, 1), m('dock', 1, 0), m('dock', 1, 2)),
    ticks: 24, check: (r) => (r.cellStats[cell(1, 0, 4)]?.shipped ?? 0) >= 1 && (r.cellStats[cell(1, 2, 4)]?.shipped ?? 0) >= 1, watch: 'Items go up, then down, then up…',
  },
  {
    id: 'furnace', machine: 'furnace', title: 'Raw scrap in a furnace makes slag',
    text: `A furnace turns shards into ingots ($${RULES.value.ingot}), but raw scrap only melts into slag ($${RULES.value.slag}). Put a crusher before the furnace. A furnace takes ${RULES.process.furnace} ticks per item, so it is the bottleneck of any line.`,
    layout: lay(4, 3, m('hopper', 0, 1), m('furnace', 1, 1), m('conveyor', 2, 1), m('dock', 3, 1)),
    ticks: 30, check: (r) => r.shipped.slag >= 1 && r.shipped.ingot === 0, watch: 'Dark slag, not gold ingots, reaches the dock.',
  },
  {
    id: 'press', machine: 'press', title: 'A press needs two shards for one plate',
    text: `A plate press swallows the first shard, holds it, and presses the second into a plate ($${RULES.value.plate}). It halves the traffic behind it, so it never backs a line up the way a furnace can; a shard left inside at the end of the round shows on its badge.`,
    layout: lay(5, 3, m('hopper', 0, 1), m('crusher', 1, 1), m('press', 2, 1), m('conveyor', 3, 1), m('dock', 4, 1)),
    ticks: 30, check: (r) => r.shipped.plate >= 1 && r.absorbed >= 1, watch: 'Two shards go in, one plate comes out.',
  },
  {
    id: 'sell', machine: null, title: 'Sell the parts you cannot use',
    text: `A part left in the bin does nothing during the round. Select it and press Sell to add $${RULES.sellValue} to your score instead: a draft that does not fit your line is still worth taking for the money. Parts on the grid cannot be sold; send them back to the bin first.`,
    layout: null, ticks: 0, check: () => true, watch: '',
  },
];

export const tipById = (tipId: string): Tip | undefined => TIPS.find((t) => t.id === tipId);
/** The tip to suggest when a machine is drafted for the first time (null when none or already read). */
export function tipForMachine(kind: MachineKind, read: readonly string[]): Tip | null {
  const t = TIPS.find((tip) => tip.machine === kind);
  return t && !read.includes(t.id) ? t : null;
}
/** Run a tip's demo for one loop (what the panel animates) and return the result. */
export function runTip(tip: Tip): RunResult | null { return tip.layout ? runLayout(tip.layout, tip.ticks) : null; }
