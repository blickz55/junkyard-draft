import { Rng } from './rng';
import { RULES } from './rules';
import { runLayout, validateLayout } from './sim';
import type { Dir, Layout, Machine, MachineKind, Material, RunResult } from './types';
import { RULES_VERSION } from './types';
import { isTutorialSeed, JOB_MACHINE, lessonYard, starsFor, TUTORIAL_SEED, yardFor, type Job } from './yard';

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
  | { t: 'reroll' }
  | { t: 'buy' };

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
  /** belts bought this run (each cost RULES.beltCost, already deducted from score) */
  belts: number;
  /** orders filled so far (rules v6) */
  filled: number;
  /** set on a practice fork of someone's replay (PLAN-v4 0.7.3): never exported, submitted or recorded as the player's own run; no effect on the simulation */
  forkedFrom?: ForkOrigin;
  nextId: number;
  actions: Action[];
}

/** The parts a draft must include: on a yard with no job, the crusher in the first draft. A job's yard opens with its line running (rules v6). */
function guaranteed(seed: string, round: number): MachineKind[] {
  return round === 1 && !yardFor(seed).job ? ['crusher'] : [];
}
export function draftOffers(seed: string, round: number): MachineKind[] {
  const scripted = lessonYard(seed)?.offers[round]; // a lesson deals what it means to teach; shifts past its end are an ordinary draft
  if (scripted) return scripted.slice();
  return offersFrom(new Rng(`${seed}:draft:${round}`), round, guaranteed(seed, round), yardFor(seed).job);
}
/** The offers a reroll buys: a purpose-specific stream, so buying one can never change a later round's draft; no crusher guarantee. */
export function rerollOffers(seed: string, round: number): MachineKind[] {
  return offersFrom(new Rng(`${seed}:draft:${round}:reroll:1`), round, [], yardFor(seed).job);
}
/** Why a reroll is not allowed right now, or null when it is. */
export function canReroll(s: Pick<RunState, 'phase' | 'seed' | 'round' | 'rerolledRound' | 'score'>): string | null {
  if (s.phase !== 'draft') return 'not drafting';
  if (isTutorialSeed(s.seed)) return 'no rerolls in the tutorial';
  if (s.rerolledRound === s.round) return 'reroll already used this round';
  if (s.score < RULES.rerollCost) return `cannot afford a reroll ($${RULES.rerollCost})`;
  return null;
}
/** Why a belt cannot be bought right now, or null when it can. */
export function canBuyBelt(s: Pick<RunState, 'phase' | 'score' | 'bin'>): string | null {
  if (s.phase !== 'build') return 'not building';
  if (s.score < RULES.beltCost) return `cannot afford a belt ($${RULES.beltCost})`;
  if (s.bin.length >= RULES.shelfSlots) return 'the shelf is full';
  return null;
}
/** The cards a yard deals from, in the order the draw reads them, so that a job's product and its rival swap places and nothing else moves. */
function dealFor(job: Job | null, round: number): Partial<Record<MachineKind, number>> {
  if (!job) {
    const weights = { ...RULES.draftWeights } as Partial<Record<MachineKind, number>>;
    for (const k of Object.keys(weights) as MachineKind[]) if (!weights[k] || (RULES.offerFromRound[k] ?? 1) > round) delete weights[k]; // experimental kinds are never offered; tiered kinds not before their round
    return weights;
  }
  const d = RULES.job.deal;
  const own = JOB_MACHINE[job.material];
  const weights: Partial<Record<MachineKind, number>> = { [own]: d.job, hopper: d.hopper, [own === 'furnace' ? 'press' : 'furnace']: d.other };
  if (round >= RULES.job.tunerFrom) weights.tuner = d.tuner;
  return weights;
}
function offersFrom(rng: Rng, round: number, must: readonly MachineKind[], job: Job | null): MachineKind[] {
  const offers: MachineKind[] = [...must];
  const weights = dealFor(job, round) as Record<MachineKind, number>;
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
/** What a card puts on the shelf (rules v6): on a job's yard a Hopper comes with its Crusher and the job's machine with a Splitter, so that one card can always widen the line. */
export function cardParts(kind: MachineKind, job: Job | null, seed = ''): MachineKind[] {
  if (!job?.orders || isTutorialSeed(seed)) return [kind];
  if (kind === 'hopper') return ['hopper', 'crusher', 'dock'];
  return kind === JOB_MACHINE[job.material] ? [kind, 'splitter', 'dock'] : [kind];
}
/** What a shift changes about the yard: the second buyer from their shift, and the prices orders have raised. */
export function shiftTerms(round: number, job: Job | null, filled: number): Pick<Layout, 'premium2' | 'rate'> {
  if (!job?.orders) return {};
  const terms: Pick<Layout, 'premium2' | 'rate'> = {}; // no key when nothing applies: a layout is hashed as it stands
  if (round >= RULES.job.secondBuyerFrom) terms.premium2 = job.material === 'ingot' ? 'plate' : 'ingot';
  if (filled > 0) terms.rate = 100 + filled * RULES.job.raise;
  return terms;
}
/** This shift's order, or null on a yard with none. */
export const orderFor = (s: Pick<RunState, 'job' | 'round'>): number | null => s.job?.orders?.[s.round - 1] ?? null;
/** A copy of a layout that shares no machine with it: what a shift runs on and what a round records. */
export const copyLayout = (l: Layout): Layout => ({ ...l, machines: l.machines.map((m) => ({ ...m })) });
/** Units of a material this run has shipped so far. */
export const shippedTotal = (s: Pick<RunState, 'rounds'>, mat: Material): number => s.rounds.reduce((n, r) => n + r.result.shipped[mat], 0);
/** Stars this run has earned on its job so far (0 on a classic yard). */
export const runStars = (s: Pick<RunState, 'rounds' | 'job' | 'filled'>): 0 | 1 | 2 | 3 =>
  s.job ? starsFor(s.job, s.job.orders ? s.filled : shippedTotal(s, s.job.material)) : 0;

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
    belts: 0,
    filled: 0,
    nextId,
    actions: [],
  };
  for (const kind of yard.shelf) s.bin.push({ id: s.nextId++, kind, x: -1, y: -1, dir: 0 });
  Object.assign(s.layout, shiftTerms(1, yard.job, 0));
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
const ACTION_TYPES = new Set(['pick', 'place', 'rotate', 'unplace', 'sell', 'run', 'next', 'reroll', 'buy']);

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
    case 'buy':
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
      for (const part of cardParts(kind, s.job, s.seed)) s.bin.push({ id: s.nextId++, kind: part, x: -1, y: -1, dir: 0 });
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
      const order = orderFor(s);
      if (order !== null && result.earned >= order) s.filled++;
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
    case 'buy': {
      const why = canBuyBelt(s);
      if (why) throw new RunError(why);
      s.score -= RULES.beltCost;
      s.belts++;
      s.bin.push({ id: s.nextId++, kind: 'conveyor', x: -1, y: -1, dir: 0 });
      break;
    }
    case 'next': {
      if (s.phase !== 'result') throw new RunError('round not finished');
      if (s.round >= RULES.rounds) {
        s.phase = 'finished';
        break;
      }
      s.round++;
      Object.assign(s.layout, shiftTerms(s.round, s.job, s.filled));
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
