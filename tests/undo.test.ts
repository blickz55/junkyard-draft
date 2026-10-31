import { test } from 'node:test';
import assert from 'node:assert/strict';
import { apply, newRun, RunError } from '../game/src/sim/run';
import { canUndo, undo, redo } from '../game/src/sim/undo';
import { exportReplay, verifyReplay } from '../game/src/sim/replay';
import { RULES } from '../game/src/sim/rules';

const snapshot = (s: ReturnType<typeof newRun>) =>
  JSON.stringify({ layout: s.layout, bin: s.bin, score: s.score, sold: s.sold, phase: s.phase, round: s.round });

test('undo: place → rotate → undo → undo restores the pre-place state; the exported replay verifies', () => {
  let s = newRun('classic-undo-seed');
  assert.equal(canUndo(s), false, 'nothing to undo while drafting');
  apply(s, { t: 'pick', i: 0 });
  assert.equal(canUndo(s), false, 'a draft pick is not a build edit');
  assert.equal(undo(s), null);
  const before = snapshot(s);
  const part = s.bin[0];
  apply(s, { t: 'place', id: part.id, x: 5, y: 4, dir: 0 });
  apply(s, { t: 'rotate', id: part.id });
  assert.equal(s.layout.machines.find((m) => m.id === part.id)?.dir, 1);
  const u1 = undo(s);
  assert.ok(u1);
  s = u1.state;
  assert.equal(u1.undone[0].t, 'rotate');
  assert.equal(s.layout.machines.find((m) => m.id === part.id)?.dir, 0, 'undoing a rotation restores the previous facing');
  const u2 = undo(s);
  assert.ok(u2);
  s = u2.state;
  assert.equal(u2.undone[0].t, 'place');
  assert.equal(snapshot(s), before, 'two undos give back the pre-place layout, bin and score');
  assert.equal(s.actions.length, 1, 'the replay is a flat list of the actions that remain (just the pick)');
  assert.equal(canUndo(s), false);
  // redo both, then finish the run: the replay must still verify with the same score
  assert.equal(redo(s, u2.undone[0]), true);
  assert.equal(redo(s, u1.undone[0]), true);
  assert.equal(s.layout.machines.find((m) => m.id === part.id)?.dir, 1);
  for (let r = 1; r <= RULES.rounds; r++) {
    if (r > 1) apply(s, { t: 'pick', i: 0 });
    apply(s, { t: 'run' });
    apply(s, { t: 'next' });
  }
  assert.equal(s.phase, 'finished');
  const v = verifyReplay(exportReplay(s));
  assert.deepEqual(
    { ok: v.ok, score: v.score, finished: v.finished },
    { ok: true, score: s.score, finished: true },
    'exported replay re-simulates to the same score',
  );
});

test('undo never crosses a run or a sell boundary incorrectly; stale redo is refused', () => {
  const s = newRun('classic-undo-seed-2');
  apply(s, { t: 'pick', i: 0 });
  const part = s.bin[0];
  const scoreBefore = s.score;
  apply(s, { t: 'sell', id: part.id });
  assert.equal(s.score, scoreBefore + RULES.sellValue);
  const u = undo(s);
  assert.ok(u);
  assert.equal(u.state.score, scoreBefore, 'undoing a sell refunds it');
  assert.equal(u.state.bin.length, 1, 'and the part is back in the bin');
  // run the round: the edits before the run are frozen
  const t = u.state;
  apply(t, { t: 'place', id: t.bin[0].id, x: 5, y: 4, dir: 0 });
  apply(t, { t: 'run' });
  assert.equal(canUndo(t), false, 'nothing to undo once the round has run');
  apply(t, { t: 'next' });
  apply(t, { t: 'pick', i: 0 });
  assert.equal(canUndo(t), false, "the previous round's place is not undoable from the next build phase");
  // a redo whose target no longer fits is refused without changing state
  const occupied = { t: 'place' as const, id: t.bin[0].id, x: 5, y: 4, dir: 0 as const };
  const snap = snapshot(t);
  assert.equal(redo(t, occupied), false, "cell occupied by the previous round's part");
  assert.equal(snapshot(t), snap);
  assert.throws(() => apply(t, occupied), RunError);
});
