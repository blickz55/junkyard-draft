/**
 * Yards (rules v4). A seed used to change only the offers: every game opened on the same straight belt. Now the seed
 * builds the yard: where the hopper and the dock stand, the belt between them with its bends, the rubble that cannot be
 * built on, the job the yard pays for and the parts already on the shelf. Everything here is a pure function of the seed
 * string, drawn from its own stream (`${seed}:yard`), so a yard is the same for everyone who plays it.
 *
 * Two reserved namespaces (part of the rules, like every scenario namespace):
 *   tutorial-*  the lesson yard: a belt with a gap at its corner, a small job, one conveyor on the shelf, no pick in shift 1
 *   classic-*   the original yard: the straight belt, no rubble, no job, an empty shelf
 */
import { Rng } from './rng';
import { DIR_DX, DIR_DY, RULES } from './rules';
import type { Dir, Layout, Machine, MachineKind, Material } from './types';

export type JobMaterial = Extract<Material, 'ingot' | 'plate'>;
/** The machine that makes a job's product out of shards. */
export const JOB_MACHINE: Record<JobMaterial, MachineKind> = { ingot: 'furnace', plate: 'press' };

/** What a yard is paid to deliver: its product (which sells for RULES.job.price here) and the three star marks in units shipped. */
export interface Job {
  material: JobMaterial;
  stars: readonly [number, number, number];
}
export interface Yard {
  machines: Omit<Machine, 'id'>[];
  rubble: number[];
  job: Job | null;
  shelf: MachineKind[];
  /** the phase a new run opens in: the lesson's first shift has no pick */
  firstPhase: 'draft' | 'build';
}

export const TUTORIAL_SEED = 'tutorial-1';
export const isTutorialSeed = (seed: string): boolean => /^tutorial-/.test(seed);
export const isClassicSeed = (seed: string): boolean => /^classic-/.test(seed);

const W = RULES.gridWidth;
const H = RULES.gridHeight;
const cell = (x: number, y: number) => y * W + x;
const inside = (x: number, y: number) => x >= 0 && y >= 0 && x < W && y < H;

interface Path {
  hopper: { x: number; y: number; dir: Dir };
  belt: { x: number; y: number; dir: Dir }[];
  dock: { x: number; y: number };
}

/** The belt's segments: conveyors laid per straight run, then which way each bend turns (+1 clockwise, -1 counter-clockwise). */
function shape(rng: Rng): { runs: number[]; turns: number[] } {
  const k = rng.weighted(RULES.yard.shapes);
  const side = rng.int(2) === 0 ? 1 : -1;
  if (k === 'straight') return { runs: [3 + rng.int(3)], turns: [] };
  if (k === 'bend') return { runs: [2 + rng.int(3), 2 + rng.int(2)], turns: [side] };
  return { runs: [2 + rng.int(2), 2, 2], turns: [side, -side] }; // an S: two bends, back to the first heading
}

/** Walk a shape from a start cell; null when it leaves the grid or crosses itself. */
function walk(x: number, y: number, dir: Dir, s: { runs: number[]; turns: number[] }): Path | null {
  const hopper = { x, y, dir };
  const belt: Path['belt'] = [];
  let cx = x,
    cy = y,
    d = dir;
  const seen = new Set<number>([cell(x, y)]);
  for (let r = 0; r < s.runs.length; r++) {
    for (let i = 0; i < s.runs[r]; i++) {
      cx += DIR_DX[d];
      cy += DIR_DY[d];
      if (!inside(cx, cy) || seen.has(cell(cx, cy))) return null;
      seen.add(cell(cx, cy));
      const lastOfRun = i === s.runs[r] - 1;
      const next = lastOfRun && r < s.turns.length ? (((d + s.turns[r] + 4) % 4) as Dir) : d;
      belt.push({ x: cx, y: cy, dir: next }); // a bend's conveyor already faces the new heading: it is fed from its side and draws as a corner
      d = next;
    }
  }
  const dx = cx + DIR_DX[d];
  const dy = cy + DIR_DY[d];
  if (!inside(dx, dy) || seen.has(cell(dx, dy))) return null;
  return { hopper, belt, dock: { x: dx, y: dy } };
}

