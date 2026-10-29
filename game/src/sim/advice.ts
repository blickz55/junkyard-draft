import { DIR_DX, DIR_DY, MACHINE_INFO, leftOf, rightOf } from './rules';
import type { Dir, Layout, Machine, MachineKind } from './types';

/** Directions (as travel directions into the machine) that a machine accepts items from; mirrors `accepts` in sim.ts. */
export function inputTravelDirs(kind: MachineKind, dir: Dir): Dir[] {
  switch (kind) {
    case 'hopper': case 'tuner': return [];
    case 'conveyor': return [dir, leftOf(dir), rightOf(dir)];
    case 'dock': return [0, 1, 2, 3];
    default: return [dir]; // splitter, crusher, furnace, press: only from behind
  }
}
/** Directions a machine pushes items out in (a splitter alternates left and right). */
export function outputDirs(kind: MachineKind, dir: Dir): Dir[] {
  if (kind === 'dock' || kind === 'tuner') return [];
  return kind === 'splitter' ? [leftOf(dir), rightOf(dir)] : [dir];
}

/** Player-facing text for a RunError message thrown by `apply` (never empty). */
export function explainRunError(message: string): string {
  const m = message.toLowerCase();
  if (m.includes('occupied')) return 'Cell occupied: drop it on an empty cell, or move the machine there first.';
  if (m.includes('out of bounds')) return 'Outside the grid: drop it on a cell of the factory floor.';
  if (m.includes('not building')) return 'Layout edits only work while you are building; wait for the round to finish.';
  if (m.includes('not drafting')) return 'You can only pick a machine while drafting.';
  if (m.includes('bad offer')) return 'That offer does not exist; pick one of the three cards.';
  if (m.includes('only bin parts')) return 'Only parts still in the bin can be sold; take a placed machine back to the bin first.';
  if (m.includes('action limit')) return 'This run has used up its edit budget: run the round and move on.';
  if (m.includes('round not finished')) return 'The round is still in progress.';
  if (m.includes('already used this round')) return 'One reroll per round: pick from these offers.';
  if (m.includes('cannot afford')) { const amt = message.match(/\$(\d+)/)?.[1]; return `A reroll costs $${amt ?? ''} from your score; you cannot afford one yet.`; }
  if (m.includes('no rerolls in the tutorial')) return 'The tutorial has fixed offers; rerolls come in normal runs.';
  if (m.includes('no machine')) return 'That machine is no longer there.';
  if (m.includes('malformed') || m.includes('unknown action')) return 'That action is not allowed.';
  return `Not allowed: ${message}`;
}

const at = (layout: Layout, x: number, y: number, ignoreId: number): Machine | undefined =>
  layout.machines.find((o) => o.x === x && o.y === y && o.id !== ignoreId);

/**
 * A legal placement that will not work as drawn: nothing feeds the machine, or nothing takes its output.
 * Returns a one-line warning, or null. Never refuses anything; the rules accept any geometry.
 */
export function placementWarning(layout: Layout, kind: MachineKind, x: number, y: number, dir: Dir, id: number): string | null {
  const name = MACHINE_INFO[kind].name;
  if (kind === 'tuner') {
    const touching = [[1, 0], [0, 1], [-1, 0], [0, -1]].some(([dx, dy]) => { const o = at(layout, x + dx, y + dy, id); return !!o && (o.kind === 'crusher' || o.kind === 'furnace' || o.kind === 'press'); });
    return touching ? null : 'A tuner only speeds up the crushers, furnaces and presses touching it; nothing here to tune yet.';
  }
  const ins = inputTravelDirs(kind, dir);
  if (ins.length && kind !== 'dock') {
    const fed = ins.some((t) => {
      const src = at(layout, x - DIR_DX[t], y - DIR_DY[t], id);
      return !!src && outputDirs(src.kind, src.dir).includes(t);
    });
    if (!fed) {
      const behind = at(layout, x - DIR_DX[dir], y - DIR_DY[dir], id);
      if (kind === 'conveyor') return 'This conveyor has nothing feeding it from behind or the sides yet.';
      if (behind && behind.kind !== 'dock') return `${name} takes items from behind only — the ${MACHINE_INFO[behind.kind].name.toLowerCase()} behind it does not point into it. Rotate one of them (R).`;
      return `${name} takes items from behind only, and nothing feeds it from there. Put a line ending behind its arrow, or rotate it (R).`;
    }
  }
  for (const o of outputDirs(kind, dir)) {
    const nx = x + DIR_DX[o], ny = y + DIR_DY[o];
    if (nx < 0 || ny < 0 || nx >= layout.width || ny >= layout.height) {
      if (kind !== 'splitter') return `${name} points off the grid, so its output goes nowhere. Rotate it (R).`;
    }
  }
  return null;
}
