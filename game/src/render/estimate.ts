/**
 * What a card would add on its own (the first panel, 2026-11-01: picks that did nothing, and no way to know until the shift ran). The
 * shift is exact, so the game can try a card's parts in the spots that make sense and take the best: a single part in every free cell
 * and on every belt piece, a Hopper feeding its Crusher wherever the pair fits, a twin machine on a Splitter's branch beside the one
 * there. It looks at this card alone: gains a good player plans for two shifts out stay theirs to find. Pure and browser-free.
 */
import { DIR_DX, DIR_DY } from '../sim/rules';
import { runLayout } from '../sim/sim';
import type { Dir, Layout, Machine, MachineKind } from '../sim/types';

const ALL: readonly Dir[] = [0, 1, 2, 3];

export interface Gain {
  /** dollars a shift, the best this card can add right now; 0 when nothing tried helps */
  gain: number;
}

const blocked = (l: Layout, x: number, y: number) => x < 0 || y < 0 || x >= l.width || y >= l.height || !!l.rubble?.includes(y * l.width + x);
const at = (l: Layout, x: number, y: number) => l.machines.find((m) => m.x === x && m.y === y);
const part = (kind: MachineKind, x: number, y: number, dir: Dir, id = -1): Machine => ({ id, kind, x, y, dir });

/** The best a single part can do, on a free cell or in place of a belt piece. */
function single(l: Layout, kind: MachineKind): number {
  const faces = kind === 'dock' || kind === 'tuner' ? ALL.slice(0, 1) : ALL;
  let best = 0;
  for (let y = 0; y < l.height; y++)
    for (let x = 0; x < l.width; x++) {
      if (blocked(l, x, y)) continue;
      const under = at(l, x, y);
      if (under && under.kind !== 'conveyor') continue;
      const rest = under ? l.machines.filter((m) => m !== under) : l.machines;
      for (const dir of faces) best = Math.max(best, runLayout({ ...l, machines: [...rest, part(kind, x, y, dir)] }).earned);
    }
  return best;
}

/** A Hopper feeding a Crusher, the pair anywhere it fits, the Crusher's load going into whatever is ahead of it. */
function feed(l: Layout): number {
  let best = 0;
  for (let y = 0; y < l.height; y++)
    for (let x = 0; x < l.width; x++) {
      if (blocked(l, x, y) || at(l, x, y)) continue;
      for (const dir of ALL)
        for (const side of ALL) {
          if (side === dir) continue; // the Hopper cannot stand where the Crusher unloads
          const hx = x + DIR_DX[side],
            hy = y + DIR_DY[side];
          if (blocked(l, hx, hy) || at(l, hx, hy)) continue;
          const hopper = part('hopper', hx, hy, ((side + 2) % 4) as Dir, -2);
          best = Math.max(best, runLayout({ ...l, machines: [...l.machines, part('crusher', x, y, dir), hopper] }).earned);
        }
    }
  return best;
}

/** A twin on a branch: a Splitter on the belt behind a machine, the twin beside that machine, and two belts round it back into the line. */
function branch(l: Layout, kind: MachineKind): number {
  let best = 0;
  for (const m of l.machines) {
    if (m.kind !== kind) continue;
    const bx = m.x - DIR_DX[m.dir],
      by = m.y - DIR_DY[m.dir];
    const behind = at(l, bx, by);
    if (!behind || behind.kind !== 'conveyor') continue;
    for (const turn of [1, 3]) {
      const side = ((m.dir + turn) % 4) as Dir;
      const sx = DIR_DX[side],
        sy = DIR_DY[side];
      const fx = DIR_DX[m.dir],
        fy = DIR_DY[m.dir];
      const free = [
        [bx + sx, by + sy],
        [m.x + sx, m.y + sy],
        [m.x + sx + fx, m.y + sy + fy],
      ];
      if (free.some(([x, y]) => blocked(l, x, y) || at(l, x, y))) continue;
      const machines = [
        ...l.machines.filter((q) => q !== behind),
        part('splitter', bx, by, m.dir),
        part('conveyor', free[0][0], free[0][1], m.dir, -2),
        part(kind, free[1][0], free[1][1], m.dir, -3),
        part('conveyor', free[2][0], free[2][1], ((side + 2) % 4) as Dir, -4),
      ];
      best = Math.max(best, runLayout({ ...l, machines }).earned);
    }
  }
  return best;
}

/** What a card's parts add to this line. */
export function cardGain(layout: Layout, parts: readonly MachineKind[]): Gain {
  const base = runLayout(layout).earned;
  const kit = parts.length > 1;
  const best = !kit ? single(layout, parts[0]) : parts[0] === 'hopper' ? feed(layout) : Math.max(branch(layout, parts[0]), single(layout, parts[0]));
  return { gain: Math.max(0, best - base) };
}
