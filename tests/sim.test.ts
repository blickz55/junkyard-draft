import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSim, runLayout, step, cellIndex } from '../game/src/sim/sim';
import { RULES } from '../game/src/sim/rules';
import { starterLayout, newRun, apply, replay, draftOffers, RunError, MAX_REPLAY_ACTIONS, actionBudget, sanitizeSeed, isTutorialSeed, TUTORIAL_SEED, TUTORIAL_SPARE_CONVEYORS } from '../game/src/sim/run';
import { createHash } from 'node:crypto';
import { exportReplay, decodeReplay, encodeReplay, verifyReplay, validateReplayFile } from '../game/src/sim/replay';
import { RULES_VERSION, type Layout, type Machine, type Dir, type MachineKind } from '../game/src/sim/types';

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
  assert.equal(replay('test-seed', s.actions, RULES_VERSION).score, s.score);
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

test('press: two shards become one $8 plate, scrap passes through, absorbed shards are accounted, only from behind', () => {
  const line = runLayout(lay(m('hopper', 0, 0), m('crusher', 1, 0), m('press', 2, 0), m('dock', 3, 0)), 80);
  assert.ok(line.shipped.plate > 0, 'plates shipped');
  assert.equal(line.shipped.shards, 0, 'no loose shards leave a fed press');
  assert.equal(line.earned, line.shipped.plate * RULES.value.plate);
  // every plate consumed one extra shard; at most one more sits in the press store at the end
  assert.ok(line.absorbed === line.shipped.plate || line.absorbed === line.shipped.plate + 1 || line.absorbed === line.shipped.plate + 2, `absorbed ${line.absorbed} vs plates ${line.shipped.plate}`);
  const inTransit = line.spawned - line.absorbed - Object.values(line.shipped).reduce((a, b) => a + b, 0);
  assert.ok(inTransit >= 0 && inTransit <= 4, `in transit ${inTransit}`);
  assert.ok(line.events.some((e) => e.kind === 'absorb') && line.events.some((e) => e.kind === 'transform' && e.to === 'plate'));
  const stored = line.cellStats[2].stored;
  assert.ok(stored === 0 || stored === 1, `press store at round end is 0 or 1, got ${stored}`);
  assert.equal(line.absorbed, line.cellStats[2].processed + stored, 'every absorbed shard either became part of a plate or is still stored');
  const raw = runLayout(lay(m('hopper', 0, 0), m('press', 1, 0), m('dock', 2, 0)), 40);
  assert.ok(raw.shipped.scrap > 0 && raw.absorbed === 0 && raw.shipped.plate === 0, 'raw scrap passes through a press unchanged');
  const wrong = runLayout(lay(m('hopper', 0, 0), m('press', 1, 0, 1), m('dock', 2, 0)), 20);
  assert.equal(wrong.spawned, 0, 'press only accepts from behind');
  // the decision: a furnace earns more on a single crusher line, but the press backs the crusher up less
  const furnaceLine = runLayout(lay(m('hopper', 0, 0), m('crusher', 1, 0), m('furnace', 2, 0), m('dock', 3, 0)), 80);
  assert.ok(furnaceLine.earned > line.earned, `furnace ${furnaceLine.earned} should beat press ${line.earned}`);
  assert.ok(line.earned > 2 * 3 * line.shipped.plate, 'a plate is worth more than the two shards it took');
  assert.ok(line.cellStats[1].jammedTicks < furnaceLine.cellStats[1].jammedTicks, 'crusher waits less behind a press than behind a furnace');
});

