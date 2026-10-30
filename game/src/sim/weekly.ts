/**
 * The weekly seed's calendar (PLAN-v4 0.7.5), pure and shared by client and verifier. A weekly opens Friday 18:00 UTC
 * and closes seven days later; it is named by the ISO week of that Friday (`2030-W11`). The seed itself is minted by the
 * verifier (`weekly-2030-W11-xxxxxxxx`); the client only recognises the format and computes the window from the id.
 * No modifiers: the rules are unchanged, a weekly is an ordinary seed with a longer window.
 */
export const WEEK_ID = /^(\d{4})-W(\d{2})$/;
export const WEEKLY_SEED = /^weekly-(\d{4}-W\d{2})-([a-z2-7]{8})$/;
export const WEEKLY_OPEN_HOUR_UTC = 18;
export const WEEKLY_WINDOW_MS = 7 * 86_400_000;
const DAY = 86_400_000;

export const isWeeklySeed = (seed: string): boolean => WEEKLY_SEED.test(seed);
export const weeklyIdOf = (seed: string): string | null => WEEKLY_SEED.exec(seed)?.[1] ?? null;

/** ISO week id of a UTC date: the week containing it, Monday-based, named by the year of its Thursday. */
export function isoWeekId(d: Date): string {
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = (t.getUTCDay() + 6) % 7; // Monday = 0
  t.setUTCDate(t.getUTCDate() - day + 3); // the Thursday of this week
  const year = t.getUTCFullYear();
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const w = 1 + Math.floor((t.getTime() - mondayOf(jan4).getTime()) / (7 * DAY));
  return `${year}-W${String(w).padStart(2, '0')}`;
}
const mondayOf = (d: Date): Date => {
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  t.setUTCDate(t.getUTCDate() - ((t.getUTCDay() + 6) % 7));
  return t;
};

/** The Friday (UTC midnight) of an ISO week id; null for a malformed or impossible id. */
export function fridayOfWeek(id: string): Date | null {
  const m = WEEK_ID.exec(id);
  if (!m) return null;
  const year = Number(m[1]),
    w = Number(m[2]);
  if (w < 1 || w > 53) return null;
  const monday1 = mondayOf(new Date(Date.UTC(year, 0, 4)));
  const friday = new Date(monday1.getTime() + ((w - 1) * 7 + 4) * DAY);
  return isoWeekId(friday) === id ? friday : null; // week 53 exists only in some years
}
export const isWeekId = (s: unknown): s is string => typeof s === 'string' && fridayOfWeek(s) !== null;

/** When a weekly opens and closes, and the open day's date (what the archive sorts by). */
export function weeklyWindow(id: string): { opensAt: string; closesAt: string; openDate: string } | null {
  const f = fridayOfWeek(id);
  if (!f) return null;
  const opens = f.getTime() + WEEKLY_OPEN_HOUR_UTC * 3_600_000;
  return { opensAt: new Date(opens).toISOString(), closesAt: new Date(opens + WEEKLY_WINDOW_MS).toISOString(), openDate: f.toISOString().slice(0, 10) };
}
/** The weekly open right now: the most recent Friday 18:00 UTC at or before `now`. */
export function currentWeekId(now: Date): string {
  const sinceFriday = (now.getUTCDay() - 5 + 7) % 7;
  let friday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - sinceFriday));
  if (friday.getTime() + WEEKLY_OPEN_HOUR_UTC * 3_600_000 > now.getTime()) friday = new Date(friday.getTime() - 7 * DAY);
  return isoWeekId(friday);
}
export const nextWeekId = (id: string): string | null => {
  const f = fridayOfWeek(id);
  return f ? isoWeekId(new Date(f.getTime() + 7 * DAY)) : null;
};
export const prevWeekId = (id: string): string | null => {
  const f = fridayOfWeek(id);
  return f ? isoWeekId(new Date(f.getTime() - 7 * DAY)) : null;
};
/** Whether a weekly seed's window has closed. */
export const weeklyClosed = (seed: string, now: Date): boolean => {
  const id = weeklyIdOf(seed);
  const w = id ? weeklyWindow(id) : null;
  return !!w && Date.parse(w.closesAt) <= now.getTime();
};
