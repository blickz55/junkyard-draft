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
import { inputTravelDirs } from '../sim/advice';

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
  /** a Dock that adds nothing now but gives a line with no free side at its dock somewhere to go */
  room?: boolean;
}

interface Try {
  earned: number;
  plan: Placed[];
}
const NOTHING: Try = { earned: 0, plan: [] };

const blocked = (l: Layout, x: number, y: number) => x < 0 || y < 0 || x >= l.width || y >= l.height || !!l.rubble?.includes(y * l.width + x);
const at = (l: Layout, x: number, y: number) => l.machines.find((m) => m.x === x && m.y === y);
const part = (kind: MachineKind, x: number, y: number, dir: Dir, id = -1): Machine => ({ id, kind, x, y, dir });
/**
 * What a try earns, with a sliver for free cells beside the machines that do the work. It only ever breaks a tie, and it matters: the first
 * spot found boxed a line in by shift 4, and then no card had a spot left at all (the third panel).
 */
function worth(l: Layout, machines: Machine[]): number {
  let room = 0;
  for (const m of machines) {
    if (m.kind !== 'crusher' && m.kind !== 'furnace' && m.kind !== 'press') continue;
    for (const d of ALL) {
      const x = m.x + DIR_DX[d],
        y = m.y + DIR_DY[d];
      if (!blocked(l, x, y) && !machines.some((q) => q.x === x && q.y === y)) room++;
    }
  }
  return runLayout({ ...l, machines }).earned + room / 1000;
}

/**
 * The way belts would run from each free cell into something that takes what they carry, shortest first: a reverse search from every
 * machine's open input. A new feed somewhere free can then reach the line by belt instead of only by touching it (the fourth panel: by shift 5
 * a line had used the room beside its dock and every card said there was no spot).
 */
function routeMap(l: Layout): { len: Int16Array; dir: Int8Array } {
  const n = l.width * l.height;
  const len = new Int16Array(n);
  const dir = new Int8Array(n);
  const free = (x: number, y: number) => !blocked(l, x, y) && !at(l, x, y);
  const queue: number[] = [];
  for (const m of l.machines) {
    if (m.kind === 'hopper') continue;
    for (const t of inputTravelDirs(m.kind, m.dir)) {
      const x = m.x - DIR_DX[t],
        y = m.y - DIR_DY[t];
      if (!free(x, y) || len[y * l.width + x]) continue;
      len[y * l.width + x] = 1;
      dir[y * l.width + x] = t;
      queue.push(y * l.width + x);
    }
  }
  for (let q = 0; q < queue.length; q++) {
    const c = queue[q];
    const cx = c % l.width,
      cy = Math.floor(c / l.width);
    const d = dir[c] as Dir;
    for (const t of [d, ((d + 1) % 4) as Dir, ((d + 3) % 4) as Dir]) {
      const x = cx - DIR_DX[t],
        y = cy - DIR_DY[t];
      if (!free(x, y) || len[y * l.width + x]) continue;
      len[y * l.width + x] = len[c] + 1;
      dir[y * l.width + x] = t;
      queue.push(y * l.width + x);
    }
  }
  return { len, dir };
}
/** The belt pieces of the way from a free cell, as a route map has it. */
function routeFrom(l: Layout, map: ReturnType<typeof routeMap>, x: number, y: number): Machine[] {
  const out: Machine[] = [];
  while (map.len[y * l.width + x]) {
    const d = map.dir[y * l.width + x] as Dir;
    out.push(part('conveyor', x, y, d, -10 - out.length));
    x += DIR_DX[d];
    y += DIR_DY[d];
  }
  return out;
}

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
      for (const dir of kind === 'tuner' && under ? [under.dir] : faces) {
        const earned = worth(l, [...rest, part(kind, x, y, dir)]);
        if (earned > best.earned) best = { earned, plan: [{ kind, x, y, dir }] };
      }
    }
  return best;
}

/** A Hopper feeding a Crusher, the pair anywhere it fits, the Crusher's load going into whatever is ahead of it, or along belts to it, or
 * with a Dock of its own (rules on trial: a card that brings one) into that, straight or one belt on, where a machine can drop in later. */
