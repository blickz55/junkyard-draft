import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanPlayer, rankText, shareText, roundGlyph, roundGrid, seedLabel, standingText, SHARE_GLYPHS } from '../game/src/render/share';

const base = { seed: 'daily-2026-10-25', score: 1234, rulesVersion: 2, rounds: [38, 120, 300, 300, 238, 238] };

test('share grid (PLAN-v1 0.4.3): glyph thresholds at their boundaries, six glyphs per run, monochrome text', () => {
  assert.equal(roundGlyph(0), '░'); assert.equal(roundGlyph(100), '░'); assert.equal(roundGlyph(101), '▒');
  assert.equal(roundGlyph(250), '▒'); assert.equal(roundGlyph(251), '▓'); assert.equal(roundGlyph(400), '▓'); assert.equal(roundGlyph(401), '█'); assert.equal(roundGlyph(9999), '█');
  assert.equal(roundGrid(base.rounds), '░▒▓▓▒▒');
  assert.equal(roundGrid([]).length, 0);
  for (const g of SHARE_GLYPHS) assert.equal(g.length, 1);
  assert.deepEqual(SHARE_GLYPHS, ['░', '▒', '▓', '█'], 'shape-only glyphs: readable under any colour vision and in plain text');
});

test('share text: spoiler-free by default — label, score, glyph line, standing, no URL, no per-round dollars, no layout data', () => {
  const local = shareText(base);
  assert.equal(local, 'Junkyard Draft · Daily 2026-10-25 · $1234\n░▒▓▓▒▒\nlocal score, not yet verified');
  assert.doesNotMatch(local, /https?:|rounds \$|verified board/);
  assert.doesNotMatch(local, /hopper|conveyor|crusher|furnace|splitter|press|dock|\bdir\b|\d,\d/i, 'no layout data of any kind');
  const verifiedRank = shareText({ ...base, player: 'jon', rank: { n: 3, of: 17 } });
  assert.match(verifiedRank, /\n#3 of 17 on the verified board as jon$/, 'under five runs the rank is the standing');
  const verifiedPct = shareText({ ...base, player: 'jon', rank: { n: 3, of: 17 }, percentile: 61, n: 38 });
  assert.match(verifiedPct, /\nbetter than 61 % of 38 verified runs as jon$/, 'five or more runs: percentile beats rank');
  assert.equal(standingText({ rank: { n: 1, of: 1 }, percentile: 0, n: 1 }), '#1 of 1 on the verified board', 'a population of one never says "better than 0 %"');
  assert.equal(standingText({ rank: null }), '');
  assert.equal(rankText({ n: null, of: 100 }), 'not in the top 100 of the verified board');
  assert.equal(seedLabel('tutorial-1'), 'Tutorial'); assert.equal(seedLabel('rust-bolt-123'), 'seed rust-bolt-123');
});

test('share text: days played and the opt-in permalink append lines; the detailed variant adds per-round dollars and the rules version', () => {
  assert.match(shareText({ ...base, daysPlayed: 1 }), /\n1 day played$/);
  assert.match(shareText({ ...base, daysPlayed: 12 }), /\n12 days played$/);
  assert.doesNotMatch(shareText({ ...base, daysPlayed: 0 }), /played/);
  const withLink = shareText({ ...base, permalink: 'https://example.test/?scene=game&seed=daily-2026-10-25' });
  assert.match(withLink, /\nhttps:\/\/example\.test\/\?scene=game&seed=daily-2026-10-25$/);
  const detailed = shareText({ ...base, variant: 'detailed', player: 'jon', rank: { n: 3, of: 17 } });
  assert.match(detailed, /\nrounds \$38 · \$120 · \$300 · \$300 · \$238 · \$238\n/);
  assert.match(detailed, /replay re-simulated by the verifier, rules v2/);
  assert.match(shareText({ ...base, variant: 'detailed' }), /\nrules v2$/);
});

test('player names are trimmed, whitespace-collapsed and capped at 32 characters', () => {
  assert.equal(cleanPlayer('  jon   flynn  '), 'jon flynn');
  assert.equal(cleanPlayer('x'.repeat(50)).length, 32);
  assert.equal(cleanPlayer(null), '');
});

test('badges in share text (PLAN-v1 0.4.6): only the detailed variant of a verified run lists them', () => {
  const base = { seed: 'x', score: 500, rulesVersion: 2, rounds: [50, 50, 100, 100, 100, 100], badges: ['Clean', 'All Hands'], rerolls: 2 };
  assert.doesNotMatch(shareText(base), /badges/, 'unverified: never');
  assert.doesNotMatch(shareText({ ...base, rank: { n: 1, of: 1 } }), /badges/, 'verified grid variant: no');
  assert.match(shareText({ ...base, rank: { n: 1, of: 1 }, variant: 'detailed' }), /\nrerolls: 2 \(−\$80\)\n[\s\S]*badges: Clean · All Hands$/, 'verified detailed: yes');
  assert.doesNotMatch(shareText({ ...base, badges: [], rank: { n: 1, of: 1 }, variant: 'detailed' }), /badges/);
});
