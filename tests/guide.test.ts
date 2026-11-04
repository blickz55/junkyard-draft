// The coach (docs/UX-STANDARD.md): one instruction at a time and what to touch, as a pure function of the run.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { apply, newRun, TUTORIAL_SEED, type RunState } from '../game/src/sim/run';
import { cardPlan, hintFor, offerWorths, payingFixes, pressPaysLess, type Guidance } from '../game/src/render/guide';
import { salGame } from '../game/src/render/sal';
import { bottleneckLine } from '../game/src/content/bottleneck';
import { dropActions, smartFacing } from '../game/src/render/placement';
import { machineName } from '../game/src/content/machines';
import { analyseRound } from '../game/src/sim/bottleneck';
import { runLayout } from '../game/src/sim/sim';

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
  // a card no spot pays for: the coach does not promise one, it says why in the line's own terms
  const seen = { press: false, other: false };
  for (let n = 0; n < 60 && !(seen.press && seen.other); n++) {
    const fresh = newRun(`no-spot-${n}`);
    for (let i = 0; i < fresh.offers.length; i++) {
      const r = newRun(`no-spot-${n}`);
      apply(r, { t: 'pick', i });
      if (cardPlan(r).length) continue;
      const g = hintFor(r, ctx());
      assert.equal(g.showMe, undefined, 'nothing to show');
      if (pressPaysLess(r, r.picks[0])) {
        seen.press = true;
        assert.match(g.text, /^Plates: \$[\d,]+ for two shards\. Ingots: \$[\d,]+ for one\. A Press needs spare shards\.$/);
      } else {
        seen.other = true;
        assert.match(
          g.text,
          /^(Nothing pays more with the .+ yet: (the line is short of scrap|the .+ is the slow one)\.|No spot pays more with the .+ yet\. It can wait on the shelf\.)$/,
        );
      }
    }
  }
  assert.ok(seen.press && seen.other, 'a Press that pays less and another card no spot pays for, on these yards');
});

