/**
 * Reading the signals (production roadmap 0.12.5). A score that looks too good is not proof of anything, and a banned innocent is worse than a
 * cheat on a board, so nothing here does anything to anyone: it lists what a person might want to look at, and why. `tools/review.ts` prints it.
 */
import type { SignalRow } from './community';

export interface Finding {
  kind: 'same-game' | 'too-soon' | 'many-tries';
  seed: string;
  player: string;
  hash: string;
  why: string;
}
/** A real game takes a few minutes; a top score sooner than this after a day opened was played before it opened, or by a machine. */
export const TOO_SOON_MS = 3 * 60_000;
/** Tries are no sin: this only names someone far past everyone else on that yard. */
export const MANY_TRIES = 25;
const TOP_SHARE = 0.05;

export function reviewSignals(rows: readonly SignalRow[]): Finding[] {
  const out: Finding[] = [];
  const bySeed = new Map<string, SignalRow[]>();
  for (const r of rows) bySeed.set(r.seed, [...(bySeed.get(r.seed) ?? []), r]);
  for (const [seed, list] of bySeed) {
    for (const r of list)
      if (r.collisionId)
        out.push({ kind: 'same-game', seed, player: r.playerId, hash: r.replayHash, why: `the same game as ${r.collisionId.slice(0, 12)} on this yard` });
    const scores = list.map((r) => r.score).sort((a, b) => b - a);
    const bar = scores[Math.max(0, Math.ceil(scores.length * TOP_SHARE) - 1)];
    for (const r of list)
      if (r.sinceOpenMs != null && r.sinceOpenMs < TOO_SOON_MS && r.score >= bar && !r.collisionId)
        out.push({
          kind: 'too-soon',
          seed,
          player: r.playerId,
          hash: r.replayHash,
          why: `a top score ${Math.round(r.sinceOpenMs / 1000)} s after the yard opened`,
        });
    const most = new Map<string, SignalRow>();
    for (const r of list) if (r.tries > (most.get(r.playerId)?.tries ?? 0)) most.set(r.playerId, r);
    const counts = [...most.values()].map((r) => r.tries).sort((a, b) => a - b);
    const median = counts[Math.floor(counts.length / 2)];
    for (const r of most.values())
      if (r.tries >= MANY_TRIES && r.tries > median * 5)
        out.push({
          kind: 'many-tries',
          seed,
          player: r.playerId,
          hash: r.replayHash,
          why: `${r.tries} tries on this yard, the middle of the field at ${median}`,
        });
  }
  return out;
}
