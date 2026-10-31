import { Rng } from './rng';
import { RULES } from './rules';
import { runLayout, validateLayout } from './sim';
import type { Dir, Layout, Machine, MachineKind, Material, RunResult } from './types';
import { RULES_VERSION } from './types';
import { isTutorialSeed, JOB_MACHINE, starsFor, TUTORIAL_SEED, yardFor, type Job } from './yard';

export { isTutorialSeed, TUTORIAL_SEED };

export type Phase = 'draft' | 'build' | 'result' | 'finished';

export type Action =
  | { t: 'pick'; i: number }
  | { t: 'place'; id: number; x: number; y: number; dir: Dir }
  | { t: 'rotate'; id: number }
  | { t: 'unplace'; id: number }
  | { t: 'sell'; id: number }
  | { t: 'run' }
  | { t: 'next' }
  | { t: 'reroll' };

/** Where a fork came from: the verified replay's hash (null for an imported file), its player label, and the round it continues after. */
export interface ForkOrigin {
  hash: string | null;
  player: string;
  round: number;
}
export interface RoundRecord {
  round: number;
  earned: number;
  layout: Layout;
  result: RunResult;
}

export interface RunState {
  rulesVersion: number;
  seed: string;
  round: number;
  phase: Phase;
  layout: Layout;
  /** what this yard is paid to deliver; null on a classic yard (rules v4) */
  job: Job | null;
  bin: Machine[];
  offers: MachineKind[];
  picks: MachineKind[];
  rounds: RoundRecord[];
  score: number;
  /** money from selling drafted parts (part of score) */
  sold: number;
  /** rerolls bought this run (each cost RULES.rerollCost, already deducted from score) and the round of the last one (0 = none) */
  rerolls: number;
  rerolledRound: number;
  /** set on a practice fork of someone's replay (PLAN-v4 0.7.3): never exported, submitted or recorded as the player's own run; no effect on the simulation */
  forkedFrom?: ForkOrigin;
  nextId: number;
  actions: Action[];
}

/**
 * The lesson (`tutorial-*`, rules v4): shift 1 has no pick (the first job is to close the gap in the belt with the conveyor on
 * the shelf), shifts 2 and 3 offer one machine each so each teaches one thing, shift 4 is the first real choice of three.
 * Later rounds are an ordinary draft from the seed's own stream.
 */
export const TUTORIAL_OFFERS: Readonly<Record<number, readonly MachineKind[]>> = { 1: [], 2: ['crusher'], 3: ['furnace'], 4: ['conveyor', 'tuner', 'hopper'] };

/** The parts a draft must include (rules v4): the crusher in the first draft, the job's own machine in the second, so the job can always be started. */
function guaranteed(seed: string, round: number): MachineKind[] {
  if (round === 1) return ['crusher'];
  const job = yardFor(seed).job;
  return round === 2 && job ? [JOB_MACHINE[job.material]] : [];
}
export function draftOffers(seed: string, round: number): MachineKind[] {
  if (isTutorialSeed(seed) && TUTORIAL_OFFERS[round]) return TUTORIAL_OFFERS[round].slice();
  return offersFrom(new Rng(`${seed}:draft:${round}`), round, guaranteed(seed, round));
}
/** The offers a reroll buys: a purpose-specific stream, so buying one can never change a later round's draft; no crusher guarantee. */
export function rerollOffers(seed: string, round: number): MachineKind[] {
  return offersFrom(new Rng(`${seed}:draft:${round}:reroll:1`), round, []);
}
/** Why a reroll is not allowed right now, or null when it is. */
export function canReroll(s: Pick<RunState, 'phase' | 'seed' | 'round' | 'rerolledRound' | 'score'>): string | null {
  if (s.phase !== 'draft') return 'not drafting';
  if (isTutorialSeed(s.seed)) return 'no rerolls in the tutorial';
  if (s.rerolledRound === s.round) return 'reroll already used this round';
  if (s.score < RULES.rerollCost) return `cannot afford a reroll ($${RULES.rerollCost})`;
  return null;
}
function offersFrom(rng: Rng, round: number, must: readonly MachineKind[]): MachineKind[] {
  const offers: MachineKind[] = [...must];
  const weights = { ...RULES.draftWeights } as Record<MachineKind, number>;
  for (const k of Object.keys(weights) as MachineKind[]) if (weights[k] <= 0 || (RULES.offerFromRound[k] ?? 1) > round) delete weights[k]; // experimental kinds are never offered; tiered kinds not before their round
  let guard = 0;
  while (offers.length < 3 && guard++ < 50) {
    const k = rng.weighted(weights);
    if (!offers.includes(k)) offers.push(k);
  }
  // late-round guarantee (0.9.6 candidate; inert while RULES.lateOfferGuarantee.rounds is empty): a draft with none of the guaranteed kinds swaps its last card for one of them
  const late = RULES.lateOfferGuarantee;
  if (late.rounds.includes(round) && !offers.some((k) => late.kinds.includes(k))) offers[offers.length - 1] = late.kinds[rng.int(late.kinds.length)];
  // deterministic shuffle so a guaranteed card is not always first
  for (let i = offers.length - 1; i > 0; i--) {
    const j = rng.int(i + 1);
    [offers[i], offers[j]] = [offers[j], offers[i]];
  }
  return offers;
}

