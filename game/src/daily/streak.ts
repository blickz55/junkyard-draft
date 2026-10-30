/**
 * Days played and the daily streak, with grace (PLAN-v3 0.6.3). Pure and browser-free.
 * The streak counts consecutive UTC dates of *verified daily submissions*, by the daily's own date (not the submission
 * time): a daily for date D accepts submissions for 48 hours from 00:00 UTC of D, so submitting yesterday's daily today
 * extends the chain just like playing today's would. The chain is alive while its latest date is today or yesterday
 * (yesterday's daily is still open); once it is older the streak reads 0 until the next verified daily starts a new
 * count. No loss copy, no colour, no notification: the number simply changes. Everything is UTC, so the device's
 * time zone never matters.
 */
export interface Streak {
  /** distinct daily dates with a verified submission */ dailies: number;
  /** consecutive dates ending today or yesterday; 0 when the chain is broken */ streak: number;
  lastDate: string | null;
}

export const DATE = /^\d{4}-\d{2}-\d{2}$/;
export const utcDateOf = (now: Date): string => now.toISOString().slice(0, 10);
export const shiftUtcDate = (date: string, days: number): string => new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

/** Distinct valid dates, sorted ascending: duplicates and junk never change the count (idempotence). */
export function normaliseDates(dates: Iterable<string>): string[] {
  const set = new Set<string>();
  for (const d of dates) {
    if (typeof d !== 'string' || !DATE.test(d)) continue;
    const t = Date.parse(`${d}T00:00:00Z`);
    if (Number.isFinite(t) && new Date(t).toISOString().slice(0, 10) === d) set.add(d);
  } // '2026-02-30' parses in JS by rolling over; the round trip rejects it
  return [...set].sort();
}

export function streakOf(dailyDates: Iterable<string>, now: Date): Streak {
  const dates = normaliseDates(dailyDates);
  if (!dates.length) return { dailies: 0, streak: 0, lastDate: null };
  const today = utcDateOf(now),
    yesterday = shiftUtcDate(today, -1);
  const last = dates[dates.length - 1];
  if (last !== today && last !== yesterday) return { dailies: dates.length, streak: 0, lastDate: last }; // the chain ended; the next daily starts a new one
  let streak = 1;
  for (let i = dates.length - 2; i >= 0 && dates[i] === shiftUtcDate(dates[i + 1], -1); i--) streak++;
  return { dailies: dates.length, streak, lastDate: last };
}