test('rules version 2: new runs carry it, replays from other versions are rejected, press picks replay-verify', () => {
  const s = newRun('press-seed');
  assert.equal(s.rulesVersion, RULES_VERSION); // the current version, whatever it is (rules-v3 branch: 3)
  // play a run that places a press whenever one is offered
  for (let r = 1; r <= RULES.rounds; r++) {
    const pi = s.offers.indexOf('press'); apply(s, { t: 'pick', i: pi >= 0 ? pi : 0 });
    const part = s.bin[s.bin.length - 1];
    if (part.kind === 'press') { const conv = s.layout.machines.find((x) => x.x === 3 && x.y === 2); if (conv) apply(s, { t: 'unplace', id: conv.id }); apply(s, { t: 'place', id: part.id, x: 3, y: 2, dir: 0 }); }
    apply(s, { t: 'run' }); apply(s, { t: 'next' });
  }
  const file = exportReplay(s);
  assert.equal(verifyReplay(file).ok, true);
  const old = verifyReplay({ ...file, rulesVersion: 1 });
  assert.equal(old.ok, false); assert.match(old.error ?? '', /rules version/);
  // a press is offered somewhere in the first rounds across a handful of seeds (weight 10 of 106)
  const seen = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'].some((seed) => [1, 2, 3, 4, 5, 6].some((r) => draftOffers(seed, r).includes('press')));
  assert.ok(seen, 'press appears in draft offers');
});

// ---- review findings (2026-10-26): boundaries between live play, saves and replays

test('all_replay_entry_points_require_explicit_version: missing, null or foreign rules versions are rejected everywhere', () => {
  const s = newRun('ver-seed');
  for (let r = 1; r <= RULES.rounds; r++) { apply(s, { t: 'pick', i: 0 }); apply(s, { t: 'run' }); apply(s, { t: 'next' }); }
  const file = exportReplay(s);
  assert.equal(verifyReplay(file).ok, true);
  for (const bad of [undefined, null, '2', 2.5, 1, 99]) {
    const v = verifyReplay({ ...file, rulesVersion: bad as unknown as number });
    assert.equal(v.ok, false, `rulesVersion ${String(bad)} must not verify`);
    assert.match(v.error ?? '', /rules version/);
  }
  assert.throws(() => decodeReplay(JSON.stringify({ ...file, rulesVersion: undefined })), /rules version/);
  assert.throws(() => decodeReplay(JSON.stringify({ ...file, rulesVersion: null })), /rules version/);
  assert.throws(() => validateReplayFile({ ...file, seed: 'x'.repeat(65) }), /seed/);
  assert.throws(() => validateReplayFile({ ...file, claimedScore: 'big' }), /claimed score/);
  // replay() itself no longer defaults the version
  assert.throws(() => replay('ver-seed', s.actions, undefined as unknown as number), /rules version missing/);
});

test('every_live_save_remains_resumable: seed bounds apply at creation and the action budget always leaves room to finish', () => {
  assert.throws(() => newRun('x'.repeat(65)), RunError);
  assert.throws(() => newRun(''), RunError);
  assert.equal(sanitizeSeed('  spaced   out  seed  '), 'spaced out seed');
  assert.equal(sanitizeSeed('y'.repeat(100)).length, 64);
  assert.equal(sanitizeSeed('   '), 'junkyard');
  assert.equal(newRun('x'.repeat(64)).seed.length, 64, 'the maximum length is playable');
  // fill the history with legal edits (rotating the dock changes nothing but counts as an action)
  const s = newRun('budget-seed');
  apply(s, { t: 'pick', i: 0 });
  const dock = s.layout.machines.find((m) => m.kind === 'dock')!;
  let rejected: Error | null = null;
  for (let i = 0; i < MAX_REPLAY_ACTIONS; i++) { try { apply(s, { t: 'rotate', id: dock.id }); } catch (e) { rejected = e as Error; break; } }
  assert.ok(rejected instanceof RunError && /action limit/.test(rejected.message), 'edits stop before the replay cap');
  assert.ok(s.actions.length < MAX_REPLAY_ACTIONS, `${s.actions.length} actions leave headroom`);
  // the game can still be finished: pick/run/next are always allowed, and the result verifies
  apply(s, { t: 'run' }); apply(s, { t: 'next' });
  for (let r = 2; r <= RULES.rounds; r++) { apply(s, { t: 'pick', i: 0 }); apply(s, { t: 'run' }); apply(s, { t: 'next' }); }
  assert.equal(s.phase, 'finished');
  assert.ok(s.actions.length <= MAX_REPLAY_ACTIONS);
  assert.equal(verifyReplay(exportReplay(s)).ok, true, 'a run played to the limit is still replayable');
  assert.equal(actionBudget(s).essential >= 0, true);
});

