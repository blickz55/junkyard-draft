// production roadmap 0.9.4: the funnel's observer on the controller hooks (extracted from GameScene).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GameTelemetry, rejectReason } from '../game/src/render/GameTelemetry';
import type { ControllerHooks } from '../game/src/render/RoundController';
import type { RoundRecord } from '../game/src/sim/run';

function setup(watching = false, seed = 'seed-1') {
  const tracked: string[] = [];
  const inner: string[] = [];
  const hooks: ControllerHooks = {
    onStateChange: (a) => inner.push(`state:${a ? a.t : 'history'}`),
    onReject: (a, m) => inner.push(`reject:${a.t}:${m}`),
    onRunStart: () => inner.push('runStart'),
    onRoundEnd: (rec) => inner.push(`roundEnd:${rec.round}`),
    onFinished: () => inner.push('finished'),
    onPause: (p) => inner.push(`pause:${p}`),
  };
  const tele = new GameTelemetry(
    {
      track: (name, props) => {
        tracked.push(props ? `${name} ${JSON.stringify(props)}` : name);
      },
    },
    { watching: () => watching, seed: () => seed, round: () => 3 },
  );
  return { tracked, inner, wrapped: tele.observe(hooks), tele };
}
const rec = (round: number, earned: number): RoundRecord => ({ round, earned }) as RoundRecord;

test("game telemetry: accepted actions, refusals, round start and end and the finish are tracked, then the scene's hooks run", () => {
  const s = setup();
  s.wrapped.onStateChange?.({ t: 'pick', i: 0 });
  s.wrapped.onStateChange?.({ t: 'place', id: 1, x: 0, y: 0, dir: 0 });
  s.wrapped.onStateChange?.({ t: 'rotate', id: 1 });
  s.wrapped.onStateChange?.({ t: 'reroll' });
  s.wrapped.onStateChange?.(null);
  s.wrapped.onReject?.({ t: 'place', id: 1, x: 0, y: 0, dir: 0 }, 'cell occupied');
  s.wrapped.onReject?.({ t: 'rotate', id: 1 }, 'not building');
  s.wrapped.onRunStart?.();
  s.wrapped.onRoundEnd?.(rec(1, 120), 120);
  s.wrapped.onPause?.(true);
  s.wrapped.onFinished?.();
  assert.deepEqual(s.tracked, [
    'first_draft_pick',
    'first_place_attempt',
    'first_rotate',
    'reroll_used {"n":3}',
    'first_place_attempt',
    'first_place_rejected {"reason":"occupied"}',
    'first_run_start',
    'round_complete {"n":1}',
    'first_run_complete {"money":120}',
    'game_complete {"mode":"seed"}',
  ]);
  assert.deepEqual(s.inner, [
    'state:pick',
    'state:place',
    'state:rotate',
    'state:reroll',
    'state:history',
    'reject:place:cell occupied',
    'reject:rotate:not building',
    'runStart',
    'roundEnd:1',
    'pause:true',
    'finished',
  ]);
  s.tele.undoUsed();
  s.tele.tutorialStep(0, 1);
  s.tele.tutorialStep(1, 2);
  s.tele.tutorialStep(6, 0);
  assert.deepEqual(s.tracked.slice(10), [
    'undo_used',
    'tutorial_step_start {"n":1}',
    'tutorial_step_complete {"n":1}',
    'tutorial_step_start {"n":2}',
    'tutorial_step_complete {"n":6}',
  ]);
});

test('game telemetry: watching a recording tracks nothing but the finish, as a replay; a daily seed finishes as daily', () => {
  const w = setup(true, 'daily-2026-10-30-abcdefgh');
  w.wrapped.onStateChange?.({ t: 'pick', i: 0 });
  w.wrapped.onRunStart?.();
  w.wrapped.onRoundEnd?.(rec(1, 50), 50);
  w.wrapped.onFinished?.();
  assert.deepEqual(w.tracked, ['game_complete {"mode":"replay"}']);
  assert.deepEqual(w.inner, ['state:pick', 'runStart', 'roundEnd:1', 'finished'], 'the scene still hears every hook');
  const d = setup(false, 'daily-2026-10-30-abcdefgh');
  d.wrapped.onFinished?.();
  assert.deepEqual(d.tracked, ['game_complete {"mode":"daily"}']);
  assert.equal(rejectReason('Cell occupied by a conveyor'), 'occupied');
  assert.equal(rejectReason('out of bounds'), 'out_of_bounds');
  assert.equal(rejectReason('frozen'), 'other');
});
