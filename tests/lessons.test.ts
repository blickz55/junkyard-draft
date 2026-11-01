// The lessons (rules v5): one way through each, every part taught by hand, and every step saying what to touch and what it does.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { apply, newRun, runStars, shippedTotal } from '../game/src/sim/run';
import { lessonYard } from '../game/src/sim/yard';
import { MACHINE_KINDS, RULES } from '../game/src/sim/rules';
import { hintFor, lessonAllows, lessonPick, lessonReady, lessonStep, lessonWants } from '../game/src/render/guide';
import { dropActions } from '../game/src/render/placement';
import { LESSONS, lessonOf, shiftsOf } from '../game/src/content/lessons';
import { actionsFor, playLesson } from '../tools/lesson-lib';

const words = (s: string) => s.split(/\s+/).length;

test('every lesson plays through, each move being the step on screen, with what to touch lit, and ends with its job done', () => {
  for (const lesson of LESSONS) {
    const s = newRun(lesson.seed);
    lesson.shifts.forEach((shift, k) => {
      assert.equal(s.round, k + 1);
      if (shift.pick) {
        const i = lessonPick(s)!;
        assert.equal(s.offers[i], shift.pick.kind, `lesson ${lesson.n}, shift ${k + 1}: the card it asks for is dealt`);
        assert.equal(s.offers.length, 3, 'three cards: picking ONE is part of the lesson');
        assert.deepEqual(lessonStep(s).spots, [{ kind: 'offer', i }]);
        apply(s, { t: 'pick', i });
      }
      for (const m of shift.moves) {
        assert.equal(lessonReady(s), false, 'the shift cannot start with a move still to make');
        const g = lessonStep(s);
        if (m.do === 'place') {
          const slot = s.bin.findIndex((q) => q.kind === m.kind);
          assert.ok(slot >= 0, `lesson ${lesson.n}, shift ${k + 1}: a ${m.kind} is on the shelf when it is asked for`);
          assert.deepEqual(g.spots, [
            { kind: 'shelf', i: slot },
            { kind: 'cell', x: m.x, y: m.y },
          ]);
        } else if (m.do === 'turn') assert.deepEqual(g.spots, [{ kind: 'cell', x: m.x, y: m.y }]);
        else if (m.do === 'buy') {
          assert.deepEqual(g.spots, [{ kind: 'buy' }]);
          assert.equal(lessonWants(s), 'buy');
        } else {
          const i = s.bin.findIndex((q) => q.kind === m.kind);
          assert.deepEqual(g.spots, [{ kind: 'shelf', i }]);
          assert.deepEqual(lessonStep(s, false, s.bin[i].id).spots, [{ kind: 'sell' }], 'then the button, once the part is in hand');
          assert.equal(lessonWants(s), 'sell');
        }
        const acts = actionsFor(s, m);
        assert.equal(lessonAllows(s, acts), true, `lesson ${lesson.n}, shift ${k + 1}: ${m.do} lands right, as a drop lands`);
        for (const a of acts) apply(s, a);
      }
      assert.equal(lessonReady(s), true);
      assert.deepEqual(lessonStep(s).spots, [{ kind: 'run' }]);
      apply(s, { t: 'run' });
      assert.deepEqual(lessonStep(s).spots, [{ kind: 'next' }]);
      if (k < lesson.shifts.length - 1) apply(s, { t: 'next' });
    });
    assert.equal(runStars(s), 3, `lesson ${lesson.n} finishes its job: ${shippedTotal(s, s.job!.material)} shipped against ${s.job!.stars.join('/')}`);
    assert.equal(shiftsOf(lesson.seed), lesson.shifts.length);
  }
});

test('each lesson matches its yard: a shift with no pick is only ever the first, and the cards run out where the script does', () => {
  for (const lesson of LESSONS) {
    const yard = lessonYard(lesson.seed)!;
    lesson.shifts.forEach((shift, k) => {
      assert.equal(!!shift.pick, (yard.offers[k + 1] ?? []).length > 0, `lesson ${lesson.n}, shift ${k + 1}`);
      if (!shift.pick) assert.equal(k, 0, 'only a lesson that opens on the build skips a pick');
    });
    assert.equal(yard.firstPhase === 'build', !lesson.shifts[0].pick);
  }
});

test('every part the game can offer is put in place by hand in some lesson, and is told about there', () => {
  const offered = MACHINE_KINDS.filter((k) => RULES.draftWeights[k] > 0);
  const moves = LESSONS.flatMap((l) => l.shifts.flatMap((s) => s.moves));
  const placed = new Set(moves.flatMap((m) => (m.do === 'place' ? [m.kind] : [])));
  const told = new Set(moves.flatMap((m) => (m.about ?? []).map((a) => a.kind)));
  for (const k of [...offered, 'conveyor' as const]) {
    assert.ok(placed.has(k), `no lesson has a player place a ${k}`);
    assert.ok(told.has(k), `no lesson says what a ${k} does`);
  }
  for (const m of moves) if (m.do === 'place') assert.ok(m.about?.length, `placing a ${m.kind} comes with what it is for`);
});

