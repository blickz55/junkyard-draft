// The coach (docs/UX-STANDARD.md): one instruction at a time and what to touch, as a pure function of the run.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { apply, newRun, TUTORIAL_SEED, type Action } from '../game/src/sim/run';
import { hintFor, type Guidance } from '../game/src/render/guide';
import { dropActions, smartFacing } from '../game/src/render/placement';

type Run = ReturnType<typeof newRun>;
const ctx = (mode = 'build', tutorial = false) => ({ tutorial, touch: false, watching: null, mode });
const shelf = (s: Run, k: string) => s.bin.find((m) => m.kind === k)!;
const doAll = (s: Run, actions: Action[]) => actions.forEach((a) => apply(s, a));
const drop = (s: Run, kind: string, x: number, y: number) => doAll(s, dropActions(s, shelf(s, kind), x, y));
const spotKinds = (g: { spots: Guidance['spots'] }) => g.spots.map((p) => p.kind);

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
  const w = hintFor(s, { ...ctx(), watching: 'recording by Ann#AB12 · Regular ($228)' });
  assert.equal(w.text, 'You are watching a recording by Ann#AB12 · Regular ($228).', 'whose it is: the top bar has no room to say');
  assert.deepEqual(w.spots, []);
  assert.doesNotMatch(hintFor(s, ctx()).text, /needs the/, 'a classic yard has no job to name');
});

test('smart facing: a machine dropped in line takes the way the line runs; a conveyor turns toward what takes its load', () => {
  const s = newRun(TUTORIAL_SEED);
  const conv = s.bin[0];
  assert.equal(smartFacing(s.layout, 'conveyor', 4, 1, conv.dir), 1, 'the corner points down the line');
  assert.equal(smartFacing(s.layout, 'crusher', 3, 1, 0, s.layout.machines.find((m) => m.x === 3 && m.y === 1)!.id), 0, 'fed from the west, it faces east');
  assert.equal(smartFacing(s.layout, 'crusher', 8, 4, 2), 2, 'nothing around it: it keeps its facing');
});

test('a broken line with no belt on the shelf: the coach says a belt can be bought and lights the button; with one on the shelf it does not', () => {
  const s = newRun('classic-broke');
  apply(s, { t: 'pick', i: 0 });
  apply(s, { t: 'sell', id: s.bin[s.bin.length - 1].id });
  apply(s, { t: 'run' });
  apply(s, { t: 'next' });
  apply(s, { t: 'pick', i: 0 });
  apply(s, { t: 'sell', id: s.bin[s.bin.length - 1].id });
  const belt = s.layout.machines.filter((m) => m.kind === 'conveyor').at(-1)!;
  apply(s, { t: 'unplace', id: belt.id });
  assert.equal(hintFor(s, ctx()).text, 'The red mark shows where the line stops. Fix it, then start.', 'the belt is right there on the shelf');
  apply(s, { t: 'sell', id: belt.id });
  const g = hintFor(s, ctx());
  assert.equal(g.text, 'The red mark shows where the line stops. Out of belts? Buy one.');
  assert.deepEqual(g.spots, [{ kind: 'buy' }]);
});