/** A path keeps clear of the corners of the grid, leaves building room on the far side of the line and has straight pieces for the recipe to drop into (a machine only takes items from behind, so a corner cannot hold one). */
function goodPath(p: Path): boolean {
  const straight = p.belt.filter((b, i) => (i === 0 ? p.hopper.dir : p.belt[i - 1].dir) === b.dir).length;
  if (straight < RULES.yard.straightPieces) return false;
  const cells = [p.hopper, ...p.belt, p.dock];
  const xs = cells.map((c) => c.x);
  const ys = cells.map((c) => c.y);
  const corner = (c: { x: number; y: number }) => (c.x === 0 || c.x === W - 1) && (c.y === 0 || c.y === H - 1);
  if (corner(p.hopper) || corner(p.dock)) return false;
  const free = Math.max(Math.min(...ys), H - 1 - Math.max(...ys));
  const freeX = Math.max(Math.min(...xs), W - 1 - Math.max(...xs));
  return free >= RULES.yard.roomRows || freeX >= RULES.yard.roomColumns;
}

function pathFor(rng: Rng): Path {
  for (let i = 0; i < 200; i++) {
    const s = shape(rng);
    const p = walk(rng.int(W), rng.int(H), rng.int(4) as Dir, s);
    if (p && goodPath(p)) return p;
  }
  return { hopper: { x: 1, y: 2, dir: 0 }, belt: [2, 3, 4].map((x) => ({ x, y: 2, dir: 0 as Dir })), dock: { x: 5, y: 2 } }; // unreachable in practice: the classic straight belt
}

/** Rubble: scattered single cells, never touching the hopper, the dock or each other, so a pile can be walked around and never walls anything off. */
function rubbleFor(rng: Rng, p: Path): number[] {
  const taken = new Set([p.hopper, ...p.belt, p.dock].map((c) => cell(c.x, c.y)));
  const near = (a: { x: number; y: number }, x: number, y: number) => Math.abs(a.x - x) + Math.abs(a.y - y) <= 1;
  const out: number[] = [];
  const want = RULES.yard.rubbleMin + rng.int(RULES.yard.rubbleMax - RULES.yard.rubbleMin + 1);
  for (let i = 0; i < 300 && out.length < want; i++) {
    const x = rng.int(W),
      y = rng.int(H);
    if (taken.has(cell(x, y)) || near(p.hopper, x, y) || near(p.dock, x, y)) continue;
    if (out.some((c) => near({ x: c % W, y: Math.floor(c / W) }, x, y))) continue;
    out.push(cell(x, y));
  }
  return out.sort((a, b) => a - b);
}

function jobFor(rng: Rng): Job {
  const material = rng.weighted(RULES.job.weights) as JobMaterial;
  return { material, stars: RULES.job.stars[material] };
}

const CLASSIC: Yard = { machines: RULES.starter.map((m) => ({ ...m })), rubble: [], job: null, shelf: [], firstPhase: 'draft' };

/** The lesson's yard: hopper → two conveyors → a gap at the bend → two conveyors → dock; the shelf holds the piece that closes the gap. */
const TUTORIAL: Yard = {
  machines: [
    { kind: 'hopper', x: 1, y: 1, dir: 0 },
    { kind: 'conveyor', x: 2, y: 1, dir: 0 },
    { kind: 'conveyor', x: 3, y: 1, dir: 0 },
    { kind: 'conveyor', x: 4, y: 2, dir: 1 },
    { kind: 'conveyor', x: 4, y: 3, dir: 1 },
    { kind: 'dock', x: 4, y: 4, dir: 0 },
  ],
  rubble: [cell(6, 1), cell(1, 4)],
  job: { material: 'ingot', stars: RULES.job.lessonStars },
  shelf: ['conveyor'],
  firstPhase: 'build',
};
/** The cell the lesson's first part closes. */
export const TUTORIAL_GAP = { x: 4, y: 1 };

/** The yard a seed opens on. */
export function yardFor(seed: string): Yard {
  if (isTutorialSeed(seed)) return TUTORIAL;
  if (isClassicSeed(seed)) return CLASSIC;
  const rng = new Rng(`${seed}:yard`);
  const p = pathFor(rng);
  const machines: Yard['machines'] = [
    { kind: 'hopper', x: p.hopper.x, y: p.hopper.y, dir: p.hopper.dir },
    ...p.belt.map((b) => ({ kind: 'conveyor' as MachineKind, x: b.x, y: b.y, dir: b.dir })),
    { kind: 'dock', x: p.dock.x, y: p.dock.y, dir: 0 },
  ];
  return { machines, rubble: rubbleFor(rng, p), job: jobFor(rng), shelf: [...RULES.yard.shelf], firstPhase: 'draft' };
}

/** How many stars a shipped count has earned on a job. */
export const starsFor = (job: Job, shipped: number): 0 | 1 | 2 | 3 => job.stars.filter((n) => shipped >= n).length as 0 | 1 | 2 | 3;

/** What a material sells for on this layout: the list price, or the job's price for its product. */
export const priceOf = (layout: Pick<Layout, 'premium'>, mat: Material): number => (layout.premium === mat ? RULES.job.price : RULES.value[mat]);