function feed(l: Layout, belts: number, dock = false): Try {
  let best = NOTHING;
  const map = routeMap(l);
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
          const ax = x + DIR_DX[dir],
            ay = y + DIR_DY[dir];
          const open = (px: number, py: number) => !blocked(l, px, py) && !at(l, px, py) && !(px === hx && py === hy);
          const tries: Machine[][] = [];
          const route = open(ax, ay) ? routeFrom(l, map, ax, ay) : [];
          if (route.length <= belts && !route.some((r) => (r.x === hx && r.y === hy) || (r.x === x && r.y === y))) tries.push(route); // the way may not run through the pair
          if (dock && open(ax, ay)) {
            tries.push([part('dock', ax, ay, 0, -7)]);
            const bx = ax + DIR_DX[dir],
              by = ay + DIR_DY[dir];
            if (belts > 0 && open(bx, by)) tries.push([part('conveyor', ax, ay, dir, -8), part('dock', bx, by, 0, -7)]);
          }
          for (const t of tries) {
            const earned = worth(l, [...l.machines, crusher, hopper, ...t]);
            if (earned > best.earned) best = { earned, plan: [hopper, crusher, ...t].map(({ kind, x, y, dir }) => ({ kind, x, y, dir })) };
          }
        }
    }
  return best;
}

/**
 * A twin on a branch: a Splitter behind a machine, the twin at the Splitter's side, and its load round into whatever takes it, by at most two
 * belts. A yard's first line has no belt behind its machine, so the machine can step along the belt to make the room: the card's own machine
 * takes the belt piece ahead, the Splitter lands on the old machine and sends it to the shelf, and that one becomes the twin.
 */
function branch(l: Layout, kind: MachineKind, belts: number, dock = false): Try {
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
          if (dock && free(ox, oy)) tries.push([part('dock', ox, oy, 0, -7)]); // a card that brings its own Dock sells where the twin stands
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
            const earned = worth(l, [...base, twin, ...route]);
            if (earned > best.earned) best = { earned, plan: [...front, splitter, ...filler, twin, ...route].map(plain) };
          }
        }
      }
    }
  }
  return best;
}

/**
 * A second Dock where the yard has room, when every dock already has each side taken: it adds nothing this shift, and without it nothing
 * more can reach a dock. The spot is free on three sides or more, and as near the line as it can be.
 */
function room(l: Layout): Placed | null {
  const free = (x: number, y: number) => !blocked(l, x, y) && !at(l, x, y);
  const docks = l.machines.filter((m) => m.kind === 'dock');
  if (!docks.length || docks.some((d) => ALL.some((t) => free(d.x + DIR_DX[t], d.y + DIR_DY[t])))) return null;
  let best: { p: Placed; score: number } | null = null;
  for (let y = 0; y < l.height; y++)
    for (let x = 0; x < l.width; x++) {
      if (!free(x, y)) continue;
      const open = ALL.filter((t) => free(x + DIR_DX[t], y + DIR_DY[t])).length;
      if (open < 3) continue;
      const near = Math.min(...l.machines.map((m) => Math.abs(m.x - x) + Math.abs(m.y - y)));
      const score = open * 10 - near;
      if (!best || score > best.score) best = { p: { kind: 'dock', x, y, dir: 0 }, score };
    }
  return best?.p ?? null;
}

/** What a card's parts add to this line, with `belts` on the shelf for what it needs. */
export function cardGain(layout: Layout, parts: readonly MachineKind[], belts = 0): Gain {
  const base = runLayout(layout).earned;
  const kit = parts.length > 1;
  const dock = kit && parts.includes('dock');
  const twin = (kind: MachineKind) => {
    const b = branch(layout, kind, belts, dock);
    const s = single(layout, kind);
    return b.earned > s.earned ? b : s;
  };
  const best = !kit ? single(layout, parts[0]) : parts[0] === 'hopper' ? feed(layout, belts, dock) : twin(parts[0]);
  const gain = Math.floor(best.earned) - base;
  if (gain > 0) return { gain, plan: best.plan };
  const spot = parts.length === 1 && parts[0] === 'dock' ? room(layout) : null;
  return spot ? { gain: 0, plan: [spot], room: true } : { gain: 0, plan: [] };
}