/** The layout a yard opens on, with its machines numbered from 1. */
export function starterLayout(seed = 'classic-yard'): { layout: Layout; nextId: number } {
  const yard = yardFor(seed);
  let id = 1;
  const machines: Machine[] = yard.machines.map((m) => ({ id: id++, kind: m.kind, x: m.x, y: m.y, dir: m.dir }));
  const layout: Layout = { width: RULES.gridWidth, height: RULES.gridHeight, machines };
  if (yard.rubble.length) layout.rubble = yard.rubble;
  if (yard.job) layout.premium = yard.job.material;
  return { layout, nextId: id };
}
/** A copy of a layout that shares no machine with it: what a shift runs on and what a round records. */
export const copyLayout = (l: Layout): Layout => ({ ...l, machines: l.machines.map((m) => ({ ...m })) });
/** Units of a material this run has shipped so far. */
export const shippedTotal = (s: Pick<RunState, 'rounds'>, mat: Material): number => s.rounds.reduce((n, r) => n + r.result.shipped[mat], 0);
/** Stars this run has earned on its job so far (0 on a classic yard). */
export const runStars = (s: Pick<RunState, 'rounds' | 'job'>): 0 | 1 | 2 | 3 => (s.job ? starsFor(s.job, shippedTotal(s, s.job.material)) : 0);

export class RunError extends Error {}

/** Seeds obey the same bounds everywhere (live play, saves, replays), so a run that can be played can always be replayed. */
export const MAX_SEED_LENGTH = 64;
export const isValidSeed = (seed: unknown): seed is string => typeof seed === 'string' && seed.length > 0 && seed.length <= MAX_SEED_LENGTH;
/** Normalise user-typed seeds: trim, collapse inner whitespace, cut to the limit, fall back when empty. */
export function sanitizeSeed(raw: string | null | undefined, fallback = 'junkyard'): string {
  const s = (raw ?? '').replace(/\s+/g, ' ').trim().slice(0, MAX_SEED_LENGTH);
  return s || fallback;
}

export function newRun(seed: string): RunState {
  if (!isValidSeed(seed)) throw new RunError('bad seed');
  const { layout, nextId } = starterLayout(seed);
  const yard = yardFor(seed);
  const s: RunState = {
    rulesVersion: RULES_VERSION,
    seed,
    round: 1,
    phase: yard.firstPhase,
    layout,
    job: yard.job,
    bin: [],
    offers: draftOffers(seed, 1),
    picks: [],
    rounds: [],
    score: 0,
    sold: 0,
    rerolls: 0,
    rerolledRound: 0,
    nextId,
    actions: [],
  };
  for (const kind of yard.shelf) s.bin.push({ id: s.nextId++, kind, x: -1, y: -1, dir: 0 });
  return s;
}

/**
 * Action-history budget. Replays are capped at MAX_REPLAY_ACTIONS, so live play must stop *before* a run
 * becomes unreplayable while always leaving room to finish: pick/run/next (the actions that advance the
 * game) are allowed up to the cap; layout edits stop earlier so the remaining rounds can still be completed.
 */
export const MAX_REPLAY_ACTIONS = 4000;
const ESSENTIAL = new Set(['pick', 'run', 'next']);
export function actionBudget(s: RunState): { essential: number; edits: number } {
  const roundsLeft = RULES.rounds - s.round + 1;
  const reserve = 3 * roundsLeft + 1; // pick + run + next per remaining round, plus slack
  return { essential: MAX_REPLAY_ACTIONS - s.actions.length, edits: MAX_REPLAY_ACTIONS - reserve - s.actions.length };
}

function findMachine(s: RunState, id: number): { m: Machine; where: 'grid' | 'bin' } {
  const g = s.layout.machines.find((m) => m.id === id);
  if (g) return { m: g, where: 'grid' };
  const b = s.bin.find((m) => m.id === id);
  if (b) return { m: b, where: 'bin' };
  throw new RunError(`no machine ${id}`);
}

const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v);
const ACTION_TYPES = new Set(['pick', 'place', 'rotate', 'unplace', 'sell', 'run', 'next', 'reroll']);

