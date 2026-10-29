import type { Dir, MachineKind, Material } from './types';

/** Machines that hold an item for a fixed number of ticks (the only keys RULES.process may have). */
export type ProcessorKind = 'crusher' | 'furnace' | 'press';

/** Tuning constants for rules version 3 (rules-v3 branch). Changing any value requires bumping RULES_VERSION. */
export const RULES = {
  gridWidth: 8,
  gridHeight: 6,
  ticksPerRound: 80,
  rounds: 6,
  /** hopper emits one scrap every N ticks */
  hopperPeriod: 2,
  /** processing time in ticks (item is held, then released when output is free) */
  process: { crusher: 2, furnace: 3, press: 2 } satisfies Record<ProcessorKind, number>,
  /** shards a press stores before it outputs one plate */
  pressShards: 2,
  value: { scrap: 1, shards: 3, plate: 8, ingot: 12, slag: 1 } as Record<Material, number>,
  /** money for selling an unwanted drafted part from the bin (never a placed machine) */
  sellValue: 10,
  /** Draft offer weights (relative). */
  draftWeights: { conveyor: 30, crusher: 18, furnace: 15, splitter: 15, hopper: 10, press: 10, dock: 8, sieve: 0 } as Record<MachineKind, number>,
  /**
   * Experimental machines (PLAN-v2 0.5.2): present in the simulation so fixtures and tests can measure them, but with draft
   * weight 0 and no card until a written go/no-go in docs/DESIGN.md admits them (0.5.3 flips the weight and the tier table).
   */
  experimental: { sieve: false }, // 0.5.2 fixture: no convincing benefit on the same inventory (docs/DESIGN.md); kept in the sim for the record, never offered
  /** Starter layout machine kinds. */
  starter: [
    { kind: 'hopper', x: 1, y: 2, dir: 0 },
    { kind: 'conveyor', x: 2, y: 2, dir: 0 },
    { kind: 'conveyor', x: 3, y: 2, dir: 0 },
    { kind: 'conveyor', x: 4, y: 2, dir: 0 },
    { kind: 'dock', x: 5, y: 2, dir: 0 },
  ] as { kind: MachineKind; x: number; y: number; dir: Dir }[],
} as const;

export const MACHINE_INFO: Record<MachineKind, { name: string; blurb: string }> = {
  hopper: { name: 'Scrap Hopper', blurb: 'Drops a lump of scrap forward every 2 ticks. Has no input.' },
  conveyor: { name: 'Conveyor', blurb: 'Carries items forward. Accepts from behind or either side.' },
  splitter: { name: 'Splitter', blurb: 'Takes from behind, alternates output left and right. Doubles a line.' },
  crusher: { name: 'Crusher', blurb: 'Scrap → Shards ($3). Takes 2 ticks. Other materials pass through.' },
  furnace: { name: 'Furnace', blurb: 'Shards → Ingot ($12). Raw scrap melts to Slag ($1). Takes 3 ticks.' },
  press: { name: 'Plate Press', blurb: 'Two Shards → one Plate ($8). Takes 2 ticks and halves the traffic behind it. Other materials pass through.' },
  dock: { name: 'Shipping Dock', blurb: 'Accepts items from any side and sells them for their value.' },
  sieve: { name: 'Sieve', blurb: 'Takes from behind. Raw scrap passes forward; shards, plates, ingots and slag turn right. A blocked exit waits.' },
};

/** Processing machines hold an item for RULES.process[kind] ticks. */
export const isProcessor = (kind: MachineKind): kind is ProcessorKind => kind === 'crusher' || kind === 'furnace' || kind === 'press';

/** Material transformation when an item enters a processing machine (for a press: the shard that completes a plate). */
export function transform(kind: MachineKind, mat: Material): Material {
  if (kind === 'crusher') return mat === 'scrap' ? 'shards' : mat;
  if (kind === 'furnace') return mat === 'shards' ? 'ingot' : mat === 'scrap' ? 'slag' : mat;
  if (kind === 'press') return mat === 'shards' ? 'plate' : mat;
  return mat;
}

export const DIR_DX: readonly number[] = [1, 0, -1, 0];
export const DIR_DY: readonly number[] = [0, 1, 0, -1];
export const opposite = (d: Dir): Dir => (((d + 2) % 4) as Dir);
export const rotateCW = (d: Dir): Dir => (((d + 1) % 4) as Dir);
export const leftOf = (d: Dir): Dir => (((d + 3) % 4) as Dir);
export const rightOf = (d: Dir): Dir => (((d + 1) % 4) as Dir);
