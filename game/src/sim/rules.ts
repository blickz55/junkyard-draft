import type { Dir, MachineKind, Material } from './types';

/** Machines that hold an item for a fixed number of ticks (the only keys RULES.process may have). */
export type ProcessorKind = 'crusher' | 'furnace' | 'press';

/** Tuning constants for rules version 8. Changing any value requires bumping RULES_VERSION. */
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
  /** Reroll (rules v3, PLAN-v2 0.5.4): once per round during the draft, the three offers are redrawn for this much, paid from the running score (refused below it; never in the tutorial). */
  rerollCost: 40,
  /** A belt from the shelf (rules v5): bought while building, paid from the running score like new offers, so every belt shows on the board. More than `sellValue`, or buying and selling would pay. */
  beltCost: 20,
  /** The slots the shelf has: a belt can only be bought into a free one. */
  shelfSlots: 7,
  /** Draft offer weights (relative). Conveyors are bought, not offered (rules v5): one card in five was a belt and it was taken about once in two games. */
  draftWeights: { conveyor: 0, crusher: 18, furnace: 15, splitter: 15, hopper: 10, press: 10, dock: 8, sieve: 0, tuner: 10 } as Record<MachineKind, number>,
  /** Round-tiered offers (PLAN-v2 0.5.3): a kind listed here is offered only from that round on; everything else from round 1. Seed-fair: depends on (seed, round) only. */
  offerFromRound: { tuner: 3 } as Partial<Record<MachineKind, number>>,
  /**
   * Late-round offer guarantee (production roadmap 0.9.6, a candidate under study): in the rounds listed, a draft that would offer none of
   * the kinds replaces its last card with one of them, drawn from the same stream. Seed-fair like round 1's crusher. Rules v3: no rounds,
   * so nothing changes; shipping it means listing rounds and bumping RULES_VERSION (the owner's go/no-go, docs/DESIGN.md).
   */
  lateOfferGuarantee: { rounds: [] as number[], kinds: ['hopper', 'crusher'] as MachineKind[] },
  /** A Tuner shortens the hold of every orthogonally adjacent processor, and a Hopper's period, by this many ticks (never below one tick; two Tuners do not stack). It carries a belt's load as well, so it can go in the line itself. */
  tunerBonus: 1,
  /** A Tuner only affects processors whose normal hold is at least this many ticks (2 = every processor; 3 = the furnace alone today). */
  tunerMinHold: 2,
  /**
   * Experimental machines (PLAN-v2 0.5.2): present in the simulation so fixtures and tests can measure them, but with draft
   * weight 0 and no card until a written go/no-go in docs/DESIGN.md admits them (0.5.3 flips the weight and the tier table).
   */
  experimental: { sieve: false }, // 0.5.2 fixture: no convincing benefit on the same inventory (docs/DESIGN.md); kept in the sim for the record, never offered
  /** How a seed builds a yard (rules v4, game/src/sim/yard.ts). `shapes`: relative odds of the belt's shape; `roomRows`/`roomColumns`: free rows or columns kept on one side of it; `shelf`: the parts every game starts with, enough to turn two corners. */
  yard: {
    shapes: { straight: 2, bend: 4, zigzag: 3 } as Record<'straight' | 'bend' | 'zigzag', number>,
    roomRows: 2,
    roomColumns: 3,
    straightPieces: 3,
    rubbleMin: 2,
    rubbleMax: 4,
    shelf: ['conveyor', 'conveyor', 'conveyor', 'conveyor'] as MachineKind[],
  },
  /**
   * The job (rules v4, orders in v6): what a yard is paid to deliver. Its product sells for `price` here. Every yard opens with the job's
   * line already running, so every pick is a choice, and each shift has an `order`: money to earn in that shift. Each order filled raises
   * every price by `raise` percent for the rest of the game; a missed order costs the raise and nothing else. `stars` are orders filled.
   * The table is tools/fun-orders.ts's, chosen on one set of yards and checked on another (docs/DESIGN.md).
   */
  job: {
    price: 24,
    weights: { ingot: 2, plate: 1 } as Record<'ingot' | 'plate', number>,
    orders: { ingot: [450, 800, 1400, 2150, 3200, 4600], plate: [380, 500, 1300, 1900, 3000, 4300] } as Record<'ingot' | 'plate', readonly number[]>,
    raise: 25,
    stars: [2, 4, 6] as readonly [number, number, number],
    /** the shift the other product starts selling at the job's price: a finished line has a new customer */
    secondBuyerFrom: 4,
    /** the deal on a job's yard: the job's own machine in place of `job`, the other product's in place of `other`. A Hopper comes with its Crusher and the job's machine with a Splitter, so one card can always widen the line. */
    deal: { job: 20, hopper: 20, tuner: 14, other: 10, dock: 8 },
    tunerFrom: 2,
  },
  /** Starter layout machine kinds (the classic yard, rules v1 to v3). */
  starter: [
    { kind: 'hopper', x: 1, y: 2, dir: 0 },
    { kind: 'conveyor', x: 2, y: 2, dir: 0 },
    { kind: 'conveyor', x: 3, y: 2, dir: 0 },
    { kind: 'conveyor', x: 4, y: 2, dir: 0 },
    { kind: 'dock', x: 5, y: 2, dir: 0 },
  ] as { kind: MachineKind; x: number; y: number; dir: Dir }[],
} as const;

/** Every machine kind the simulation knows (the names and blurbs a player reads live in game/src/content/machines.ts, 0.9.0). */
export const MACHINE_KINDS: readonly MachineKind[] = ['hopper', 'conveyor', 'splitter', 'crusher', 'furnace', 'press', 'dock', 'tuner', 'sieve'];

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
export const opposite = (d: Dir): Dir => ((d + 2) % 4) as Dir;
export const rotateCW = (d: Dir): Dir => ((d + 1) % 4) as Dir;
export const leftOf = (d: Dir): Dir => ((d + 3) % 4) as Dir;
export const rightOf = (d: Dir): Dir => ((d + 1) % 4) as Dir;