test('tuner (rules v3, PLAN-v2 0.5.3): adjacent processors hold one tick less on any side, never under one tick, tuners do not stack, nothing else is affected, no item ever enters a tuner', () => {
  const line = (extra: Machine[]) => runLayout(lay(m('hopper', 0, 1), m('crusher', 1, 1), m('furnace', 2, 1), m('dock', 3, 1), ...extra), 60);
  const plain = line([]);
  for (const [x, y] of [[2, 0], [2, 2]] as const) { // above and below the furnace
    const tuned = line([m('tuner', x, y)]);
    assert.ok(tuned.shipped.ingot > plain.shipped.ingot, `tuner at ${x},${y}: ${tuned.shipped.ingot} ingots > ${plain.shipped.ingot}`);
    assert.equal(tuned.cellStats[cellIndex(x, y, 8)]?.tuned, tuned.cellStats[cellIndex(2, 1, 8)]!.processed, 'every item the furnace processed was credited to the tuner');
  }
  // left/right of a processor: a tuner beside the crusher (whose hold is 2 → 1) speeds the crusher, not the furnace
  const side = runLayout(lay(m('hopper', 0, 1), m('crusher', 1, 1), m('dock', 2, 1), m('tuner', 1, 0)), 40);
  const sidePlain = runLayout(lay(m('hopper', 0, 1), m('crusher', 1, 1), m('dock', 2, 1)), 40);
  assert.ok(side.shipped.shards >= sidePlain.shipped.shards, 'a crusher next to a tuner holds 1 tick instead of 2');
  assert.ok((side.cellStats[cellIndex(1, 0, 8)]?.tuned ?? 0) > 0);
  // two tuners do not stack and the hold never drops under one tick: crusher 2 → 1 with one tuner equals two tuners
  const two = runLayout(lay(m('hopper', 0, 1), m('crusher', 1, 1), m('dock', 2, 1), m('tuner', 1, 0), m('tuner', 1, 2)), 40);
  assert.equal(two.shipped.shards, side.shipped.shards, 'the second tuner adds nothing');
  assert.equal((two.cellStats[cellIndex(1, 0, 8)]?.tuned ?? 0) + (two.cellStats[cellIndex(1, 2, 8)]?.tuned ?? 0), side.cellStats[cellIndex(1, 0, 8)]?.tuned, 'one credit per item, to one tuner');
  // non-processors are untouched: a tuner beside conveyors and the dock changes nothing
  const conv = runLayout(lay(m('hopper', 0, 1), m('conveyor', 1, 1), m('conveyor', 2, 1), m('dock', 3, 1), m('tuner', 1, 0), m('tuner', 3, 0)), 40);
  const convPlain = runLayout(lay(m('hopper', 0, 1), m('conveyor', 1, 1), m('conveyor', 2, 1), m('dock', 3, 1)), 40);
  assert.equal(conv.earned, convPlain.earned); assert.equal((conv.cellStats[cellIndex(1, 0, 8)]?.tuned ?? 0) + (conv.cellStats[cellIndex(3, 0, 8)]?.tuned ?? 0), 0);
  // nothing enters a tuner: a hopper facing it is blocked
  const blocked = runLayout(lay(m('hopper', 0, 1), m('tuner', 1, 1)), 10);
  assert.equal(blocked.spawned, 0); assert.ok((blocked.cellStats[cellIndex(0, 1, 8)]?.blockedTicks ?? 0) > 0);
  // conservation holds with tuners in the line
  const t = line([m('tuner', 2, 0)]);
  assert.ok(t.spawned >= Object.values(t.shipped).reduce((a, b) => a + b, 0) + t.absorbed);
});

