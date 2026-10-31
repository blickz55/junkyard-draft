import { test } from 'node:test';
import assert from 'node:assert/strict';
import { playSeed } from '../tools/autoplay-lib';
import { Rng } from '../game/src/sim/rng';
import { replay, runStars, shippedTotal, TUTORIAL_SEED } from '../game/src/sim/run';
import { RULES_VERSION } from '../game/src/sim/types';

test('autoplayer on the lesson yard ships ingots by shift 3 in every try (the single-card drafts make the recipe unmissable)', () => {
  for (let k = 0; k < 8; k++) {
    const { report, actions } = playSeed(TUTORIAL_SEED, new Rng(`tutorial-try:${k}`), 40);
    const s = replay(TUTORIAL_SEED, actions, RULES_VERSION);
    const ingotsBy3 = s.rounds.slice(0, 3).reduce((n, r) => n + r.result.shipped.ingot, 0);
    assert.ok(ingotsBy3 >= 1, `try ${k}: no ingot by shift 3 (shifts ${JSON.stringify(report.rounds)}, picks ${report.picks.join(',')})`);
    assert.deepEqual(report.picks.slice(0, 2), ['crusher', 'furnace'], 'no pick in shift 1, one card each in shifts 2 and 3');
    assert.equal(s.phase, 'finished');
    assert.ok(runStars(s) >= 2, `try ${k}: the lesson's job is well within reach (${shippedTotal(s, 'ingot')} ingots)`);
  }
});
