/**
 * The record page's data (production roadmap 0.9.7): everything this device remembers about its own play, read from
 * storage and nothing else. Days played and the daily chain, medals seen, bests per yard, the standing of each checked
 * game in the order they were checked (and whether it is rising), machines drafted per kind. Pure: the panel renders it.
 */
import type { MachineKind } from '../sim/types';
import { longestStreak, streakOf } from '../daily/streak';
import {
  loadBests,
  loadDailyDates,
  loadDaysPlayed,
  loadKinds,
  loadMedals,
  loadStandings,
  loadWatched,
  loadTrophies,
  type MedalRecord,
  type Standing,
  type WatchedRecord,
} from './storage';

export type Trend = 'up' | 'down' | 'flat' | null;

export interface RecordData {
  days: { played: number; first: string | null; last: string | null };
  dailies: { checked: number; current: number; longest: number };
  medals: MedalRecord[];
  bests: { overall: { score: number; seed: string; at: string } | null; games: number; yards: number; top: { seed: string; score: number; at: string }[] };
  /** chronological */
  standings: Standing[];
  trend: Trend;
  kinds: { kind: MachineKind; count: number }[];
  /** the games other players watched most, by players */
  watched: WatchedRecord[];
  /** medals from divisions and days in the top one, as Home last heard them */
  trophies: Record<string, number>;
}

/** Rising, falling or steady: the mean of the latest three standings against the three before them; null under six. */
export function trendOf(standings: readonly Standing[]): Trend {
  if (standings.length < 6) return null;
  const mean = (xs: readonly Standing[]) => xs.reduce((a, s) => a + s.percentile, 0) / xs.length;
  const recent = mean(standings.slice(-3)),
    before = mean(standings.slice(-6, -3));
  return recent - before > 5 ? 'up' : before - recent > 5 ? 'down' : 'flat';
}

export function recordData(now = new Date()): RecordData {
  const days = loadDaysPlayed();
  const dailyDates = loadDailyDates();
  const bests = loadBests();
  const standings = loadStandings();
  const kinds = Object.entries(loadKinds())
    .map(([kind, count]) => ({ kind: kind as MachineKind, count: count ?? 0 }))
    .filter((k) => k.count > 0)
    .sort((a, b) => b.count - a.count || a.kind.localeCompare(b.kind));
  const top = Object.entries(bests.bySeed)
    .map(([seed, b]) => ({ seed, score: b.score, at: b.at }))
    .sort((a, b) => b.score - a.score || a.at.localeCompare(b.at))
    .slice(0, 8);
  return {
    days: { played: days.length, first: days[0] ?? null, last: days[days.length - 1] ?? null },
    dailies: { checked: dailyDates.length, current: streakOf(dailyDates, now).streak, longest: longestStreak(dailyDates) },
    medals: loadMedals().sort((a, b) => b.at.localeCompare(a.at)),
    bests: { overall: bests.overall, games: bests.runs, yards: Object.keys(bests.bySeed).length, top },
    standings,
    trend: trendOf(standings),
    kinds,
    watched: loadWatched()
      .sort((a, b) => b.players - a.players || b.times - a.times)
      .slice(0, 5),
    trophies: loadTrophies(),
  };
}
