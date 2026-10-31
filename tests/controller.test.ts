import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RoundController, type ControllerHooks } from '../game/src/render/RoundController';
import { newRun, apply, type Action } from '../game/src/sim/run';
import { RULES } from '../game/src/sim/rules';

/** Hooks that record every call and queue scheduled callbacks so the test can run them deliberately. */
function recorder() {
  const log: string[] = [];
  const queue: { ms: number; fn: () => void }[] = [];
  const saves: number[] = [];
  const hooks: ControllerHooks = {
    onTick: (evs) => {
      if (log[log.length - 1]?.startsWith('tick')) log[log.length - 1] = `tick×${Number(log[log.length - 1].split('×')[1] ?? 1) + 1}`;
      else log.push('tick×1');
      void evs;
    },
    onRunStart: () => log.push('runStart'),
    onPause: (p) => log.push(p ? 'pause' : 'resume'),
    onRoundEnd: (rec, visual) => log.push(`roundEnd:${rec.round}:$${rec.earned}:visual$${visual}`),
    onNextRound: () => log.push('nextRound'),
    onFinished: () => log.push('finished'),
    onStateChange: (a) => log.push(`state:${a ? a.t : 'history'}`),
    onReject: (a, m) => log.push(`reject:${a.t}:${m}`),
    onPlaybackDone: () => log.push('playbackDone'),
    persist: (_seed, actions) => saves.push(actions.length),
    schedule: (ms, fn) => queue.push({ ms, fn }),
  };
  const flush = () => {
    while (queue.length) queue.shift()!.fn();
  };
  return { hooks, log, queue, flush, saves };
}

test('controller: build → running → summary → build with ticks reported, the layout frozen while running, and saves on every accepted action', () => {
  const r = recorder();
  const c = new RoundController({ seed: 'classic-ctl-seed', fresh: true }, r.hooks);
  assert.equal(c.mode, 'build');
  assert.equal(c.run.phase, 'draft');
  assert.equal(c.pick(0), true);
  const part = c.run.bin[0];
  assert.equal(c.act({ t: 'place', id: part.id, x: 5, y: 4, dir: 0 }), true);
  assert.equal(c.canStartRun(), true);
  assert.equal(c.startRun(), true);
  assert.equal(c.mode, 'running');
  assert.equal(c.act({ t: 'rotate', id: part.id }), false, 'layout edits are refused while running');
  assert.equal(c.act({ t: 'unplace', id: part.id }), false);
  assert.equal(c.canUndo(), false, 'no undo while running');
  // advance in frame-sized steps at 1×: 170 ms per tick
  let ended = false;
  let frames = 0;
  while (!ended && frames < 10000) {
    ended = c.advance(16.7);
    frames++;
  }
  assert.equal(ended, true, 'the round ends from advance()');
  assert.equal(c.mode, 'summary');
  assert.equal(c.sim, null);
  assert.equal(c.run.rounds.length, 1);
  const ticks = r.log.filter((l) => l.startsWith('tick')).reduce((n, l) => n + Number(l.split('×')[1]), 0);
  assert.equal(ticks, RULES.ticksPerRound, 'every tick was reported once');
  const end = r.log.find((l) => l.startsWith('roundEnd'))!;
  assert.match(end, /^roundEnd:1:\$(\d+):visual\$\1$/, 'rendered earnings equal the authoritative result');
  assert.equal(c.nextRound(), 'build');
  assert.equal(c.mode, 'build');
  assert.equal(c.run.round, 2);
  assert.equal(c.run.phase, 'draft');
  assert.ok(r.log.includes('runStart') && r.log.includes('nextRound'));
  assert.deepEqual(r.saves, [1, 2, 3, 4], 'pick, place, run, next were each persisted (refused actions were not)');
  // finish the run quickly: finishRun() steps the rest in one call
  for (let round = 2; round <= RULES.rounds; round++) {
    c.pick(0);
    c.startRun();
    assert.equal(c.finishRun(), true);
    assert.equal(c.mode, 'summary');
    const res = c.nextRound();
    assert.equal(res, round === RULES.rounds ? 'finished' : 'build');
  }
  assert.equal(c.run.phase, 'finished');
  assert.equal(r.log[r.log.length - 1], 'finished');
});

