import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSim, runLayout, step } from '../game/src/sim/sim';
import { RULES } from '../game/src/sim/rules';
import { starterLayout, newRun, apply, replay, draftOffers, RunError } from '../game/src/sim/run';
import { exportReplay, decodeReplay, encodeReplay, verifyReplay } from '../game/src/sim/replay';
import type { Layout, Machine, Dir, MachineKind } from '../game/src/sim/types';

let nid = 100;
const m = (kind: MachineKind, x: number, y: number, dir: Dir = 0): Machine => ({ id: nid++, kind, x, y, dir });
const lay = (...machines: Machine[]): Layout => ({ width: 8, height: 6, machines });

test('starter layout ships raw scrap: hopper period and conveyor latency', () => {
  const r = runLayout(starterLayout().layout, 80);
  // hopper emits at ticks 2,4,...,80 (40 items); the 3-conveyor path takes 3 ticks to the dock, so the last few are in transit
  assert.equal(r.spawned, 40);
  assert.equal(r.shipped.scrap, 38);
  assert.equal(r.earned, 38 * RULES.value.scrap);
});

test('crusher turns scrap into shards worth $3; throughput limited by processing time', () => {
  const r = runLayout(lay(m('hopper', 0, 0), m('crusher', 1, 0), m('dock', 2, 0)), 40);
  assert.equal(r.shipped.shards > 0, true);
  assert.equal(r.shipped.scrap, 0);
  assert.equal(r.earned, r.shipped.shards * 3);
  const raw2 = runLayout(lay(m('hopper', 0, 0), m('furnace', 1, 0), m('dock', 2, 0)), 80);
  assert.equal(raw2.earned, raw2.shipped.slag * RULES.value.slag, 'slag is worth less than raw scrap sold directly');
  // crusher holds each item for 2 ticks, hopper emits every 2 ticks: no loss
  assert.ok(r.shipped.shards >= 18, `shipped ${r.shipped.shards}`);
});

test('furnace: shards → ingot ($12), raw scrap → slag ($2), furnace is the bottleneck', () => {
  const chain = runLayout(lay(m('hopper', 0, 0), m('crusher', 1, 0), m('furnace', 2, 0), m('dock', 3, 0)), 80);
  assert.ok(chain.shipped.ingot > 0 && chain.shipped.shards === 0 && chain.shipped.slag === 0);
  assert.equal(chain.earned, chain.shipped.ingot * 12);
  const raw = runLayout(lay(m('hopper', 0, 0), m('furnace', 1, 0), m('dock', 2, 0)), 80);
  assert.ok(raw.shipped.slag > 0 && raw.shipped.ingot === 0);
  // the furnace (3 ticks) is slower than the hopper (2 ticks): hopper must report blocked ticks
  const hopperStats = chain.cellStats[0];
  assert.ok(hopperStats.blockedTicks > 0, 'hopper should be blocked by the slow furnace');
});

test('splitter doubles furnace throughput', () => {
  // hopper → crusher → splitter → two furnaces (left/right) → docks
  const single = runLayout(lay(m('hopper', 0, 2), m('crusher', 1, 2), m('furnace', 2, 2), m('dock', 3, 2)), 80);
  const split = runLayout(lay(
    m('hopper', 0, 2), m('crusher', 1, 2), m('splitter', 2, 2, 0),
    m('furnace', 2, 1, 3), m('dock', 2, 0),
    m('furnace', 2, 3, 1), m('dock', 2, 4),
  ), 80);
  assert.ok(split.shipped.ingot > single.shipped.ingot * 1.35, `split ${split.shipped.ingot} vs single ${single.shipped.ingot}`);
});

test('orientation matters: crusher only accepts from behind, conveyors side-load, dock accepts any side', () => {
  // hopper facing a crusher that faces away sideways: crusher input must come from behind
  const wrong = runLayout(lay(m('hopper', 0, 0), m('crusher', 1, 0, 1), m('dock', 2, 0)), 20);
  assert.equal(wrong.spawned, 0);
  assert.ok(wrong.cellStats[0].blockedTicks > 0);
  // side-loading a conveyor from the north then into a dock from the south side
  const side = runLayout(lay(m('hopper', 1, 0, 1), m('conveyor', 1, 1, 0), m('dock', 2, 1)), 20);
  assert.ok(side.shipped.scrap > 0);
  const dockSide = runLayout(lay(m('hopper', 0, 0, 1), m('dock', 0, 1, 0)), 20);
  assert.ok(dockSide.shipped.scrap > 0);
});

test('jams are reported and no item is ever lost or duplicated', () => {
  const s = createSim(lay(m('hopper', 0, 0), m('conveyor', 1, 0), m('conveyor', 2, 0))); // dead end
  for (let i = 0; i < 20; i++) step(s);
  assert.equal(s.items.length, 2);
  assert.ok(s.events.some((e) => e.kind === 'jam'));
  const occupied = s.itemAt.filter(Boolean).length;
  assert.equal(occupied, s.items.length);
});

test('determinism: identical layouts produce identical event streams', () => {
  const a = runLayout(starterLayout().layout, 80);
  const b = runLayout(starterLayout().layout, 80);
  assert.deepEqual(a.events, b.events);
});

