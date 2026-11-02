// The fun card's arithmetic (docs/GOALS.md). The card steers rules changes, so what it adds up has to be right; what it says about the
// game comes from running it, and its own check is that ruined versions of the game score lower (`tools/fun-card.ts --validate`).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newRun } from '../game/src/sim/run';
import { runLayout } from '../game/src/sim/sim';
import { Rng } from '../game/src/sim/rng';
import { cardOf, evaluate, lastStarShift, median, paidGame, scale, solve, type PathResult, type YardResult, type YardTree } from '../tools/fun-lib';
import { read, underOrders, type Orders } from '../tools/fun-orders';

const ORDERS_TABLE = [100, 400, 600, 800, 1000, 1200];
const JOB = { material: 'ingot', stars: [2, 4, 6], orders: ORDERS_TABLE } as const;

test('scale runs from bad to good, either way round, and stops at the ends', () => {
  assert.equal(scale(5, 0, 10), 50);
  assert.equal(scale(-1, 0, 10), 0);
  assert.equal(scale(11, 0, 10), 100);
  assert.equal(scale(0.1, 0.5, 0), 80, 'less is better here');
});

test('a game is paid with the raises its orders earned, and a miss by under a tenth is counted as close', () => {
  const g = paidGame([100, 400, 400, 420, 400, 400], JOB);
  assert.deepEqual(g.pay, [100, 500, 600, 735, 700, 700]);
  assert.deepEqual(g.filled, [1, 2, 3]);
  assert.equal(g.close, 1, 'the 800 order is missed by under a tenth, the others by far');
});

test('the last star lands in the shift of the order that earned it', () => {
  assert.equal(lastStarShift([1, 2, 3, 4, 5, 6], JOB), 6);
  assert.equal(lastStarShift([1, 3, 5, 6], JOB), 6);
  assert.equal(lastStarShift([1, 2, 5], JOB), 2);
  assert.equal(lastStarShift([3], JOB), 0);
});

test('the search reads the rules as a shift does, and never hands back less than it started from', () => {
  const run = newRun('fun-test-1');
  assert.equal(evaluate(run.layout).earned, runLayout(run.layout).earned);
  const free = run.layout.machines.filter((m) => m.kind === 'conveyor').length + 2;
  const start = evaluate(run.layout).earned;
  const plan = solve(run.layout, ['tuner'], free, 4, 60, new Rng('t'), new Set(), run.job);
  assert.ok(plan.earned > start, 'a tuner beside the slowest machine pays');
  assert.equal(plan.earned, runLayout(plan.layout).earned);
  assert.deepEqual(plan.spare, []);
});

function path(picks: string[], rounds: number[], units: number[], stars: number): PathResult {
  return {
    picks: picks as PathResult['picks'],
    rounds,
    units,
    score: rounds.reduce((a, b) => a + b, 0),
    stars,
    belts: 0,
    filled: [1, 2, 3, 4, 5, 6],
    close: 0,
  };
}
function yard(seed: string, novice: number, casual: number, competent: number, best: PathResult): YardResult {
  const tree: YardTree = {
    seed,
    job: JOB,
    offers: Array.from({ length: 6 }, () => ['crusher', 'furnace', 'hopper']),
    best,
    scores: [best.score],
    nearBestSets: ['a', 'b', 'c'],
    choices: Array.from({ length: 6 }, () => ({ offered: ['crusher', 'furnace', 'hopper'], values: [100, 98, 80], taken: 0 })),
    limits: ['saturated:furnace', 'saturated:crusher', 'starved:furnace', 'dead-end:hopper', 'balanced:-', 'balanced:-'],
    forgiving: 0.7,
    nodes: 1,
  };
  const tier = (score: number, units: number, stars: number) => ({ score, units, stars, close: 1 });
  return { tree, tiers: { novice: tier(novice, 60, 1), casual: tier(casual, 148, 2), competent: tier(competent, 150, 2) }, deeper: best.score * 1.06 };
}

test('a yard set that does everything right reads full marks where it should', () => {
  const rising = path(['crusher', 'furnace', 'hopper', 'tuner', 'press', 'dock'], [100, 300, 500, 700, 900, 1100], [0, 20, 30, 40, 50, 60], 3);
  const yards = ['a', 'b', 'c'].map((s, i) =>
    yard(s, 400, 1000 + i, 2000 + i, { ...rising, picks: rising.picks.slice().reverse().slice(0, 6), score: 3600 + i * 400 }),
  );
  yards[0].tree.best = rising;
  const c = cardOf(yards);
  const named = Object.fromEntries(c.dimensions.map((d) => [d.name, d]));
  assert.equal(named['Alive to the last shift'].read.flatSteps, 0);
  assert.equal(named['Every pick a real choice'].read.realPicks, 1);
  assert.equal(named['Skill shows'].read.tiersInOrder, 1);
  assert.equal(named['The problem keeps moving'].read.limitsPerGame, 5);
  assert.ok(c.total > 70, `total ${c.total}`);
  assert.equal(median([3, 1, 2]), 2);
});

const ORDERS: Orders = { label: 't', ingot: [100, 400, 600, 800, 1000, 1200], plate: [100, 300, 400, 500, 600, 700], raise: 0.25, miss: 'reset' };

test('a filled order raises what the rest of the game pays, a miss takes the raises back', () => {
  const p = underOrders([100, 400, 500, 800, 800, 800], JOB, ORDERS);
  assert.deepEqual(p.pay, [100, 500, 750, 1400, 1600, 1800]);
  assert.equal(p.filled, 6);
  const q = underOrders([100, 400, 400, 800, 800, 800], JOB, ORDERS);
  assert.deepEqual(q.pay, [100, 500, 600, 1400, 1600, 1800], 'the third order is just filled by the raise');
  const r = underOrders([100, 100, 500, 500, 500, 500], JOB, ORDERS);
  assert.equal(r.pay[1], 125);
  assert.equal(r.pay[2], 500, 'the miss took the raise back');
  assert.equal(r.filled, 1);
});

test('where a miss closes the yard the game ends there, and a miss by under a tenth is counted as close', () => {
  const o: Orders = { ...ORDERS, miss: 'end', raise: 0 };
  const p = underOrders([100, 400, 550, 800, 800, 800], JOB, o);
  assert.deepEqual(p.pay, [100, 400, 550]);
  assert.equal(p.shifts, 3);
  assert.equal(p.close, 1);
});

test('a reading adds up the best path and what each kind of player fills', () => {
  const steady = path(['crusher', 'furnace', 'hopper', 'tuner', 'press', 'dock'], [100, 500, 500, 500, 500, 500], [0, 20, 20, 20, 20, 20], 2);
  const late = path(['crusher', 'tuner', 'hopper', 'tuner', 'press', 'dock'], [100, 100, 100, 100, 100, 1800], [0, 0, 0, 0, 0, 60], 1);
  const tree = {
    job: JOB,
    offers: Array.from({ length: 6 }, () => ['crusher', 'furnace', 'hopper', 'tuner', 'press', 'dock']),
    paths: [steady, late],
  } as unknown as YardTree;
  const r = read([{ tree, novice: { rounds: [50, 50, 50, 50, 50, 50] }, casual: { rounds: steady.rounds }, competent: { rounds: steady.rounds } }], {
    ...ORDERS,
    raise: 0,
    miss: 'keep',
  });
  assert.equal(r.medians.expert, 2600);
  assert.equal(r.filled.casual, 2);
});
