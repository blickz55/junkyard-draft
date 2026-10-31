/**
 * Divisions at freeze (production roadmap 0.11.11). Pure and browser-free; the verifier computes them once when a day closes,
 * the client only reads. The day's checked players, best first, are cut into groups so that a player at $3,000 and a player at
 * $300 each have a board they can top. The first division holds sixteen when that leaves a real second one; the rest are as
 * even as they can be, around thirty-two; a day with fewer than thirty-two players is one division. The top three of a division
 * take its medals. A division's name is a key the client turns into words (`division.<tier>`, and a number when a tier holds
 * several): the tiers run back through the yard, from the foreman's table by the dock to the heap the scrap comes from.
 */
export const DIVISION_MIN = 16;
export const DIVISION_TARGET = 32;
export const DIVISION_MAX = 64;
export const DIVISION_TIERS = ['table', 'dockside', 'foundry', 'pressroom', 'workshop', 'crusher', 'scrapline', 'heap'] as const;
export type DivisionTier = (typeof DIVISION_TIERS)[number];
export type DivisionMedal = 'gold' | 'silver' | 'bronze';

/** The sizes of the divisions for `n` players, best division first. They add up to `n`. */
export function divisionSizes(n: number): number[] {
  if (n <= 0) return [];
  if (n < 2 * DIVISION_MIN) return [n];
  const rest = n - DIVISION_MIN;
  const k = Math.max(1, Math.round(rest / DIVISION_TARGET));
  const base = Math.floor(rest / k),
    extra = rest % k;
  return [DIVISION_MIN, ...Array.from({ length: k }, (_, i) => base + (i < extra ? 1 : 0))];
}

/** The key of division `i` of `total`: one tier each while they last, then the tiers shared out in order, numbered inside each. */
export function divisionKey(i: number, total: number): { tier: DivisionTier; number: number | null; key: string } {
  const tiers = DIVISION_TIERS.length;
  if (total <= tiers) return { tier: DIVISION_TIERS[i], number: null, key: DIVISION_TIERS[i] };
  const t = Math.floor((i * tiers) / total);
  const first = Math.ceil((t * total) / tiers);
  const number = i - first + 1;
  return { tier: DIVISION_TIERS[t], number, key: `${DIVISION_TIERS[t]}-${number}` };
}

export const divisionMedal = (place: number): DivisionMedal | null => (place === 1 ? 'gold' : place === 2 ? 'silver' : place === 3 ? 'bronze' : null);

export interface DivisionPlacement<T> {
  player: T;
  division: number;
  key: string;
  place: number;
  size: number;
  medal: DivisionMedal | null;
}

/** Each player's division and place. `ranked` is the day's final order, one row per player, best first. */
export function placeDivisions<T>(ranked: readonly T[]): DivisionPlacement<T>[] {
  const sizes = divisionSizes(ranked.length);
  const out: DivisionPlacement<T>[] = [];
  let at = 0;
  sizes.forEach((size, division) => {
    const { key } = divisionKey(division, sizes.length);
    for (let place = 1; place <= size; place++) out.push({ player: ranked[at++], division, key, place, size, medal: divisionMedal(place) });
  });
  return out;
}
