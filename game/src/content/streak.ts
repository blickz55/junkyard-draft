/** The days-played line with the streak (PLAN-v3 0.6.3), worded from the table (0.9.0); the arithmetic stays in game/src/daily/streak.ts. */
import { t } from './strings';
import { int } from './format';

export const streakLine = (daysPlayed: number, streak: number): string =>
  `${t('share.days', { n: daysPlayed })}${streak >= 2 ? t('streak.inARow', { n: int(streak) }) : ''}`;
