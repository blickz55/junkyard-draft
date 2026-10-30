/**
 * Challenge links (PLAN-v4 0.7.1): "beat this". A verified entry becomes `…/?challenge=<replayHash>`; the recipient
 * plays the same seed with the challenger's per-round earnings overlaid live and sees a two-row result. The link
 * carries no replay and no layout: the verifier's `/entry` answers earnings only, so the 0.6.6 reveal gate holds on an
 * open daily. A challenge played inside a daily's window counts on the daily board through the normal verified path.
 */
import { overrideAllowed } from './config';
import { outcomeText } from './share';

export interface Challenge {
  hash: string;
  seed: string;
  player: string;
  score: number;
  rounds: number[];
}

/** Pure: the shareable URL for an entry; `verifierOverride` is appended only when the caller says overrides count here. */
export function buildChallengeLink(origin: string, pathname: string, hash: string, verifierOverride: string | null): string {
  return `${origin}${pathname}?challenge=${encodeURIComponent(hash)}${verifierOverride ? `&verifier=${encodeURIComponent(verifierOverride)}` : ''}`;
}
/**
 * The shareable URL for an entry. In dev builds and on loopback pages the `verifier` query parameter is kept so local and
 * test setups follow the same server; a hosted build never propagates it (production roadmap 0.8.0: a link must not be
 * able to point the recipient's client, and its bearer token, at another host).
 */
export function challengeLink(hash: string): string {
  const override = overrideAllowed() ? new URLSearchParams(location.search).get('verifier') : null;
  return buildChallengeLink(location.origin, location.pathname, hash, override);
}

/** Fetch the challenger's entry; null when unknown, offline, or without per-round earnings. */
export async function fetchChallenge(verifierUrl: string, hash: string, timeoutMs = 4000): Promise<Challenge | null> {
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), timeoutMs);
    const res = await fetch(`${verifierUrl}/entry?hash=${encodeURIComponent(hash)}`, { signal: ctl.signal });
    clearTimeout(t);
    if (!res.ok) return null;
    const b = (await res.json()) as { ok?: boolean; seed?: string; player?: string; score?: number; rounds?: unknown; replayHash?: string };
    if (!b.ok || typeof b.seed !== 'string' || typeof b.score !== 'number' || !Array.isArray(b.rounds) || !b.rounds.every((x) => typeof x === 'number'))
      return null;
    return {
      hash: b.replayHash ?? hash,
      seed: b.seed,
      player: typeof b.player === 'string' ? b.player.slice(0, 40) : 'challenger',
      score: b.score,
      rounds: b.rounds as number[],
    };
  } catch {
    return null;
  }
}

/** The challenger's running total after `round` rounds (0 → 0). */
export const challengerTotal = (c: Challenge, round: number): number =>
  c.rounds.slice(0, Math.max(0, Math.min(round, c.rounds.length))).reduce((a, b) => a + b, 0);

/** The outcome line once a run is finished: "beat Jon#7Q2M's $1200 by $50", "short of … by $50", or "tied …". */
export function challengeOutcome(score: number, c: Challenge): { diff: number; text: string } {
  const diff = score - c.score;
  return { diff, text: outcomeText(score, c) };
}
