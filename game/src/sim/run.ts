import { Rng } from './rng';
import { RULES } from './rules';
import { runLayout, validateLayout } from './sim';
import type { Dir, Layout, Machine, MachineKind, RunResult } from './types';
import { RULES_VERSION } from './types';

export type Phase = 'draft' | 'build' | 'result' | 'finished';

export type Action =
  | { t: 'pick'; i: number }
  | { t: 'place'; id: number; x: number; y: number; dir: Dir }
  | { t: 'rotate'; id: number }
  | { t: 'unplace'; id: number }
  | { t: 'run' }
  | { t: 'next' };

export interface RoundRecord { round: number; earned: number; layout: Layout; result: RunResult }

export interface RunState {
  rulesVersion: number;
  seed: string;
  round: number;
  phase: Phase;
  layout: Layout;
  bin: Machine[];
  offers: MachineKind[];
  picks: MachineKind[];
  rounds: RoundRecord[];
  score: number;
  nextId: number;
  actions: Action[];
}

export function draftOffers(seed: string, round: number): MachineKind[] {
  const rng = new Rng(`${seed}:draft:${round}`);
  const offers: MachineKind[] = [];
  if (round === 1) offers.push('crusher'); // first useful upgrade is always reachable
  const weights = { ...RULES.draftWeights } as Record<MachineKind, number>;
  let guard = 0;
  while (offers.length < 3 && guard++ < 50) {
    const k = rng.weighted(weights);
    if (!offers.includes(k)) offers.push(k);
  }
  // deterministic shuffle so the forced crusher is not always first
  for (let i = offers.length - 1; i > 0; i--) { const j = rng.int(i + 1); [offers[i], offers[j]] = [offers[j], offers[i]]; }
  return offers;
}

export function starterLayout(): { layout: Layout; nextId: number } {
  let id = 1;
  const machines: Machine[] = RULES.starter.map((m) => ({ id: id++, kind: m.kind, x: m.x, y: m.y, dir: m.dir }));
  return { layout: { width: RULES.gridWidth, height: RULES.gridHeight, machines }, nextId: id };
}

export function newRun(seed: string): RunState {
  const { layout, nextId } = starterLayout();
  return { rulesVersion: RULES_VERSION, seed, round: 1, phase: 'draft', layout, bin: [], offers: draftOffers(seed, 1), picks: [], rounds: [], score: 0, nextId, actions: [] };
}

export class RunError extends Error {}

function findMachine(s: RunState, id: number): { m: Machine; where: 'grid' | 'bin' } {
  const g = s.layout.machines.find((m) => m.id === id);
  if (g) return { m: g, where: 'grid' };
  const b = s.bin.find((m) => m.id === id);
  if (b) return { m: b, where: 'bin' };
  throw new RunError(`no machine ${id}`);
}

/** Apply an action (mutates and returns state). Throws RunError for invalid actions. */
export function apply(s: RunState, a: Action): RunState {
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
      if (where === 'bin') { s.bin.splice(s.bin.indexOf(m), 1); s.layout.machines.push(m); }
      m.x = a.x; m.y = a.y; m.dir = a.dir;
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
      if (where === 'grid') { s.layout.machines.splice(s.layout.machines.indexOf(m), 1); m.x = -1; m.y = -1; s.bin.push(m); }
      break;
    }
    case 'run': {
      if (s.phase !== 'build') throw new RunError('not building');
      const errs = validateLayout(s.layout);
      if (errs.length) throw new RunError(errs.join('; '));
      const layout: Layout = { width: s.layout.width, height: s.layout.height, machines: s.layout.machines.map((m) => ({ ...m })) };
      const result = runLayout(layout);
      s.rounds.push({ round: s.round, earned: result.earned, layout, result });
      s.score += result.earned;
      s.phase = 'result';
      break;
    }
    case 'next': {
      if (s.phase !== 'result') throw new RunError('round not finished');
      if (s.round >= RULES.rounds) { s.phase = 'finished'; break; }
      s.round++;
      s.offers = draftOffers(s.seed, s.round);
      s.phase = 'draft';
      break;
    }
  }
  s.actions.push(a);
  return s;
}

/** Full replay: rebuild a run from seed + actions. Throws on any invalid action. */
export function replay(seed: string, actions: Action[], rulesVersion = RULES_VERSION): RunState {
  if (rulesVersion !== RULES_VERSION) throw new RunError(`rules version ${rulesVersion} unsupported (have ${RULES_VERSION})`);
  const s = newRun(seed);
  for (const a of actions) apply(s, a);
  return s;
}
