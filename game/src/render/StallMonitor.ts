/**
 * The stall indicator's state machine (PLAN-v1 0.3.5; extracted from GameScene in production roadmap 0.9.4): nothing
 * shipped for STALL_TICKS while something is jammed → the first (lowest) blocking cell is flagged; the flag moves to a lower
 * cell without restarting the clock; it clears when something ships or nothing is jammed. Pure: the scene draws the mark.
 */
import { RULES } from '../sim/rules';
import type { MachineKind } from '../sim/types';
import { t } from '../content/strings';
import { machineName } from '../content/machines';

export const STALL_TICKS = 8;

export type StallChange = { kind: 'flag'; cell: number; x: number; y: number; /** true when the stall began now, false when the marker moved */ began: boolean } | { kind: 'clear' } | null;

export class StallMonitor {
  /** the flagged cell, null when none */
  cell: number | null = null;
  /** the sim tick the current stall was flagged at (-1 when none); read by the dev API so a test's answer never depends on how late it polls */
  flaggedAt = -1;
  /** tick of the last ship this round */
  lastShipTick = 0;
  constructor(private readonly width: number = RULES.gridWidth, private readonly ticks: number = STALL_TICKS) {}

  /** A new round: nothing shipped yet, nothing flagged. */
  reset() { this.cell = null; this.flaggedAt = -1; this.lastShipTick = 0; }
  /** Something shipped at this tick. */
  shipped(tick: number) { this.lastShipTick = tick; }
  /** After a tick's events: what the indicator should do now (null: nothing changed). */
  update(jammedNow: ReadonlySet<number>, tick: number): StallChange {
    if (jammedNow.size === 0 || tick - this.lastShipTick < this.ticks) {
      if (this.cell == null) return null;
      this.cell = null; this.flaggedAt = -1; return { kind: 'clear' };
    }
    let cell = Infinity; for (const c of jammedNow) if (c < cell) cell = c;
    if (cell === this.cell) return null;
    const began = this.cell == null;
    if (began) this.flaggedAt = tick; // the marker may move to a lower blocked cell later (the hopper once it is blocked too) without restarting the clock
    this.cell = cell;
    return { kind: 'flag', cell, x: cell % this.width, y: Math.floor(cell / this.width), began };
  }
}

/** The HUD's stall line for a flagged cell. */
export function stallText(kind: MachineKind | null, x: number, y: number, ticks: number = STALL_TICKS): string {
  const what = kind ? machineName(kind) : 'Item';
  return t('hint.stall', { what, pos: `${x + 1},${y + 1}`, state: kind === 'hopper' ? t('hint.stallBlocked') : t('hint.stallWaiting'), n: ticks });
}
