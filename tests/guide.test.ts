// The coach (docs/UX-STANDARD.md): one instruction at a time and what to touch, as a pure function of the run.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { apply, newRun, TUTORIAL_SEED, type Action } from '../game/src/sim/run';
import { TUTORIAL_GAP } from '../game/src/sim/yard';
import { hintFor, lessonStep, type Guidance } from '../game/src/render/guide';
import { dropActions, smartFacing } from '../game/src/render/placement';

type Run = ReturnType<typeof newRun>;
const ctx = (mode = 'build', tutorial = false) => ({ tutorial, touch: false, watching: false, mode });
const shelf = (s: Run, k: string) => s.bin.find((m) => m.kind === k)!;
const doAll = (s: Run, actions: Action[]) => actions.forEach((a) => apply(s, a));
const drop = (s: Run, kind: string, x: number, y: number) => doAll(s, dropActions(s, shelf(s, kind), x, y));
const spotKinds = (g: { spots: Guidance['spots'] }) => g.spots.map((p) => p.kind);

test('the lesson: close the gap, start, then one machine a shift, then the first real choice; every step lights what it talks about', () => {
  const s = newRun(TUTORIAL_SEED);
  assert.equal(s.phase, 'build', 'the lesson opens on the build: the first thing a player does is touch the belt');
  let g = lessonStep(s);
  assert.match(g.text, /gap/);
  assert.deepEqual(g.spots, [
    { kind: 'shelf', i: 0 },
    { kind: 'cell', ...TUTORIAL_GAP },
  ]);
  assert.match(lessonStep(s, true).text, /^The belt has a gap\. Tap/, 'a finger reads tap, not drag');
  // the conveyor dropped in the gap turns the corner by itself
  drop(s, 'conveyor', TUTORIAL_GAP.x, TUTORIAL_GAP.y);
  g = lessonStep(s);
  assert.match(g.text, /Start the shift/);
  assert.deepEqual(spotKinds(g), ['run']);
  apply(s, { t: 'run' });
  g = lessonStep(s);
  assert.match(g.text, /reached the dock/);
  assert.deepEqual(spotKinds(g), ['next']);
  apply(s, { t: 'next' });
  // shift 2: the crusher
  g = lessonStep(s);
  assert.match(g.text, /Pick the Crusher/);
  assert.deepEqual(g.spots, [{ kind: 'offer', i: 0 }]);
  apply(s, { t: 'pick', i: 0 });
  g = lessonStep(s);
  assert.match(g.text, /lit belt piece/);
  assert.deepEqual(spotKinds(g), ['shelf', 'cell']);
  const c = g.spots[1] as { x: number; y: number };
  drop(s, 'crusher', c.x, c.y);
  assert.match(lessonStep(s).text, /Shards sell for/);
  apply(s, { t: 'run' });
  apply(s, { t: 'next' });
  // shift 3: the furnace, after the crusher
  assert.match(lessonStep(s).text, /Pick the Furnace/);
  apply(s, { t: 'pick', i: 0 });
  g = lessonStep(s);
  const f = g.spots[1] as { x: number; y: number };
  assert.ok(f.x > c.x || f.y > c.y, 'the lit piece is after the crusher');
  drop(s, 'furnace', f.x, f.y);
  assert.match(lessonStep(s).text, /Ingots pay/);
  apply(s, { t: 'run' });
  assert.ok(s.rounds[2].result.shipped.ingot > 0, 'following the lesson ships ingots');
  assert.match(lessonStep(s).text, /fill the bar/);
  apply(s, { t: 'next' });
  // shift 4: a real choice
  g = lessonStep(s);
  assert.match(g.text, /first real choice/);
  assert.deepEqual(
    g.spots,
    s.offers.map((_, i) => ({ kind: 'offer', i })),
  );
});

