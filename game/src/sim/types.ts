// Deterministic simulation types. No DOM, no Phaser.

export const RULES_VERSION = 1;

export type MachineKind = 'hopper' | 'conveyor' | 'splitter' | 'crusher' | 'furnace' | 'dock';
export type Material = 'scrap' | 'shards' | 'ingot' | 'slag';
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

export type EventKind = 'spawn' | 'move' | 'transform' | 'ship' | 'jam';
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
}

export interface RunResult {
  earned: number;
  shipped: Record<Material, number>;
  spawned: number;
  ticks: number;
  cellStats: Record<number, CellStats>;
  events: SimEvent[];
}
