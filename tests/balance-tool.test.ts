// Balance tooling (PLAN-v2 0.5.1): paired deltas, metadata, replay-verified action lists, executable gate, deterministic output.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runBalance, gateVerdict, verifyActions, runRerollStudy, gateReroll } from '../tools/balance-lib';
import { improve, playSeed, scoreSanityBound } from '../tools/autoplay-lib';
import { Rng } from '../game/src/sim/rng';
import { newRun } from '../game/src/sim/run';
import { RULES } from '../game/src/sim/rules';
import { RULES_VERSION } from '../game/src/sim/types';

const SMALL = { machine: 'press' as const, seeds: 3, tries: 6, prefix: 'bt', policies: ['greedy' as const], build: 'test' };
// one shared run: the autoplayer search is CPU-bound and node --test runs files in parallel with the browser suites
const SHARED = runBalance(SMALL);

test('runBalance: shape, paired per-seed deltas, metadata and replay-verified action lists on a small press job', () => {
  const r = SHARED;
  assert.deepEqual(
    { v: r.meta.rulesVersion, build: r.meta.build, machine: r.meta.machine, seeds: r.meta.seeds, tries: r.meta.tries, policies: r.meta.policies },
    { v: RULES_VERSION, build: 'test', machine: 'press', seeds: 3, tries: 6, policies: ['greedy'] },
  );
  assert.match(r.meta.searchStream, /search/);
  assert.match(r.meta.offerStream, /draft/);
  assert.equal(r.meta.sanityBound, scoreSanityBound());
  assert.equal(r.policies.length, 1);
  const p = r.policies[0];
  assert.equal(p.policy, 'greedy');
  assert.deepEqual(
    p.variants.map((v) => v.label),
    ['baseline', 'ban press (never drafted)'],
  );
  const base = p.variants[0];
  assert.ok(base.vsBan, 'baseline carries the paired comparison against the ban');
  assert.equal(base.vsBan!.paired.length, 3);
  for (const d of base.vsBan!.paired) {
    assert.equal(d.delta, d.baseline - d.ban);
    assert.match(d.seed, /^bt-\d$/);
  }
  assert.equal(base.vsBan!.seedsBetter + base.vsBan!.seedsWorse + base.vsBan!.seedsEqual, 3);
  assert.equal(p.verified, true, `every reported score re-simulated from its actions: ${p.unverified.join(', ')}`);
  for (const [label, bySeed] of Object.entries(r.actions.greedy))
    for (const [seed, acts] of Object.entries(bySeed)) {
      const claimed = label === 'baseline' ? base.vsBan!.paired.find((d) => d.seed === seed)!.baseline : base.vsBan!.paired.find((d) => d.seed === seed)!.ban;
      assert.ok(verifyActions(seed, acts, claimed), `${label}/${seed} actions replay to the reported score`);
    }
  assert.ok(
    p.variants.every((v) => v.max <= r.meta.sanityBound),
    'no score above the derived sanity bound',
  );
});

test('runBalance is deterministic: two runs with identical options agree on every number (timing and timestamp aside)', () => {
  const strip = (x: ReturnType<typeof runBalance>) => ({ ...x, meta: { ...x.meta, ms: 0, at: '' } });
  assert.deepEqual(strip(SHARED), strip(runBalance(SMALL)));
});

test('gateVerdict: passes a healthy result, fails a synthetic regression with a nonzero-exit reason, honours the pick band and verification', () => {
  const r = SHARED;
  const base = r.policies[0].variants[0].vsBan!;
  // a healthy result (whatever the small job says, the gate must agree with its own numbers)
  const healthy = gateVerdict(r, { maxSeedsWorse: base.seedsWorse, minMeanDelta: base.meanDelta - 1 });
  assert.equal(healthy.ok, true, healthy.reasons.join('; '));
  // synthetic failure: pretend one seed got worse and the mean fell
  const broken = JSON.parse(JSON.stringify(r)) as typeof r;
  const vs = broken.policies[0].variants[0].vsBan!;
  vs.paired[0].delta = -50;
  vs.seedsWorse = 1;
  vs.meanDelta = -10;
  const verdict = gateVerdict(broken, { maxSeedsWorse: 0, minMeanDelta: 0 });
  assert.equal(verdict.ok, false);
  assert.ok(
    verdict.reasons.some((x) => /1 seed\(s\) worse/.test(x)) && verdict.reasons.some((x) => /mean paired delta -10/.test(x)),
    verdict.reasons.join('; '),
  );
  // pick-rate band and verification requirement
  const narrow = gateVerdict(r, { maxSeedsWorse: 99, minMeanDelta: -1e9, pickRate: [0.999, 1] });
  assert.equal(narrow.ok, r.policies[0].variants[0].pickRateWhenOffered >= 0.999);
  const unverified = JSON.parse(JSON.stringify(r)) as typeof r;
  unverified.policies[0].verified = false;
  unverified.policies[0].unverified = ['greedy/baseline/bt-0'];
  assert.equal(gateVerdict(unverified, { maxSeedsWorse: 99, minMeanDelta: -1e9 }).ok, false);
  assert.equal(gateVerdict(r, { policy: 'neutral' }).ok, false, 'a policy that was not run cannot pass');
});

