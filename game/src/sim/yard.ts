/**
 * Yards (rules v4). A seed used to change only the offers: every game opened on the same straight belt. Now the seed
 * builds the yard: where the hopper and the dock stand, the belt between them with its bends, the rubble that cannot be
 * built on, the job the yard pays for and the parts already on the shelf. Everything here is a pure function of the seed
 * string, drawn from its own stream (`${seed}:yard`), so a yard is the same for everyone who plays it.
 *
 * Two reserved namespaces (part of the rules, like every scenario namespace):
 *   tutorial-*  the lessons (rules v5): `tutorial-2` and `tutorial-3` are the later ones, and every other name is the first
 *   classic-*   the original yard: the straight belt, no rubble, no job, an empty shelf
 */
import { Rng } from './rng';
import { DIR_DX, DIR_DY, RULES, type YardVariant } from './rules';
import type { Dir, Layout, Machine, MachineKind, Material } from './types';

export type JobMaterial = Extract<Material, 'ingot' | 'plate'>;
/** The machine that makes a job's product out of shards. */
export const JOB_MACHINE: Record<JobMaterial, MachineKind> = { ingot: 'furnace', plate: 'press' };

/** What a yard is paid to deliver: its product (which sells for RULES.job.price here), an order a shift, and the three star marks: orders filled, or in a lesson, which has no orders, units shipped. */
export interface Job {
  material: JobMaterial;
  stars: readonly [number, number, number];
  orders?: readonly number[];
}
export interface Yard {
  machines: Omit<Machine, 'id'>[];
  rubble: number[];
  job: Job | null;
  shelf: MachineKind[];
  /** the phase a new run opens in: the lesson's first shift has no pick */
  firstPhase: 'draft' | 'build';
  /** how the line starts, when not as it stands (RULES.yard.variants) */
  variant?: Exclude<YardVariant, 'standard'>;
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
  return { material, stars: RULES.job.stars, orders: RULES.job.orders[material] };
}

const CLASSIC: Yard = { machines: RULES.starter.map((m) => ({ ...m })), rubble: [], job: null, shelf: [], firstPhase: 'draft' };

/** A lesson's yard, and the cards each of its shifts deals. A lesson that opens on the build has no pick in shift 1. */
export interface LessonYard extends Yard {
  offers: Readonly<Record<number, readonly MachineKind[]>>;
}
const R: Dir = 0;
const D: Dir = 1;
const U: Dir = 3;
const lessonPart = (kind: MachineKind, x: number, y: number, dir: Dir = R): Omit<Machine, 'id'> => ({ kind, x, y, dir });

/** Lesson 1, the first line: hopper, belt, a gap at the bend, belt, dock. The shelf holds the piece that closes the gap. */
const LESSON_1: LessonYard = {
  machines: [
    lessonPart('hopper', 1, 1),
    lessonPart('conveyor', 2, 1),
    lessonPart('conveyor', 3, 1),
    lessonPart('conveyor', 4, 2, D),
    lessonPart('conveyor', 4, 3, D),
    lessonPart('dock', 4, 4),
  ],
  rubble: [cell(6, 1), cell(1, 4)],
  job: { material: 'ingot', stars: [5, 10, 20] },
  shelf: ['conveyor'],
  firstPhase: 'build',
  offers: { 1: [], 2: ['crusher', 'press', 'hopper'], 3: ['furnace', 'tuner', 'dock'] },
};
/** Lesson 2, plates and a second feed: a working crusher line with one belt piece pointing the wrong way, and room below it for a second feed to join. */
const LESSON_2: LessonYard = {
  machines: [
    lessonPart('hopper', 1, 2),
    lessonPart('crusher', 2, 2),
    lessonPart('conveyor', 3, 2),
    lessonPart('conveyor', 4, 2),
    lessonPart('conveyor', 5, 2, U),
    lessonPart('dock', 6, 2),
  ],
  rubble: [cell(6, 4), cell(1, 0)],
  job: { material: 'plate', stars: [10, 25, 40] },
  shelf: ['crusher', 'conveyor'],
  firstPhase: 'draft',
  offers: { 1: ['press', 'furnace', 'tuner'], 2: ['hopper', 'splitter', 'dock'] },
};
/** Lesson 3, the slowest machine: two feeds pouring into one furnace, with the belt already round it, so the second furnace mirrors the first. */
const LESSON_3: LessonYard = {
  machines: [
    lessonPart('hopper', 0, 2),
    lessonPart('crusher', 1, 2),
    lessonPart('conveyor', 2, 2),
    lessonPart('conveyor', 3, 2, U),
    lessonPart('conveyor', 3, 1),
    lessonPart('furnace', 4, 1),
    lessonPart('conveyor', 5, 1, D),
    lessonPart('conveyor', 5, 2),
    lessonPart('dock', 6, 2),
    lessonPart('crusher', 2, 3, U),
    lessonPart('hopper', 2, 4, U),
  ],
  rubble: [cell(7, 0), cell(0, 5)],
  job: { material: 'ingot', stars: [30, 80, 150] },
  shelf: ['furnace'],
  firstPhase: 'build',
  offers: { 1: [], 2: ['tuner', 'press', 'hopper'], 3: ['splitter', 'dock', 'crusher'], 4: ['dock', 'hopper', 'press'] },
};
const LESSON_SEEDS: Readonly<Record<string, LessonYard>> = { 'tutorial-2': LESSON_2, 'tutorial-3': LESSON_3 };
/** The lesson a reserved seed opens; null on any other yard. */
export const lessonYard = (seed: string): LessonYard | null => (isTutorialSeed(seed) ? (LESSON_SEEDS[seed] ?? LESSON_1) : null);

