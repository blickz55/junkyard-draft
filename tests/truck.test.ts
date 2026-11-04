// The scrap truck (rules v11): where a yard puts it, the cells kept for it, how it lands, and that a card's plan in front of its Crusher
// earns exactly what the card said.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { apply, cardParts, newRun, RunError, type RunState } from '../game/src/sim/run';
import { RULES } from '../game/src/sim/rules';
import { runLayout } from '../game/src/sim/sim';
import { truckCells, truckLoad, yardFor, TUTORIAL_SEED } from '../game/src/sim/yard';
import { cardGain } from '../game/src/render/estimate';
import { dropActions } from '../game/src/render/placement';
import { yardLines } from '../game/src/render/mirror';
import { cardPlan, offerWorths } from '../game/src/render/guide';

const W = RULES.gridWidth;
const seeds = Array.from({ length: 40 }, (_, i) => `truck-${i}`);
/** Shifts run with nothing built, up to the draft of `round`. */
function upTo(seed: string, round: number): RunState {
  const s = newRun(seed);
  while (s.round < round) {
    apply(s, { t: 'pick', i: 0 });
    apply(s, { t: 'run' });
    apply(s, { t: 'next' });
  }
  return s;
}

test('a yard keeps two cells for the truck: a Hopper two or more from the line, its Crusher in front as far from it, facing a free cell', () => {
  let found = 0;
  for (const seed of seeds) {
    const y = yardFor(seed);
    const d = y.delivery;
    if (!d) continue;
    found++;
    const taken = new Set([...y.machines.map((m) => m.y * W + m.x), ...y.rubble]);
    for (const c of [d, d.crusher]) {
      assert.ok(!taken.has(c.y * W + c.x), `${seed}: the truck's cells are free`);
      assert.ok(
        y.machines.every((m) => Math.abs(m.x - c.x) + Math.abs(m.y - c.y) >= 2),
        `${seed}: apart from the line`,
      );
    }
    assert.deepEqual(
      [d.x + [1, 0, -1, 0][d.dir], d.y + [0, 1, 0, -1][d.dir]],
      [d.crusher.x, d.crusher.y],
      `${seed}: the Crusher stands in front of the Hopper`,
    );
    assert.notEqual(d.crusher.dir, (d.dir + 2) % 4, `${seed}: never back into its Hopper`);
    const fx = d.crusher.x + [1, 0, -1, 0][d.crusher.dir],
      fy = d.crusher.y + [0, 1, 0, -1][d.crusher.dir];
    assert.ok(fx >= 0 && fy >= 0 && fx < W && fy < RULES.gridHeight && !taken.has(fy * W + fx), `${seed}: its Crusher faces a free cell`);
    assert.deepEqual(truckCells(seed), [d.y * W + d.x, d.crusher.y * W + d.crusher.x]);
  }
  assert.ok(found >= 36, `nearly every yard has room for the truck (${found} of 40)`);
  assert.equal(yardFor(TUTORIAL_SEED).delivery, undefined, 'no truck in a lesson');
  assert.equal(yardFor('classic-truck').delivery, undefined, 'none on a classic yard');
});

test('the kept cells refuse a part until the truck comes, and as its shift starts it lands there and the cells are the yard again', () => {
  const seed = seeds.find((s) => yardFor(s).delivery)!;
  const d = yardFor(seed).delivery!;
  const s = newRun(seed);
  assert.deepEqual(s.layout.reserved, truckCells(seed), 'kept from the first shift');
  apply(s, { t: 'pick', i: 0 });
  const part = s.bin[s.bin.length - 1];
  assert.throws(
    () => apply(s, { t: 'place', id: part.id, x: d.x, y: d.y, dir: 0 }),
    (e: unknown) => e instanceof RunError && /scrap truck/.test(e.message),
  );
  const at4 = upTo(seed, RULES.yard.truck.shift);
  assert.equal(at4.layout.reserved, undefined, 'the cells are the yard again');
  const hopper = at4.layout.machines.find((m) => m.x === d.x && m.y === d.y)!;
  const crusher = at4.layout.machines.find((m) => m.x === d.crusher.x && m.y === d.crusher.y)!;
  assert.deepEqual([hopper.kind, hopper.dir, crusher.kind, crusher.dir], ['hopper', d.dir, 'crusher', d.crusher.dir]);
  assert.equal(new Set(at4.layout.machines.map((m) => m.id)).size, at4.layout.machines.length, 'fresh ids');
  const before = upTo(seed, RULES.yard.truck.shift - 1);
  assert.ok(!before.layout.machines.some((m) => m.x === d.x && m.y === d.y), 'not a shift early');
  assert.deepEqual(truckLoad(seed, RULES.yard.truck.shift + 1, at4.layout), [], 'it comes once');
});

test("a job machine's card can stand in front of the truck's Crusher, and its plan earns exactly what the card said", () => {
  let lit = 0;
  for (const seed of seeds) {
    const s = upTo(seed, RULES.yard.truck.shift);
    const d = yardFor(seed).delivery;
    if (!d || !s.job) continue;
    for (const [i, kind] of s.offers.entries()) {
      const parts = cardParts(kind, s.job, seed);
      if (parts[0] === 'hopper' || parts.length < 2) continue;
      const run = structuredClone(s);
      const belts = run.bin.filter((m) => m.kind === 'conveyor').length;
      const { gain, plan } = cardGain(run.layout, parts, belts);
      if (!gain) continue;
      const before = runLayout(run.layout).earned;
      apply(run, { t: 'pick', i });
      for (const p of plan) {
        const part = run.bin.find((m) => m.kind === p.kind)!;
        for (const a of dropActions(run, part, p.x, p.y, p.dir)) apply(run, a);
      }
      assert.equal(runLayout(run.layout).earned, before + gain, `${seed} ${kind}: ${JSON.stringify(plan)}`);
      const fx = d.crusher.x + [1, 0, -1, 0][d.crusher.dir],
        fy = d.crusher.y + [0, 1, 0, -1][d.crusher.dir];
      if (plan.some((p) => p.x === fx && p.y === fy && p.kind === parts[0])) lit++;
    }
  }
  assert.ok(lit >= 5, `on several yards the card's machine goes in front of the truck's Crusher (${lit})`);
});

test('the yard in words names the kept cells until the truck comes', () => {
  const seed = seeds.find((s) => yardFor(s).delivery)!;
  const lines = yardLines(newRun(seed));
  assert.equal(lines.filter((l) => /kept for the scrap truck$/.test(l)).length, 2);
  assert.equal(yardLines(upTo(seed, RULES.yard.truck.shift)).filter((l) => /kept for the scrap truck$/.test(l)).length, 0);
});

test('as the truck comes, a card whose tag says it pays has a plan once picked: the coach builds on the yard with the truck', () => {
  let checked = 0;
  for (const seed of seeds) {
    const s = upTo(seed, RULES.yard.truck.shift);
    if (!yardFor(seed).delivery) continue;
    const worths = offerWorths(s);
    for (const [i, w] of worths.entries()) {
      if (!(w.gain > 0)) continue;
      const run = structuredClone(s);
      const belts = run.bin.filter((m) => m.kind === 'conveyor').length;
      const parts = cardParts(run.offers[i], run.job, seed);
      const { plan } = cardGain(run.layout, parts, belts);
      apply(run, { t: 'pick', i });
      assert.deepEqual(cardPlan(run), plan, `${seed} ${run.picks.at(-1)}: the coach's plan is the tag's`);
      checked++;
    }
  }
  assert.ok(checked >= 40, `cards that pay as the truck comes (${checked})`);
});
