/**
 * The foreman (production roadmap 0.9.1, text only): Sal's lines, keyed by situation, three to five variants each in the
 * string table (`foreman.<situation>.<n>`), chosen from the UTC date so everyone hears the same line on the same day and
 * the next day brings another. All of this is flavour: the instructions in a game are the coach's (render/guide.ts), and
 * the player can turn Sal to quiet. The character sheet is docs/FOREMAN.md.
 */
import { hashSeed } from '../sim/rng';
import { STRINGS, t, type StringKey, type Params } from './strings';
import { loadSettings } from '../render/storage';

export type Situation =
  | 'welcome'
  | 'dailyOpen'
  | 'dailyFinal'
  | 'roundGood'
  | 'roundFlat'
  | 'resultsTop'
  | 'resultsUpper'
  | 'resultsLower'
  | 'resultsFew'
  | 'resultsOffline'
  | 'resultsFirst'
  | 'streak3'
  | 'streak7'
  | 'streak30'
  | 'firstShare'
  | 'firstCrew';

export const SITUATIONS: readonly Situation[] = [
  'welcome',
  'dailyOpen',
  'dailyFinal',
  'roundGood',
  'roundFlat',
  'resultsTop',
  'resultsUpper',
  'resultsLower',
  'resultsFew',
  'resultsOffline',
  'resultsFirst',
  'streak3',
  'streak7',
  'streak30',
  'firstShare',
  'firstCrew',
];

export const foremanName = (): string => t('foreman.name');

/** The keys of a situation's variants, in order (`foreman.welcome.1`, `.2`, …). */
export function variantKeys(situation: Situation): StringKey[] {
  const out: StringKey[] = [];
  for (let i = 1; i <= 9; i++) {
    const k = `foreman.${situation}.${i}` as StringKey;
    if (k in STRINGS) out.push(k);
    else break;
  }
  return out;
}

/** Today's UTC date, the day's yard, which decides the variant. */
export const dayOf = (now = new Date()): string => now.toISOString().slice(0, 10);

/** The line for a situation on a day: deterministic, the same for every player that day. */
export function foremanLine(situation: Situation, params: Params = {}, day = dayOf()): string {
  const keys = variantKeys(situation);
  if (!keys.length) return '';
  const idx = hashSeed(`${situation}|${day}`) % keys.length;
  return t(keys[idx], params);
}

export type Chatter = 'full' | 'less';
export const chatter = (): Chatter => loadSettings().chatter;

/** The line, or '' when the player turned Sal to quiet. */
export function foremanSays(situation: Situation, params: Params = {}, day = dayOf()): string {
  if (chatter() === 'less') return '';
  return foremanLine(situation, params, day);
}

/** The results band for a checked game among n others: top (better than 80 %), upper (50 %), lower; few below five games. */
export function resultsBand(percentile: number | null, n: number): Situation {
  if (n < 5 || percentile == null) return 'resultsFew';
  return percentile >= 80 ? 'resultsTop' : percentile >= 50 ? 'resultsUpper' : 'resultsLower';
}
