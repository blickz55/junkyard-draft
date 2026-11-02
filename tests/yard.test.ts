// Rules v4: the seed builds the yard. Same seed, same yard; different seeds, different yards; every yard can be played: a belt that
// runs, straight pieces for the recipe, rubble that never walls anything off, a job whose machine is guaranteed, and star marks that
// mean what they say (the plain recipe earns two, on every yard).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { apply, cardParts, draftOffers, newRun, runStars, RunError, shippedTotal, TUTORIAL_SEED } from '../game/src/sim/run';
import { isClassicSeed, isTutorialSeed, JOB_MACHINE, lessonYard, priceOf, starsFor, yardFor } from '../game/src/sim/yard';
import { RULES } from '../game/src/sim/rules';
import { runLayout, validateLayout } from '../game/src/sim/sim';
import { straightPieces } from './e2e/line';

const seeds = Array.from({ length: 300 }, (_, i) => `yard-${i}`);
const signature = (seed: string) => JSON.stringify(yardFor(seed));

test('a yard is a pure function of its seed, and different seeds open on different yards (the same board every time was the bug)', () => {
  for (const s of seeds.slice(0, 30)) assert.equal(signature(s), signature(s), s);
  assert.ok(new Set(seeds.map(signature)).size >= seeds.length * 0.98, 'practically no two yards alike');
  const belts = new Set(seeds.map((s) => JSON.stringify(yardFor(s).machines)));
  assert.ok(belts.size >= seeds.length * 0.6, `${belts.size} different belts in ${seeds.length} yards`);
  const shapes = new Set(seeds.map((s) => yardFor(s).machines.length));
  assert.ok(shapes.size >= 3, `belt lengths vary: ${[...shapes].join(', ')}`);
  const line = (s: string) => yardFor(s).machines.filter((m) => m.kind !== 'hopper' && m.kind !== 'dock');
  const bends = seeds.filter((s) => new Set(line(s).map((m) => m.dir)).size > 1).length;
  assert.ok(bends > seeds.length / 2 && bends < seeds.length, `most belts bend, some run straight (${bends} of ${seeds.length})`);
  const headings = new Set(seeds.map((s) => yardFor(s).machines[0].dir));
  assert.equal(headings.size, 4, 'hoppers face every way');
});

test("every generated yard opens with the job's line running: it ships the job's goods as it stands, rubble is scattered, the job is set", () => {
  for (const seed of seeds) {
    const s = newRun(seed);
    const y = yardFor(seed);
    assert.deepEqual(validateLayout(s.layout), [], `${seed}: legal`);
    assert.equal(s.layout.machines.filter((m) => m.kind === 'hopper').length, 1, `${seed}: one hopper`);
    assert.equal(s.layout.machines.filter((m) => m.kind === 'dock').length, y.variant === 'twoMakers' ? 2 : 1, `${seed}: one dock, or two`);
    const shipped = runLayout(s.layout).shipped[s.job!.material];
    assert.ok(shipped >= 15, `${seed}: the line ships the job's goods before anything is built (${shipped})`);
    assert.ok(
      straightPieces(s).length >= RULES.yard.straightPieces - (y.variant === 'twoMakers' ? 3 : 2),
      `${seed}: ${straightPieces(s).length} straight pieces left`,
    );
    assert.ok(y.rubble.length >= RULES.yard.rubbleMin && y.rubble.length <= RULES.yard.rubbleMax, `${seed}: ${y.rubble.length} piles`);
    const xy = (c: number) => ({ x: c % RULES.gridWidth, y: Math.floor(c / RULES.gridWidth) });
    for (const c of y.rubble) {
      const p = xy(c);
      assert.ok(!s.layout.machines.some((m) => m.x === p.x && m.y === p.y), `${seed}: rubble never under a machine`);
      for (const o of y.rubble)
        if (o !== c) assert.ok(Math.abs(xy(o).x - p.x) + Math.abs(xy(o).y - p.y) > 1, `${seed}: piles never touch, so nothing is walled off`);
    }
    assert.ok(s.job, `${seed}: a job`);
    assert.equal(s.layout.premium, s.job!.material);
    assert.deepEqual(
      s.bin.map((m) => m.kind),
      RULES.yard.shelf,
      `${seed}: spare conveyors for corners on the shelf`,
    );
    assert.equal(s.phase, 'draft');
  }
  const jobs = seeds.map((s) => yardFor(s).job!.material);
  assert.ok(jobs.includes('ingot') && jobs.includes('plate'), 'both kinds of job occur');
  assert.ok(jobs.filter((j) => j === 'ingot').length > jobs.filter((j) => j === 'plate').length, 'ingot jobs are the common ones');
});

