/**
 * Undo / redo over the build phase (PLAN-v1 0.3.3). The replay stays a flat list of final actions: undo
 * removes the last layout edit and re-derives the state from seed + remaining actions (cheap: the sim is
 * deterministic), so an undone rotation restores the previous facing exactly and the exported replay still
 * verifies. Nothing is undone across a run, a draft pick or a round boundary.
 */
import { apply, replay, type Action, type RunState } from './run';
import { RULES_VERSION } from './types';

export const UNDOABLE: ReadonlySet<Action['t']> = new Set<Action['t']>(['place', 'unplace', 'rotate', 'sell']);

/** True while building and the last recorded action is a layout edit of this build phase. */
export function canUndo(s: RunState): boolean {
  return s.phase === 'build' && s.actions.length > 0 && UNDOABLE.has(s.actions[s.actions.length - 1].t);
}

/** The state with its last build edit removed, plus the removed action; null when nothing can be undone. */
export function undo(s: RunState): { state: RunState; undone: Action } | null {
  if (!canUndo(s)) return null;
  const undone = s.actions[s.actions.length - 1];
  return { state: replay(s.seed, s.actions.slice(0, -1), RULES_VERSION), undone };
}

/** Re-applies an undone action in place; false when the rules no longer accept it (the state moved on). */
export function redo(s: RunState, a: Action): boolean {
  try {
    apply(s, a);
    return true;
  } catch {
    return false;
  }
}