test('search policies: neutral accepts plateau moves, never scores below greedy on the same input, and both are deterministic', () => {
  const s = newRun('classic-policy-seed');
  const bin = [...s.bin, { id: 900, kind: 'crusher' as const, x: -1, y: -1, dir: 0 as const }];
  const g1 = improve(s.layout, bin, new Rng('p:g'), 30, 4, 'greedy');
  const g2 = improve(s.layout, bin, new Rng('p:g'), 30, 4, 'greedy');
  const n1 = improve(s.layout, bin, new Rng('p:n'), 30, 4, 'neutral');
  const n2 = improve(s.layout, bin, new Rng('p:n'), 30, 4, 'neutral');
  assert.deepEqual(g1, g2);
  assert.deepEqual(n1, n2);
  assert.ok(n1.earned >= g1.earned, `neutral ${n1.earned} ≥ greedy ${g1.earned}`);
  const seeds = ['pl-0', 'pl-1', 'pl-2'];
  const greedy = seeds.map((x) => playSeed(x, new Rng(`${x}:search:greedy`), 6, { policy: 'greedy' }));
  const neutral = seeds.map((x) => playSeed(x, new Rng(`${x}:search:neutral`), 6, { policy: 'neutral' }));
  for (let i = 0; i < seeds.length; i++) {
    assert.equal(greedy[i].report.policy, 'greedy');
    assert.equal(neutral[i].report.policy, 'neutral');
    assert.deepEqual(greedy[i].report.offers, neutral[i].report.offers, 'offers come from the sim stream and never depend on the search policy');
  }
  assert.ok(
    neutral.some((n, i) => JSON.stringify(n.actions) !== JSON.stringify(greedy[i].actions)),
    'the neutral policy explores different layouts on at least one seed',
  );
});

test('reroll study (PLAN-v2 0.5.4): paired never-vs-greedy on the same seeds, reroll rate, verified actions, gate reasons', () => {
  const st = runRerollStudy({ seeds: 3, tries: 6, prefix: 'rrt' });
  assert.equal(st.paired.length, 3);
  assert.equal(st.summary.rounds, 3 * 6);
  for (const p of st.paired) assert.equal(p.delta, p.greedy - p.never);
  assert.equal(st.verified, true, st.unverified.join(', '));
  assert.ok(st.summary.rerollRate >= 0 && st.summary.rerollRate <= 1);
  assert.equal(
    st.summary.rerolls,
    st.paired.reduce((s, p) => s + p.rerolls, 0),
  );
  const wide = gateReroll(st, { rate: [0, 1], maxSeedsWorse: 99 });
  assert.equal(wide.ok, true, wide.reasons.join('; '));
  const narrow = gateReroll(st, { rate: [0.999, 1] });
  assert.equal(narrow.ok, false);
  const greedyActions = Object.values(st.actions.greedy).flat();
  assert.equal(greedyActions.filter((a) => a.t === 'reroll').length, st.summary.rerolls, 'every counted reroll is a recorded action');
});

test('derived sanity bound and dead-end definitions', () => {
  const hoppers = RULES.starter.filter((m) => m.kind === 'hopper').length + RULES.rounds;
  assert.equal(
    scoreSanityBound(),
    RULES.rounds * hoppers * Math.ceil(RULES.ticksPerRound / RULES.hopperPeriod) * Math.max(...Object.values(RULES.value), RULES.job.price) +
      RULES.rounds * RULES.sellValue,
  );
  const { report } = playSeed('dead-0', new Rng('dead-0:search:greedy'), 5);
  assert.equal(report.deadEnd, report.flatRounds >= RULES.rounds, 'deadEnd means no improving draft in any round');
  assert.equal(report.mostlyFlat, report.flatRounds >= 4);
  assert.ok(report.score <= scoreSanityBound());
});