test("a card can always widen the line: a Hopper brings its Crusher and the job's machine a Splitter, each with a Dock of its own (rules v10); lessons and classic yards deal single parts", () => {
  for (const seed of seeds) {
    const job = yardFor(seed).job!;
    assert.deepEqual(cardParts('hopper', job, seed), ['hopper', 'crusher', 'dock']);
    assert.deepEqual(cardParts(JOB_MACHINE[job.material], job, seed), [JOB_MACHINE[job.material], 'splitter', 'dock']);
    assert.deepEqual(cardParts('tuner', job, seed), ['tuner']);
  }
  assert.deepEqual(cardParts('hopper', null), ['hopper']);
  assert.deepEqual(cardParts('hopper', yardFor('tutorial-2').job, 'tutorial-2'), ['hopper']);
});

test('rubble cannot be built on, and the refusal is the rules, not the interface', () => {
  const seed = seeds.find((s) => yardFor(s).rubble.length > 0)!;
  const s = newRun(seed);
  apply(s, { t: 'pick', i: 0 });
  const c = s.layout.rubble![0];
  const part = s.bin[0];
  assert.throws(
    () => apply(s, { t: 'place', id: part.id, x: c % 8, y: Math.floor(c / 8), dir: 0 }),
    (e: unknown) => e instanceof RunError && /rubble/.test(e.message),
  );
  assert.ok(s.bin.includes(part), 'the part stays on the shelf');
  assert.ok(validateLayout({ ...s.layout, machines: [{ id: 99, kind: 'conveyor', x: c % 8, y: Math.floor(c / 8), dir: 0 }] }).some((e) => /rubble/.test(e)));
});

test("the job's product sells for the job's price on its yard and the list price elsewhere; stars count what shipped over the game", () => {
  const layout = (premium?: 'ingot' | 'plate') => ({
    width: 8,
    height: 6,
    premium,
    machines: [
      { id: 1, kind: 'hopper' as const, x: 0, y: 0, dir: 0 as const },
      { id: 2, kind: 'crusher' as const, x: 1, y: 0, dir: 0 as const },
      { id: 3, kind: 'furnace' as const, x: 2, y: 0, dir: 0 as const },
      { id: 4, kind: 'dock' as const, x: 3, y: 0, dir: 0 as const },
    ],
  });
  const list = runLayout(layout());
  const job = runLayout(layout('ingot'));
  assert.equal(list.shipped.ingot, job.shipped.ingot, 'the same line ships the same');
  assert.equal(job.earned, list.shipped.ingot * RULES.job.price);
  assert.equal(list.earned, list.shipped.ingot * RULES.value.ingot);
  assert.equal(runLayout(layout('plate')).earned, list.earned, 'a plate job pays nothing extra for ingots');
  assert.equal(priceOf({ premium: 'plate' }, 'plate'), RULES.job.price);
  assert.equal(priceOf({ premium: 'plate' }, 'ingot'), RULES.value.ingot);
  assert.equal(priceOf({}, 'ingot'), RULES.value.ingot);
  const j = { material: 'ingot' as const, stars: [10, 20, 30] as const };
  assert.deepEqual(
    [0, 9, 10, 19, 20, 29, 30, 99].map((n) => starsFor(j, n)),
    [0, 0, 1, 1, 2, 2, 3, 3],
  );
});

test('orders: each one filled raises every price, a miss costs only the raise, and the stars count orders filled', () => {
  const s = newRun('orders-yard');
  const job = s.job!;
  const line = runLayout(s.layout).earned;
  assert.ok(line >= job.orders![0], 'the line as it opens fills the first order');
  while (s.phase !== 'finished') {
    if (s.phase === 'draft') apply(s, { t: 'pick', i: 0 });
    apply(s, { t: 'run' });
    apply(s, { t: 'next' });
  }
  assert.equal(s.rounds[0].earned, line);
  assert.ok(s.filled >= 1);
  assert.equal(s.rounds[1].layout.rate, 100 + RULES.job.raise, 'the raise reached shift 2');
  assert.equal(runStars(s), starsFor(job, s.filled));
  const rates = s.rounds.map((r) => r.layout.rate ?? 100);
  assert.deepEqual(
    rates,
    rates.slice().sort((a, b) => a - b),
    'a miss takes nothing back',
  );
});

