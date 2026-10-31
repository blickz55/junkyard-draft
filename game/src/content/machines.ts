/**
 * Machine and material names for the player (production roadmap 0.9.0): the text that used to sit in the sim's
 * MACHINE_INFO, now read from the string table with the rules' numbers filled in. The sim keeps the kinds and the numbers.
 */
import { RULES } from '../sim/rules';
import type { Layout, MachineKind, Material } from '../sim/types';
import { priceOf } from '../sim/yard';
import { t } from './strings';
import { money } from './format';

export interface MachineInfo {
  name: string;
  blurb: string;
}

export function machineName(kind: MachineKind): string {
  return t(`machine.${kind}.name` as const);
}
/** What a card says. On a yard with a job, the job's goods are worth the job's price: pass the layout and the card says so. */
export function machineBlurb(kind: MachineKind, layout: Pick<Layout, 'premium'> = {}): string {
  switch (kind) {
    case 'hopper':
      return t('machine.hopper.blurb', { period: RULES.hopperPeriod });
    case 'crusher':
      return t('machine.crusher.blurb', { shards: money(RULES.value.shards), time: RULES.process.crusher });
    case 'furnace':
      return t('machine.furnace.blurb', { ingot: money(priceOf(layout, 'ingot')), slag: money(RULES.value.slag), time: RULES.process.furnace });
    case 'press':
      return t('machine.press.blurb', { plate: money(priceOf(layout, 'plate')), time: RULES.process.press });
    default:
      return t(`machine.${kind}.blurb` as const);
  }
}
export const machineInfo = (kind: MachineKind): MachineInfo => ({ name: machineName(kind), blurb: machineBlurb(kind) });
/** The short lower-case name used inside sentences ("the furnace at 5,3"). */
export const machineWord = (kind: MachineKind): string => (kind === 'hopper' || kind === 'dock' || kind === 'press' ? kind : machineName(kind).toLowerCase());
/** The name a chip has room for: Hopper, Crusher, Dock. */
export const machineShort = (kind: MachineKind): string => {
  const w = machineWord(kind);
  return w.charAt(0).toUpperCase() + w.slice(1);
};
export const materialName = (mat: Material): string => t(`material.${mat}` as const);
