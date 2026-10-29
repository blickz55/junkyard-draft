/**
 * Client side of the minted daily (PLAN-v3 0.6.1). The verifier mints today's ranked seed; the client plays it when
 * `/daily` answers for today, caches it for the day (`jd.daily.v1`), and otherwise falls back to the practice seed
 * `daily-YYYY-MM-DD`, labelled unranked. The client never derives a minted seed itself.
 */
import { dailySeedFor, isMintedDailySeed, dailyDateOf } from '../sim/daily';

export interface DailyInfo { date: string; seed: string; closesAt: string; commitment: string }
const KEY = 'jd.daily.v1';

export const todayUTC = (now = new Date()): string => now.toISOString().slice(0, 10);
/** The unranked fallback for now. */
export const practiceSeed = (now = new Date()): string => dailySeedFor(now);

/** Validate a `/daily` body as today's minted daily; cache and return it, or null. */
export function acceptDaily(body: unknown, now = new Date()): DailyInfo | null {
  const x = body as Partial<DailyInfo> & { minted?: boolean } | null;
  if (!x || x.minted !== true || typeof x.seed !== 'string' || !isMintedDailySeed(x.seed) || x.date !== todayUTC(now) || dailyDateOf(x.seed) !== x.date) return null;
  const info: DailyInfo = { date: x.date, seed: x.seed, closesAt: typeof x.closesAt === 'string' ? x.closesAt : '', commitment: typeof x.commitment === 'string' ? x.commitment : '' };
  try { localStorage.setItem(KEY, JSON.stringify(info)); } catch { /* session only */ }
  return info;
}
/** Today's minted daily if this device learned it today; null otherwise. */
export function cachedDaily(now = new Date()): DailyInfo | null {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Partial<DailyInfo> | null;
    return raw && raw.date === todayUTC(now) && typeof raw.seed === 'string' && isMintedDailySeed(raw.seed) ? { date: raw.date, seed: raw.seed, closesAt: typeof raw.closesAt === 'string' ? raw.closesAt : '', commitment: typeof raw.commitment === 'string' ? raw.commitment : '' } : null;
  } catch { return null; }
}
/** Ask the verifier for today's minted seed; null when unreachable, slow, or not minted for today. */
export async function fetchDaily(verifierUrl: string, timeoutMs = 2500): Promise<DailyInfo | null> {
  try {
    const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), timeoutMs);
    const res = await fetch(`${verifierUrl}/daily?limit=1`, { signal: ctl.signal }); clearTimeout(t);
    if (!res.ok) return null;
    return acceptDaily(await res.json());
  } catch { return null; }
}
/** The seed "Today's challenge" plays right now: the minted one when known, else practice. */
export const todaySeed = (): string => cachedDaily()?.seed ?? practiceSeed();