test('a Plate Press on an ingot yard pays less per shard, and the coach says so with the prices; nowhere else', () => {
  let ingot: RunState | null = null;
  let plate: RunState | null = null;
  for (let n = 0; n < 40 && (!ingot || !plate); n++) {
    const r = newRun(`pays-less-${n}`);
    if (r.job?.material === 'ingot') ingot ??= r;
    if (r.job?.material === 'plate') plate ??= r;
  }
  assert.ok(ingot && plate, 'both kinds of yard in forty');
  assert.equal(pressPaysLess(ingot, 'press'), true, 'a plate takes two shards and sells for less than two ingots');
  assert.equal(pressPaysLess(ingot, 'furnace'), false, "the job's own machine");
  assert.equal(pressPaysLess(plate, 'press'), false, "on a plate yard the Press is the job's own machine");
  assert.equal(pressPaysLess(plate, 'furnace'), false);
  assert.equal(pressPaysLess(newRun('classic-pays-less'), 'press'), false, 'a yard with no job');
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

test("once a card's plan is all in, the part it did not need is spare: the coach stops asking where it goes and offers to sell it", () => {
  let checked = 0;
  for (let n = 0; n < 60 && checked < 3; n++) {
    const fresh = newRun(`spare-${n}`);
    for (let i = 0; i < fresh.offers.length; i++) {
      const r = newRun(`spare-${n}`);
      apply(r, { t: 'pick', i });
      const plan = cardPlan(r);
      const kinds = plan.map((p) => p.kind);
      const card = r.bin.slice(-3).map((m) => m.kind);
      if (!plan.length || card.length < 3 || card.every((k) => kinds.includes(k))) continue; // a plan that leaves one of its card's parts out
      for (const p of plan) {
        const part = r.bin.find((m) => m.kind === p.kind)!;
        for (const a of dropActions(r, part, p.x, p.y, p.dir)) apply(r, a);
      }
      const g = hintFor(r, { ...ctx(), lights: false });
      assert.doesNotMatch(g.text, /on the shelf, then where/, `${r.seed}: the spare is not asked for`);
      const ready = !/short of the order|more to fill|\$[\d,]+ short/.test(g.text);
      if (ready) assert.match(g.text, /^Ready\? Start the shift\. The spare .+ sells for \$10: every card brings what it needs\.$/);
      // the sale is one tap from the coach, and once every spare is sold there is nothing more to offer
      let offer = g.sell;
      assert.ok(offer, `${r.seed}: the spare is offered for sale`);
      while (offer) {
        const id = offer.id;
        const part = r.bin.find((m) => m.id === id);
        assert.ok(part && part.kind !== 'conveyor', `${r.seed}: a part of the card, never a belt`);
        const before = r.score;
        apply(r, { t: 'sell', id });
        assert.equal(r.score, before + 10);
        offer = hintFor(r, { ...ctx(), lights: false }).sell;
      }
      if (ready) assert.equal(hintFor(r, { ...ctx(), lights: false }).text, 'Ready? Start the shift.');
      checked++;
      break;
    }
  }
  assert.ok(checked > 0, 'a plan that left a part of its card out, on these yards');
});

test('ready but short with every machine keeping up: the coach says the line needs more scrap, not "try a change"', () => {
  let seen = 0;
  for (let n = 0; n < 80 && seen < 2; n++) {
    const r = newRun(`short-${n}`);
    apply(r, { t: 'pick', i: 0 });
    for (const m of r.bin.slice(-3)) if (m.kind !== 'conveyor') apply(r, { t: 'sell', id: m.id });
    if (analyseRound(r.layout, runLayout(r.layout), 2).kind !== 'balanced') continue;
    r.round = 5; // a late order the opening line cannot fill
    r.picks = []; // no card in hand: the coach goes straight to whether the line fills the order
    // and, where a Hopper card has a paying spot, that it is the card to look for next shift (the eleventh panel)
    const hopper = payingFixes(r, analyseRound(r.layout, runLayout(r.layout), r.round + 1)).b.fixes.includes('hopper');
    assert.match(
      hintFor(r, ctx()).text,
      hopper
        ? /^\$[\d,]+ short of the order: every machine keeps up\. A Hopper card next shift would bring more scrap\.$/
        : /^\$[\d,]+ short of the order: every machine keeps up; it needs more scrap\.$/,
      r.seed,
    );
    seen++;
  }
  assert.ok(seen, 'a yard whose opening line keeps up everywhere');
});

test('the summary names only fixes whose card pays now, so a card on offer never says "No spot pays" for a fix the summary just named', () => {
  let named = 0;
  let dropped = 0;
  for (let n = 0; n < 24; n++) {
    const seed = `fixes-${n}`;
    const r = newRun(seed);
    for (const a of salGame(seed).actions) {
      if (r.phase === 'draft' && r.rounds.length && a.t !== 'reroll') {
        const last = r.rounds[r.rounds.length - 1];
        const raw = analyseRound(last.layout, last.result, r.round);
        const { b, nothingPays } = payingFixes(r, raw);
        dropped += raw.fixes.length - b.fixes.length;
        const worths = offerWorths(r);
        r.offers.forEach((kind, i) => {
          const isNamed = (b.fixes.includes('splitter') && b.machine?.kind === kind) || (kind !== 'splitter' && b.fixes.includes(kind));
          if (!isNamed) return;
          named++;
          assert.ok(worths[i].gain > 0, `${seed}, shift ${r.round}: the summary named the ${kind}, and its card pays`);
        });
        if (nothingPays) assert.match(bottleneckLine(b, true), /No card pays to clear it yet/);
      }
      apply(r, a);
    }
  }
  assert.ok(named > 0 && dropped > 0, `fixes named with their card on offer (${named}) and fixes dropped (${dropped})`);
});
