/**
 * Non-ranked run badges (PLAN-v1 0.4.6): recognition for how a run was played, computed from the finished run's own
 * records. Badges are never a leaderboard axis (one ranked axis: money) and never appear in unverified share text.
 *   Clean      — no item waited and no hopper was blocked for a single tick in any round.
 *   Minimalist — round 6 used at most MINIMALIST_MACHINES machines while the run still scored at least the bot par.
 *   Full Grid  — some round used every cell of the grid.
 */
import { RULES } from './rules';
import type { RunState } from './run';

export type BadgeId = 'clean' | 'minimalist' | 'full-grid';
export interface Badge { id: BadgeId; title: string; text: string }

/** Machines placed in the final round at or below which a run that still beats the bot par counts as Minimalist. */
export const MINIMALIST_MACHINES = 8;

export const BADGE_INFO: Record<BadgeId, Badge> = {
  clean: { id: 'clean', title: 'Clean', text: 'Nothing waited and no hopper was blocked, in any round.' },
  minimalist: { id: 'minimalist', title: 'Minimalist', text: `At most ${MINIMALIST_MACHINES} machines in the final round, and still at or above the bot par.` },
  'full-grid': { id: 'full-grid', title: 'Full Grid', text: 'Every cell of the grid was used in a round.' },
};

/** Badges earned by a finished (or at least started) run; `botPar` null means Minimalist cannot be judged. */
export function badgesFor(run: Pick<RunState, 'rounds' | 'score' | 'layout'>, botPar: number | null): Badge[] {
  const out: Badge[] = [];
  if (!run.rounds.length) return out;
  const clean = run.rounds.every((r) => Object.values(r.result.cellStats).every((st) => st.jammedTicks === 0 && st.blockedTicks === 0));
  if (clean) out.push(BADGE_INFO.clean);
  const finalRound = run.rounds.length >= RULES.rounds ? run.rounds[RULES.rounds - 1] : null;
  if (finalRound && botPar != null && finalRound.layout.machines.length <= MINIMALIST_MACHINES && run.score >= botPar) out.push(BADGE_INFO.minimalist);
  if (run.rounds.some((r) => r.layout.machines.length >= r.layout.width * r.layout.height)) out.push(BADGE_INFO['full-grid']);
  return out;
}