test('round-tiered offers (PLAN-v2 0.5.3): the tuner is never offered before round 3, the seven 0.2.0 machines are available in every round, offers depend on seed and round only', () => {
  const seen: Record<number, Set<string>> = {};
  for (let i = 0; i < 300; i++) for (let r = 1; r <= RULES.rounds; r++) for (const k of draftOffers(`tier-${i}`, r)) (seen[r] ||= new Set()).add(k);
  for (const r of [1, 2]) assert.ok(!seen[r].has('tuner'), `no tuner in round ${r}`);
  assert.ok([3, 4, 5, 6].some((r) => seen[r].has('tuner')), 'the tuner is offered from round 3');
  for (let r = 1; r <= RULES.rounds; r++) for (const k of ['conveyor', 'crusher', 'furnace', 'splitter', 'hopper', 'press', 'dock']) assert.ok(seen[r].has(k), `${k} is offered in round ${r} over 300 seeds`);
  assert.ok(![...Object.values(seen)].some((s) => s.has('sieve')), 'the experimental sieve is never offered');
  assert.deepEqual(draftOffers('tier-7', 4), draftOffers('tier-7', 4), 'deterministic per (seed, round)');
});

test('tutorial seed (PLAN-v1 0.3.4): rounds 1-3 offer one machine each, three spare conveyors start in the bin, rounds 4-6 draft normally; every other seed\'s offers are byte-identical to before', () => {
  assert.equal(isTutorialSeed(TUTORIAL_SEED), true); assert.equal(isTutorialSeed('tutorial-x'), true); assert.equal(isTutorialSeed('junkyard'), false);
  assert.deepEqual([1, 2, 3].map((r) => draftOffers(TUTORIAL_SEED, r)), [['crusher'], ['furnace'], ['splitter']]);
  for (const r of [4, 5, 6]) assert.equal(draftOffers(TUTORIAL_SEED, r).length, 3, 'rounds 4-6 are an ordinary draft');
  const s = newRun(TUTORIAL_SEED);
  assert.equal(s.bin.length, TUTORIAL_SPARE_CONVEYORS); assert.ok(s.bin.every((m) => m.kind === 'conveyor'));
  assert.equal(newRun('junkyard').bin.length, 0, 'ordinary seeds start with an empty bin');
  // snapshot taken before the tutorial table existed: the offer streams of ordinary seeds are unchanged
  const h = createHash('sha256'); for (let i = 0; i < 50; i++) for (let r = 1; r <= 6; r++) h.update(JSON.stringify(draftOffers('snap-' + i, r)));
  for (const seed of ['junkyard', 'e2e-seed', 'auto-12', 'daily-2026-10-29']) for (let r = 1; r <= 6; r++) h.update(JSON.stringify(draftOffers(seed, r)));
  assert.equal(h.digest('hex'), 'f02d6c589664e9af03d5f484f8db16d5d2ce9458c8da941acbea0228712a9959', 'OFFERS_SNAPSHOT: draftOffers for non-tutorial seeds must not change without a RULES_VERSION bump (rules v3: the tuner joins the pool from round 3, so the v2 snapshot b016e31a… was retired with the bump)');
  // a tutorial run replays and verifies like any other
  apply(s, { t: 'pick', i: 0 });
  assert.throws(() => apply(s, { t: 'pick', i: 1 }), RunError, 'only one offer exists');
  const conv = s.layout.machines.find((m) => m.x === 2 && m.y === 2)!; apply(s, { t: 'unplace', id: conv.id });
  apply(s, { t: 'place', id: s.bin.find((m) => m.kind === 'crusher')!.id, x: 2, y: 2, dir: 0 });
  apply(s, { t: 'run' }); apply(s, { t: 'next' });
  assert.ok(s.rounds[0].result.shipped.shards > 0, 'round 1 ships shards');
  for (let r = 2; r <= RULES.rounds; r++) { apply(s, { t: 'pick', i: 0 }); apply(s, { t: 'run' }); apply(s, { t: 'next' }); }
  const v = verifyReplay(exportReplay(s));
  assert.deepEqual({ ok: v.ok, score: v.score }, { ok: true, score: s.score });
});
