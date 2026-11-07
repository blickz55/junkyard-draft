/**
 * The promise after the score goes up (the consultant panel, 2026-11-06): once a daily is checked, the results say as a fact when the
 * places become final and where this device's lands. The moment is the day's close (the verifier freezes the board at `closesAt`,
 * server/verify.ts) in the player's own zone and calendar, like the next yard's time; the count is the board's with this game on it,
 * and under five games, or with the count unknown, it is "the final board" alone; the first game on today's board is said to be.
 * Where it lands is the inbox: the day closing writes each placed player a line there (closeDay, server/community.ts), which a device
 * with a key our server takes reaches from Home. No urgency: a time and a place, nothing to hurry for. The results are lazy, so the
 * words live in strings-more.ts.
 */
import { t } from './strings';
import './strings-more';
import { localDate, localTime, localWeekday } from './format';

const DAY_MS = 86_400_000;
/** "7:00 PM tomorrow", "7:00 PM today", "1:00 AM on Sunday": an instant as the player's clock and calendar have it. */
export function whenFinal(closesAt: Date, now = new Date(), timeZone?: string): string {
  const time = localTime(closesAt, timeZone);
  const day = localDate(closesAt, timeZone);
  if (day === localDate(now, timeZone)) return t('results.finalToday', { time });
  if (day === localDate(new Date(now.getTime() + DAY_MS), timeZone)) return t('results.finalTomorrow', { time });
  return t('results.finalOn', { time, day: localWeekday(closesAt, timeZone) });
}

/** From this many games the line carries the count; under it, the board is "the final board" and nothing is counted. */
export const COUNTED_FROM = 5;

export interface FinalLineInput {
  /** when the day closes: from then on the board never changes */
  closesAt: Date;
  /** games on the board with this one counted, as the status line has it; null when the board could not be read */
  games: number | null;
  /** today's yard, so "today" is true of its board */
  today: boolean;
  /** this device has a key our server takes: where it finished lands in its inbox when the day closes */
  inbox: boolean;
  now?: Date;
  timeZone?: string;
}
export function finalLine(x: FinalLineInput): string {
  const when = whenFinal(x.closesAt, x.now, x.timeZone);
  const inbox = x.inbox ? t('results.finalInbox') : '';
  if (x.games === 1 && x.today) return t('results.finalFirst', { when, inbox });
  if (x.games != null && x.games >= COUNTED_FROM) return t('results.finalCount', { n: x.games, when, inbox });
  return t('results.finalBoard', { when, inbox });
}
