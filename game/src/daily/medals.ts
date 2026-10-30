/**
 * Medals after close (PLAN-v3 0.6.4). Pure and browser-free; the verifier computes, the client only reads.
 * At freeze the verifier takes the day's verified scores and sets three thresholds with the nearest-rank percentile:
 *   threshold(p) = sorted[ceil(p / 100 · n) − 1]   (sorted ascending, 1-based rank rounded up)
 * bronze = 50th, silver = 80th, gold = 95th percentile. A score earns the highest medal whose threshold it reaches
 * (ties included, since the threshold is itself one of the scores). Fewer than MEDAL_MIN_N verified runs → no medals:
 * a population of two has no 95th percentile worth the name. Bot par stays the day-of target; medals are the after-close one.
 */
export const MEDAL_PERCENTILES = { bronze: 50, silver: 80, gold: 95 } as const;
export const MEDAL_MIN_N = 5;
export type MedalName = 'gold' | 'silver' | 'bronze';
export interface Medals {
  n: number;
  bronze: number;
  silver: number;
  gold: number;
}

/** Nearest-rank percentile of an ascending-sorted array. */
export const nearestRank = (sorted: readonly number[], p: number): number =>
  sorted[Math.max(0, Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1))];

/** Thresholds for a day's verified scores, or null when there are too few. */
export function medalThresholds(scores: readonly number[]): Medals | null {
  const sorted = scores
    .filter((s) => Number.isFinite(s))
    .slice()
    .sort((a, b) => a - b);
  if (sorted.length < MEDAL_MIN_N) return null;
  return {
    n: sorted.length,
    bronze: nearestRank(sorted, MEDAL_PERCENTILES.bronze),
    silver: nearestRank(sorted, MEDAL_PERCENTILES.silver),
    gold: nearestRank(sorted, MEDAL_PERCENTILES.gold),
  };
}
/** The medal a score earns, or null. */
export function medalFor(score: number, m: Medals | null | undefined): MedalName | null {
  if (!m) return null;
  if (score >= m.gold) return 'gold';
  if (score >= m.silver) return 'silver';
  if (score >= m.bronze) return 'bronze';
  return null;
}
export const medalsLine = (m: Medals): string => `gold ≥ $${m.gold} · silver ≥ $${m.silver} · bronze ≥ $${m.bronze}`;
