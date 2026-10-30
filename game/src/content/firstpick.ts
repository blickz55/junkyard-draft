/**
 * The first draft's advice (production roadmap 0.9.3): which card to take and why, from the offers alone. Presentation only:
 * a ranking by how much a machine can do on a fresh belt (scrap from one hopper, three conveyors, a dock), with the reason
 * from the string table. No scoring authority; the player picks whatever they like.
 */
import type { MachineKind } from '../sim/types';
import { RULES } from '../sim/rules';
import { t } from './strings';
import { money } from './format';

/** Most useful first, on a belt that carries only raw scrap. */
export const FIRST_PICK_ORDER: readonly MachineKind[] = ['crusher', 'hopper', 'conveyor', 'splitter', 'press', 'furnace', 'tuner', 'sieve', 'dock'];

export interface FirstPick {
  index: number;
  kind: MachineKind;
  why: string;
}

export function recommendFirstPick(offers: readonly MachineKind[]): FirstPick | null {
  if (!offers.length) return null;
  let best = 0;
  for (let i = 1; i < offers.length; i++) if (rank(offers[i]) < rank(offers[best])) best = i;
  const kind = offers[best];
  return {
    index: best,
    kind,
    why: t(`firstpick.${kind}` as const, {
      scrap: money(RULES.value.scrap),
      shards: money(RULES.value.shards),
      plate: money(RULES.value.plate),
      slag: money(RULES.value.slag),
    }),
  };
}

const rank = (k: MachineKind): number => {
  const i = FIRST_PICK_ORDER.indexOf(k);
  return i < 0 ? FIRST_PICK_ORDER.length : i;
};
