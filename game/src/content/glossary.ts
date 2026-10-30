/**
 * The plain-language glossary (production roadmap 0.9.0, Appendix B): internal word → the word a player reads, and
 * the words that may not appear in any player-facing string. tests/strings.test.ts holds the string table to the banned
 * list; the policy page is the one place the technical words are allowed (the glossary says so), and the generated
 * policy and legal documents are exact texts outside the table. The owner reviews this list ⚑; changing a player word
 * means changing the table, nothing else.
 */
export interface GlossaryEntry {
  internal: string;
  player: string;
  note: string;
}
export const GLOSSARY: readonly GlossaryEntry[] = [
  {
    internal: 'seed, daily seed',
    player: "yard; today's yard; the yard of 30 October",
    note: 'the date is the name; the seed string stays in the URL and the share text',
  },
  { internal: 'tick', player: 'second', note: "80 ticks are 80 seconds of the yard's clock at 1×; the simulation is unchanged" },
  { internal: "run (a round's simulation)", player: 'shift', note: '"start the shift"; a whole game is "the game"' },
  {
    internal: 'verified, verifier',
    player: 'checked, our server',
    note: '"checked by our server" on the policy page and in the share text; "checked" everywhere else',
  },
  { internal: 'replay', player: 'the recording', note: '"watch the recording"' },
  { internal: 'replay hash', player: "the recording's code", note: 'shown as eight characters where needed' },
  { internal: 'local best, unverified', player: 'your best on this device, not yet checked', note: '' },
  { internal: 'histogram', player: 'everyone today', note: '"better than 61 % of everyone today"' },
  { internal: 'percentile', player: 'better than N %', note: 'never the word' },
  { internal: 'bot par', player: "the foreman's mark", note: 'what our own player reaches, explained once' },
  { internal: 'reroll', player: 'new offers (−$40)', note: 'the button says what it costs' },
  { internal: 'draft', player: 'pick', note: '"pick a machine"' },
  { internal: 'bin', player: 'the shelf', note: 'parts waiting to be placed' },
  { internal: 'dock', player: 'shipping dock', note: 'kept; "sells what reaches it"' },
  { internal: 'splitter, tuner, press', player: 'kept, with a one-sentence job each', note: 'names are fine; jobs must be plain' },
  { internal: 'freeze, closes at', player: 'the day closes; results final at 00:00 UTC on …', note: '' },
  { internal: 'medal (nearest-rank 50/80/95)', player: 'bronze / silver / gold', note: 'the rule in one sentence on the policy page' },
  { internal: 'group code', player: "your crew's code", note: 'groups are crews' },
  { internal: 'challenge link', player: '"beat this" link', note: '' },
  { internal: 'fork from round N', player: 'a try from round N', note: '' },
  { internal: 'protocol, rules version', player: '(never shown)', note: 'policy page only' },
  { internal: 'device token, recovery code', player: 'your key', note: '"use your key to play as you on another device"' },
];

/** Words that may not appear in a player-facing string (case-insensitive, whole words; "rules version" as a phrase). The policy page keys are exempt. */
export const BANNED_WORDS: readonly string[] = [
  'seed',
  'seeds',
  'tick',
  'ticks',
  'verifier',
  'verified',
  'verify',
  'replay',
  'replays',
  'hash',
  'histogram',
  'percentile',
  'RNG',
  'protocol',
  'rules version',
  'local storage',
  'bearer',
  'token',
  'npm',
  'localhost',
  'reroll',
  'rerolls',
  'fork',
  'forked',
  'bin',
];
/** Phrases that contain a banned word but are allowed: "your key" is the glossary's own term. */
export const BANNED_EXCEPTIONS: readonly RegExp[] = [/\byour key\b/i];

export function bannedWordsIn(text: string): string[] {
  let scan = text.replace(/\{[^{}]*(\{[^{}]*\}[^{}]*)*\}/g, ' '); // placeholders and plural forms are not words the player reads
  for (const ex of BANNED_EXCEPTIONS) scan = scan.replace(ex, ' ');
  const found: string[] = [];
  for (const w of BANNED_WORDS) if (new RegExp(`(^|[^A-Za-z-])${w.replace(/ /g, '\\s+')}(?=$|[^A-Za-z-])`, 'i').test(scan)) found.push(w);
  return found;
}
