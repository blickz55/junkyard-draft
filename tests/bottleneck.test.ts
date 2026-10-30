// Production roadmap 0.8.8: the bottleneck line over canonical layouts (saturated furnace, blocked hopper, starved
// processor, slag line) plus the disconnected and balanced cases, the pool filter on the fixes, and determinism.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runLayout } from '../game/src/sim/sim';
import { RULES } from '../game/src/sim/rules';
import { analyseRound, inPool, HELD_FRACTION } from '../game/src/sim/bottleneck';
import { bottleneckLine } from '../game/src/content/bottleneck';
import type { Layout, Machine, Dir, MachineKind } from '../game/src/sim/types';

let nid = 1;
const m = (kind: MachineKind, x: number, y: number, dir: Dir = 0): Machine => ({ id: nid++, kind, x, y, dir });
const lay = (...machines: Machine[]): Layout => ({ width: 8, height: 6, machines });
const analyse = (layout: Layout, nextRound = 4) => { const res = runLayout(layout); return { res, b: analyseRound(layout, res, nextRound), line: bottleneckLine(analyseRound(layout, res, nextRound)) }; };

test('saturated furnace: hopper → crusher → furnace → dock; the furnace (3 ticks against a 2-tick supply) held the line, and the two pool fixes are named', () => {
  const L = lay(m('hopper', 0, 2), m('conveyor', 1, 2), m('crusher', 2, 2), m('conveyor', 3, 2), m('furnace', 4, 2), m('dock', 5, 2));
  const { res, b, line } = analyse(L, 4);
  assert.equal(b.kind, 'saturated'); assert.equal(b.machine?.kind, 'furnace'); assert.deepEqual([b.machine?.x, b.machine?.y], [4, 2]);
  assert.ok(b.heldTicks >= Math.ceil(RULES.ticksPerRound * HELD_FRACTION) && b.heldTicks <= RULES.ticksPerRound, `held ${b.heldTicks} ticks`);
  assert.ok(res.shipped.ingot > 0, 'the line works, it is just slow');
  assert.deepEqual(b.fixes, ['tuner', 'splitter']);
  assert.match(line, /^The furnace at 5,3 held the line for \d+ of 80 seconds\. A tuner beside it, or a second furnace behind a splitter, would clear it\.$/);
  // in round 2 the tuner is not in the pool yet (offered from round 3): the sentence names only the splitter fix
  const early = analyseRound(L, res, 2);
  assert.deepEqual(early.fixes, ['splitter']); assert.match(bottleneckLine(early), /seconds\. A second furnace behind a splitter would clear it\.$/);
  assert.deepEqual(analyseRound(L, runLayout(L), 4), b, 'deterministic');
});

test('blocked hopper: a hopper pushing into the side of a crusher is blocked on every try; the fix is a rotation, not a draft', () => {
  const { b, line } = analyse(lay(m('hopper', 1, 2), m('crusher', 2, 2, 3), m('dock', 2, 1)));
  assert.equal(b.kind, 'dead-end'); assert.equal(b.machine?.kind, 'hopper'); assert.equal(b.count, RULES.ticksPerRound / RULES.hopperPeriod); assert.equal(b.heldTicks, b.count); assert.deepEqual(b.fixes, []);
  assert.equal(line, 'The hopper at 2,3 was blocked on 40 of its 40 tries: nothing ahead takes its scrap. Point it into a conveyor or the back of a machine (R rotates).');
});

test('dead-end belt: a conveyor pointing off the grid holds every item; nothing ships, and the belt, not "disconnected", is named', () => {
  const { b, line } = analyse(lay(m('hopper', 5, 2), m('conveyor', 6, 2), m('conveyor', 7, 2)));
  assert.equal(b.kind, 'dead-end'); assert.equal(b.machine?.kind, 'conveyor'); assert.deepEqual([b.machine?.x, b.machine?.y], [7, 2]);
  assert.match(line, /^The conveyor at 8,3 is a dead end: items waited there for \d+ of 80 seconds\. Point it on toward the dock \(R rotates\)\.$/);
});

