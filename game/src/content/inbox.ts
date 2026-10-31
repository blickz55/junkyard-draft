/** What a line in the inbox says (0.11.7). A kind this client does not know yet says nothing, so a newer server cannot break an older game. */
import { placeLine, periodLabel } from './division';
import { money } from './format';
import { reactionLine, reactionTotal, type ReactionCounts } from './reactions';
import { t } from './strings';
import { yardLabel } from './yard';
import type { DivisionMedal } from '../daily/divisions';

export function inboxText(kind: string, p: Record<string, unknown>): string | null {
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
