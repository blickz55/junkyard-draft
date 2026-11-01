/**
 * What Sal writes in a day's thread, and the few words around it on the thread's web page (production roadmap 0.11.5). The server
 * writes all of this, because a thread is also a page with no game behind it, so the table stays apart from the one the game loads
 * and the verifier carries only these lines. Same voice and rules as his other lines (docs/FOREMAN.md, tests/strings.test.ts).
 * Chosen from the day, so everyone reads the same words, and the closing post is a pure function of the board.
 */
import { hashSeed } from '../sim/rng';
import { money } from './format';
import { render, type Params } from './template';

interface Line {
  en: string;
  note: string;
}
const s = (en: string, note: string): Line => ({ en, note });

export const SAL_STRINGS = {
  'sal.open.1': s('The yard is open. Same offers for all of you. Say what you built once your game is in.', "Sal opens a day's thread"),
  'sal.open.2': s('New yard. Nobody is ahead yet. Finish a game, then talk.', "Sal opens a day's thread"),
  'sal.open.3': s('Fresh yard, same dock. Get a game in first, then tell the others how it went.', "Sal opens a day's thread"),
  'sal.close.1': s('The board is final.', 'first sentence of his closing post'),
  'sal.close.2': s("That's the day. The board stands.", 'first sentence of his closing post'),
  'sal.close.3': s('Whistle has gone. Board is final.', 'first sentence of his closing post'),
  'sal.closeNone': s('Nobody put a game on this one. Quiet yard.', 'his closing post when no game was checked'),
  'sal.runs': s('{runs, plural, one {# game} other {# games}} on it, the middle of the pack at {median}.', 'closing post: how many, and the median'),
  'sal.first': s('{a} took it with {aScore}.', 'closing post: one player at the top'),
  'sal.firstTwo': s('{a} took it with {aScore}, ahead of {b}.', 'closing post: two players at the top'),
  'sal.firstThree': s('{a} took it with {aScore}, ahead of {b} and {c}.', 'closing post: three players at the top'),
  'sal.reacted': s('The one you all reacted to: {player} on {score}.', 'closing post: the most reacted game'),
  'sal.pageTitle': s('The talk on {yard}', 'the web page of a thread'),
  'sal.pageDay': s('the yard of {key}', 'a daily on the web page'),
  'sal.pageWeek': s('the week {key}', 'a weekly on the web page'),
  'sal.pageOpen': s(
    'This yard is still open. The talk shows here when it closes. Until then it is in the game, once your game is in.',
    'the web page of an open day',
  ),
  'sal.pageEmpty': s('Nobody has said anything yet.', 'the web page of a thread with no posts'),
  'sal.pageEdited': s('edited', 'beside a post that was changed'),
  'sal.pagePlay': s('Play Junkyard Draft', 'link to the game'),
  'sal.pageName': s('Sal', 'his name on a post'),
  'sal.pageMissing': s('There is no such yard.', 'the web page of an unknown day'),
} as const satisfies Record<string, Line>;
export type SalKey = keyof typeof SAL_STRINGS;

export const sal = (key: SalKey, params: Params = {}): string => render(SAL_STRINGS[key].en, params);

const pick = (group: string, day: string, n: number) => (hashSeed(`${group}|${day}`) % n) + 1;

/** His opening post: neutral, nothing about anyone. */
export const openingPost = (key: string): string => sal(`sal.open.${pick('open', key, 3)}` as SalKey);

export interface DayFacts {
  runs: number;
  median: number | null;
  /** best first, at most three */ top: { player: string; score: number }[];
  /** the game with the most reactions, when there is one */ reacted: { player: string; score: number } | null;
}

/** His closing post, built from the final board: the same board always reads the same. */
export function closingPost(key: string, f: DayFacts): string {
  if (!f.runs) return sal('sal.closeNone');
  const [a, b, c] = f.top;
  const lead = sal(`sal.close.${pick('close', key, 3)}` as SalKey);
  const runs = f.median === null ? '' : sal('sal.runs', { runs: f.runs, median: money(f.median) });
  const who = !a
    ? ''
    : c
      ? sal('sal.firstThree', { a: a.player, aScore: money(a.score), b: b.player, c: c.player })
      : b
        ? sal('sal.firstTwo', { a: a.player, aScore: money(a.score), b: b.player })
        : sal('sal.first', { a: a.player, aScore: money(a.score) });
  const reacted = f.reacted ? sal('sal.reacted', { player: f.reacted.player, score: money(f.reacted.score) }) : '';
  return [lead, runs, who, reacted].filter(Boolean).join(' ');
}
