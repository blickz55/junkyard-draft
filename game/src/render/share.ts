// Share text for a finished run. Pure so it can be unit-tested; never claims verification it does not have.
export interface Rank { n: number | null; of: number }
export interface ShareInput { seed: string; score: number; rulesVersion: number; rounds: number[]; player?: string; rank?: Rank | null }

export const PLAYER_MAX = 32;
export const cleanPlayer = (raw: string | null | undefined): string => (raw ?? '').replace(/\s+/g, ' ').trim().slice(0, PLAYER_MAX);

export function rankText(rank: Rank | null | undefined): string {
  if (!rank) return '';
  if (rank.n == null) return `not in the top ${rank.of} of the verified board`;
  return `#${rank.n} of ${rank.of} on the verified board`;
}

export function shareText(s: ShareInput): string {
  const lines = [
    `Junkyard Draft — seed ${s.seed}: $${s.score}`,
    `rounds ${s.rounds.map((r) => `$${r}`).join(' · ')}`,
    s.rank ? `${rankText(s.rank)}${s.player ? ` as ${s.player}` : ''} (replay re-simulated, rules v${s.rulesVersion})` : `local score, not yet verified (rules v${s.rulesVersion})`,
  ];
  return lines.join('\n');
}
