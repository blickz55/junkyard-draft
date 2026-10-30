import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanPlayer, rankText, shareText, roundGlyph, roundGrid, seedLabel, standingText, SHARE_GLYPHS } from '../game/src/render/share';

const base = { seed: 'daily-2026-10-25', score: 1234, rulesVersion: 2, rounds: [38, 120, 300, 300, 238, 238] };

test('share grid (PLAN-v1 0.4.3): glyph thresholds at their boundaries, six glyphs per run, monochrome text', () => {
  assert.equal(roundGlyph(0), '░');
  assert.equal(roundGlyph(100), '░');
  assert.equal(roundGlyph(101), '▒');
  assert.equal(roundGlyph(250), '▒');
  assert.equal(roundGlyph(251), '▓');
  assert.equal(roundGlyph(400), '▓');
  assert.equal(roundGlyph(401), '█');
  assert.equal(roundGlyph(9999), '█');
  assert.equal(roundGrid(base.rounds), '░▒▓▓▒▒');
  assert.equal(roundGrid([]).length, 0);
  for (const g of SHARE_GLYPHS) assert.equal(g.length, 1);
  assert.deepEqual(SHARE_GLYPHS, ['░', '▒', '▓', '█'], 'shape-only glyphs: readable under any colour vision and in plain text');
});

test('share text: spoiler-free by default — label, score, glyph line, standing, no URL, no per-round dollars, no layout data', () => {
  const local = shareText(base);
  assert.equal(local, 'Junkyard Draft · Daily 2026-10-25 · $1234\n░▒▓▓▒▒\nscore on this device, not yet checked');
  assert.doesNotMatch(local, /https?:|rounds \$|verified board/);
  assert.doesNotMatch(local, /hopper|conveyor|crusher|furnace|splitter|press|dock|\bdir\b|\d,\d/i, 'no layout data of any kind');
  const verifiedRank = shareText({ ...base, player: 'jon', rank: { n: 3, of: 17 } });
  assert.match(verifiedRank, /\n#3 of 17 on the board as jon$/, 'under five games the rank is the standing');
  const verifiedPct = shareText({ ...base, player: 'jon', rank: { n: 3, of: 17 }, percentile: 61, n: 38 });
  assert.match(verifiedPct, /\nbetter than 61 % of 38 checked games as jon$/, 'five or more games: better-than beats rank');
  assert.equal(standingText({ rank: { n: 1, of: 1 }, percentile: 0, n: 1 }), '#1 of 1 on the board', 'a population of one never says "better than 0 %"');
  assert.equal(standingText({ rank: null }), '');
  assert.equal(rankText({ n: null, of: 100 }), 'not in the top 100 of the board');
  assert.equal(seedLabel('tutorial-1'), 'Lesson');
  assert.equal(seedLabel('rust-bolt-123'), 'yard rust-bolt-123');
});

test('share text: days played and the opt-in permalink append lines; the detailed variant adds per-round dollars and the rules version', () => {
  assert.match(shareText({ ...base, daysPlayed: 1 }), /\n1 day played$/);
  assert.match(shareText({ ...base, daysPlayed: 12 }), /\n12 days played$/);
  assert.doesNotMatch(shareText({ ...base, daysPlayed: 0 }), /played/);
  // challenge (PLAN-v4 0.7.1): detailed variant says how it went
  assert.match(
    shareText({ ...base, score: 1300, challenge: { player: 'Jon#7Q2M', score: 1200 }, variant: 'detailed' }),
    /\nbeat Jon#7Q2M's \$1200 by \$100(\n|$)/,
  );
  assert.match(
    shareText({ ...base, score: 1100, challenge: { player: 'Jon#7Q2M', score: 1200 }, variant: 'detailed' }),
    /\nshort of Jon#7Q2M's \$1200 by \$100(\n|$)/,
  );
  assert.match(shareText({ ...base, score: 1200, challenge: { player: 'Jon#7Q2M', score: 1200 }, variant: 'detailed' }), /\ntied Jon#7Q2M's \$1200(\n|$)/);
  assert.doesNotMatch(shareText({ ...base, score: 1300, challenge: { player: 'Jon#7Q2M', score: 1200 } }), /Jon/, 'the grid never carries it');
  // medal (PLAN-v3 0.6.4): detailed variant, verified entry only
  assert.match(shareText({ ...base, rank: { n: 3, of: 40 }, medal: 'silver', variant: 'detailed' }), /\nmedal: silver \(final board\)(\n|$)/);
  assert.doesNotMatch(shareText({ ...base, rank: { n: 3, of: 40 }, medal: 'silver' }), /medal/, 'the grid never carries it');
  assert.doesNotMatch(shareText({ ...base, medal: 'silver', variant: 'detailed' }), /medal/, 'no verified entry, no medal');
  // streak (PLAN-v3 0.6.3): only the detailed variant, only from two in a row
  assert.match(shareText({ ...base, daysPlayed: 17, streak: 5, variant: 'detailed' }), /\n17 days · 5 in a row(\n|$)/);
  assert.match(shareText({ ...base, daysPlayed: 17, streak: 5 }), /\n17 days played(\n|$)/, 'the spoiler-free grid keeps the plain line');
  assert.match(shareText({ ...base, daysPlayed: 3, streak: 1, variant: 'detailed' }), /\n3 days played(\n|$)/, 'one in a row is not a streak');
  assert.doesNotMatch(shareText({ ...base, daysPlayed: 0, streak: 9, variant: 'detailed' }), /in a row/);
  const withLink = shareText({ ...base, permalink: 'https://example.test/?scene=game&seed=daily-2026-10-25' });
  assert.match(withLink, /\nhttps:\/\/example\.test\/\?scene=game&seed=daily-2026-10-25$/);
  const detailed = shareText({ ...base, variant: 'detailed', player: 'jon', rank: { n: 3, of: 17 } });
  assert.match(detailed, /\nrounds \$38 · \$120 · \$300 · \$300 · \$238 · \$238\n/);
  assert.match(detailed, /\nchecked by the Junkyard Draft server(\n|$)/);
  assert.doesNotMatch(
    shareText({ ...base, variant: 'detailed' }),
    /rules v|checked by/,
    'an unchecked game claims nothing and names no rules version (the glossary: never shown)',
  );
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
  assert.match(
    shareText({ ...base, rank: { n: 1, of: 1 }, variant: 'detailed' }),
    /\nnew offers: 2 \(−\$80\)\n[\s\S]*badges: Clean · All Hands$/,
    'checked detailed: yes',
  );
  assert.doesNotMatch(shareText({ ...base, badges: [], rank: { n: 1, of: 1 }, variant: 'detailed' }), /badges/);
});
