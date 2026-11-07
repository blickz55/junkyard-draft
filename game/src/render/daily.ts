/**
 * Client side of the minted daily (PLAN-v3 0.6.1). The verifier mints today's ranked seed; the client plays it when
 * `/daily` answers for today, caches it for the day (`jd.daily.v1`), and otherwise falls back to the practice seed
 * `daily-YYYY-MM-DD`, labelled unranked. The client never derives a minted seed itself.
 */
import { dailySeedFor, isMintedDailySeed, dailyDateOf } from '../sim/daily';
import { t } from '../content/strings';
import { shiftUtcDate } from '../daily/streak';
import { isWeeklySeed, weeklyClosed } from '../sim/weekly';
import { loadSubmissions } from './storage';
import { isTestEdition } from './config';

export interface DailyInfo {
  date: string;
  seed: string;
  closesAt: string;
  commitment: string;
  /** yesterday's yard, as the server names it beside today's (PLAN-v3 0.6.1); it stays open for 48 hours from its 00:00 UTC */
  previous?: { date: string; seed: string };
}
const previousOf = (x: unknown): DailyInfo['previous'] => {
  const q = x as { date?: unknown; seed?: unknown } | null;
  return q && typeof q.date === 'string' && typeof q.seed === 'string' && isMintedDailySeed(q.seed) && dailyDateOf(q.seed) === q.date
    ? { date: q.date, seed: q.seed }
    : undefined;
};
const KEY = 'jd.daily.v1';

export const todayUTC = (now = new Date()): string => now.toISOString().slice(0, 10);
/** The unranked fallback for now. */
export const practiceSeed = (now = new Date()): string => dailySeedFor(now);

/** Validate a `/daily` body as today's minted daily; cache and return it, or null. */
export function acceptDaily(body: unknown, now = new Date()): DailyInfo | null {
  const x = body as (Partial<DailyInfo> & { minted?: boolean }) | null;
  if (!x || x.minted !== true || typeof x.seed !== 'string' || !isMintedDailySeed(x.seed) || x.date !== todayUTC(now) || dailyDateOf(x.seed) !== x.date)
    return null;
  const info: DailyInfo = {
    date: x.date,
    seed: x.seed,
    closesAt: typeof x.closesAt === 'string' ? x.closesAt : '',
    commitment: typeof x.commitment === 'string' ? x.commitment : '',
  };
  const previous = previousOf((x as { previous?: unknown }).previous);
  if (previous) info.previous = previous;
  try {
    localStorage.setItem(KEY, JSON.stringify(info));
  } catch {
    /* session only */
  }
  return info;
}
/** Today's minted daily if this device learned it today; null otherwise. */
export function cachedDaily(now = new Date()): DailyInfo | null {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Partial<DailyInfo> | null;
    if (!(raw && raw.date === todayUTC(now) && typeof raw.seed === 'string' && isMintedDailySeed(raw.seed))) return null;
    const info: DailyInfo = {
      date: raw.date,
      seed: raw.seed,
      closesAt: typeof raw.closesAt === 'string' ? raw.closesAt : '',
      commitment: typeof raw.commitment === 'string' ? raw.commitment : '',
    };
    const previous = previousOf(raw.previous);
    if (previous) info.previous = previous;
    return info;
  } catch {
    return null;
  }
}
/** Ask the verifier for today's minted seed; null when unreachable, slow, or not minted for today. */
export async function fetchDaily(verifierUrl: string, timeoutMs = 2500): Promise<DailyInfo | null> {
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), timeoutMs);
    const res = await fetch(`${verifierUrl}/daily?limit=1`, { signal: ctl.signal });
    clearTimeout(t);
    if (!res.ok) return null;
    return acceptDaily(await res.json());
  } catch {
    return null;
  }
}
/**
 * Yesterday's yard, still open (the consultant panel, 2026-11-06): the rule has accepted yesterday's daily for 48 hours since PLAN-v3 0.6.3,
 * and no screen offered it. Null unless today's daily names yesterday, that day is not closed, and this device has no checked daily for it.
 */
