/**
 * The obvious move works (docs/UX-STANDARD.md): dropping a part on the belt puts it in the belt, facing the way the line
 * runs. Pure and browser-free. `dropActions` turns a drop into rule-checked actions (a swap is several, undone as one);
 * `smartFacing` chooses the way a part from the shelf should face; `beltShape` says how a conveyor draws: a conveyor fed only
 * from its side is a corner. None of this has any scoring authority: the rules still check every action.
 */
import type { Action, RunState } from '../sim/run';
import { inputTravelDirs, outputDirs } from '../sim/advice';
import { DIR_DX, DIR_DY, leftOf, opposite, rightOf, RULES } from '../sim/rules';
import type { Dir, Layout, Machine, MachineKind } from '../sim/types';

const at = (l: Layout, x: number, y: number, ignore?: number) => l.machines.find((m) => m.x === x && m.y === y && m.id !== ignore);
const ALL: readonly Dir[] = [0, 1, 2, 3];

/** The travel directions of the machines pushing items into (x, y). */
export function feedsInto(l: Layout, x: number, y: number, ignore?: number): Dir[] {
  return ALL.filter((t) => {
    const src = at(l, x - DIR_DX[t], y - DIR_DY[t], ignore);
    return !!src && outputDirs(src.kind, src.dir).includes(t);
  });
}
/** Does the machine one step along `d` from (x, y) take what we would push into it? */
function takes(l: Layout, x: number, y: number, d: Dir, ignore?: number): boolean {
  const n = at(l, x + DIR_DX[d], y + DIR_DY[d], ignore);
  return !!n && inputTravelDirs(n.kind, n.dir).includes(d);
}

const inGrid = (l: Layout, x: number, y: number) => x >= 0 && y >= 0 && x < l.width && y < l.height && !l.rubble?.includes(y * l.width + x);

/** What a load pushed from (x, y) along `d` reaches first past belts and Tuners: a machine's kind, 'open' for a free cell beside, or null. */
function reach(l: Layout, x: number, y: number, d: Dir, ignore?: number): MachineKind | 'open' | null {
  let cx = x,
    cy = y,
    dir = d;
  for (let i = 0; i < l.width * l.height; i++) {
    const nx = cx + DIR_DX[dir],
      ny = cy + DIR_DY[dir];
    if (!inGrid(l, nx, ny)) return null;
    const n = at(l, nx, ny, ignore);
    if (!n) return i === 0 ? 'open' : null;
    if (!inputTravelDirs(n.kind, n.dir).includes(dir)) return null;
    if (n.kind !== 'conveyor' && n.kind !== 'tuner') return n.kind;
    cx = nx;
    cy = ny;
    dir = n.dir;
  }
  return null;
}
/** How good a way is for a Hopper's scrap: into a Crusher best, then a Splitter or a Sieve, then a free cell where a Crusher can go or a Dock that pays a dollar. Raw scrap into a Furnace is slag, so that ranks with nothing. */
const SCRAP_WAYS: Partial<Record<MachineKind | 'open', number>> = { crusher: 3, splitter: 2, sieve: 2, open: 1, dock: 1 };
const scrapWay = (l: Layout, x: number, y: number, d: Dir, ignore?: number) => {
  const r = reach(l, x, y, d, ignore);
  return r === null ? 0 : (SCRAP_WAYS[r] ?? 0);
};

/**
 * Which way a part should face at (x, y): a Splitter or a Sieve, which take only from behind, faces the way its feeder pushes; a
 * machine fed from one side goes straight on, as the line runs, unless the way ahead is blocked, and then turns to whatever beside it
 * takes its load (the seventh panel turned a Crusher three times to point it at the line); a Hopper faces the way its scrap reaches a
 * Crusher, never a Tuner on the way into a Furnace (the eighth); a conveyor runs on toward whatever will take its load, turning a
 * corner if that is where the line goes; a part with nothing around it keeps its current facing.
 */
export function smartFacing(l: Layout, kind: MachineKind, x: number, y: number, current: Dir, ignore?: number): Dir {
  if (kind === 'dock') return current;
  const feeds = feedsInto(l, x, y, ignore);
  const out = (ways: Dir[]) => ways.find((d) => !feeds.includes(opposite(d)) && takes(l, x, y, d, ignore));
  if (feeds.length && kind !== 'conveyor' && kind !== 'tuner') {
    const ahead = feeds[0];
    const nx = x + DIR_DX[ahead],
      ny = y + DIR_DY[ahead];
    const clear = takes(l, x, y, ahead, ignore) || (inGrid(l, nx, ny) && !at(l, nx, ny, ignore)); // the line can run on there
    if (kind === 'splitter' || kind === 'sieve' || clear) return ahead;
    return out([leftOf(ahead), rightOf(ahead)]) ?? ahead;
  }
  const ahead = feeds[0] ?? current;
  const order: Dir[] = [ahead, leftOf(ahead), rightOf(ahead), opposite(ahead)];
  if (kind === 'hopper') return order.reduce((best, d) => (scrapWay(l, x, y, d, ignore) > scrapWay(l, x, y, best, ignore) ? d : best), ahead);
  return out(order) ?? ahead;
}

/**
 * Hoppers beside (x, y) whose scrap goes nowhere, into a free cell, or into a Furnace or a Press, and could feed a Crusher put there, with the
 * way each should turn. One that sends scrap to a Dock keeps its way: that line pays, and the Crusher may not lead anywhere yet.
 */