test('draft offers are seeded, distinct, and round 1 always includes a crusher', () => {
  for (const seed of ['alpha', 'beta', '42', 'junkyard']) {
    const o1 = draftOffers(seed, 1);
    assert.ok(o1.includes('crusher'), `${seed} round 1 offers ${o1}`);
    assert.equal(new Set(o1).size, 3);
    assert.deepEqual(draftOffers(seed, 3), draftOffers(seed, 3));
  }
  assert.notDeepEqual(draftOffers('alpha', 2), draftOffers('beta', 2));
});

test('run: pick → place → run → next, invalid actions rejected, replay reproduces score', () => {
  const s = newRun('test-seed');
  assert.equal(s.phase, 'draft');
  assert.throws(() => apply(s, { t: 'run' }), RunError);
  const crusherIdx = s.offers.indexOf('crusher');
  apply(s, { t: 'pick', i: crusherIdx });
  const id = s.bin[0].id;
  assert.throws(() => apply(s, { t: 'place', id, x: 2, y: 2, dir: 0 }), /occupied/);
  // move conveyor at (2,2) to bin, put the crusher there
  const conv = s.layout.machines.find((x) => x.x === 2 && x.y === 2)!;
  apply(s, { t: 'unplace', id: conv.id });
  apply(s, { t: 'place', id, x: 2, y: 2, dir: 0 });
  apply(s, { t: 'run' });
  assert.equal(s.phase, 'result');
  assert.ok(s.rounds[0].earned > 38, 'crusher chain beats starter');
  apply(s, { t: 'next' });
  assert.equal(s.round, 2);
  for (let r = 2; r <= RULES.rounds; r++) { apply(s, { t: 'pick', i: 0 }); apply(s, { t: 'run' }); apply(s, { t: 'next' }); }
  assert.equal(s.phase, 'finished');
  const file = exportReplay(s);
  const roundTrip = decodeReplay(encodeReplay(file));
  const v = verifyReplay(roundTrip);
  assert.equal(v.ok, true); assert.equal(v.score, s.score);
  // tampered claim is rejected
  assert.equal(verifyReplay({ ...roundTrip, claimedScore: s.score + 1 }).ok, false);
  // tampered action (placing on occupied cell) is rejected
  const bad = { ...roundTrip, actions: [...roundTrip.actions.slice(0, 1), { t: 'place', id: 6, x: 1, y: 2, dir: 0 } as const, ...roundTrip.actions.slice(1)] };
  assert.equal(verifyReplay(bad).ok, false);
  assert.equal(replay('test-seed', s.actions).score, s.score);
});

test('long east-moving chains advance as a unit (no false jams from a pass cap)', () => {
  const machines: Machine[] = [m('hopper', 0, 0)];
  for (let x = 1; x < 15; x++) machines.push(m('conveyor', x, 0));
  machines.push(m('dock', 15, 0));
  const r = runLayout({ width: 16, height: 1, machines }, 60);
  assert.equal(r.shipped.scrap, 23, 'hopper emits 30 items; 15 cells of latency ⇒ 23 arrive by tick 60');
  assert.equal(r.events.filter((e) => e.kind === 'jam').length, 0);
});

test('malformed actions are rejected by apply and by decodeReplay', () => {
  const s = newRun('v');
  for (const bad of [{ t: 'pick', i: 0.5 }, { t: 'pick', i: -1 }, { t: 'place', id: 1, x: null, y: 2, dir: 0 }, { t: 'place', id: 1, x: 1, y: 1, dir: 4 }, { t: 'foo' }, { t: 'run', extra: 1 }, null, 'run'])
    assert.throws(() => apply(s, bad as never), RunError, JSON.stringify(bad));
  assert.throws(() => decodeReplay(JSON.stringify({ format: 1, rulesVersion: 1, seed: 'x', claimedScore: 0, actions: [{ t: 'pick', i: 'a' }] })), /malformed action/);
  assert.throws(() => decodeReplay(JSON.stringify({ format: 1, rulesVersion: 1, seed: 'x', claimedScore: 0, actions: new Array(5000).fill({ t: 'rotate', id: 1 }) })), /too long/);
});

test('selling a bin part adds the sell bonus to the score and is replay-verified; placed machines cannot be sold', () => {
  const s = newRun('sell-seed');
  apply(s, { t: 'pick', i: 0 });
  const id = s.bin[0].id;
  assert.throws(() => apply(s, { t: 'sell', id: 1 }), /only bin parts/);
  apply(s, { t: 'sell', id });
  assert.equal(s.bin.length, 0); assert.equal(s.score, RULES.sellValue); assert.equal(s.sold, RULES.sellValue);
  assert.throws(() => apply(s, { t: 'sell', id }), RunError);
  for (let r = 1; r <= RULES.rounds; r++) { if (r > 1) apply(s, { t: 'pick', i: 0 }); apply(s, { t: 'run' }); apply(s, { t: 'next' }); }
  assert.equal(verifyReplay(exportReplay(s)).ok, true);
});
