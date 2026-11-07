/**
 * Home's record card before the first game (the consultant panel, 2026-11-06): a device that had finished a lesson but no game read
 * "No finished games yet" and "0 games played on this device" under up to nine lesson stars. Now it states what is done and what is
 * next, as facts. A device with neither keeps the old words, and a device with a game never comes here: the bests speak.
 */
import { LESSONS } from './lessons';
import { t } from './strings';

export interface HomeProgress {
  /** "Lessons done: 2 of 3." */ done: string;
  /** "Your first game is next." */ next: string;
}
/** The two lines, or null when the record card has a game to speak of, or nothing done at all. Only lessons the game still has count. */
export function homeProgress(lessonsDone: readonly number[], gamesEver: number, lessons: readonly { n: number }[] = LESSONS): HomeProgress | null {
  const n = lessons.filter((l) => lessonsDone.includes(l.n)).length;
  if (gamesEver > 0 || n === 0) return null;
  return { done: t('title.lessonsDone', { n, total: lessons.length }), next: t('title.firstGameNext') };
}
