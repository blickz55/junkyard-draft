/**
 * The job as the player reads it (rules v4): the one-line goal, the flavour line picked from the yard's name, the recipe and
 * the pace. The numbers come from game/src/sim/yard.ts; this module only words them. Pure, so the HUD, the job card, the
 * results and the home screen all say the same thing.
 */
import { JOB_MACHINE, isTutorialSeed, type Job } from '../sim/yard';
import { RULES } from '../sim/rules';
import { shippedTotal, type RunState } from '../sim/run';
import type { MachineKind, Material } from '../sim/types';
import { t, type StringKey } from './strings';
import { int } from './format';
import { machineName } from './machines';

export const materialMany = (m: Material): string => t(`material.${m}.many` as StringKey);
/** The job's target is its third star. */
export const jobTarget = (job: Job): number => job.stars[2];
export const jobLine = (job: Job): string => t('job.ship', { n: int(jobTarget(job)), mat: materialMany(job.material) });
export const starMarks = (n: number): string => '★'.repeat(n);

const FLAVOURS = 6;
function nameHash(seed: string): number {
  let h = 7;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return h;
}
/** A line of story for the job, the same for everyone on the same yard. */
export function jobFlavour(seed: string, job: Job): string {
  if (isTutorialSeed(seed)) return t('job.flavour.lesson');
  return t(`job.flavour.${job.material}.${(nameHash(seed) % FLAVOURS) + 1}` as StringKey);
}
/** The chain every job needs, in order. */
export const jobRecipe = (job: Job): MachineKind[] => ['hopper', 'crusher', JOB_MACHINE[job.material], 'dock'];

/** The next machine the job still needs, in recipe order; null when the line has them all (on a yard with a job). */
export function nextNeeded(r: Pick<RunState, 'job' | 'layout' | 'bin'>): MachineKind | null {
  if (!r.job) return null;
  const owned = (k: MachineKind) => r.layout.machines.some((m) => m.kind === k) || r.bin.some((m) => m.kind === k);
  return jobRecipe(r.job).find((k) => !owned(k)) ?? null;
}
/** When a shift shipped none of the job's goods and machines are missing from the line, that is the advice: the bottleneck can wait. */
export function missingForJob(r: Pick<RunState, 'job' | 'layout' | 'rounds'>): string | null {
  const job = r.job;
  const last = r.rounds[r.rounds.length - 1];
  if (!job || !last || last.result.shipped[job.material] > 0) return null;
  const missing = jobRecipe(job).filter((k) => !r.layout.machines.some((m) => m.kind === k));
  if (!missing.length) return null;
  return t('job.noGoods', { mat: materialMany(job.material), list: `${t('job.the')}${missing.map(machineName).join(t('job.and'))}` });
}

export interface Pace {
  shipped: number;
  thisShift: number;
  /** what the same shift, repeated to the end, would come to */ projected: number;
  /** the next star not yet reached (1 to 3), or null when all three are in */ nextStar: number | null;
  /** how many more a shift the next star takes, over the shifts left; null when no shifts are left */ perShift: number | null;
}
/** Where the job stands after a finished shift. */
export function paceOf(run: Pick<RunState, 'job' | 'rounds' | 'round'>): Pace | null {
  const job = run.job;
  if (!job) return null;
  const shipped = shippedTotal(run, job.material);
  const last = run.rounds[run.rounds.length - 1];
  const thisShift = last ? last.result.shipped[job.material] : 0;
  const left = Math.max(0, RULES.rounds - run.rounds.length);
  const next = job.stars.findIndex((n) => shipped < n);
  return {
    shipped,
    thisShift,
    projected: shipped + thisShift * left,
    nextStar: next < 0 ? null : next + 1,
    perShift: next < 0 || left === 0 ? null : Math.ceil((job.stars[next] - shipped) / left),
  };
}