/** Structural validation of an action object (replays come from untrusted files). */
export function validateAction(a: unknown): a is Action {
  if (!a || typeof a !== 'object') return false;
  const o = a as Record<string, unknown>;
  if (typeof o.t !== 'string' || !ACTION_TYPES.has(o.t)) return false;
  switch (o.t) {
    case 'pick':
      return isInt(o.i) && o.i >= 0 && o.i < 3 && Object.keys(o).length === 2;
    case 'place':
      return isInt(o.id) && isInt(o.x) && isInt(o.y) && isInt(o.dir) && o.dir >= 0 && o.dir <= 3 && Object.keys(o).length === 5;
    case 'rotate':
    case 'unplace':
    case 'sell':
      return isInt(o.id) && Object.keys(o).length === 2;
    case 'run':
    case 'next':
    case 'reroll':
      return Object.keys(o).length === 1;
  }
  return false;
}

/** Apply an action (mutates and returns state). Throws RunError for invalid actions. */
export function apply(s: RunState, a: Action): RunState {
  if (!validateAction(a)) throw new RunError('malformed action');
  const budget = actionBudget(s);
  if (ESSENTIAL.has(a.t) ? budget.essential <= 0 : budget.edits <= 0)
    throw new RunError('action limit reached for this run: finish the round (pick, run, next) rather than editing further');
  switch (a.t) {
    case 'pick': {
      if (s.phase !== 'draft') throw new RunError('not drafting');
      if (a.i < 0 || a.i >= s.offers.length) throw new RunError('bad offer index');
      const kind = s.offers[a.i];
      s.bin.push({ id: s.nextId++, kind, x: -1, y: -1, dir: 0 });
      s.picks.push(kind);
      s.phase = 'build';
      break;
    }
    case 'place': {
      if (s.phase !== 'build') throw new RunError('not building');
      if (a.x < 0 || a.y < 0 || a.x >= s.layout.width || a.y >= s.layout.height) throw new RunError('out of bounds');
      const { m, where } = findMachine(s, a.id);
      const occupant = s.layout.machines.find((o) => o.x === a.x && o.y === a.y && o.id !== a.id);
      if (occupant) throw new RunError('cell occupied');
      if (s.layout.rubble?.includes(a.y * s.layout.width + a.x)) throw new RunError('cell blocked by rubble');
      if (where === 'bin') {
        s.bin.splice(s.bin.indexOf(m), 1);
        s.layout.machines.push(m);
      }
      m.x = a.x;
      m.y = a.y;
      m.dir = a.dir;
      break;
    }
    case 'rotate': {
      if (s.phase !== 'build') throw new RunError('not building');
      const { m } = findMachine(s, a.id);
      m.dir = ((m.dir + 1) % 4) as Dir;
      break;
    }
    case 'unplace': {
      if (s.phase !== 'build') throw new RunError('not building');
      const { m, where } = findMachine(s, a.id);
      if (where === 'grid') {
        s.layout.machines.splice(s.layout.machines.indexOf(m), 1);
        m.x = -1;
        m.y = -1;
        s.bin.push(m);
      }
      break;
    }
    case 'sell': {
      if (s.phase !== 'build') throw new RunError('not building');
      const { m, where } = findMachine(s, a.id);
      if (where !== 'bin') throw new RunError('only bin parts can be sold');
      s.bin.splice(s.bin.indexOf(m), 1);
      s.sold += RULES.sellValue;
      s.score += RULES.sellValue;
      break;
    }
    case 'run': {
      if (s.phase !== 'build') throw new RunError('not building');
      const errs = validateLayout(s.layout);
      if (errs.length) throw new RunError(errs.join('; '));
      const layout = copyLayout(s.layout);
      const result = runLayout(layout);
      s.rounds.push({ round: s.round, earned: result.earned, layout, result });
      s.score += result.earned;
      s.phase = 'result';
      break;
    }
    case 'reroll': {
      const why = canReroll(s);
      if (why) throw new RunError(why);
      s.score -= RULES.rerollCost;
      s.rerolls++;
      s.rerolledRound = s.round;
      s.offers = rerollOffers(s.seed, s.round);
      break;
    }
    case 'next': {
      if (s.phase !== 'result') throw new RunError('round not finished');
      if (s.round >= RULES.rounds) {
        s.phase = 'finished';
        break;
      }
      s.round++;
      s.offers = draftOffers(s.seed, s.round);
      s.phase = 'draft';
      break;
    }
    default:
      throw new RunError('unknown action');
  }
  s.actions.push(a);
  return s;
}

/** Full replay: rebuild a run from seed + actions. Throws on any invalid action. The rules version must be explicit and current. */
export function replay(seed: string, actions: Action[], rulesVersion: number): RunState {
  if (!Number.isInteger(rulesVersion)) throw new RunError('rules version missing');
  if (rulesVersion !== RULES_VERSION) throw new RunError(`rules version ${rulesVersion} unsupported (have ${RULES_VERSION})`);
  if (!isValidSeed(seed)) throw new RunError('bad seed');
  if (!Array.isArray(actions) || actions.length > MAX_REPLAY_ACTIONS) throw new RunError('too many actions');
  const s = newRun(seed);
  for (const a of actions) apply(s, a);
  return s;
}
