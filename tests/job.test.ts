// The job as the player reads it, and the local rank ladder (rules v4).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newRun, TUTORIAL_SEED, type RunState } from '../game/src/sim/run';
import { jobFlavour, jobLine, jobRecipe, jobTarget, missingForJob, nextNeeded, paceOf, starMarks } from '../game/src/content/job';
import { machineBlurb } from '../game/src/content/machines';
import { RANK_STARS, rankFor, rankLine, rankNext } from '../game/src/content/ranks';
import { shareText } from '../game/src/render/share';
import type { Job } from '../game/src/sim/yard';

const ingots: Job = { material: 'ingot', stars: [50, 100, 160] };

test('the job in words: the goal is the third star, the story is stable per yard, the recipe ends at the dock', () => {
  assert.equal(jobTarget(ingots), 160);
  assert.equal(jobLine(ingots), 'Ship 160 ingots');
  assert.equal(jobLine({ material: 'plate', stars: [40, 80, 135] }), 'Ship 135 plates');
  assert.deepEqual(jobRecipe(ingots), ['hopper', 'crusher', 'furnace', 'dock']);
  assert.deepEqual(jobRecipe({ material: 'plate', stars: [1, 2, 3] }), ['hopper', 'crusher', 'press', 'dock']);
  assert.equal(jobFlavour('some-yard', ingots), jobFlavour('some-yard', ingots));
  const lines = new Set(Array.from({ length: 40 }, (_, i) => jobFlavour(`yard-${i}`, ingots)));
  assert.ok(lines.size >= 4, 'yards get different stories');
  assert.match(jobFlavour(TUTORIAL_SEED, ingots), /learn/);
  assert.equal(starMarks(2), '★★');
});

const fake = (shipped: number[], job: Job | null = ingots) =>
  ({
    job,
    round: shipped.length,
    rounds: shipped.map((n, i) => ({ round: i + 1, earned: 0, layout: null, result: { shipped: { ingot: n, plate: 0, shards: 0, scrap: 0, slag: 0 } } })),
  }) as unknown as RunState;

test('the pace: what this shift shipped, what the same again would come to, and what the next star takes per shift', () => {
  const p = paceOf(fake([20, 20]))!;
  assert.deepEqual({ ...p }, { shipped: 40, thisShift: 20, projected: 120, nextStar: 1, perShift: 3 });
  assert.equal(paceOf(fake([170]))!.nextStar, null, 'all three stars in');
  assert.equal(paceOf(fake([10, 10, 10, 10, 10, 10]))!.perShift, null, 'no shifts left');
  assert.equal(paceOf(fake([], null)), null, 'no job, no pace');
  assert.equal(newRun('classic-x').job, null);
});

test('the next needed machine is one at a time, and the advice says what the job lacks before what held the line', () => {
  const s = newRun('needed-yard');
  assert.equal(nextNeeded(s), 'crusher');
  const withCrusher = { ...s, bin: [...s.bin, { id: 99, kind: 'crusher' as const, x: -1, y: -1, dir: 0 as const }] };
  assert.equal(nextNeeded(withCrusher), s.job!.material === 'ingot' ? 'furnace' : 'press');
  assert.equal(nextNeeded(newRun('classic-x')), null);
  const noGoods = { job: s.job, layout: s.layout, rounds: [{ result: { shipped: { ingot: 0, plate: 0 } } }] } as unknown as RunState;
  assert.match(missingForJob(noGoods) ?? '', /^No (ingots|plates) yet\. Your line still needs the Crusher and the (Furnace|Plate Press)\.$/);
  assert.equal(missingForJob({ ...noGoods, rounds: [] }), null, 'nothing to say before a shift');
  assert.equal(missingForJob({ ...noGoods, job: null }), null, 'no job, no such advice');
});

test("a card says what the part's goods are worth on this yard", () => {
  assert.match(machineBlurb('furnace'), /worth \$12/);
  assert.match(machineBlurb('furnace', { premium: 'ingot' }), /worth \$24/, 'the job pays more, and the card says so');
  assert.match(machineBlurb('press', { premium: 'plate' }), /worth \$24/);
  assert.match(machineBlurb('press', { premium: 'ingot' }), /worth \$8/);
});

test('the rank ladder climbs with total stars and says what the next rank takes', () => {
  assert.deepEqual(
    RANK_STARS,
    [...RANK_STARS].sort((a, b) => a - b),
    'in order',
  );
  assert.equal(rankFor(0).name, 'Scrap Picker');
  assert.equal(rankFor(4).name, 'Scrap Picker');
  assert.equal(rankFor(5).name, 'Yard Hand');
  assert.equal(rankFor(14).next?.need, 1);
  assert.equal(rankFor(9999).name, 'Scrap King');
  assert.equal(rankFor(9999).next, null);
  assert.equal(rankLine(1), 'Scrap Picker · 1 star');
  assert.equal(rankLine(7), 'Yard Hand · 7 stars');
  assert.equal(rankNext(7), '8 more stars to Line Boss');
  assert.equal(rankNext(9999), '');
});

test('share text carries the stars only when the yard has a job', () => {
  const base = { seed: 'daily-2026-10-25', score: 1234, rulesVersion: 4, rounds: [50, 150, 300, 350, 200, 184] };
  assert.match(shareText({ ...base, stars: 2 }).split('\n')[0], /· ★★☆$/);
  assert.doesNotMatch(shareText(base), /★/);
});
