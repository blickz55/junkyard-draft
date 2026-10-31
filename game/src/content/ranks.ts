/**
 * The career ladder (rules v4): the stars of a player's best game on each yard add up to a rank. Local only, a reason to come
 * back, never a claim about other players (CLAUDE.md: never invent competitors) and never sent anywhere.
 */
import { t, type StringKey } from './strings';

/** Total stars each rank starts at. */
export const RANK_STARS: readonly number[] = [0, 5, 15, 30, 60, 100, 200];

export interface Rank {
  index: number;
  name: string;
  /** the rank above, or null at the top */ next: { name: string; need: number } | null;
}
const nameOf = (i: number) => t(`rank.${i}` as StringKey);

export function rankFor(stars: number): Rank {
  let index = 0;
  for (let i = 0; i < RANK_STARS.length; i++) if (stars >= RANK_STARS[i]) index = i;
  const up = index + 1 < RANK_STARS.length ? { name: nameOf(index + 1), need: RANK_STARS[index + 1] - stars } : null;
  return { index, name: nameOf(index), next: up };
}
export const rankLine = (stars: number): string => t('rank.line', { rank: rankFor(stars).name, n: stars });
export function rankNext(stars: number): string {
  const r = rankFor(stars).next;
  return r ? t('rank.next', { n: r.need, rank: r.name }) : '';
}
