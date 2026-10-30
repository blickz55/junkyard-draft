/**
 * Share text for a finished game (PLAN-v1 0.4.3). Pure so it can be unit-tested; never claims a check it does not have.
 * The default is spoiler-free: a label, the score, six glyphs (one per round) on fixed published thresholds of round
 * earnings, the checked standing when there is one, days played, and no URL unless asked. Per-round dollars live in the
 * "detailed" variant. Nothing here carries a layout, and the glyphs are monochrome text (shape, not colour).
 * Words come from the string table (0.9.0); numbers from the format helpers.
 */
import { RULES } from '../sim/rules';
import { t } from '../content/strings';
import { money, int } from '../content/format';
import { shareYardLabel } from '../content/yard';
export interface Rank {
  n: number | null;
  of: number;
}
export interface ShareInput {
  seed: string;
  score: number;
  rulesVersion: number;
  rounds: number[];
  player?: string;
  rank?: Rank | null;
  /** checked standing from the chart: share of other checked games beaten and the population */
  percentile?: number | null;
  n?: number;
  /** UTC days with at least one finished game on this device */
  daysPlayed?: number;
  /** consecutive checked dailies (PLAN-v3 0.6.3); the detailed variant says "17 days · 5 in a row" from two */
  streak?: number;
  /** medal of this game's checked entry on a closed daily (PLAN-v3 0.6.4); detailed variant only, only when the server sent thresholds */
  medal?: string;
  /** a try from someone's recording (PLAN-v4 0.7.3): the standing line says so in every variant, never a score to rank */
  fork?: { player: string; round: number };
  /** the challenge this game answered (PLAN-v4 0.7.1): the detailed variant says how it went */
  challenge?: { player: string; score: number };
  /** appended only when the player opts in */
  permalink?: string;
  variant?: 'grid' | 'detailed';
  /** non-ranked badge titles; shown only in the detailed variant of a checked game */
  badges?: string[];
  /** new offers bought (rules v3); the detailed variant shows the deduction so the score reads as production + sales − offers */
  rerolls?: number;
}

export const PLAYER_MAX = 32;
export const cleanPlayer = (raw: string | null | undefined): string => (raw ?? '').replace(/\s+/g, ' ').trim().slice(0, PLAYER_MAX);

/** Published round-earnings thresholds: ░ ≤ $100, ▒ ≤ $250, ▓ ≤ $400, █ above. */
export const SHARE_THRESHOLDS: readonly number[] = [100, 250, 400];
export const SHARE_GLYPHS: readonly string[] = ['░', '▒', '▓', '█'];
export const roundGlyph = (earned: number): string => SHARE_GLYPHS[SHARE_THRESHOLDS.filter((x) => earned > x).length];
export const roundGrid = (rounds: number[]): string => rounds.map(roundGlyph).join('');

/** "Daily 2026-10-25", "Lesson", or "yard xyz". */
export const seedLabel = (seed: string): string => shareYardLabel(seed);

export function rankText(rank: Rank | null | undefined): string {
  if (!rank) return '';
  if (rank.n == null) return t('share.notInTop', { of: int(rank.of) });
  return t('share.rankOf', { n: int(rank.n), of: int(rank.of) });
}

/** The checked standing line: better-than once five or more checked games exist, else the rank, else nothing. */
export function standingText(s: Pick<ShareInput, 'rank' | 'percentile' | 'n' | 'player'>): string {
  if (!s.rank) return '';
  const who = s.player ? t('share.as', { player: s.player }) : '';
  if (s.percentile != null && (s.n ?? 0) >= 5) return t('share.better', { pct: int(s.percentile), n: int(s.n ?? 0), who });
  return `${rankText(s.rank)}${who}`;
}

/** "beat Jon#7Q2M's $1200 by $50", "short of … by $50", or "tied …". */
export function outcomeText(score: number, c: { player: string; score: number }): string {
  const d = score - c.score;
  return d > 0
    ? t('share.beat', { player: c.player, score: money(c.score), d: money(d) })
    : d < 0
      ? t('share.short', { player: c.player, score: money(c.score), d: money(-d) })
      : t('share.tied', { player: c.player, score: money(c.score) });
}

export function shareText(s: ShareInput): string {
  const lines: string[] = [t('share.header', { label: seedLabel(s.seed), score: money(s.score) }), roundGrid(s.rounds)];
  const standing = standingText(s);
  lines.push(s.fork ? t('share.try', { player: s.fork.player, round: s.fork.round + 1 }) : standing || t('share.local'));
  if (s.variant === 'detailed') {
    lines.push(t('share.rounds', { list: s.rounds.map((r) => money(r)).join(' · ') }));
    if (s.rerolls) lines.push(t('share.newOffers', { n: int(s.rerolls), cost: money(s.rerolls * RULES.rerollCost) }));
    if (s.rank) lines.push(t('share.checked'));
    if (s.rank && s.badges?.length) lines.push(t('share.badges', { list: s.badges.join(' · ') }));
    if (s.rank && s.medal) lines.push(t('share.medal', { medal: s.medal }));
    if (s.challenge) lines.push(outcomeText(s.score, s.challenge));
  }
  if (s.daysPlayed && s.daysPlayed > 0)
    lines.push(
      s.variant === 'detailed' && s.streak && s.streak >= 2
        ? t('share.streak', { days: int(s.daysPlayed), streak: int(s.streak) })
        : t('share.days', { n: s.daysPlayed }),
    );
  if (s.permalink) lines.push(s.permalink);
  return lines.join('\n');
}
