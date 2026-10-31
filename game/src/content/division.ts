/** What a division is called (0.11.11): the server stores a key ("foundry-2"), players read "Foundry 2". */
import { DIVISION_TIERS, type DivisionMedal, type DivisionTier } from '../daily/divisions';
import { t, type StringKey } from './strings';
import { int, utcDay } from './format';

export const MEDAL_GLYPH: Record<DivisionMedal, string> = { gold: '🥇', silver: '🥈', bronze: '🥉' };
export const medalGlyph = (m: DivisionMedal | null): string => (m ? MEDAL_GLYPH[m] : '');

export function divisionName(key: string): string {
  const [tier, n] = key.split('-');
  const word = DIVISION_TIERS.includes(tier as DivisionTier) ? t(`division.${tier}` as StringKey) : tier;
  return n ? t('division.numbered', { tier: word, n }) : word;
}
/** "29 October", or "W43" for a weekly. */
export const periodLabel = (period: string): string => (/^\d{4}-\d{2}-\d{2}$/.test(period) ? utcDay(period) : period.slice(5));

/** The numbers of a place: "#3 of 28 in Foundry 2 🥉". */
export const placeLine = (p: { place: number; size: number; name: string; medal: DivisionMedal | null }): string =>
  `${t('division.place', { place: int(p.place), size: int(p.size), division: divisionName(p.name) })}${p.medal ? ` ${medalGlyph(p.medal)}` : ''}`;

/** What Your record says about the trophies: "2 gold · 1 silver · 3 days in the top division", empty with none. */
export function trophyLine(trophies: Record<string, number>): string {
  const parts: string[] = [];
  for (const m of ['gold', 'silver', 'bronze'] as const) {
    const n = trophies[`medal-${m}`];
    if (n) parts.push(t(`division.trophy.${m}` as StringKey, { n }));
  }
  if (trophies['top-division']) parts.push(t('division.trophy.top', { n: trophies['top-division'] }));
  return parts.join(' · ');
}