test('controller: pause/resume, speed, undo/redo with history notifications, and rejections reported', () => {
  const r = recorder();
  const c = new RoundController({ seed: 'classic-ctl-seed-2', fresh: true }, r.hooks);
  c.pick(0);
  const part = c.run.bin[0];
  assert.equal(c.act({ t: 'place', id: part.id, x: 2, y: 2, dir: 0 }), false, 'occupied cell is refused');
  assert.ok(r.log.includes('reject:place:cell occupied'));
  c.act({ t: 'place', id: part.id, x: 5, y: 4, dir: 0 });
  c.act({ t: 'rotate', id: part.id });
  assert.equal(c.canUndo(), true);
  assert.equal(c.canRedo(), false);
  assert.equal(c.undo(), true);
  assert.equal(c.run.layout.machines.find((m) => m.id === part.id)?.dir, 0);
  assert.equal(c.canRedo(), true);
  assert.equal(c.redo(), true);
  assert.equal(c.run.layout.machines.find((m) => m.id === part.id)?.dir, 1);
  assert.equal(c.redo(), false, 'nothing left to redo');
  c.undo();
  c.act({ t: 'rotate', id: part.id });
  assert.equal(c.canRedo(), false, 'a new edit clears the redo stack');
  assert.ok(r.log.filter((l) => l === 'state:history').length >= 2, 'undo/redo notify as history changes');
  c.startRun();
  assert.equal(c.setPaused(true), true);
  assert.equal(c.mode, 'paused');
  assert.equal(c.advance(1000), false, 'paused: no ticks');
  assert.equal(c.setPaused(true), false, 'already paused');
  assert.equal(c.setPaused(false), true);
  assert.equal(c.mode, 'running');
  c.setSpeed(4);
  const before = r.log.length;
  c.advance(170); // one wall-clock tick at 4× = four sim ticks
  assert.equal(c.sim?.tick, 4);
  assert.ok(r.log.slice(before).some((l) => l.startsWith('tick')));
  assert.equal(c.finishRun(), true);
  assert.equal(c.finishRun(), false, 'already finished');
  assert.deepEqual(
    r.log.filter((l) => l === 'pause' || l === 'resume'),
    ['pause', 'resume'],
  );
});

test('controller: single step while paused (0.8.12): refused while building or running, one tick per call with onTick, the phase left at 1, the round ending normally on the last tick', () => {
  const r = recorder();
  const c = new RoundController({ seed: 'classic-ctl-seed-step', fresh: true }, r.hooks);
  const ticks = () => r.log.filter((l) => l.startsWith('tick')).reduce((n, l) => n + Number(l.split('×')[1] ?? 1), 0);
  assert.equal(c.stepTick(), false, 'build: nothing to step');
  c.pick(0);
  c.startRun();
  assert.equal(c.mode, 'running');
  assert.equal(c.stepTick(), false, 'running: stepping is a paused-only control');
  assert.equal(c.sim!.tick, 0);
  c.setPaused(true);
  assert.equal(c.stepTick(), false);
  assert.equal(c.sim!.tick, 1, 'one tick');
  assert.equal(c.tickPhase, 1, 'items drawn at rest in their new cells');
  assert.equal(c.stepTick(), false);
  assert.equal(c.stepTick(), false);
  assert.equal(c.sim!.tick, 3, 'three steps, three ticks');
  assert.equal(ticks(), 3, 'every step is reported like a live tick');
  assert.equal(c.mode, 'paused', 'still paused');
  assert.ok(r.log.includes('state:history'), 'the panel is told to refresh');
  let ended = false;
  for (let i = 3; i < RULES.ticksPerRound; i++) ended = c.stepTick();
  assert.equal(ended, true, 'the last step ends the round');
  assert.equal(c.mode, 'summary');
  assert.equal(c.run.rounds.length, 1);
  assert.equal(ticks(), RULES.ticksPerRound);
  assert.ok(
    r.log.some((l) => l.startsWith('roundEnd:1:')),
    'the round end is reported as after a live run',
  );
  assert.equal(c.stepTick(), false, 'summary: nothing to step');
});

