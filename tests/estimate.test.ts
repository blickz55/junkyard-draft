// What a card says it would add, and a machine lifted out of the line. The first panel lost whole shifts to parts that did nothing until
// the shift ran, and to a hole left in the belt by "Back to the shelf".
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { apply, cardParts, newRun } from '../game/src/sim/run';
import { runLayout } from '../game/src/sim/sim';
import { cardGain } from '../game/src/render/estimate';
import { yardFor } from '../game/src/sim/yard';
import { dropActions, liftActions } from '../game/src/render/placement';
import { RULES } from '../game/src/sim/rules';
import type { RunState } from '../game/src/sim/run';

/** The classic straight line with a crusher and a furnace in it: hopper, crusher, furnace, belt, dock. */
function line(): RunState {
  const s = newRun('classic-estimate');
  const belts = s.layout.machines.filter((m) => m.kind === 'conveyor');
  s.layout.machines = s.layout.machines.filter((m) => m !== belts[0] && m !== belts[1]);
  s.layout.machines.push({ id: 90, kind: 'crusher', x: belts[0].x, y: belts[0].y, dir: 0 }, { id: 91, kind: 'furnace', x: belts[1].x, y: belts[1].y, dir: 0 });
  return s;
}

test('a Crusher on a raw line adds what shards pay over scrap', () => {
  const s = newRun('classic-estimate');
  const scrap = runLayout(s.layout).shipped.scrap;
  assert.equal(cardGain(s.layout, ['crusher']).gain, scrap * (RULES.value.shards - RULES.value.scrap));
});

test('a Tuner beside a slow Furnace reads as a gain, and it is the one the line really gets', () => {
  const s = line();
  const before = runLayout(s.layout).earned;
  const { gain } = cardGain(s.layout, ['tuner']);
  assert.ok(gain > 0);
  const furnace = s.layout.machines.find((m) => m.kind === 'furnace')!;
  const after = runLayout({ ...s.layout, machines: [...s.layout.machines, { id: 92, kind: 'tuner', x: furnace.x, y: furnace.y + 1, dir: 0 }] }).earned;
  assert.equal(before + gain, after);
});

test('a card that needs a partner reads as nothing yet, which is true', () => {
  const s = line();
  assert.equal(cardGain(s.layout, ['press']).gain, 0);
});

test("a card's plan, made with the game's own moves, earns exactly what the card says, on every yard and every card", () => {
  const kinds: Record<string, { lit: number; all: number }> = {};
  for (let i = 0; i < 60; i++) {
    const seed = `plan-${i}`;
    const standard = !yardFor(seed).variant; // a yard that opens with two of the job's machine is short of scrap: a third adds nothing yet
    for (const [at, kind] of newRun(seed).offers.entries()) {
      const run = newRun(seed);
      const before = runLayout(run.layout).earned;
      const parts = cardParts(kind, run.job, seed);
      const { gain, plan, room } = cardGain(run.layout, parts, run.bin.filter((m) => m.kind === 'conveyor').length);
      apply(run, { t: 'pick', i: at });
      const row = standard ? (kinds[parts.join('+')] ??= { lit: 0, all: 0 }) : { lit: 0, all: 0 };
      row.all++;
      if (!gain) {
        if (room)
          assert.deepEqual(
            plan.map((q) => q.kind),
            ['dock'],
            'a Dock for room: one spot',
          );
        else assert.deepEqual(plan, [], 'nothing to light when the card adds nothing');
        continue;
      }
      row.lit++;
      for (const p of plan) {
        const part = run.bin.find((m) => m.kind === p.kind);
        assert.ok(part, `${seed} ${kind}: the shelf holds the ${p.kind} the plan asks for`);
        for (const a of dropActions(run, part, p.x, p.y, p.dir)) apply(run, a);
      }
      assert.equal(runLayout(run.layout).earned, before + gain, `${seed} ${kind}: ${JSON.stringify(plan)}`);
    }
  }
  console.log(JSON.stringify(kinds));
  for (const k of ['hopper+crusher+dock', 'furnace+splitter+dock'])
    assert.ok(kinds[k].lit >= kinds[k].all * 0.8, `${k}: says what it adds on ${kinds[k].lit} of ${kinds[k].all}`);
});

test('a Dock gives a full line room: with every side of the dock taken it is offered a free spot, and the advice says why', () => {
  const s = line();
  const dock = s.layout.machines.find((m) => m.kind === 'dock')!;
  for (const [dx, dy] of [
    [0, -1],
    [0, 1],
    [1, 0],
  ] as const)
    s.layout.machines.push({ id: 200 + dx * 3 + dy, kind: 'conveyor', x: dock.x + dx, y: dock.y + dy, dir: 0 });
  const g = cardGain(s.layout, ['dock'], 4);
  assert.equal(g.gain, 0);
  assert.equal(g.room, true);
  assert.equal(g.plan.length, 1);
  const s2 = line();
  assert.equal(cardGain(s2.layout, ['dock'], 4).room, undefined, 'a dock with a free side needs no other');
});

test('a branch needs its belts: with none on the shelf the card offers only what a single part can do', () => {
  const s = line();
  const { plan } = cardGain(s.layout, ['furnace', 'splitter'], 0);
  assert.ok(!plan.some((p) => p.kind === 'splitter'));
});

test('a machine lifted out of the line leaves a belt piece behind when the shelf has one', () => {
  const s = line();
  s.bin.push({ id: 93, kind: 'conveyor', x: -1, y: -1, dir: 0 });
  s.phase = 'build';
  const crusher = s.layout.machines.find((m) => m.kind === 'crusher')!;
  const { x, y } = crusher;
  for (const a of liftActions(s, crusher)) apply(s, a);
  assert.equal(s.layout.machines.find((m) => m.x === x && m.y === y)?.kind, 'conveyor');
  assert.ok(runLayout(s.layout).earned > 0, 'the line still runs, without the crusher');
});

test('with no belt on the shelf, or for a part beside the line, it just comes off', () => {
  const s = line();
  s.phase = 'build';
  const crusher = s.layout.machines.find((m) => m.kind === 'crusher')!;
  assert.deepEqual(liftActions(s, crusher), [{ t: 'unplace', id: crusher.id }]);
  s.layout.machines.push({ id: 94, kind: 'tuner', x: 3, y: 4, dir: 0 });
  s.bin.push({ id: 95, kind: 'conveyor', x: -1, y: -1, dir: 0 });
  assert.deepEqual(
    liftActions(
      s,
      s.layout.machines.find((m) => m.id === 94)!,
    ),
    [{ t: 'unplace', id: 94 }],
  );
});