test('what a lesson teaches pays: each new thing earns more than the shift before it, in money a player can see', () => {
  for (const lesson of LESSONS) {
    const earned = playLesson(lesson).rounds.map((r) => r.earned);
    for (let i = 1; i < earned.length; i++) {
      const taught = lesson.shifts[i].moves.length > 0 && !(lesson.n === 3 && i === 3); // a second dock saves a belt, it adds no money
      if (taught) assert.ok(earned[i] > earned[i - 1], `lesson ${lesson.n}: ${earned.join(', ')}`);
    }
  }
});

test('the rail: only the step on screen counts; the wrong spot, the wrong part and the start are refused, and Undo steps back', () => {
  const s = newRun(LESSONS[0].seed);
  const gap = s.bin[0];
  assert.equal(lessonAllows(s, dropActions(s, gap, 5, 3)), false, 'the wrong spot');
  assert.equal(lessonAllows(s, [{ t: 'unplace', id: s.layout.machines.find((m) => m.kind === 'conveyor')!.id }]), false, 'taking the belt apart');
  assert.equal(lessonAllows(s, [{ t: 'sell', id: gap.id }]), false, 'selling the part it needs');
  assert.equal(lessonAllows(s, [{ t: 'rotate', id: gap.id }]), false, 'turning a part on the shelf');
  assert.equal(lessonAllows(s, [{ t: 'buy' }]), false, 'buying before it asks');
  assert.equal(lessonReady(s), false);
  assert.equal(lessonAllows(s, dropActions(s, gap, 4, 1)), true);
  for (const a of dropActions(s, gap, 4, 1)) apply(s, a);
  assert.equal(lessonReady(s), true);
  assert.equal(lessonAllows(s, [{ t: 'rotate', id: gap.id }]), false, 'nothing else to do but start');
  // the run is the lesson's only memory: take the move away and the step is back
  apply(s, { t: 'unplace', id: gap.id });
  assert.match(lessonStep(s).text, /gap/);
  const t = newRun(LESSONS[1].seed);
  assert.equal(lessonPick(t), 0);
  apply(t, { t: 'pick', i: 0 });
  assert.equal(lessonPick(t), null);
  const press = t.bin.find((q) => q.kind === 'press')!;
  assert.equal(lessonAllows(t, dropActions(t, press, 4, 2)), false, 'first the belt that points the wrong way');
});

test('every step reads like a person talking: an instruction, a line on what the part does, and a finger reads tap', () => {
  const ctx = { tutorial: true, touch: false, watching: null, mode: 'build' };
  for (const lesson of LESSONS) {
    const s = newRun(lesson.seed);
    lesson.shifts.forEach((shift, k) => {
      if (shift.pick) {
        assert.ok(words(lessonStep(s).text) <= 16, lessonStep(s).text);
        apply(s, { t: 'pick', i: lessonPick(s)! });
      }
      for (const m of shift.moves) {
        const g = lessonStep(s);
        assert.ok(words(g.text) <= 16, g.text);
        for (const a of g.about ?? []) assert.ok(words(a.text) <= 18, a.text);
        if (m.do === 'place') {
          assert.doesNotMatch(lessonStep(s, true).text, /\bDrag\b/, `a finger cannot drag here: ${lessonStep(s, true).text}`);
          assert.match(g.text, /^Drag|^The belt has a gap\. Drag|^One more/, g.text);
        }
        assert.deepEqual(hintFor(s, ctx).about, g.about, 'the panel gets what the step says');
        for (const a of actionsFor(s, m)) apply(s, a);
      }
      assert.ok(words(lessonStep(s).text) <= 16, lessonStep(s).text);
      apply(s, { t: 'run' });
      assert.ok(words(lessonStep(s).text) <= 16, lessonStep(s).text);
      if (k < lesson.shifts.length - 1) apply(s, { t: 'next' });
    });
  }
  assert.equal(hintFor(newRun(LESSONS[0].seed), { ...ctx, mode: 'running' }).about, undefined, 'a running shift has nothing to place');
});

test('any other tutorial name is the first lesson, as the yards have it; other yards are not lessons', () => {
  assert.equal(lessonOf('tutorial-anything'), LESSONS[0]);
  assert.equal(lessonYard('tutorial-anything'), lessonYard('tutorial-1'));
  assert.equal(lessonYard('junkyard'), null);
  assert.equal(shiftsOf('junkyard'), RULES.rounds);
});