test('starved processor: one hopper split over two crusher lines leaves each crusher idle half the round; supply is named with the hopper fix', () => {
  const L = lay(m('hopper', 0, 2), m('splitter', 1, 2), m('crusher', 1, 1, 3), m('dock', 1, 0), m('crusher', 1, 3, 1), m('dock', 1, 4));
  const { res, b, line } = analyse(L);
  assert.ok(res.shipped.shards > 20, `both branches ship: ${res.shipped.shards}`);
  assert.equal(b.kind, 'starved'); assert.equal(b.machine?.kind, 'crusher'); assert.ok(b.utilisation <= 0.5 && b.utilisation > 0.3, `utilisation ${b.utilisation}`); assert.deepEqual(b.fixes, ['hopper']);
  assert.match(line, /^Supply held the line: the crusher at 2,[24] was idle \d+ % of the round \(\d+ items in 80 seconds\)\. A second hopper would raise the ceiling\.$/);
});

test('slag line: a furnace fed raw scrap melts it into $1 slag; the crusher is the fix', () => {
  const { res, b, line } = analyse(lay(m('hopper', 0, 2), m('conveyor', 1, 2), m('furnace', 2, 2), m('dock', 3, 2)));
  assert.ok(res.shipped.slag >= 3 && res.shipped.ingot === 0);
  assert.equal(b.kind, 'slag'); assert.equal(b.machine?.kind, 'furnace'); assert.equal(b.count, res.shipped.slag); assert.deepEqual(b.fixes, ['crusher']);
  assert.equal(line, `The furnace at 3,3 melted ${res.shipped.slag} raw scrap into slag at $1 each. A crusher before it turns the scrap into shards first, worth $12 each as ingots.`);
});

test('disconnected: no hopper at all ships nothing and jams nothing; balanced: hopper → crusher → dock keeps up exactly', () => {
  const none = analyse(lay(m('conveyor', 1, 2), m('dock', 2, 2)));
  assert.equal(none.b.kind, 'disconnected'); assert.equal(none.b.machine, null); assert.match(none.line, /^Nothing reached a dock\./);
  const ok = analyse(lay(m('hopper', 0, 2), m('crusher', 1, 2), m('dock', 2, 2)));
  assert.equal(ok.b.kind, 'balanced'); assert.equal(ok.b.count, 1); assert.equal(ok.line, 'Nothing held the line this round: every machine kept up with the hopper. The next ceiling is supply; another hopper would raise it.');
});

test('merge: two lines squeezing into one belt before the dock name the conveyor with its feeders and the dock/press fixes', () => {
  // two hoppers side-load one conveyor that runs to a dock: the belt takes one item a tick, each hopper offers one every two ticks, so the merge saturates
  const L = lay(m('hopper', 2, 1, 1), m('hopper', 2, 3, 3), m('conveyor', 2, 2), m('hopper', 1, 2), m('conveyor', 3, 2), m('dock', 4, 2));
  const { b, line } = analyse(L);
  assert.equal(b.kind, 'saturated'); assert.equal(b.machine?.kind, 'conveyor'); assert.deepEqual([b.machine?.x, b.machine?.y], [2, 2]); assert.equal(b.feeders, 3); assert.deepEqual(b.fixes, ['dock', 'press']);
  assert.match(line, /^The conveyor at 3,3 held the line for \d+ of 80 seconds: 3 lines squeeze into one belt\. A second dock on one of the branches, or a press to halve the traffic, would clear it\.$/);
});

test('the pool filter follows the rules: experimental kinds never, tiered kinds from their round', () => {
  assert.equal(inPool('sieve', 6), false); assert.equal(inPool('tuner', 2), false); assert.equal(inPool('tuner', 3), true); assert.equal(inPool('hopper', 1), true);
});
