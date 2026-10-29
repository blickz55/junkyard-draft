// Deterministic simulation types. No DOM, no Phaser.

/** v2 (2026-10-25): Plate Press machine + plate material; conveyor draft weight 34 → 30. */
/** v3 (rules-v3 branch): Tuner machine (adjacent processors hold one tick less) offered from round 3 through the tier table; Sieve exists as an experimental, never-offered kind. */
export const RULES_VERSION = 3; // rules-v3 branch (PLAN-v2): bumped on the first semantic change; v2 replays and saves are refused from here on

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
