/** What a line in the inbox says (0.11.7). A kind this client does not know yet says nothing, so a newer server cannot break an older game. */
import { placeLine, periodLabel } from './division';
import { money, utcDateTime } from './format';
import { reactionLine, reactionTotal, type ReactionCounts } from './reactions';
import { t, type StringKey } from './strings';
import { MORE_STRINGS } from './strings-more';
import { lookName } from './title';
import { yardLabel } from './yard';
import type { DivisionMedal } from '../daily/divisions';

/** `self-harm` is the key `selfHarm`: a code from the server names a string. */
const keyWord = (code: unknown) => String(code).replace(/-(\w)/g, (_, c: string) => c.toUpperCase());
const known = (key: string): key is StringKey => key in MORE_STRINGS;
/** The sentence for a reason; a reason this client does not know yet still says something true. */
export const reasonText = (code: unknown) => {
  const key = `moderation.reason.${keyWord(code)}`;
  return t(known(key) ? key : 'moderation.reason.other');
};

export function inboxText(kind: string, p: Record<string, unknown>): string | null {
  if (kind === 'moderation') {
    const key = `moderation.what.${keyWord(p.what)}`;
    if (!known(key)) return null;
    return t(key, {
      excerpt: (p.excerpt as string | undefined) ?? '',
      reason: reasonText(p.code),
      until: typeof p.until === 'number' ? utcDateTime(new Date(p.until).toISOString()) : '',
    });
  }
  if (kind === 'cosmetic') return lookName(p.id as string) ? t('inbox.cosmetic', { name: lookName(p.id as string) }) : null;
  if (kind === 'message') return t('inbox.message', { player: p.player as string });
  if (kind === 'friend-request') return t('inbox.friendRequest', { player: p.player as string });
  if (kind === 'friend-accepted') return t('inbox.friendAccepted', { player: p.player as string });
  if (kind === 'appeal') return p.result === 'overturned' ? t('moderation.appealOverturned') : t('moderation.appealUpheld');
  if (kind === 'thread-reply') {
    if (p.kind !== 'run') return t('inbox.threadReply', { yard: periodLabel(p.key as string) });
    const game = { score: money(p.score as number), yard: yardLabel(p.seed as string) };
    return p.own ? t('inbox.runComment', game) : t('inbox.runReply', { ...game, player: p.player as string });
  }
  if (kind === 'reactions') {
    const reactions = p.reactions as ReactionCounts;
    const n = reactionTotal(reactions);
    return t('inbox.reactions', {
      line: `${t('reaction.total', { n })} ${reactionLine(reactions)}`,
      score: money(p.score as number),
      yard: yardLabel(p.seed as string),
    });
  }
  if (kind === 'challenge')
    return t('inbox.challenge', {
      player: p.player as string,
      theirs: money(p.theirs as number),
      yard: yardLabel(p.seed as string),
      score: money(p.score as number),
    });
  if (kind === 'division')
    return t('division.home', {
      day: periodLabel(p.period as string),
      line: placeLine({ place: p.place as number, size: p.size as number, name: p.name as string, medal: (p.medal as DivisionMedal | null) ?? null }),
    });
  if (kind === 'crew-day') {
    const crew = (p.crew as string | null) ?? t('inbox.crewGone');
    const day = periodLabel(p.period as string);
    return p.place === 1
      ? t('inbox.crewDayWon', { crew, day, size: p.size as number, score: money(p.score as number) })
      : t('inbox.crewDay', { crew, day, top: p.top as string, score: money(p.score as number), place: p.place as number, size: p.size as number });
  }
  return null;
}
