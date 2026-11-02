/**
 * What a card would add on its own, and where (the first panel, 2026-11-01: picks that did nothing, and no way to know until the shift
 * ran). The shift is exact, so the game can try a card's parts in the spots that make sense and take the best: a single part in every free
 * cell and on every belt piece, a Hopper feeding its Crusher wherever the pair fits, a twin machine on a Splitter's branch beside the one
 * there. It looks at this card alone: gains a good player plans for two shifts out stay theirs to find. The best try is also the plan the
 * coach lights, one spot at a time, so what the card says is what those spots earn. Pure and browser-free.
 */
import { DIR_DX, DIR_DY } from '../sim/rules';
import { runLayout } from '../sim/sim';
import type { Dir, Layout, Machine, MachineKind } from '../sim/types';

const ALL: readonly Dir[] = [0, 1, 2, 3];

/** A part in its spot. */
export interface Placed {
  kind: MachineKind;
  x: number;
  y: number;
  dir: Dir;
}
export interface Gain {
  /** dollars a shift, the best this card can add right now; 0 when nothing tried helps */
  gain: number;
  /** the placements that earn it, in the order to make them; empty when nothing tried helps */
  plan: Placed[];
}

interface Try {
  earned: number;
  plan: Placed[];
}
const NOTHING: Try = { earned: 0, plan: [] };

const blocked = (l: Layout, x: number, y: number) => x < 0 || y < 0 || x >= l.width || y >= l.height || !!l.rubble?.includes(y * l.width + x);
const at = (l: Layout, x: number, y: number) => l.machines.find((m) => m.x === x && m.y === y);
const part = (kind: MachineKind, x: number, y: number, dir: Dir, id = -1): Machine => ({ id, kind, x, y, dir });

/** The best a single part can do, on a free cell or in place of a belt piece. */
function single(l: Layout, kind: MachineKind): Try {
  const faces = kind === 'dock' || kind === 'tuner' ? ALL.slice(0, 1) : ALL;
  let best = NOTHING;
  for (let y = 0; y < l.height; y++)
    for (let x = 0; x < l.width; x++) {
      if (blocked(l, x, y)) continue;
      const under = at(l, x, y);
      if (under && under.kind !== 'conveyor') continue;
      const rest = under ? l.machines.filter((m) => m !== under) : l.machines;
      for (const dir of faces) {
        const earned = runLayout({ ...l, machines: [...rest, part(kind, x, y, dir)] }).earned;
        if (earned > best.earned) best = { earned, plan: [{ kind, x, y, dir }] };
      }
    }
  return best;
}

/** A Hopper feeding a Crusher, the pair anywhere it fits, the Crusher's load going into whatever is ahead of it. */
function feed(l: Layout): Try {
  let best = NOTHING;
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
          const crusher = part('crusher', x, y, dir);
          const earned = runLayout({ ...l, machines: [...l.machines, crusher, hopper] }).earned;
          if (earned > best.earned) best = { earned, plan: [hopper, crusher].map(({ kind, x, y, dir }) => ({ kind, x, y, dir })) };
        }
    }
  return best;
}

/**
 * A twin on a branch: a Splitter behind a machine, the twin at the Splitter's side, and its load round into whatever takes it, by at most two
 * belts. A yard's first line has no belt behind its machine, so the machine can step along the belt to make the room: the card's own machine
 * takes the belt piece ahead, the Splitter lands on the old machine and sends it to the shelf, and that one becomes the twin.
 */
function branch(l: Layout, kind: MachineKind, belts: number): Try {
  let best = NOTHING;
  const plain = ({ kind, x, y, dir }: Machine): Placed => ({ kind, x, y, dir });
  for (const m of l.machines) {
    if (m.kind !== kind) continue;
    const along: Machine[] = [m]; // the machine's cell, then the belt pieces it could step onto
    for (let i = 0; i < 2; i++) {
      const c = along[along.length - 1];
      const next = at(l, c.x + DIR_DX[c.dir], c.y + DIR_DY[c.dir]);
      if (next?.kind !== 'conveyor') break;
      along.push(next);
    }
    const behind = at(l, m.x - DIR_DX[m.dir], m.y - DIR_DY[m.dir]);
    for (let k = behind?.kind === 'conveyor' ? 0 : 1; k < along.length; k++) {
      const spot = k ? along[k - 1] : behind!; // where the Splitter goes
      const front = k ? [part(kind, along[k].x, along[k].y, along[k].dir)] : [];
      const filler = k === 2 ? [part('conveyor', m.x, m.y, m.dir, -5)] : []; // the machine stepped two: a belt carries on to the Splitter
      const gone = k ? along.slice(0, k + 1) : [behind!];
      const splitter = part('splitter', spot.x, spot.y, spot.dir, -6);
      const base = [...l.machines.filter((q) => !gone.includes(q)), ...front, ...filler, splitter];
      const free = (x: number, y: number) => !blocked(l, x, y) && !base.some((q) => q.x === x && q.y === y);
      const spare = belts + (k ? k : 1) - filler.length; // the pieces a Splitter and a stepped machine lift come back to the shelf
      for (const turn of [1, 3]) {
        const side = ((spot.dir + turn) % 4) as Dir;
        const tx = spot.x + DIR_DX[side],
          ty = spot.y + DIR_DY[side];
        if (!free(tx, ty)) continue;
        for (const dir of ALL) {
          if (dir === (side + 2) % 4) continue; // head-on into the Splitter
          const twin = part(kind, tx, ty, dir, -3);
          const tries: Machine[][] = [[]];
          const ox = tx + DIR_DX[dir],
            oy = ty + DIR_DY[dir];
          if (free(ox, oy) && spare > 0)
            for (const d1 of ALL) {
              const b1 = part('conveyor', ox, oy, d1, -2);
              tries.push([b1]);
              const nx = ox + DIR_DX[d1],
                ny = oy + DIR_DY[d1];
              if (spare < 2 || !free(nx, ny) || (nx === tx && ny === ty)) continue;
              for (const d2 of ALL) tries.push([b1, part('conveyor', nx, ny, d2, -4)]);
            }
          for (const route of tries) {
            const earned = runLayout({ ...l, machines: [...base, twin, ...route] }).earned;
            if (earned > best.earned) best = { earned, plan: [...front, splitter, ...filler, twin, ...route].map(plain) };
          }
        }
      }
    }
  }
  return best;
}

/** What a card's parts add to this line, with `belts` on the shelf for what it needs. */
export function cardGain(layout: Layout, parts: readonly MachineKind[], belts = 0): Gain {
  const base = runLayout(layout).earned;
  const kit = parts.length > 1;
  const twin = (kind: MachineKind) => {
    const b = branch(layout, kind, belts);
    const s = single(layout, kind);
    return b.earned > s.earned ? b : s;
  };
  const best = !kit ? single(layout, parts[0]) : parts[0] === 'hopper' ? feed(layout) : twin(parts[0]);
  return best.earned > base ? { gain: best.earned - base, plan: best.plan } : { gain: 0, plan: [] };
}
