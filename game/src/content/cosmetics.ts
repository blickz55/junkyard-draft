/**
 * What a player can earn to wear (0.11.12): a yard colour, machine paint and a title beside the name. One list both sides read: the server
 * says what is unlocked, the game draws it. Nothing here reaches game/src/sim, because paint changes how a yard looks, never what happens
 * in it. The colours are placeholders until the commission (0.12.0); the ids and the rules stay. An id starts with its kind.
 */
export type CosmeticKind = 'yard' | 'skin' | 'title';
export const COSMETIC_KINDS: readonly CosmeticKind[] = ['yard', 'skin', 'title'];

/** How far a player has come: days with a checked daily, and the trophies, which never decay. */
export interface Progress {
  days: number;
  trophies: Record<string, number>;
}
/** What it takes. Every line must hold. */
export interface Needs {
  days?: number;
  medals?: number;
  gold?: number;
  top?: number;
}
export interface Cosmetic {
  id: string;
  kind: CosmeticKind;
  needs: Needs;
  /** the coat a placeholder is painted in */ colour?: string;
}

export const COSMETICS: readonly Cosmetic[] = [
  { id: 'yard-dusk', kind: 'yard', needs: { days: 3 }, colour: '#6a5a9a' },
  { id: 'yard-moss', kind: 'yard', needs: { days: 10 }, colour: '#5f7f4f' },
  { id: 'yard-frost', kind: 'yard', needs: { days: 30 }, colour: '#6f9fc0' },
  { id: 'yard-ember', kind: 'yard', needs: { medals: 5 }, colour: '#b0553a' },
  { id: 'skin-oxide', kind: 'skin', needs: { days: 5 }, colour: '#b5482e' },
  { id: 'skin-verdigris', kind: 'skin', needs: { medals: 1 }, colour: '#3f9d8b' },
  { id: 'skin-brass', kind: 'skin', needs: { gold: 1 }, colour: '#c9a227' },
  { id: 'skin-cobalt', kind: 'skin', needs: { top: 3 }, colour: '#3f6fc0' },
  { id: 'title-regular', kind: 'title', needs: { days: 7 } },
  { id: 'title-old-hand', kind: 'title', needs: { days: 30 } },
  { id: 'title-podium', kind: 'title', needs: { medals: 3 } },
  { id: 'title-top-shelf', kind: 'title', needs: { top: 1 } },
  { id: 'title-sals-pick', kind: 'title', needs: { gold: 10 } },
];

const BY_ID = new Map(COSMETICS.map((c) => [c.id, c]));
export const cosmeticById = (id: string): Cosmetic | null => BY_ID.get(id) ?? null;

/** The numbers the needs are measured against. */
export function measures(p: Progress): Required<Needs> {
  const gold = p.trophies['medal-gold'] ?? 0;
  const medals = gold + (p.trophies['medal-silver'] ?? 0) + (p.trophies['medal-bronze'] ?? 0);
  return { days: p.days, medals, gold, top: p.trophies['top-division'] ?? 0 };
}
export function earned(c: Cosmetic, p: Progress): boolean {
  const have = measures(p);
  return (Object.keys(c.needs) as (keyof Needs)[]).every((k) => have[k] >= c.needs[k]!);
}
/** Everything this progress has earned. */
export const unlockedBy = (p: Progress): string[] => COSMETICS.filter((c) => earned(c, p)).map((c) => c.id);

/** What a player is wearing: one of each kind at most, null for plain. */
export type Look = Record<CosmeticKind, string | null>;
export const PLAIN: Look = { yard: null, skin: null, title: null };
/** A look from a list of ids: what this list does not know is dropped, so a newer server cannot break an older client. */
export function lookFrom(ids: readonly unknown[]): Look {
  const look = { ...PLAIN };
  for (const id of ids) {
    const c = typeof id === 'string' ? cosmeticById(id) : null;
    if (c) look[c.kind] = c.id;
  }
  return look;
}
