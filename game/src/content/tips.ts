/**
 * Tips as the player reads them (production roadmap 0.9.0): the demo layouts, loop lengths and checks stay in the sim
 * (game/src/sim/tips.ts, so tests can run every demo); the title, text and "what to watch" come from the string table.
 */
import { TIP_DEMOS, type TipDemo } from '../sim/tips';
import { RULES } from '../sim/rules';
import type { MachineKind } from '../sim/types';
import { t, type StringKey } from './strings';
import { money } from './format';

export interface Tip extends TipDemo { title: string; text: string; watch: string }

const params: Record<string, Record<string, string | number>> = {
  crusher: { scrap: money(RULES.value.scrap), shards: money(RULES.value.shards) },
  furnace: { ingot: money(RULES.value.ingot), slag: money(RULES.value.slag), time: RULES.process.furnace },
  press: { plate: money(RULES.value.plate) },
  tuner: { bonus: RULES.tunerBonus, tuned: RULES.process.furnace - RULES.tunerBonus, time: RULES.process.furnace },
  sell: { sell: money(RULES.sellValue) },
};

function withText(d: TipDemo): Tip {
  const p = params[d.id] ?? {};
  const watchKey = `tips.${d.id}.watch` as StringKey;
  return { ...d, title: t(`tips.${d.id}.title` as StringKey, p), text: t(`tips.${d.id}.text` as StringKey, p), watch: d.layout ? t(watchKey, p) : '' };
}

/** Every tip with its text; built on each call so the pseudo-locale applies. */
export const tips = (): Tip[] => TIP_DEMOS.map(withText);
export const tipById = (tipId: string): Tip | undefined => tips().find((x) => x.id === tipId);
/** The tip to suggest when a machine is drafted for the first time (null when none or already read). */
export function tipForMachine(kind: MachineKind, read: readonly string[]): Tip | null {
  const d = TIP_DEMOS.find((x) => x.machine === kind);
  return d && !read.includes(d.id) ? withText(d) : null;
}