function idleHoppers(l: Layout, x: number, y: number, crusherDir: Dir, ignore?: number): { h: Machine; dir: Dir }[] {
  const found: { h: Machine; dir: Dir }[] = [];
  for (const d of ALL) {
    const h = at(l, x + DIR_DX[d], y + DIR_DY[d], ignore);
    if (h?.kind !== 'hopper' || d === crusherDir) continue; // a Hopper in front of the Crusher would push head-on into its output
    const toward = opposite(d);
    const now = reach(l, h.x, h.y, h.dir, ignore);
    if (h.dir === toward || (now !== null && now !== 'open' && now !== 'furnace' && now !== 'press')) continue; // it faces here, or its scrap pays
    found.push({ h, dir: toward });
  }
  return found;
}

/** The rule-checked actions that put machine `m` at (x, y). A machine already there goes to the shelf, or swaps places when `m` came from the yard. */
export function dropActions(run: RunState, m: Machine, x: number, y: number, facing?: Dir): Action[] {
  const fromYard = m.x >= 0;
  if (fromYard && m.x === x && m.y === y) return [];
  const occupant = at(run.layout, x, y, m.id);
  const dir = facing ?? (fromYard ? m.dir : smartFacing(run.layout, m.kind, x, y, m.dir, occupant?.id));
  // a Crusher dropped beside a Hopper that feeds nothing turns that Hopper to feed it, in the same edit (the seventh panel's ten clicks)
  const aim: Action[] =
    m.kind === 'crusher' ? idleHoppers(run.layout, x, y, dir, m.id).map(({ h, dir: d }) => ({ t: 'place', id: h.id, x: h.x, y: h.y, dir: d })) : [];
  if (!occupant) return [{ t: 'place', id: m.id, x, y, dir }, ...aim];
  const { x: fx, y: fy } = m;
  const out: Action[] = [
    { t: 'unplace', id: occupant.id },
    { t: 'place', id: m.id, x, y, dir },
  ];
  if (fromYard) out.push({ t: 'place', id: occupant.id, x: fx, y: fy, dir: occupant.dir });
  return [...out, ...aim];
}

/** A machine back to the shelf. If it stood in the line and the shelf holds a belt piece, the piece takes its place, facing the way it faced. */
export function liftActions(run: RunState, m: Machine): Action[] {
  const lift: Action[] = [{ t: 'unplace', id: m.id }];
  const belt = run.bin.find((b) => b.kind === 'conveyor');
  if (m.kind === 'conveyor' || m.kind === 'dock' || m.kind === 'hopper' || !belt || !feedsInto(run.layout, m.x, m.y, m.id).length) return lift;
  return [...lift, { t: 'place', id: belt.id, x: m.x, y: m.y, dir: m.dir }];
}

/** The way from one cell to the one beside it. */
const stepDir = (a: Cell, b: Cell): Dir => ALL.find((d) => a.x + DIR_DX[d] === b.x && a.y + DIR_DY[d] === b.y) ?? 0;
export interface Cell {
  x: number;
  y: number;
}
export interface Stroke {
  actions: Action[];
  /** belt pieces it lays */ laid: number;
  /** of those, how many it buys */ bought: number;
  /** it ran out of belts or money before the end of the stroke */ short: boolean;
}
/**
 * A finger across the yard lays a belt (the owner's agents, 2026-11-01: twenty taps to wire one branch). A stroke from a machine aims it
 * along the stroke. Empty cells take belt pieces, each facing the next cell, from the shelf and then bought, and the stroke ends at the
 * first thing in the way, with the last piece facing it, so a belt joins a line by being drawn into it. One Undo takes it all back.
 */
export function strokeActions(run: RunState, cells: readonly Cell[]): Stroke {
  const out: Stroke = { actions: [], laid: 0, bought: 0, short: false };
  if (cells.length < 2) return out;
  const l = run.layout;
  const free = run.bin.filter((m) => m.kind === 'conveyor').map((m) => m.id);
  let nextId = run.nextId;
  let money = run.score;
  const start = at(l, cells[0].x, cells[0].y);
  if (start && start.kind !== 'dock') {
    const dir = stepDir(cells[0], cells[1]);
    if (dir !== start.dir) out.actions.push({ t: 'place', id: start.id, x: start.x, y: start.y, dir });
  }
  for (let i = start ? 1 : 0; i < cells.length; i++) {
    const c = cells[i];
    if (at(l, c.x, c.y) || l.rubble?.includes(c.y * l.width + c.x)) break;
    const next = cells[i + 1];
    const ahead = next ? stepDir(c, next) : i > 0 ? stepDir(cells[i - 1], c) : 0;
    // the last piece bends toward whatever will take its load
    const dir = next ? ahead : ([ahead, rightOf(ahead), leftOf(ahead)].find((d) => takes(l, c.x, c.y, d)) ?? ahead);
    let id = free.shift();
    if (id === undefined) {
      if (money < RULES.beltCost || run.bin.length >= RULES.shelfSlots) {
        out.short = true;
        break;
      }
      out.actions.push({ t: 'buy' });
      money -= RULES.beltCost;
      id = nextId++;
      out.bought++;
    }
    out.actions.push({ t: 'place', id, x: c.x, y: c.y, dir });
    out.laid++;
  }
  return out;
}

export type BeltShape = 'straight' | 'right' | 'left';
/** How a conveyor draws: fed from behind (or by several sides) it runs straight; fed from one side only it is a corner, turning right or left. */
export function beltShape(l: Layout, m: Machine): BeltShape {
  const feeds = feedsInto(l, m.x, m.y, m.id);
  if (feeds.includes(m.dir) || feeds.length !== 1) return 'straight';
  return feeds[0] === leftOf(m.dir) ? 'right' : 'left';
}
