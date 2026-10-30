/** Badge titles and texts for the player (production roadmap 0.9.0); the sim decides which badges a run earned. */
import { badgeIdsFor, MINIMALIST_MACHINES, type BadgeId } from '../sim/badges';
import type { RunState } from '../sim/run';
import { t } from './strings';

export interface Badge { id: BadgeId; title: string; text: string }

export function badgeInfo(id: BadgeId): Badge {
  switch (id) {
    case 'clean': return { id, title: t('badge.clean.title'), text: t('badge.clean.text') };
    case 'minimalist': return { id, title: t('badge.minimalist.title'), text: t('badge.minimalist.text', { n: MINIMALIST_MACHINES }) };
    default: return { id, title: t('badge.allHands.title'), text: t('badge.allHands.text') };
  }
}
export const badgesFor = (run: Pick<RunState, 'rounds' | 'score' | 'layout' | 'bin' | 'sold'>, botPar: number | null): Badge[] => badgeIdsFor(run, botPar).map(badgeInfo);
