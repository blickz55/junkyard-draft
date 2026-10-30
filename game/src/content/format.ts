/**
 * Number and date formatting for everything a player reads (production roadmap 0.9.0): one place that uses Intl, so
 * no screen hand-rolls a date and every money amount is written the same way. English (en-US) numbers without a
 * grouping separator: "$1758" stays a single token the share text, the cards and the tests can pin, and the
 * simulation's integers never carry fractions. Dates are UTC on purpose: the daily's clock is UTC everywhere.
 */
const MONEY = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0, useGrouping: false });
const INT = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0, useGrouping: false });
const DEC1 = new Intl.NumberFormat('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1, useGrouping: false });
const UTC_DATE_TIME = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'UTC',
  year: 'numeric',
  month: 'short',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});
const UTC_DATE = new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', year: 'numeric', month: 'short', day: 'numeric' });
const UTC_DAY = new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', month: 'long', day: 'numeric' });

const LOCAL_HOUR = new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit' });
/** "9:00 AM": a local hour of the day (the daily reminder's picker, 0.10.4). */
export const localHour = (hour: number): string => LOCAL_HOUR.format(new Date(2026, 0, 1, hour, 0, 0));
/** "$1758"; negative amounts use the typographic minus the share text always used: "−$40". */
export const money = (n: number): string => (n < 0 ? `−${MONEY.format(-n)}` : MONEY.format(n));
export const int = (n: number): string => INT.format(n);
export const dec1 = (n: number): string => DEC1.format(n);
/** "30 Oct 2026, 00:00 UTC" from an ISO instant; the input unchanged when it does not parse. */
export function utcDateTime(iso: string): string {
  const t = Date.parse(iso);
  return Number.isFinite(t) ? `${UTC_DATE_TIME.format(t).replace(',', ',')} UTC` : iso;
}
/** "30 Oct 2026" from an ISO instant or a YYYY-MM-DD date. */
export function utcDate(isoOrDate: string): string {
  const t = Date.parse(/^\d{4}-\d{2}-\d{2}$/.test(isoOrDate) ? `${isoOrDate}T00:00:00Z` : isoOrDate);
  return Number.isFinite(t) ? UTC_DATE.format(t) : isoOrDate;
}
/** "30 October" for a yard named by its date (the glossary: "the yard of 12 March"). */
export function utcDay(date: string): string {
  const t = Date.parse(`${date}T00:00:00Z`);
  return Number.isFinite(t) ? UTC_DAY.format(t) : date;
}