test('controller: a watched replay plays itself through scheduled steps, never persists, and reports when done', () => {
  // record a legal run first
  const s = newRun('classic-ctl-replay');
  for (let round = 1; round <= RULES.rounds; round++) {
    apply(s, { t: 'pick', i: 0 });
    if (round === 1) {
      const p = s.bin[0];
      apply(s, { t: 'place', id: p.id, x: 5, y: 4, dir: 0 });
    }
    apply(s, { t: 'run' });
    apply(s, { t: 'next' });
  }
  const recorded: Action[] = s.actions.slice();
  const r = recorder();
  const c = new RoundController({ seed: 'classic-ctl-replay', fresh: true, replay: recorded, replayLabel: 'verified replay by tester' }, r.hooks);
  assert.equal(c.isPlayback, true);
  assert.equal(c.playbackPending, true);
  assert.deepEqual(
    c.replayRounds,
    s.rounds.map((x) => x.earned),
    "the original run's per-round earnings are known up front",
  );
  assert.equal(c.act({ t: 'pick', i: 0 }), true, 'the controller itself can act during playback (the scene ignores player input)');
  // rewind: build a fresh controller and drive the queue
  const r2 = recorder();
  const c2 = new RoundController({ seed: 'classic-ctl-replay', fresh: true, replay: recorded, replayLabel: 'x' }, r2.hooks);
  let safety = 0;
  c2.advanceReplay();
  while (c2.playbackPending && safety++ < 100) {
    if (c2.mode === 'running') c2.finishRun(); // the scene would animate; the test skips
    r2.flush();
  }
  assert.equal(c2.playbackPending, false);
  assert.equal(c2.run.phase, 'finished');
  assert.equal(c2.run.score, s.score, 'playback reproduces the recorded score');
  assert.deepEqual(r2.saves, [], 'playback never persists');
  assert.ok(r2.log.includes('playbackDone') && r2.log.includes('finished'));
  assert.equal(c2.speed, 4, 'runs play at 4× during playback');
});

test("controller: while watching, manual Space/advance cannot double the queue's own boundary (review F09), and callbacks scheduled before a stop are dropped", () => {
  const s = newRun('classic-ctl-space');
  for (let round = 1; round <= RULES.rounds; round++) {
    apply(s, { t: 'pick', i: 0 });
    if (round === 1) {
      const p = s.bin[0];
      apply(s, { t: 'place', id: p.id, x: 5, y: 4, dir: 0 });
    }
    apply(s, { t: 'run' });
    apply(s, { t: 'next' });
  }
  const r = recorder();
  const c = new RoundController({ seed: 'classic-ctl-space', fresh: true, replay: s.actions.slice(), replayLabel: 'x' }, r.hooks);
  let safety = 0;
  c.advanceReplay();
  while (c.playbackPending && safety++ < 200) {
    if (c.mode === 'running') c.finishRun();
    if (c.mode === 'summary') {
      assert.equal(c.nextRound(), null, 'a manual advance during playback is refused');
      assert.equal(c.startRun(), false);
    }
    if (c.mode === 'build') assert.equal(c.startRun(), false, 'a manual run start during playback is refused');
    r.flush();
  }
  assert.equal(c.playbackPending, false);
  assert.equal(c.run.rounds.length, RULES.rounds, 'exactly six rounds were recorded');
  assert.equal(c.run.score, s.score, 'the verified score is reproduced despite the extra key presses');
  assert.equal(c.run.phase, 'finished');
  // stale callbacks: stop a fresh playback while an advance is scheduled; flushing it must not act
  const r2 = recorder();
  const c2 = new RoundController({ seed: 'classic-ctl-space', fresh: true, replay: s.actions.slice(), replayLabel: 'x' }, r2.hooks);
  c2.advanceReplay(); // picks + places, starts the run, schedules the 4× speed
  const before = c2.run.actions.length;
  c2.stopReplay();
  r2.flush();
  assert.equal(c2.run.actions.length, before, 'nothing applied after stopReplay');
  assert.equal(c2.playbackPending, false);
});

test('controller: a damaged save starts fresh with a notice; a run saved mid-result resumes in summary mode', () => {
  const r = recorder();
  const bad = new RoundController({ seed: 'classic-ctl-save', fresh: false, actions: [{ t: 'pick', i: 9 } as Action] }, r.hooks);
  assert.match(bad.resumeNotice ?? '', /couldn't be picked up/);
  assert.equal(bad.run.actions.length, 0);
  const s = newRun('classic-ctl-save');
  apply(s, { t: 'pick', i: 0 });
  apply(s, { t: 'run' });
  const resumed = new RoundController({ seed: 'classic-ctl-save', fresh: false, actions: s.actions }, r.hooks);
  assert.equal(resumed.mode, 'summary', 'a save taken after run but before next opens on the summary');
  assert.equal(resumed.nextRound(), 'build');
});
