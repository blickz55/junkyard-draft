// production roadmap 0.9.4: a watched recording's try payload (extracted from GameScene).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { forkPayload } from '../game/src/render/replayActions';
import { apply, newRun } from '../game/src/sim/run';
import { RULES } from '../game/src/sim/rules';

test('fork payload: null without an origin, before the first round is done and after the last; else the seed, the origin and the round count', () => {
  const s = newRun('try-seed');
  const origin = { hash: 'abc', player: 'Pat#AB12', actions: [{ t: 'pick' as const, i: 0 }] };
  assert.equal(forkPayload(s, null), null);
  assert.equal(forkPayload(s, origin), null, 'no round finished yet');
  apply(s, { t: 'pick', i: 0 });
  apply(s, { t: 'run' });
  assert.deepEqual(forkPayload(s, origin), {
    seed: 'try-seed',
    fresh: false,
    fork: { origin: { hash: 'abc', player: 'Pat#AB12' }, actions: origin.actions, round: 1 },
  });
  assert.deepEqual(forkPayload(s, { ...origin, hash: null })!.fork.origin, { hash: null, player: 'Pat#AB12' }, 'a local recording has no hash');
  for (let r = 2; r <= RULES.rounds; r++) {
    apply(s, { t: 'next' });
    apply(s, { t: 'pick', i: 0 });
    apply(s, { t: 'run' });
  }
  assert.equal(s.rounds.length, RULES.rounds);
  assert.equal(forkPayload(s, origin), null, 'the game is over: nothing to continue');
});
