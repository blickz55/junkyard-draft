/**
 * Share text for a finished run (PLAN-v1 0.4.3). Pure so it can be unit-tested; never claims verification it does not have.
 * The default is spoiler-free: a label, the score, six glyphs (one per round) on fixed published thresholds of round
 * earnings, the verified standing when there is one, days played, and no URL unless asked. Per-round dollars live in the
 * "detailed" variant. Nothing here carries a layout, and the glyphs are monochrome text (shape, not colour).
 */
import { RULES } from '../sim/rules';
export interface Rank { n: number | null; of: number }
export interface ShareInput {
  seed: string; score: number; rulesVersion: number; rounds: number[];
  player?: string; rank?: Rank | null;
  /** verified standing from the histogram: share of other verified runs beaten and the population */
  percentile?: number | null; n?: number;
  /** UTC days with at least one finished run on this device */
  daysPlayed?: number;
  /** consecutive verified dailies (PLAN-v3 0.6.3); the detailed variant says "17 days · 5 in a row" from two */
  streak?: number;
  /** medal of this run's verified entry on a frozen daily (PLAN-v3 0.6.4); detailed variant only, only when the server sent thresholds */
  medal?: string;
  /** the challenge this run answered (PLAN-v4 0.7.1): the detailed variant says how it went */
  challenge?: { player: string; score: number };
  /** appended only when the player opts in */
  permalink?: string;
  variant?: 'grid' | 'detailed';
  /** non-ranked badge titles; shown only in the detailed variant of a verified run */
  badges?: string[];
  /** rerolls bought (rules v3); the detailed variant shows the deduction so the score reads as production + sales − rerolls */
  rerolls?: number;
}

export const PLAYER_MAX = 32;
export const cleanPlayer = (raw: string | null | undefined): string => (raw ?? '').replace(/\s+/g, ' ').trim().slice(0, PLAYER_MAX);

/** Published round-earnings thresholds: ░ ≤ $100, ▒ ≤ $250, ▓ ≤ $400, █ above. */
export const SHARE_THRESHOLDS: readonly number[] = [100, 250, 400];
export const SHARE_GLYPHS: readonly string[] = ['░', '▒', '▓', '█'];
export const roundGlyph = (earned: number): string => SHARE_GLYPHS[SHARE_THRESHOLDS.filter((t) => earned > t).length];
export const roundGrid = (rounds: number[]): string => rounds.map(roundGlyph).join('');

/** "Daily 2026-10-25", "Tutorial", or "seed xyz". */
export function seedLabel(seed: string): string {
  const d = /^daily-(\d{4}-\d{2}-\d{2})$/.exec(seed); if (d) return `Daily ${d[1]}`;
  if (/^tutorial-/.test(seed)) return 'Tutorial';
  return `seed ${seed}`;
}

export function rankText(rank: Rank | null | undefined): string {
  if (!rank) return '';
  if (rank.n == null) return `not in the top ${rank.of} of the verified board`;
  return `#${rank.n} of ${rank.of} on the verified board`;
}

/** The verified standing line: percentile once five or more verified runs exist, else the rank, else nothing. */
export function standingText(s: Pick<ShareInput, 'rank' | 'percentile' | 'n' | 'player'>): string {
  if (!s.rank) return '';
  const who = s.player ? ` as ${s.player}` : '';
  if (s.percentile != null && (s.n ?? 0) >= 5) return `better than ${s.percentile} % of ${s.n} verified runs${who}`;
  return `${rankText(s.rank)}${who}`;
}

export function shareText(s: ShareInput): string {
  const lines: string[] = [`Junkyard Draft · ${seedLabel(s.seed)} · $${s.score}`, roundGrid(s.rounds)];
  const standing = standingText(s);
  lines.push(standing || `local score, not yet verified`);
  if (s.variant === 'detailed') {
    lines.push(`rounds ${s.rounds.map((r) => `$${r}`).join(' · ')}`);
    if (s.rerolls) lines.push(`rerolls: ${s.rerolls} (−$${s.rerolls * RULES.rerollCost})`);
    lines.push(s.rank ? `replay re-simulated by the verifier, rules v${s.rulesVersion}` : `rules v${s.rulesVersion}`);
    if (s.rank && s.badges?.length) lines.push(`badges: ${s.badges.join(' · ')}`);
    if (s.rank && s.medal) lines.push(`medal: ${s.medal} (final board)`);
    if (s.challenge) { const d = s.score - s.challenge.score; lines.push(d > 0 ? `beat ${s.challenge.player}'s $${s.challenge.score} by $${d}` : d < 0 ? `short of ${s.challenge.player}'s $${s.challenge.score} by $${-d}` : `tied ${s.challenge.player}'s $${s.challenge.score}`); }
  }
  if (s.daysPlayed && s.daysPlayed > 0) lines.push(s.variant === 'detailed' && s.streak && s.streak >= 2 ? `${s.daysPlayed} day${s.daysPlayed === 1 ? '' : 's'} · ${s.streak} in a row` : `${s.daysPlayed} day${s.daysPlayed === 1 ? '' : 's'} played`);
  if (s.permalink) lines.push(s.permalink);
  return lines.join('\n');
}
