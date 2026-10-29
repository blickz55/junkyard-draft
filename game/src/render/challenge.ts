/**
 * Challenge links (PLAN-v4 0.7.1): "beat this". A verified entry becomes `…/?challenge=<replayHash>`; the recipient
 * plays the same seed with the challenger's per-round earnings overlaid live and sees a two-row result. The link
 * carries no replay and no layout: the verifier's `/entry` answers earnings only, so the 0.6.6 reveal gate holds on an
 * open daily. A challenge played inside a daily's window counts on the daily board through the normal verified path.
 */
export interface Challenge { hash: string; seed: string; player: string; score: number; rounds: number[] }

/** The shareable URL for an entry; keeps the `verifier` query parameter so local and test setups follow the same server. */
export function challengeLink(hash: string): string {
  const verifier = new URLSearchParams(location.search).get('verifier');
  return `${location.origin}${location.pathname}?challenge=${encodeURIComponent(hash)}${verifier ? `&verifier=${encodeURIComponent(verifier)}` : ''}`;
}

/** Fetch the challenger's entry; null when unknown, offline, or without per-round earnings. */
export async function fetchChallenge(verifierUrl: string, hash: string, timeoutMs = 4000): Promise<Challenge | null> {
  try {
    const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), timeoutMs);
    const res = await fetch(`${verifierUrl}/entry?hash=${encodeURIComponent(hash)}`, { signal: ctl.signal }); clearTimeout(t);
    if (!res.ok) return null;
    const b = await res.json() as { ok?: boolean; seed?: string; player?: string; score?: number; rounds?: unknown; replayHash?: string };
    if (!b.ok || typeof b.seed !== 'string' || typeof b.score !== 'number' || !Array.isArray(b.rounds) || !b.rounds.every((x) => typeof x === 'number')) return null;
    return { hash: b.replayHash ?? hash, seed: b.seed, player: typeof b.player === 'string' ? b.player.slice(0, 40) : 'challenger', score: b.score, rounds: b.rounds as number[] };
  } catch { return null; }
}

/** The challenger's running total after `round` rounds (0 → 0). */
export const challengerTotal = (c: Challenge, round: number): number => c.rounds.slice(0, Math.max(0, Math.min(round, c.rounds.length))).reduce((a, b) => a + b, 0);

/** The outcome line once a run is finished: "beat Jon#7Q2M's $1200 by $50", "short of … by $50", or "tied …". */
export function challengeOutcome(score: number, c: Challenge): { diff: number; text: string } {
  const diff = score - c.score;
  const text = diff > 0 ? `beat ${c.player}'s $${c.score} by $${diff}` : diff < 0 ? `short of ${c.player}'s $${c.score} by $${-diff}` : `tied ${c.player}'s $${c.score}`;
  return { diff, text };
}
