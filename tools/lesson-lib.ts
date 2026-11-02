/**
 * A lesson played the way a person plays it, from the script alone: the same drops a pointer makes, so a part that would land
 * facing the wrong way shows here. Used by `tests/lessons.test.ts` and by the golden corpus.
 */
import { apply, newRun, type Action, type RunState } from '../game/src/sim/run';
import { dropActions } from '../game/src/render/placement';
import { plannedFacing } from '../game/src/render/guide';
import type { Lesson, Move } from '../game/src/content/lessons';

/** What a player does for one move of a script. */
export function actionsFor(s: RunState, m: Move): Action[] {
  switch (m.do) {
    case 'place':
      return dropActions(
        s,
        s.bin.find((q) => q.kind === m.kind)!,
        m.x,
        m.y,
        plannedFacing(s, m.kind, m.x, m.y),
      );
    case 'turn':
      return [{ t: 'rotate', id: s.layout.machines.find((q) => q.x === m.x && q.y === m.y)!.id }];
    case 'buy':
      return [{ t: 'buy' }];
    case 'sell':
      return [{ t: 'sell', id: s.bin.find((q) => q.kind === m.kind)!.id }];
  }
}
/** The whole lesson, up to the end of its last shift. */
export function playLesson(lesson: Lesson): RunState {
  const s = newRun(lesson.seed);
  lesson.shifts.forEach((shift, k) => {
    if (shift.pick) apply(s, { t: 'pick', i: s.offers.indexOf(shift.pick.kind) });
    for (const m of shift.moves) for (const a of actionsFor(s, m)) apply(s, a);
    apply(s, { t: 'run' });
    if (k < lesson.shifts.length - 1) apply(s, { t: 'next' });
  });
  return s;
}
