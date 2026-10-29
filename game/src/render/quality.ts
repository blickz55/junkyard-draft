/** Adaptive-resolution decision (DOSSIER-v1 0.3.10), kept pure so it can be unit-tested without a browser. */
export const QUALITY_PROBE_FRAMES = 120;
export const QUALITY_P95_LIMIT_MS = 20;

/** Frame deltas (ms) of the first running frames at high resolution → keep 'high' or drop to 'low' (DPR 1) for later starts. */
export function decideQuality(deltas: readonly number[]): 'high' | 'low' {
  if (deltas.length === 0) return 'high';
  const sorted = deltas.slice().sort((a, b) => a - b);
  const p95 = sorted[Math.min(sorted.length - 1, Math.floor(0.95 * sorted.length))];
  return p95 > QUALITY_P95_LIMIT_MS ? 'low' : 'high';
}
