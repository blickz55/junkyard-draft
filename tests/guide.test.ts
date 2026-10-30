// production roadmap 0.9.4: the onboarding guide is a pure function of the run state (extracted from GameScene).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { apply, newRun, TUTORIAL_SEED } from '../game/src/sim/run';
import { hintFor, lessonStep, idleTip } from '../game/src/render/guide';

const at = (s: ReturnType<typeof newRun>, x: number, y: number) => s.layout.machines.find((m) => m.x === x && m.y === y)!;
const binKind = (s: ReturnType<typeof newRun>, k: string) => s.bin.find((m) => m.kind === k)!;

test('guide: the lesson follows the layout (pick, make room, a misoriented crusher, fed), round 3 in three steps with demos', () => {
  const s = newRun(TUTORIAL_SEED);
  assert.deepEqual(lessonStep(s), { step: 1, text: lessonStep(s).text });
  assert.match(lessonStep(s).text, /Pick the CRUSHER/);
  const g1 = hintFor(s, { tutorial: true, onboarded: false, watching: false });
  assert.equal(g1.step, 1);
  assert.equal(g1.foreman, 'lesson1');
  assert.match(g1.text, /Pick the CRUSHER/);
  apply(s, { t: 'pick', i: 0 });
  assert.match(lessonStep(s).text, /Make room/);
  assert.equal(lessonStep(s).step, 2);
  apply(s, { t: 'unplace', id: at(s, 2, 2).id });
  apply(s, { t: 'place', id: binKind(s, 'crusher').id, x: 2, y: 2, dir: 1 });
  assert.match(lessonStep(s).text, /only takes items from behind/);
  assert.equal(lessonStep(s).step, 3);
  for (let i = 0; i < 3; i++) apply(s, { t: 'rotate', id: at(s, 2, 2).id });
  assert.match(lessonStep(s).text, /Good: the hopper feeds the crusher/);
  assert.equal(hintFor(s, { tutorial: true, onboarded: false, watching: false }).foreman, null, 'in the build phase the foreman keeps his line');
  // rounds 1 and 2 run; round 3: the splitter, then the two branches, then the real simulation's verdict
  apply(s, { t: 'run' });
  apply(s, { t: 'next' });
  assert.match(lessonStep(s).text, /FURNACE/);
  assert.equal(hintFor(s, { tutorial: true, onboarded: false, watching: false }).foreman, 'lesson2');
  apply(s, { t: 'pick', i: 0 });
  const dock = at(s, 5, 2);
  apply(s, { t: 'unplace', id: dock.id });
  apply(s, { t: 'place', id: dock.id, x: 6, y: 2, dir: 0 });
  apply(s, { t: 'place', id: binKind(s, 'furnace').id, x: 5, y: 2, dir: 0 });
  assert.match(lessonStep(s).text, /Shards reach the furnace/);
  apply(s, { t: 'run' });
  apply(s, { t: 'next' });
  assert.deepEqual(lessonStep(s), { step: 5, text: lessonStep(s).text, demo: 'splitter' });
  assert.match(lessonStep(s).text, /SPLITTER/);
  apply(s, { t: 'pick', i: 0 });
  assert.match(lessonStep(s).text, /^Replace the conveyor after the crusher with the SPLITTER/);
  apply(s, { t: 'unplace', id: at(s, 3, 2).id });
  apply(s, { t: 'place', id: binKind(s, 'splitter').id, x: 3, y: 2, dir: 0 });
  assert.match(lessonStep(s).text, /^Top branch:/);
  assert.equal(lessonStep(s).demo, 'sideload');
  const convs = s.bin.filter((m) => m.kind === 'conveyor');
  apply(s, { t: 'place', id: convs[0].id, x: 3, y: 1, dir: 0 });
  apply(s, { t: 'place', id: convs[1].id, x: 4, y: 1, dir: 1 });
  assert.match(lessonStep(s).text, /^Bottom branch/);
  apply(s, { t: 'place', id: convs[2].id, x: 3, y: 3, dir: 0 });
  apply(s, { t: 'place', id: convs[3].id, x: 4, y: 3, dir: 3 });
  assert.match(lessonStep(s).text, /ingots flow/, 'the real simulation confirms the merge');
  apply(s, { t: 'sell', id: convs[4].id });
  apply(s, { t: 'run' });
  apply(s, { t: 'next' });
  const g4 = hintFor(s, { tutorial: true, onboarded: false, watching: false });
  assert.equal(g4.step, 6);
  assert.match(g4.text, /ordinary pick/);
  assert.equal(g4.foreman, null, 'after round 3 the lesson is over: no lesson line for the foreman');
});

test('guide: the first draft names the card and why; a newcomer reads the pointer to the lesson first; a watched recording gets neither', () => {
  const s = newRun('guide-seed');
  const on = hintFor(s, { tutorial: false, onboarded: true, watching: false });
  assert.match(on.text, /^First pick: [A-Z][a-z]+( [A-Z][a-z]+)? \(card [123]\) — .+\.$/);
  assert.equal(on.foreman, 'firstDraft');
  assert.equal(on.step, 0);
  const off = hintFor(s, { tutorial: false, onboarded: false, watching: false });
  assert.match(off.text, /^New here\? 'Learn \(3 min\)'.* First pick: /);
  const watching = hintFor(s, { tutorial: false, onboarded: true, watching: true });
  assert.doesNotMatch(watching.text, /First pick/);
  assert.equal(watching.text, idleTip(s));
  assert.equal(watching.foreman, null);
  assert.equal(
    hintFor(s, { tutorial: false, onboarded: true, watching: false, resumeNotice: 'Saved game could not be resumed' }).text,
    'Saved game could not be resumed',
    'a resume notice takes the strip once',
  );
});

test("guide: after a round the draft hint is the last round's bottleneck line and the foreman gets its opener", () => {
  const s = newRun('guide-seed-2');
  apply(s, { t: 'pick', i: 0 });
  apply(s, { t: 'run' });
  apply(s, { t: 'next' });
  assert.equal(s.round, 2);
  const g = hintFor(s, { tutorial: false, onboarded: true, watching: false });
  assert.match(g.text, /^Last round: /);
  assert.match(String(g.foreman), /^bottleneck/);
  // in the build phase of a normal game: an idle tip, no foreman change
  apply(s, { t: 'pick', i: 0 });
  const b = hintFor(s, { tutorial: false, onboarded: true, watching: false });
  assert.equal(b.text, idleTip(s));
  assert.equal(b.foreman, null);
});