test('the second buyer: from their shift the other product sells at the job price, and never before', () => {
  const s = newRun('buyer-yard');
  const other = s.job!.material === 'ingot' ? 'plate' : 'ingot';
  for (let r = 1; r <= RULES.rounds; r++) {
    assert.equal(s.layout.premium2, r >= RULES.job.secondBuyerFrom ? other : undefined, `shift ${r}`);
    apply(s, { t: 'pick', i: 0 });
    apply(s, { t: 'run' });
    apply(s, { t: 'next' });
  }
});

test('namespaces: the lesson yard has a gap at its bend and one conveyor to close it, no pick in shift 1; the classic yard is the old straight belt with no job', () => {
  assert.equal(isTutorialSeed(TUTORIAL_SEED), true);
  assert.equal(isTutorialSeed('tutorialish'), false);
  const s = newRun(TUTORIAL_SEED);
  assert.equal(s.phase, 'build', 'the lesson opens building: the first job is the belt');
  assert.deepEqual(s.offers, []);
  assert.deepEqual(
    s.bin.map((m) => m.kind),
    ['conveyor'],
  );
  assert.equal(runLayout(s.layout).earned, 0, 'with the gap open nothing reaches the dock');
  const piece = s.bin[0];
  apply(s, { t: 'place', id: piece.id, x: 4, y: 1, dir: 1 });
  assert.ok(runLayout(s.layout).shipped.scrap >= 30, 'the conveyor, facing down the belt, closes the gap: fed from its side, it is the corner');
  assert.deepEqual(draftOffers(TUTORIAL_SEED, 2), lessonYard(TUTORIAL_SEED)!.offers[2]);
  assert.equal(draftOffers(TUTORIAL_SEED, 3)[0], 'furnace');
  assert.equal(draftOffers(TUTORIAL_SEED, 4).length, 3, 'past its script a lesson yard deals an ordinary draft');

  assert.equal(isClassicSeed('classic-x'), true);
  const c = newRun('classic-x');
  assert.equal(c.job, null);
  assert.deepEqual(c.bin, []);
  assert.equal(c.layout.rubble, undefined);
  assert.equal(c.layout.premium, undefined);
  assert.deepEqual(
    c.layout.machines.map((m) => `${m.kind}@${m.x},${m.y}`),
    RULES.starter.map((m) => `${m.kind}@${m.x},${m.y}`),
  );
  assert.equal(runStars(c), 0);
  assert.equal(shippedTotal(c, 'ingot'), 0);
});

test('rules v9: yards open three ways, and a variant changes only its own pieces: a second job machine with its own Dock behind a Splitter, or a Tuner at the job machine', async () => {
  const { override } = await import('../tools/balance-lib');
  const W = RULES.gridWidth;
  const by: Record<string, number> = { standard: 0, twoMakers: 0, tuned: 0 };
  for (let i = 0; i < 90; i++) {
    const seed = `variant-${i}`;
    const y = yardFor(seed);
    by[y.variant ?? 'standard']++;
    const restore = override({ 'yard.variants.twoMakers': 0, 'yard.variants.tuned': 0 });
    const plain = yardFor(seed);
    restore();
    assert.deepEqual([y.rubble, y.job?.material], [plain.rubble, plain.job?.material], `${seed}: the same rubble and job`);
    const pct = RULES.yard.orderScale[y.variant ?? 'standard'][y.job!.material];
    assert.deepEqual(
      y.job!.orders,
      RULES.job.orders[y.job!.material].map((o) => Math.round((o * pct) / 1000) * 10),
      `${seed}: orders scaled to the variant, to the $10`,
    );
    const res = runLayout(newRun(seed).layout);
    const maker = JOB_MACHINE[y.job!.material];
    const at = (m: { x: number; y: number }) => res.cellStats[m.y * W + m.x];
    if (y.variant === 'twoMakers') {
      assert.equal(y.machines.filter((m) => m.kind === maker).length, 2, `${seed}: two of the job machine`);
      assert.equal(y.machines.length, plain.machines.length + 2, `${seed}: a machine and a Dock more`);
      for (const d of y.machines.filter((m) => m.kind === 'dock')) assert.ok(at(d)?.shipped, `${seed}: both docks sell`);
    } else if (y.variant === 'tuned') {
      const tuner = y.machines.find((m) => m.kind === 'tuner')!;
      assert.deepEqual(y.machines.slice(0, -1), plain.machines, `${seed}: the line as it stood, and a Tuner`);
      assert.ok(at(tuner)?.tuned, `${seed}: the Tuner speeds the job machine`);
    } else assert.deepEqual(y.machines, plain.machines);
  }
  assert.ok(by.standard >= 15 && by.twoMakers >= 15 && by.tuned >= 15, JSON.stringify(by));
});
