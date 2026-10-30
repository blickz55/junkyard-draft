/**
 * What a yard is called (production roadmap 0.9.0, the glossary): the seed string stays in URLs, saves and share text's
 * machine-readable parts; players read "today's yard", "the yard of 30 October", "the week's yard (W43)", "the lesson
 * yard" or, for a custom or random seed, "yard <name>".
 */
import { dailyDateOf, isMintedDailySeed, isDailySeed } from '../sim/daily';
import { isWeeklySeed, weeklyIdOf } from '../sim/weekly';
import { isTutorialSeed } from '../sim/run';
import { t } from './strings';
import { utcDay } from './format';

export function yardLabel(seed: string, now = new Date()): string {
  if (isTutorialSeed(seed)) return t('common.yardTutorial');
  if (isWeeklySeed(seed)) { const id = weeklyIdOf(seed); return t('common.yardWeek', { week: id ? id.slice(5) : '?' }); }
  if (isMintedDailySeed(seed) || isDailySeed(seed)) {
    const d = dailyDateOf(seed);
    if (d === now.toISOString().slice(0, 10)) return t('common.yardToday');
    if (d) return t('common.yardOfDay', { day: utcDay(d) });
  }
  return t('common.yard', { seed });
}

/** The compact label on share text, cards and clips: "Daily 2026-10-30", "Lesson", or "yard rust-bolt-123". */
export function shareYardLabel(seed: string): string {
  const d = /^daily-(\d{4}-\d{2}-\d{2})/.exec(seed); if (d) return t('share.daily', { date: d[1] });
  if (isTutorialSeed(seed) || /^tutorial-/.test(seed)) return t('share.tutorial');
  return t('common.yard', { seed });
}
