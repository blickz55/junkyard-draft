/**
 * What the live shift looks like, as pure functions (production roadmap 0.9.4, extracted from GameScene): a machine's
 * state frame while it works (0.4.4), where an item is drawn between two cells, the colour of a transform flash, and a
 * tick's events sorted for the renderer. render/SimView.ts applies these to sprites; nothing here knows Phaser.
 */
import type { Item, Material, MachineKind, SimEvent } from '../sim/types';
import type { SimState } from '../sim/sim';
import { RULES } from '../sim/rules';
import { P } from './palette';

/** A machine's look this frame: texture key, tint, scale factor, angle offset; a missing field leaves the sprite as it is. */
export interface MachineFrame { key?: string; tint?: number; scale?: number; angleOffset?: number }

/** State frames (0.4.4): a machine that holds an item shows it; idle machines are still so a jam stays visible. */
export function machineFrame(kind: MachineKind, sim: Pick<SimState, 'itemAt' | 'pressStore' | 'splitterToggle' | 'tick'>, cell: number, phase: number): MachineFrame {
  const held = sim.itemAt[cell];
  const busy = !!held && held.hold > 0;
  switch (kind) {
    case 'crusher': return { key: busy && sim.tick % 2 === 1 ? 'm-crusher-1' : 'm-crusher' };
    case 'furnace': return { tint: busy ? 0xffd9a0 : 0xffffff };
    case 'press': return { key: busy ? (held!.hold >= 2 ? 'm-press-1' : 'm-press-2') : 'm-press', tint: !busy && (sim.pressStore[cell] ?? 0) > 0 ? 0xcfe3ff : 0xffffff };
    case 'hopper': return { scale: sim.tick % RULES.hopperPeriod === 0 && phase < 0.3 ? 1.05 : 1 };
    case 'splitter': return { angleOffset: (sim.splitterToggle[cell] ?? 0) === 0 ? -4 : 4 };
    default: return {};
  }
}

/** Quadratic ease in and out, the same curve Phaser.Math.Easing.Quadratic.InOut draws. */
export const easeInOutQuad = (v: number): number => { v *= 2; return v < 1 ? 0.5 * v * v : -0.5 * ((v - 1) * (v - 3) - 1); };

/** Where an item is drawn: on its way from `from` (t in 0..1) when it moved this tick and motion is on, at rest otherwise; smaller while a machine holds it. */
export function itemPose(it: Item, tick: number, phase: number, reducedMotion: boolean, time: number): { from: number | null; t: number; scale: number } {
  const moving = !reducedMotion && it.movedAt === tick && it.from >= 0;
  return { from: moving ? it.from : null, t: moving ? easeInOutQuad(phase) : 1, scale: it.hold > 0 ? (reducedMotion ? 0.85 : 0.8 + 0.1 * Math.sin(time / 60)) : 1 };
}

/** The flash colour of a transform, by what was made. */
export const transformColour = (to: Material | undefined): number => (to === 'ingot' ? P.gold : to === 'slag' ? P.red : to === 'plate' ? P.plate : P.shards);

export interface TickDigest {
  /** value shipped per dock cell this tick (same-tick ships coalesce into their sum) */ ships: Map<number, number>;
  /** cells jammed this tick */ jammed: Set<number>;
  /** cells jammed now that had no mark before (one sound each) */ newJams: number[];
  transforms: { cell: number; to: Material | undefined }[];
  absorbs: number[];
  sounds: { ships: number[]; transforms: number[]; jams: number };
}

/** Sort a tick's events for the renderer; `ships` and `jammed` are reused containers (cleared here) so the hot path allocates little. */
export function digestTick(evs: readonly SimEvent[], marked: { has(cell: number): boolean }, ships: Map<number, number>, jammed: Set<number>): TickDigest {
  ships.clear(); jammed.clear();
  const d: TickDigest = { ships, jammed, newJams: [], transforms: [], absorbs: [], sounds: { ships: [], transforms: [], jams: 0 } };
  for (const e of evs) {
    if (e.kind === 'ship' && e.value != null) { ships.set(e.cell, (ships.get(e.cell) ?? 0) + e.value); d.sounds.ships.push(e.value); }
    else if (e.kind === 'transform') { d.sounds.transforms.push(e.to === 'ingot' ? 3 : e.to === 'plate' ? 2 : e.to === 'shards' ? 1 : 0); d.transforms.push({ cell: e.cell, to: e.to }); }
    else if (e.kind === 'absorb') d.absorbs.push(e.cell);
    else if (e.kind === 'jam') { if (!jammed.has(e.cell) && !marked.has(e.cell)) { d.newJams.push(e.cell); d.sounds.jams++; } jammed.add(e.cell); }
  }
  return d;
}
