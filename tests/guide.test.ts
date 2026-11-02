// The coach (docs/UX-STANDARD.md): one instruction at a time and what to touch, as a pure function of the run.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { apply, newRun, TUTORIAL_SEED } from '../game/src/sim/run';
import { cardPlan, hintFor, type Guidance } from '../game/src/render/guide';
import { dropActions, smartFacing } from '../game/src/render/placement';
import { machineName } from '../game/src/content/machines';

const ctx = (mode = 'build', tutorial = false) => ({ tutorial, touch: false, watching: null, mode });
const spotKinds = (g: { spots: Guidance['spots'] }) => g.spots.map((p) => p.kind);

test("outside the lesson the coach says one thing per moment and names the shift's order", () => {
  const s = newRun('coach-yard');
  assert.ok(s.job);
  const pick = hintFor(s, ctx());
  assert.equal(pick.text, `Pick ONE card. This shift the order is $${s.job!.orders![0].toLocaleString('en-US')}.`, "the yard's own first order");
  assert.equal(pick.step, 0);
  assert.deepEqual(pick.spots, [], 'a real choice lights nothing');
  apply(s, { t: 'pick', i: s.offers.indexOf('furnace') });
  const place = hintFor(s, ctx());
  const plan = cardPlan(s);
  assert.ok(plan.length >= 4, 'the card says what it adds, so the coach knows where');
  assert.equal(place.text, `Click the lit spot for the ${machineName(plan[0].kind)}. Step 1 of ${plan.length}.`, 'one spot at a time');
  assert.deepEqual(place.spots, [
    { kind: 'shelf', i: s.bin.findIndex((m) => m.kind === plan[0].kind) },
    { kind: 'cell', x: plan[0].x, y: plan[0].y },
  ]);
  assert.equal(hintFor(s, { ...ctx(), touch: true }).text, `Tap the lit spot for the ${machineName(plan[0].kind)}. Step 1 of ${plan.length}.`);
  const first = s.bin.find((m) => m.kind === plan[0].kind)!;
  // a part put somewhere else ends the plan: the plain words take over, and they promise nothing they cannot show
  for (const a of dropActions(s, first, 0, 0)) apply(s, a);
  assert.match(hintFor(s, ctx()).text, /where you think\. The pay shows if it helps\.$/);
  assert.ok(!hintFor(s, ctx()).spots.some((p) => p.kind === 'cell'), 'no spot is lit once the plan is off');
  apply(s, { t: 'unplace', id: first.id });
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

test('with the spots dark the coach leaves the spot to the player and offers "Show me"; where no spot pays it says how to make room', () => {
  const s = newRun('coach-yard');
  apply(s, { t: 'pick', i: s.offers.indexOf('furnace') });
  const dark = hintFor(s, { ...ctx(), lights: false });
  assert.equal(dark.showMe, true, 'a spot is known: one tap lights it');
  assert.ok(!dark.spots.some((p) => p.kind === 'cell'), 'and none is lit until asked');
  assert.match(dark.text, /where you think/);
  assert.equal(hintFor(s, ctx()).showMe, undefined, 'lit, there is nothing to ask for');
  // a card no spot pays for: the coach does not promise one, it says what could make one
  let found = false;
  for (let n = 0; n < 40 && !found; n++) {
    const fresh = newRun(`no-spot-${n}`);
    for (let i = 0; i < fresh.offers.length && !found; i++) {
      const r = newRun(`no-spot-${n}`);
      apply(r, { t: 'pick', i });
      if (cardPlan(r).length) continue;
      found = true;
      const g = hintFor(r, ctx());
      assert.match(g.text, /^No easy spot for the .+ yet\. Move a machine to make room\.$/);
      assert.equal(g.showMe, undefined, 'nothing to show');
    }
  }
  assert.ok(found, 'some card on these yards has no easy spot');
});

test('when no card on offer fits, the coach says New offers deals three more and lights it, and only then', () => {
  const s = newRun('coach-yard');
  const W = s.layout.width;
  const taken = new Set(s.layout.machines.map((m) => m.y * W + m.x));
  s.layout.rubble = [...Array(W * s.layout.height).keys()].filter((c) => !taken.has(c)); // nowhere left to build
  s.score = 500;
  const g = hintFor(s, ctx());
  assert.equal(g.text, 'No card here fits your line yet. New offers deals three more for $40.');
  assert.deepEqual(spotKinds(g), ['offers']);
  apply(s, { t: 'reroll' });
  assert.match(hintFor(s, ctx()).text, /^Pick ONE card/, 'once a shift: after that the coach says to pick');
  const fresh = newRun('coach-yard');
  fresh.score = 500;
  assert.match(hintFor(fresh, ctx()).text, /^Pick ONE card/, 'a card fits: nothing to buy');
});

test('a resume notice comes first, once; a watched recording gets no advice', () => {
  const s = newRun('classic-guide-seed');
  assert.equal(hintFor(s, { ...ctx(), resumeNotice: 'Saved game is gone' }).text, 'Saved game is gone');
  const w = hintFor(s, { ...ctx(), watching: 'recording by Ann#AB12 · Regular ($228)' });
  assert.equal(w.text, 'Watching: recording by Ann#AB12 · Regular ($228).', 'whose it is: the top bar has no room to say');
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
  const before = s.layout.machines.filter((m) => m.kind === 'conveyor').at(-1)!;
  const broken = hintFor(s, ctx());
  assert.equal(broken.text, 'This piece leads nowhere. Turn it or move it, then start.', 'the belt is right there on the shelf');
  assert.deepEqual(broken.spots, [{ kind: 'cell', x: before.x, y: before.y }], 'and the piece is lit');
  apply(s, { t: 'sell', id: belt.id });
  const g = hintFor(s, ctx());
  assert.equal(g.text, 'This piece leads nowhere. Out of belts? Buy one.');
  assert.deepEqual(g.spots, [{ kind: 'cell', x: before.x, y: before.y }, { kind: 'buy' }]);
});

test('ready but short of the order: the coach says by how much, and lights the slow machine when there is one', () => {
  const s = newRun('coach-yard');
  apply(s, { t: 'pick', i: 0 });
  while (s.bin.length) apply(s, { t: 'sell', id: s.bin[0].id });
  assert.match(hintFor(s, ctx()).text, /Start the shift/, 'an order the line fills: ready');
  s.job = { ...s.job!, orders: s.job!.orders!.map(() => 99_999) }; // an order no line of this size fills
  const g = hintFor(s, ctx());
  assert.match(g.text, /^\$[\d,]+ short of the order: the .+ (is the slow one|waits for scrap)\.$/, g.text);
  assert.deepEqual(spotKinds(g), ['cell', 'run'], 'the machine to look at, and the shift can still start');
  assert.ok(g.text.split(/\s+/).length <= 14, 'one short instruction');
});