/** The yard a seed opens on. */
export function yardFor(seed: string): Yard {
  const lesson = lessonYard(seed);
  if (lesson) return lesson;
  if (isClassicSeed(seed)) return CLASSIC;
  const rng = new Rng(`${seed}:yard`);
  const p = pathFor(rng);
  const rubble = rubbleFor(rng, p); // the stream's order is part of the yard: rubble, then the job
  const job = jobFor(rng);
  const belt = p.belt.map((b) => ({ kind: 'conveyor' as MachineKind, x: b.x, y: b.y, dir: b.dir }));
  // the yard opens with the job's line already working: every pick is a choice, and shift 1 already pays
  const straight = p.belt.map((b, i) => ((i === 0 ? p.hopper.dir : p.belt[i - 1].dir) === b.dir ? i : -1)).filter((i) => i >= 0);
  belt[straight[0]].kind = 'crusher';
  belt[straight[Math.min(2, straight.length - 1)]].kind = JOB_MACHINE[job.material]; // a belt piece between them: where a first Splitter goes
  const machines: Yard['machines'] = [
    { kind: 'hopper', x: p.hopper.x, y: p.hopper.y, dir: p.hopper.dir },
    ...belt,
    { kind: 'dock', x: p.dock.x, y: p.dock.y, dir: 0 },
  ];
  const maker = belt[straight[Math.min(2, straight.length - 1)]];
  const gap = belt[straight[0] + 1];
  return withVariant(seed, { machines, rubble, job, shelf: [...RULES.yard.shelf], firstPhase: 'draft' }, gap, maker);
}

/**
 * A yard's variant, drawn from its own stream so the rest of the yard is the same whatever the weights. A variant that does not fit the
 * yard (no room beside the line) leaves it as it stands.
 */
function withVariant(seed: string, yard: Yard, gap: { x: number; y: number; dir: Dir }, maker: { x: number; y: number }): Yard {
  const rng = new Rng(`${seed}:variant`);
  const v = rng.weighted(RULES.yard.variants) as YardVariant;
  if (v === 'standard' || !yard.job) return yard;
  const pct = RULES.yard.orderScale[v][yard.job.material];
  const job: Job = { ...yard.job, orders: yard.job.orders?.map((o) => Math.round((o * pct) / 1000) * 10) };
  const taken = new Set([...yard.machines.map((m) => cell(m.x, m.y)), ...yard.rubble]);
  const free = (x: number, y: number) => inside(x, y) && !taken.has(cell(x, y));
  const sides = ([1, 3] as const).map((t) => ((gap.dir + t) % 4) as Dir);
  if (rng.int(2)) sides.reverse();
  if (v === 'twoMakers') {
    // the belt piece between the Crusher and the job's machine becomes a Splitter, with a second machine and its own Dock to one side;
    // a Splitter takes from behind only, so the piece must run straight on from the Crusher
    const crusher = yard.machines.find((m) => m.kind === 'crusher');
    if (!crusher || crusher.dir !== gap.dir || crusher.x + DIR_DX[gap.dir] !== gap.x || crusher.y + DIR_DY[gap.dir] !== gap.y) return yard;
    for (const s of sides) {
      const m = { x: gap.x + DIR_DX[s], y: gap.y + DIR_DY[s] };
      const d = { x: m.x + DIR_DX[s], y: m.y + DIR_DY[s] };
      if (!free(m.x, m.y) || !free(d.x, d.y)) continue;
      const machines = yard.machines.map((q) => (q.x === gap.x && q.y === gap.y ? { ...q, kind: 'splitter' as MachineKind } : q));
      machines.push({ kind: JOB_MACHINE[yard.job.material], x: m.x, y: m.y, dir: s }, { kind: 'dock', x: d.x, y: d.y, dir: 0 });
      return { ...yard, machines, job, variant: v };
    }
    return yard;
  }
  // a Tuner already beside the job's machine
  for (const t of [0, 1, 2, 3] as Dir[]) {
    const x = maker.x + DIR_DX[t];
    const y = maker.y + DIR_DY[t];
    if (free(x, y)) return { ...yard, machines: [...yard.machines, { kind: 'tuner', x, y, dir: t }], job, variant: v }; // it points away: it carries nothing in
  }
  return yard;
}

/** How many stars a count has earned on a job: orders filled, or in a lesson, units shipped. */
export const starsFor = (job: Job, shipped: number): 0 | 1 | 2 | 3 => job.stars.filter((n) => shipped >= n).length as 0 | 1 | 2 | 3;

/** What a material sells for on this layout: the list price, or the job's price for its product. */
export const priceOf = (layout: Pick<Layout, 'premium' | 'premium2' | 'rate'>, mat: Material): number => {
  const base = layout.premium === mat || layout.premium2 === mat ? RULES.job.price : RULES.value[mat];
  return layout.rate ? Math.round((base * layout.rate) / 100) : base;
};
