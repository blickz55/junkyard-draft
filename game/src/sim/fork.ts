/**
 * Fork from round N (PLAN-v4 0.7.3): continue someone's watched replay (or your own) from the state after round N as a
 * fresh practice run on the same seed. Pure: the same actions, the same rules, the same state; the fork is marked with
 * its origin so the HUD can say so and so it can never be exported, submitted or recorded as the player's own run.
 */
import { apply, newRun, type Action, type ForkOrigin, type RunState } from './run';
import { RULES } from './rules';

/**
 * The state right after round `n` of `actions` on `seed` (the draft of round n + 1), as a practice run that remembers
 * where it came from. Throws when the replay has fewer than `n` finished rounds, when `n` is out of range, or when an
 * action is illegal (a tampered replay never forks).
 */
export function forkFrom(seed: string, actions: readonly Action[], rulesVersion: number, n: number, origin: Omit<ForkOrigin, 'round'>): RunState {
  if (!Number.isInteger(n) || n < 1 || n >= RULES.rounds) throw new Error(`fork round must be between 1 and ${RULES.rounds - 1}`);
  const s = newRun(seed);
  if (s.rulesVersion !== rulesVersion) throw new Error(`replay is rules version ${rulesVersion}, this build plays ${s.rulesVersion}`);
  for (const a of actions) {
    apply(s, a);
    if (s.rounds.length === n && s.phase === 'draft') { s.forkedFrom = { ...origin, round: n }; return s; }
  }
  throw new Error(`replay has only ${s.rounds.length} finished round(s); cannot fork after round ${n}`);
}
