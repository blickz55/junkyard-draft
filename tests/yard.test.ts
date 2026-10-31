// Rules v4: the seed builds the yard. Same seed, same yard; different seeds, different yards; every yard can be played: a belt that
// runs, straight pieces for the recipe, rubble that never walls anything off, a job whose machine is guaranteed, and star marks that
// mean what they say (the plain recipe earns two, on every yard).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { apply, draftOffers, newRun, runStars, RunError, shippedTotal, TUTORIAL_OFFERS, TUTORIAL_SEED } from '../game/src/sim/run';
import { isClassicSeed, isTutorialSeed, JOB_MACHINE, priceOf, starsFor, TUTORIAL_GAP, yardFor } from '../game/src/sim/yard';
import { RULES } from '../game/src/sim/rules';
import { runLayout, validateLayout } from '../game/src/sim/sim';
import { straightPieces } from './e2e/line';
import { plainLine } from '../tools/job-study';

const seeds = Array.from({ length: 300 }, (_, i) => `yard-${i}`);
const signature = (seed: string) => JSON.stringify(yardFor(seed));

test('a yard is a pure function of its seed, and different seeds open on different yards (the same board every time was the bug)', () => {
  for (const s of seeds.slice(0, 30)) assert.equal(signature(s), signature(s), s);
  assert.ok(new Set(seeds.map(signature)).size >= seeds.length * 0.98, 'practically no two yards alike');
  const belts = new Set(seeds.map((s) => JSON.stringify(yardFor(s).machines)));
  assert.ok(belts.size >= seeds.length * 0.6, `${belts.size} different belts in ${seeds.length} yards`);
  const shapes = new Set(seeds.map((s) => yardFor(s).machines.filter((m) => m.kind === 'conveyor').length));
  assert.ok(shapes.size >= 3, `belt lengths vary: ${[...shapes].join(', ')}`);
  const bends = seeds.filter(
    (s) =>
      new Set(
        yardFor(s)
          .machines.filter((m) => m.kind === 'conveyor')
          .map((m) => m.dir),
      ).size > 1,
  ).length;
  assert.ok(bends > seeds.length / 2 && bends < seeds.length, `most belts bend, some run straight (${bends} of ${seeds.length})`);
  const headings = new Set(seeds.map((s) => yardFor(s).machines[0].dir));
  assert.equal(headings.size, 4, 'hoppers face every way');
});

test('every generated yard is playable: the belt ships scrap as it stands, the recipe has straight pieces, rubble is scattered, the job is set', () => {
  for (const seed of seeds) {
    const s = newRun(seed);
    const y = yardFor(seed);
    assert.deepEqual(validateLayout(s.layout), [], `${seed}: legal`);
    assert.equal(s.layout.machines.filter((m) => m.kind === 'hopper').length, 1, `${seed}: one hopper`);
    assert.equal(s.layout.machines.filter((m) => m.kind === 'dock').length, 1, `${seed}: one dock`);
    assert.ok(runLayout(s.layout).shipped.scrap >= 35, `${seed}: the belt ships scrap before anything is built (${runLayout(s.layout).shipped.scrap})`);
    assert.ok(straightPieces(s).length >= RULES.yard.straightPieces, `${seed}: ${straightPieces(s).length} straight pieces`);
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

test("the job's parts are guaranteed: the crusher in the first draft, the job's own machine in the second", () => {
  for (const seed of seeds) {
    const job = yardFor(seed).job!;
    assert.ok(draftOffers(seed, 1).includes('crusher'), `${seed}: crusher in draft 1`);
    assert.ok(draftOffers(seed, 2).includes(JOB_MACHINE[job.material]), `${seed}: ${JOB_MACHINE[job.material]} in draft 2`);
    for (const r of [1, 2]) assert.equal(new Set(draftOffers(seed, r)).size, 3, `${seed}: three different cards in draft ${r}`);
  }
  const positions = new Set(seeds.map((s) => draftOffers(s, 2).indexOf(JOB_MACHINE[yardFor(s).job!.material])));
  assert.equal(positions.size, 3, 'the guaranteed card is shuffled among the three');
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

test('star marks mean what they say: the plain recipe from shift 2 earns exactly two stars on every yard, and is never enough for the third', () => {
  for (const seed of seeds.slice(0, 80)) {
    const job = yardFor(seed).job!;
    const { shipped } = plainLine(seed);
    assert.equal(starsFor(job, shipped), 2, `${seed}: ${shipped} ${job.material}s against ${job.stars.join('/')}`);
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
  apply(s, { t: 'place', id: piece.id, x: TUTORIAL_GAP.x, y: TUTORIAL_GAP.y, dir: 1 });
  assert.ok(runLayout(s.layout).shipped.scrap >= 30, 'the conveyor, facing down the belt, closes the gap: fed from its side, it is the corner');
  assert.deepEqual(TUTORIAL_OFFERS[2], ['crusher']);
  assert.deepEqual(TUTORIAL_OFFERS[3], ['furnace']);
  assert.equal(TUTORIAL_OFFERS[4].length, 3, 'shift 4 is the first real choice');
  assert.deepEqual(RULES.job.lessonStars, s.job!.stars);

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