export function yesterdayOffer(
  info: DailyInfo | null,
  dailyDates: readonly string[],
  now = new Date(),
): { seed: string; date: string; closesAt: string } | null {
  const prev = info?.previous;
  if (!prev || prev.date !== shiftUtcDate(todayUTC(now), -1) || dailyDates.includes(prev.date) || dailyClosed(prev.seed, now)) return null;
  return { seed: prev.seed, date: prev.date, closesAt: `${shiftUtcDate(prev.date, 2)}T00:00:00.000Z` };
}
/** Whether a minted daily seed's window has closed (48 h after 00:00 UTC of its date): UTC arithmetic, same rule as the verifier. */
export const dailyClosed = (seed: string, now = new Date()): boolean => {
  const d = dailyDateOf(seed);
  return !!d && isMintedDailySeed(seed) && shiftUtcDate(d, 2) <= todayUTC(now);
};
/**
 * When a minted daily's places become final (the consultant panel, 2026-11-06): the server's own moment for the yard it named today,
 * which a re-issued day moves, else 00:00 UTC two days after the date, the rule `dailyClosed` reads; null for any other yard.
 */
export function dailyClosesAt(seed: string, now = new Date()): Date | null {
  if (!isMintedDailySeed(seed)) return null;
  const known = cachedDaily(now);
  const theirs = known && known.seed === seed ? Date.parse(known.closesAt) : NaN;
  return new Date(Number.isFinite(theirs) ? theirs : `${shiftUtcDate(dailyDateOf(seed)!, 2)}T00:00:00.000Z`);
}
/**
 * Reveal gate (PLAN-v3 0.6.6): on an open daily other players' replays are watchable only once this device has a
 * verified entry for that seed (or the day has closed). Returns the reason to show while gated, null when watchable.
 * The verifier enforces the same rule on GET /replay; this only keeps the buttons honest.
 */
export function revealGate(seed: string, now = new Date()): string | null {
  if (isWeeklySeed(seed)) {
    // PLAN-v4 0.7.5: the weekly is gated the same way until its Friday 18:00 UTC close
    if (weeklyClosed(seed, now) || loadSubmissions()[seed]) return null;
    return t('gate.weekly');
  }
  if (!isMintedDailySeed(seed) || dailyClosed(seed, now)) return null;
  if (loadSubmissions()[seed]) return null;
  const d = dailyDateOf(seed)!;
  return t('gate.daily', { date: shiftUtcDate(d, 2) });
}
export interface WeeklyInfo {
  week: string;
  seed: string;
  closesAt: string;
  final: boolean;
  now: string;
}
/** This week's minted seed from the verifier; null when unreachable or malformed. */
export async function fetchWeekly(verifierUrl: string, timeoutMs = 2500): Promise<WeeklyInfo | null> {
  if (isTestEdition()) return null;
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), timeoutMs);
    const res = await fetch(`${verifierUrl}/weekly?limit=1`, { signal: ctl.signal });
    clearTimeout(t);
    if (!res.ok) return null;
    const b = (await res.json()) as { ok?: boolean; week?: string; seed?: string; closesAt?: string; final?: boolean; now?: string };
    if (!b.ok || typeof b.seed !== 'string' || !isWeeklySeed(b.seed) || typeof b.week !== 'string' || typeof b.closesAt !== 'string') return null;
    return { week: b.week, seed: b.seed, closesAt: b.closesAt, final: !!b.final, now: typeof b.now === 'string' ? b.now : new Date().toISOString() };
  } catch {
    return null;
  }
}
/** The seed "Today's challenge" plays right now: the minted one when known, else practice. */
export const todaySeed = (): string => cachedDaily()?.seed ?? practiceSeed();
/** The yard to open for "play today": our server's when it has one, otherwise today's practice yard. */
export async function todaysYard(verifierUrl: string): Promise<string> {
  const known = cachedDaily();
  if (known) return known.seed;
  if (isTestEdition()) return practiceSeed();
  const d = await fetchDaily(verifierUrl);
  return d ? d.seed : practiceSeed();
}
