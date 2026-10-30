/**
 * Placement geometry (what feeds what) for the advice the player reads. Pure and browser-free: the sentences live in
 * game/src/content/advice.ts (0.9.0); this module only answers with what is wrong.
 */
import { DIR_DX, DIR_DY, leftOf, rightOf } from './rules';
import type { Dir, Layout, Machine, MachineKind } from './types';

/** Directions (as travel directions into the machine) that a machine accepts items from; mirrors `accepts` in sim.ts. */
export function inputTravelDirs(kind: MachineKind, dir: Dir): Dir[] {
  switch (kind) {
    case 'hopper':
    case 'tuner':
      return [];
    case 'conveyor':
      return [dir, leftOf(dir), rightOf(dir)];
    case 'dock':
      return [0, 1, 2, 3];
    default:
      return [dir]; // splitter, crusher, furnace, press: only from behind
  }
}
/** Directions a machine pushes items out in (a splitter alternates left and right). */
export function outputDirs(kind: MachineKind, dir: Dir): Dir[] {
  if (kind === 'dock' || kind === 'tuner') return [];
  return kind === 'splitter' ? [leftOf(dir), rightOf(dir)] : [dir];
}

const at = (layout: Layout, x: number, y: number, ignoreId: number): Machine | undefined =>
  layout.machines.find((o) => o.x === x && o.y === y && o.id !== ignoreId);

export type PlacementIssue =
  { kind: 'tuner-alone' } | { kind: 'conveyor-unfed' } | { kind: 'behind-not-facing'; behind: MachineKind } | { kind: 'unfed' } | { kind: 'off-grid' };

/**
 * A legal placement that will not work as drawn: nothing feeds the machine, or nothing takes its output. Answers with
 * what is wrong; null when it looks fine. Never refuses anything; the rules accept any geometry.
 */
export function placementIssue(layout: Layout, kind: MachineKind, x: number, y: number, dir: Dir, id: number): PlacementIssue | null {
  if (kind === 'tuner') {
    const touching = [
      [1, 0],
      [0, 1],
      [-1, 0],
      [0, -1],
    ].some(([dx, dy]) => {
      const o = at(layout, x + dx, y + dy, id);
      return !!o && (o.kind === 'crusher' || o.kind === 'furnace' || o.kind === 'press');
    });
    return touching ? null : { kind: 'tuner-alone' };
  }
  const ins = inputTravelDirs(kind, dir);
  if (ins.length && kind !== 'dock') {
    const fed = ins.some((t) => {
      const src = at(layout, x - DIR_DX[t], y - DIR_DY[t], id);
      return !!src && outputDirs(src.kind, src.dir).includes(t);
    });
    if (!fed) {
      const behind = at(layout, x - DIR_DX[dir], y - DIR_DY[dir], id);
      if (kind === 'conveyor') return { kind: 'conveyor-unfed' };
      if (behind && behind.kind !== 'dock') return { kind: 'behind-not-facing', behind: behind.kind };
      return { kind: 'unfed' };
    }
  }
  for (const o of outputDirs(kind, dir)) {
    const nx = x + DIR_DX[o],
      ny = y + DIR_DY[o];
    if (nx < 0 || ny < 0 || nx >= layout.width || ny >= layout.height) {
      if (kind !== 'splitter') return { kind: 'off-grid' };
    }
  }
  return null;
}
