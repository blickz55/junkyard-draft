/**
 * Refusals and placement warnings as the player reads them (production roadmap 0.9.0). The geometry (what feeds what)
 * stays in game/src/sim/advice.ts and answers with a structured issue; this module turns a RunError message or an issue
 * into a sentence from the string table.
 */
import { placementIssue } from '../sim/advice';
import type { Dir, Layout, MachineKind } from '../sim/types';
import { t } from './strings';
import { machineName } from './machines';
import { money } from './format';

/** Player-facing text for a RunError message thrown by `apply` (never empty). */
export function explainRunError(message: string): string {
  const m = message.toLowerCase();
  if (m.includes('occupied')) return t('advice.occupied');
  if (m.includes('out of bounds')) return t('advice.outOfBounds');
  if (m.includes('not building')) return t('advice.notBuilding');
  if (m.includes('not drafting')) return t('advice.notDrafting');
  if (m.includes('bad offer')) return t('advice.badOffer');
  if (m.includes('only bin parts')) return t('advice.onlyShelf');
  if (m.includes('action limit')) return t('advice.actionLimit');
  if (m.includes('round not finished')) return t('advice.roundNotFinished');
  if (m.includes('already used this round')) return t('advice.offersOnce');
  if (m.includes('cannot afford')) {
    const amt = message.match(/\$(\d+)/)?.[1];
    return t('advice.cannotAfford', { amount: amt ? money(Number(amt)) : '' });
  }
  if (m.includes('no rerolls in the tutorial')) return t('advice.noOffersInLesson');
  if (m.includes('no machine')) return t('advice.noMachine');
  if (m.includes('malformed') || m.includes('unknown action')) return t('advice.notAllowed');
  return t('advice.other', { message });
}

/** A legal placement that will not work as drawn, as one line; null when it looks fine. */
export function placementWarning(layout: Layout, kind: MachineKind, x: number, y: number, dir: Dir, id: number): string | null {
  const issue = placementIssue(layout, kind, x, y, dir, id);
  if (!issue) return null;
  const name = machineName(kind);
  switch (issue.kind) {
    case 'tuner-alone':
      return t('advice.tunerAlone');
    case 'conveyor-unfed':
      return t('advice.conveyorUnfed');
    case 'behind-not-facing':
      return t('advice.behindNotFacing', { name, behind: machineName(issue.behind).toLowerCase() });
    case 'unfed':
      return t('advice.unfed', { name });
    case 'off-grid':
      return t('advice.offGrid', { name });
  }
}
