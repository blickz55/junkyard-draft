import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { forkFrom } from '../game/src/sim/fork';
import { forkLabel } from '../game/src/content/fork';
import { apply, replay as replayRun, type Action } from '../game/src/sim/run';
import { exportReplay } from '../game/src/sim/replay';
import { RULES } from '../game/src/sim/rules';

const DIR = path.resolve(process.cwd(), 'tests', 'golden');
const files = fs.readdirSync(DIR).filter((f) => f.endsWith('.json') && f !== 'INDEX.json');
interface Golden {
  seed: string;
  rulesVersion: number;
  actions: Action[];
  claimedScore: number;
}
const origin = { hash: 'f'.repeat(64), player: 'Jon#7Q2M' };

test('fork (PLAN-v4 0.7.3): for every golden replay and every round, the fork equals the replay after that round, the rest re-simulates to the same final score, and a fork is never exportable', () => {
  assert.ok(files.length >= 5, `golden corpus present (${files.length})`);
  for (const f of files) {
    const g = JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8')) as Golden;
    const full = replayRun(g.seed, g.actions, g.rulesVersion);
    assert.equal(full.score, g.claimedScore, `${f}: the corpus still re-simulates`);
    for (let n = 1; n < RULES.rounds; n++) {
      const fork = forkFrom(g.seed, g.actions, g.rulesVersion, n, origin);
      assert.equal(fork.rounds.length, n, `${f} n=${n}: ${n} rounds done`);
      assert.equal(fork.round, n + 1);
      assert.equal(fork.phase, 'draft');
      assert.equal(
        fork.score - fork.sold + fork.rerolls * RULES.rerollCost,
        full.rounds.slice(0, n).reduce((a, r) => a + r.earned, 0),
        'score after n rounds = earnings − reroll costs + sold parts',
      );
      assert.deepEqual(
        fork.rounds.map((r) => r.earned),
        full.rounds.slice(0, n).map((r) => r.earned),
      );
      assert.deepEqual(fork.layout.machines, full.rounds[n - 1].layout.machines, 'the layout is the one that ran round n');
      assert.deepEqual(fork.forkedFrom, { ...origin, round: n });
      // the remaining actions of the original replay continue the fork to the same end
      const rest = g.actions.slice(fork.actions.length);
      for (const a of rest) apply(fork, a);
      assert.equal(fork.score, full.score, `${f} n=${n}: the rest re-simulates deterministically`);
      assert.equal(fork.rounds.length, RULES.rounds);
      assert.throws(() => exportReplay(fork), /forked run cannot be exported/, 'a fork never becomes a replay file');
    }
    assert.throws(() => forkFrom(g.seed, g.actions, g.rulesVersion, 0, origin), /between 1 and/);
    assert.throws(() => forkFrom(g.seed, g.actions, g.rulesVersion, RULES.rounds, origin), /between 1 and/);
    assert.throws(() => forkFrom(g.seed, g.actions.slice(0, 3), g.rulesVersion, 2, origin), /only \d+ finished round/);
    assert.throws(() => forkFrom(g.seed, g.actions, g.rulesVersion + 1, 1, origin), /rules version/);
  }
  assert.equal(forkLabel({ ...origin, round: 3 }), 'a try from Jon#7Q2M after round 3 · practice');
});
