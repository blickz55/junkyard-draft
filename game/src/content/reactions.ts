/**
 * The eight reactions on a run (production roadmap 0.11.3): a fixed list and counts only, so there is nothing to moderate. The
 * verifier takes nothing else; the words for them are in the string table (`reaction.<id>`).
 */
export const REACTIONS = [
  { id: 'fire', glyph: '🔥' },
  { id: 'applause', glyph: '👏' },
  { id: 'mindblown', glyph: '🤯' },
  { id: 'brain', glyph: '🧠' },
  { id: 'recycle', glyph: '♻️' },
  { id: 'turtle', glyph: '🐢' },
  { id: 'puzzle', glyph: '🧩' },
  { id: 'factory', glyph: '🏭' },
] as const;
export type ReactionId = (typeof REACTIONS)[number]['id'];
export type ReactionCounts = Partial<Record<ReactionId, number>>;

export const isReaction = (x: unknown): x is ReactionId => REACTIONS.some((r) => r.id === x);
export const reactionTotal = (c: ReactionCounts): number => Object.values(c).reduce((n, v) => n + (v ?? 0), 0);
/** The most used first, then in list order: "🔥 3 👏 1", at most `top` of them; empty when nobody has reacted. */
export const reactionLine = (c: ReactionCounts, top = 3): string =>
  REACTIONS.filter((r) => c[r.id])
    .map((r, i) => ({ ...r, i, n: c[r.id]! }))
    .sort((a, b) => b.n - a.n || a.i - b.i)
    .slice(0, top)
    .map((r) => `${r.glyph} ${r.n}`)
    .join(' ');
