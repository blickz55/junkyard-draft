import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanPlayer, rankText, shareText } from '../game/src/render/share';

test('share text: verified runs state rank, player and rules version; unverified runs say so', () => {
  const base = { seed: 'daily-2026-10-25', score: 1234, rulesVersion: 2, rounds: [38, 120, 300, 300, 238, 238] };
  const verified = shareText({ ...base, player: 'jon', rank: { n: 3, of: 17 } });
  assert.match(verified, /^Junkyard Draft — seed daily-2026-10-25: \$1234\n/);
  assert.match(verified, /rounds \$38 · \$120 · \$300 · \$300 · \$238 · \$238/);
  assert.match(verified, /#3 of 17 on the verified board as jon \(replay re-simulated, rules v2\)/);
  const local = shareText(base);
  assert.match(local, /local score, not yet verified \(rules v2\)/);
  assert.doesNotMatch(local, /verified board/);
  assert.equal(rankText({ n: null, of: 100 }), 'not in the top 100 of the verified board');
  assert.equal(rankText(null), '');
});

test('player names are trimmed, whitespace-collapsed and capped at 32 characters', () => {
  assert.equal(cleanPlayer('  jon   flynn  '), 'jon flynn');
  assert.equal(cleanPlayer('x'.repeat(50)).length, 32);
  assert.equal(cleanPlayer(null), '');
});
