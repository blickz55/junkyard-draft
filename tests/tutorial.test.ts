import { test } from 'node:test';
import assert from 'node:assert/strict';
import { playSeed } from '../tools/autoplay-lib';
import { Rng } from '../game/src/sim/rng';
import { replay, TUTORIAL_SEED } from '../game/src/sim/run';
import { RULES_VERSION } from '../game/src/sim/types';

test('autoplayer on the tutorial seed reaches ingots by round 3 in every try (the constrained drafts make the lesson unmissable)', () => {
  const tries = 8;
  for (let k = 0; k < tries; k++) {
    const { report, actions } = playSeed(TUTORIAL_SEED, new Rng(`tutorial-try:${k}`), 40);
    const s = replay(TUTORIAL_SEED, actions, RULES_VERSION);
    const ingotsBy3 = s.rounds.slice(0, 3).reduce((n, r) => n + r.result.shipped.ingot, 0);
    assert.ok(ingotsBy3 >= 1, `try ${k}: no ingot in rounds 1-3 (rounds ${JSON.stringify(report.rounds)}, picks ${report.picks.join(',')})`);
    assert.deepEqual(report.picks.slice(0, 3), ['crusher', 'furnace', 'splitter']);
    assert.equal(s.phase, 'finished');
  }
});
