// Deterministic simulation types. No DOM, no Phaser.

/** v2 (2026-10-25): Plate Press machine + plate material; conveyor draft weight 34 → 30. */
/** v3 (rules-v3 branch): Tuner machine (adjacent processors hold one tick less) offered from round 3 through the tier table; Sieve exists as an experimental, never-offered kind. */
/** v4 (owner playtest, 2026-10-31): the seed builds the yard (belt shape, rubble, job, shelf), the job's product sells for the job's price, the job's machine is guaranteed in shift 2, the lesson opens with a broken belt. */
/** v6 (the fun card and the agent panels, 2026-11-02): a job's yard opens with its line running; orders each shift, each one filled raising every price; a Hopper card brings a Crusher and the job's machine a Splitter; a Splitter sends things ahead as well as to the sides; machines take from the sides as well as from behind; a second buyer from shift 4. */
/** v7 (2026-11-02): the orders priced against players who follow the lit spots: a novice's first star, Sal's two, and a third that takes more than following them. */
/** v8 (the third panel, 2026-11-02): a Tuner can stand in the line, carrying what a belt carries, and speeds a Hopper too; a yard's first line leaves a belt between the Crusher and the job's machine. */
export const RULES_VERSION = 8; // bumped on every semantic change; older replays and saves are refused from here on

export type MachineKind = 'hopper' | 'conveyor' | 'splitter' | 'crusher' | 'furnace' | 'press' | 'dock' | 'sieve' | 'tuner';
export type Material = 'scrap' | 'shards' | 'plate' | 'ingot' | 'slag';
/** Facing: 0=east, 1=south, 2=west, 3=north (clockwise). */
export type Dir = 0 | 1 | 2 | 3;

export interface Machine {
  id: number;
  kind: MachineKind;
  x: number;
  y: number;
  dir: Dir;
}

export interface Item {
  id: number;
  mat: Material;
  /** cell index the item occupies */
  cell: number;
  /** ticks remaining before a processing machine releases it (0 when free to move) */
  hold: number;
  /** tick the item last moved (render uses it for interpolation) */
  movedAt: number;
  /** previous cell (for interpolation), -1 if spawned this tick */
  from: number;
}

export interface Layout {
  width: number;
  height: number;
  machines: Machine[];
  /** cell indices nothing can be built on (rules v4; absent means none) */
  rubble?: readonly number[];
  /** the job's product: it sells for RULES.job.price on this layout (rules v4; absent means none) */
  premium?: Material;
  /** the second buyer (rules v6): another product at the job's price, this shift */
  premium2?: Material;
  /** what every price is at this shift, in percent (rules v6: orders filled raise it; absent means 100) */
  rate?: number;
}

/** `absorb`: a press took a shard into its store (the item ceases to exist; the next shard becomes a plate). */
export type EventKind = 'spawn' | 'move' | 'transform' | 'absorb' | 'ship' | 'jam';
export interface SimEvent {
  tick: number;
  kind: EventKind;
  cell: number;
  itemId?: number;
  from?: Material;
  to?: Material;
  value?: number;
}

export interface CellStats {
  processed: number;
  shipped: number;
  earned: number;
  jammedTicks: number;
  spawned: number;
  blockedTicks: number;
  /** items that entered this cell */
  passed: number;
  /** shards still stored in a press when the round ended (lost; shown on its badge) */
  stored: number;
  /** items whose hold a Tuner in this cell shortened (rules v3) */
  tuned: number;
}

export interface RunResult {
  earned: number;
  shipped: Record<Material, number>;
  spawned: number;
  /** items consumed by presses (not shipped, not in transit) */
  absorbed: number;
  ticks: number;
  cellStats: Record<number, CellStats>;
  events: SimEvent[];
}
