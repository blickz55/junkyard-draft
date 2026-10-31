/**
 * What an email account carries between devices (0.11.1): the bests, the stars behind the rank, and what Your record shows. Pure
 * merging: nothing a device earned is ever lost, so a best is the higher of the two, days are the union, a yard's standing is the
 * newest. Machine counts take the higher side, because adding them would count a game twice each time two devices meet.
 */
import type { Bests, SyncData } from './storage';

const newest = <T extends { seed: string; at: string }>(a: readonly T[], b: readonly T[]): T[] => {
  const by = new Map<string, T>();
  for (const r of [...a, ...b]) {
    const have = by.get(r.seed);
    if (!have || r.at > have.at) by.set(r.seed, r);
  }
  return [...by.values()].sort((x, y) => x.at.localeCompare(y.at));
};
const union = (a: readonly string[], b: readonly string[]): string[] => [...new Set([...a, ...b])].sort();
const higher = (a: Record<string, number>, b: Record<string, number>): Record<string, number> => {
  const out = { ...a };
  for (const [k, v] of Object.entries(b)) out[k] = Math.max(out[k] ?? 0, v);
  return out;
};
function mergeBests(a: Bests, b: Bests): Bests {
  const bySeed = { ...a.bySeed };
  for (const [seed, best] of Object.entries(b.bySeed)) if (!bySeed[seed] || best.score > bySeed[seed].score) bySeed[seed] = best;
  const overall = !a.overall || (b.overall && b.overall.score > a.overall.score) ? b.overall : a.overall;
  return { overall, bySeed, runs: Math.max(a.runs, b.runs) };
}

export function mergeSync(local: SyncData, remote: SyncData): SyncData {
  return {
    settings: local.settings,
    bests: mergeBests(local.bests, remote.bests),
    stars: higher(local.stars, remote.stars),
    days: union(local.days, remote.days),
    dailies: union(local.dailies, remote.dailies),
    medals: newest(local.medals, remote.medals),
    standings: newest(local.standings, remote.standings),
    watched: newest(local.watched, remote.watched),
    kinds: higher(local.kinds as Record<string, number>, remote.kinds as Record<string, number>),
  };
}

/** Whether the two hold the same progress, whatever order it came in. */
export function sameProgress(a: SyncData, b: SyncData): boolean {
  const canon = (d: SyncData) => {
    const sorted = (o: object) => Object.entries(o).sort(([x], [y]) => x.localeCompare(y));
    return JSON.stringify([
      sorted(d.bests.bySeed),
      d.bests.overall?.score,
      d.bests.runs,
      sorted(d.stars),
      d.days,
      d.dailies,
      d.medals,
      d.standings,
      d.watched,
      sorted(d.kinds),
    ]);
  };
  return canon(a) === canon(b);
}
