import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cardText, CARD_W, CARD_H } from '../game/src/render/card';

const base = { seed: 'daily-2026-10-25', score: 1234, rounds: [38, 120, 300, 300, 238, 238], rulesVersion: 3 };

test('share card text (PLAN-v4 0.7.4): verified standing only when verified; medal and group only when verified; challenge and link when given; a local run never says verified; a fork says practice', () => {
  assert.deepEqual([CARD_W, CARD_H], [1200, 630]);
  const local = cardText({ ...base, verified: false, rank: { n: 3, of: 40 }, medal: 'gold', group: { name: 'Lunch Crew' } });
  assert.equal(local.standing, 'unverified score'); assert.deepEqual(local.extras, [], 'nothing from a board is shown for an unverified run');
  assert.doesNotMatch([local.standing, ...local.extras, local.footer].join('\n'), /\bverified\b/, 'a local card never claims verification');
  assert.match(local.footer, /^junkyard draft · local run · unverified score · rules v3$/);
  assert.equal(local.glyphs, '░▒▓▓▒▒'); assert.equal(local.seedLine, 'Daily 2026-10-25 · 6 rounds'); assert.equal(local.score, '$1234');
  const verified = cardText({ ...base, verified: true, rank: { n: 3, of: 40 }, percentile: 92, n: 40, player: 'Jon#7Q2M', medal: 'gold', group: { name: 'Lunch Crew' }, build: 'abc123' });
  assert.equal(verified.standing, 'better than 92 % of 40 verified runs as Jon#7Q2M');
  assert.deepEqual(verified.extras, ['group Lunch Crew: #3 of 40', 'medal: gold (final board)']);
  assert.equal(verified.footer, 'junkyard draft · verified by re-simulation · rules v3 · build abc123');
  const few = cardText({ ...base, verified: true, rank: { n: 1, of: 2 }, n: 2 }); assert.match(few.standing, /#1 of 2/);
  const bare = cardText({ ...base, verified: true, rank: null }); assert.equal(bare.standing, 'verified by re-simulation');
  const challenge = cardText({ ...base, verified: false, challenge: { player: 'Ann#AB12', score: 1200 }, permalink: 'http://x/?seed=1' });
  assert.deepEqual(challenge.extras, ["beat Ann#AB12's $1200 by $34", 'http://x/?seed=1']);
  assert.deepEqual(cardText({ ...base, score: 1200, verified: false, challenge: { player: 'Ann#AB12', score: 1200 } }).extras, ["tied Ann#AB12's $1200"]);
  const fork = cardText({ ...base, verified: false, fork: { player: 'Jon#7Q2M', round: 2 } });
  assert.equal(fork.standing, "practice fork of Jon#7Q2M's run from round 3"); assert.equal(fork.footer, 'junkyard draft · practice fork · not a ranked score');
});
