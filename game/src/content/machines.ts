/**
 * Machine and material names for the player (production roadmap 0.9.0): the text that used to sit in the sim's
 * MACHINE_INFO, now read from the string table with the rules' numbers filled in. The sim keeps the kinds and the numbers.
 */
import { RULES } from '../sim/rules';
import type { MachineKind, Material } from '../sim/types';
import { t } from './strings';
import { money } from './format';

export interface MachineInfo { name: string; blurb: string }

export function machineName(kind: MachineKind): string { return t(`machine.${kind}.name` as const); }
export function machineBlurb(kind: MachineKind): string {
  switch (kind) {
    case 'hopper': return t('machine.hopper.blurb', { period: RULES.hopperPeriod });
    case 'crusher': return t('machine.crusher.blurb', { shards: money(RULES.value.shards), time: RULES.process.crusher });
    case 'furnace': return t('machine.furnace.blurb', { ingot: money(RULES.value.ingot), slag: money(RULES.value.slag), time: RULES.process.furnace });
    case 'press': return t('machine.press.blurb', { plate: money(RULES.value.plate), time: RULES.process.press });
    default: return t(`machine.${kind}.blurb` as const);
  }
}
export const machineInfo = (kind: MachineKind): MachineInfo => ({ name: machineName(kind), blurb: machineBlurb(kind) });
/** The short lower-case name used inside sentences ("the furnace at 5,3"). */
export const machineWord = (kind: MachineKind): string => (kind === 'hopper' || kind === 'dock' || kind === 'press' ? kind : machineName(kind).toLowerCase());
export const materialName = (mat: Material): string => t(`material.${mat}` as const);
