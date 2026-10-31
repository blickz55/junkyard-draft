/**
 * The obvious move works (docs/UX-STANDARD.md): dropping a part on the belt puts it in the belt, facing the way the line
 * runs. Pure and browser-free. `dropActions` turns a drop into rule-checked actions (a swap is several, undone as one);
 * `smartFacing` chooses the way a part from the shelf should face; `beltShape` says how a conveyor draws: a conveyor fed only
 * from its side is a corner. None of this has any scoring authority: the rules still check every action.
 */
import type { Action, RunState } from '../sim/run';
import { inputTravelDirs, outputDirs } from '../sim/advice';
import { DIR_DX, DIR_DY, leftOf, opposite, rightOf } from '../sim/rules';
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

/**
 * Which way a part should face at (x, y): a machine that only takes items from behind faces the way its feeder pushes; a
 * conveyor runs on toward whatever will take its load, turning a corner if that is where the line goes; a part with nothing
 * around it keeps its current facing.
 */
export function smartFacing(l: Layout, kind: MachineKind, x: number, y: number, current: Dir, ignore?: number): Dir {
  if (kind === 'dock' || kind === 'tuner') return current;
  const feeds = feedsInto(l, x, y, ignore);
  if (feeds.length && kind !== 'conveyor') return feeds[0];
  const ahead = feeds[0] ?? current;
  const order: Dir[] = [ahead, rightOf(ahead), leftOf(ahead), opposite(ahead)];
  const out = order.find((d) => !feeds.includes(opposite(d)) && takes(l, x, y, d, ignore));
  return out ?? ahead;
}

/** The rule-checked actions that put machine `m` at (x, y). A machine already there goes to the shelf, or swaps places when `m` came from the yard. */
export function dropActions(run: RunState, m: Machine, x: number, y: number): Action[] {
  const fromYard = m.x >= 0;
  if (fromYard && m.x === x && m.y === y) return [];
  const occupant = at(run.layout, x, y, m.id);
  const dir = fromYard ? m.dir : smartFacing(run.layout, m.kind, x, y, m.dir, occupant?.id);
  if (!occupant) return [{ t: 'place', id: m.id, x, y, dir }];
  const { x: fx, y: fy } = m;
  const out: Action[] = [
    { t: 'unplace', id: occupant.id },
    { t: 'place', id: m.id, x, y, dir },
  ];
  if (fromYard) out.push({ t: 'place', id: occupant.id, x: fx, y: fy, dir: occupant.dir });
  return out;
}

export type BeltShape = 'straight' | 'right' | 'left';
/** How a conveyor draws: fed from behind (or by several sides) it runs straight; fed from one side only it is a corner, turning right or left. */
export function beltShape(l: Layout, m: Machine): BeltShape {
  const feeds = feedsInto(l, m.x, m.y, m.id);
  if (feeds.includes(m.dir) || feeds.length !== 1) return 'straight';
  return feeds[0] === leftOf(m.dir) ? 'right' : 'left';
}