test('the lesson answers a player who did it wrong: a part facing the wrong way, a furnace before the crusher', () => {
  const s = newRun(TUTORIAL_SEED);
  apply(s, { t: 'place', id: s.bin[0].id, x: TUTORIAL_GAP.x, y: TUTORIAL_GAP.y, dir: 3 });
  let g = lessonStep(s);
  assert.match(g.text, /Tap it to turn it/);
  assert.deepEqual(g.spots, [{ kind: 'cell', ...TUTORIAL_GAP }]);
  const gap = () => s.layout.machines.find((m) => m.x === TUTORIAL_GAP.x && m.y === TUTORIAL_GAP.y)!;
  apply(s, { t: 'rotate', id: gap().id });
  apply(s, { t: 'rotate', id: gap().id });
  assert.match(lessonStep(s).text, /Start the shift/);
  apply(s, { t: 'run' });
  apply(s, { t: 'next' });
  apply(s, { t: 'pick', i: 0 });
  drop(s, 'crusher', 3, 1);
  apply(s, { t: 'run' });
  apply(s, { t: 'next' });
  apply(s, { t: 'pick', i: 0 });
  drop(s, 'furnace', 2, 1);
  g = lessonStep(s);
  assert.match(g.text, /after the Crusher/);
  assert.deepEqual(g.spots, [{ kind: 'cell', x: 2, y: 1 }]);
});

test('outside the lesson the coach says one thing per moment and names what the job needs', () => {
  const s = newRun('coach-yard');
  assert.ok(s.job);
  const pick = hintFor(s, ctx());
  assert.match(pick.text, /^Pick ONE part\./);
  assert.match(pick.text, /This job needs the Crusher/, 'the guaranteed crusher is named');
  assert.equal(pick.step, 0);
  assert.deepEqual(pick.spots, [], 'a real choice lights nothing');
  apply(s, { t: 'pick', i: s.offers.indexOf('crusher') });
  const place = hintFor(s, ctx());
  assert.match(place.text, /^Drag the Crusher onto the belt/);
  assert.deepEqual(place.spots[0], { kind: 'shelf', i: s.bin.length - 1 });
  assert.ok(place.spots.length > 1 && place.spots.slice(1).every((p) => p.kind === 'cell' && p.soft), 'the belt pieces it could take are lit softly');
  assert.match(hintFor(s, { ...ctx(), touch: true }).text, /^Tap the Crusher, then tap the belt/);
  assert.match(hintFor(s, { ...ctx(), touch: true, selected: s.bin[s.bin.length - 1].id }).text, /^Now tap the belt/, 'already selected: no need to tap it');
  const line = s.layout.machines.filter((m) => m.kind === 'conveyor');
  const mid = line[Math.floor(line.length / 2)];
  drop(s, 'crusher', mid.x, mid.y);
  while (s.bin.length) apply(s, { t: 'sell', id: s.bin[0].id });
  const ready = hintFor(s, ctx());
  assert.match(ready.text, /Start the shift/);
  assert.deepEqual(spotKinds(ready), ['run']);
  assert.match(hintFor(s, ctx('running')).text, /Tap any machine/);
  apply(s, { t: 'run' });
  const after = hintFor(s, ctx('summary'));
  assert.match(after.text, /start the next shift/);
  assert.deepEqual(spotKinds(after), ['next']);
});

test('a resume notice comes first, once; a watched recording gets no advice', () => {
  const s = newRun('classic-guide-seed');
  assert.equal(hintFor(s, { ...ctx(), resumeNotice: 'Saved game is gone' }).text, 'Saved game is gone');
  const w = hintFor(s, { ...ctx(), watching: true });
  assert.match(w.text, /watching a recording/);
  assert.deepEqual(w.spots, []);
  assert.doesNotMatch(hintFor(s, ctx()).text, /needs the/, 'a classic yard has no job to name');
});

test('smart facing: a machine dropped in line takes the way the line runs; a conveyor turns toward what takes its load', () => {
  const s = newRun(TUTORIAL_SEED);
  const conv = s.bin[0];
  assert.equal(smartFacing(s.layout, 'conveyor', TUTORIAL_GAP.x, TUTORIAL_GAP.y, conv.dir), 1, 'the corner points down the line');
  assert.equal(smartFacing(s.layout, 'crusher', 3, 1, 0, s.layout.machines.find((m) => m.x === 3 && m.y === 1)!.id), 0, 'fed from the west, it faces east');
  assert.equal(smartFacing(s.layout, 'crusher', 8, 4, 2), 2, 'nothing around it: it keeps its facing');
});
