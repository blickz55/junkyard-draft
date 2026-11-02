/**
 * The coach (docs/UX-STANDARD.md, rules v4; extracted from GameScene in 0.9.4): a pure function of the run to the one thing
 * to do right now, plus what to touch. Nothing here touches the DOM or Phaser; the scene shows the words and the panel lights
 * the spots. A lesson is a script (content/lessons.ts): the first move not done yet is the instruction, and `lessonAllows`
 * says whether an edit is that move, so a lesson has one way through.
 */
import { apply, canBuyBelt, cardParts, orderFor, RunError, type Action, type RunState } from '../sim/run';
import type { Machine, MachineKind } from '../sim/types';
import { DIR_DX, DIR_DY, RULES } from '../sim/rules';
import { outputDirs } from '../sim/advice';
import { hasText, t, type StringKey } from '../content/strings';
import { money } from '../content/format';
import { machineName } from '../content/machines';
import { nextNeeded } from '../content/job';
import { lessonOf, type About, type Move } from '../content/lessons';
import { flowLinks } from './FlowOverlay';
import { beltShape } from './placement';

/** Something to touch: a card, a shelf slot, a spot in the yard, or a button. */
export type Spot =
  | { kind: 'offer'; i: number }
  | { kind: 'shelf'; i: number }
  | { kind: 'cell'; x: number; y: number; /** one of several places it could go */ soft?: boolean }
  | { kind: 'run' }
  | { kind: 'next' }
  | { kind: 'buy' }
  | { kind: 'sell' };

/** One step of the lesson: the instruction, the funnel step, what to touch and what the parts in it do. */
export interface LessonStep {
  text: string;
  step: number;
  spots: Spot[];
  about?: { kind: MachineKind; text: string }[];
}
export interface GuideContext {
  tutorial: boolean;
  /** a finger rather than a mouse: tap wording */ touch: boolean;
  /** the recording being watched: no advice */ watching: string | null;
  /** build | running | paused | summary, from the scene */ mode: string;
  /** the machine selected right now */ selected?: number | null;
  resumeNotice?: string | null;
}
export interface Guidance {
  text: string;
  spots: Spot[];
  /** lesson step on screen, 0 outside the lesson */ step: number;
  /** what the parts in this step do, in the lesson */ about?: { kind: MachineKind; text: string }[];
}

/** Parts that go in the line, on a belt piece. */
const BELT_PARTS: readonly MachineKind[] = ['crusher', 'furnace', 'press', 'splitter'];

/** The machines of the line in the order things travel, from the first hopper. */
function lineFromHopper(run: RunState): Machine[] {
  const L = run.layout;
  const at = (x: number, y: number) => L.machines.find((m) => m.x === x && m.y === y);
  const out: Machine[] = [];
  let m = L.machines.find((q) => q.kind === 'hopper');
  while (m && !out.includes(m)) {
    out.push(m);
    const d = outputDirs(m.kind, m.dir)[0];
    if (d == null) break;
    m = at(m.x + DIR_DX[d], m.y + DIR_DY[d]);
  }
  return out;
}
/** The numbers a lesson's words use. */
const WORDS = {
  scrap: money(RULES.value.scrap),
  shards: money(RULES.value.shards),
  slag: money(RULES.value.slag),
  price: money(RULES.job.price),
  belt: money(RULES.beltCost),
  sell: money(RULES.sellValue),
};
const say = (key: StringKey, touch: boolean): string => {
  const twin = `${key}Touch`;
  return t(touch && hasText(twin) ? twin : key, WORDS);
};
const aboutOf = (about: readonly About[] = []) => about.map((a) => ({ kind: a.kind, text: t(a.key, WORDS) }));

/** Has this move been made? The run is the only memory, so an Undo steps the lesson back by itself. */
function moveDone(m: Move, r: RunState): boolean {
  switch (m.do) {
    case 'place':
      return r.layout.machines.some((q) => q.kind === m.kind && q.x === m.x && q.y === m.y && q.dir === m.dir);
    case 'turn':
      return r.layout.machines.some((q) => q.kind === 'conveyor' && q.x === m.x && q.y === m.y && q.dir === m.dir);
    case 'buy':
      return r.belts >= m.belts;
    case 'sell':
      return r.sold >= m.sold * RULES.sellValue;
  }
}
/** The move on screen; null when the shift is ready to start, or when this is not the build. */
function nextMove(r: RunState): Move | null {
  if (r.phase !== 'build') return null;
  return lessonOf(r.seed).shifts[r.round - 1]?.moves.find((m) => !moveDone(m, r)) ?? null;
}
/** Every move of this shift is made: it can start. */
export const lessonReady = (r: RunState): boolean => r.phase === 'build' && !nextMove(r);
/** The card a lesson's pick wants; null when there is no pick on screen. */
export function lessonPick(r: RunState): number | null {
  const pick = lessonOf(r.seed).shifts[r.round - 1]?.pick;
  return r.phase === 'draft' && pick ? r.offers.indexOf(pick.kind) : null;
}
/** The button the step on screen calls for, beyond the yard. */
export function lessonWants(r: RunState): 'buy' | 'sell' | null {
  const m = nextMove(r);
  return m?.do === 'buy' || m?.do === 'sell' ? m.do : null;
}
/** Is this edit the step on screen? Tried on a copy: the run itself is not touched. */
export function lessonAllows(r: RunState, actions: Action[]): boolean {
  const move = nextMove(r);
  if (!move) return false;
  const copy = structuredClone(r);
  try {
    for (const a of actions) apply(copy, a);
  } catch (e) {
    if (e instanceof RunError) return false;
    throw e;
  }
  return moveDone(move, copy);
}

/** The lesson: the first move not done yet, with the part and the spot lit, and what the part does. */
export function lessonStep(run: RunState, touch = false, selected: number | null = null): LessonStep {
  const r = run;
  const lesson = lessonOf(r.seed);
  const shift = lesson.shifts[r.round - 1];
  const base = (lesson.n - 1) * 100;
  if (!shift) return { step: base + 99, text: t('hint.summary'), spots: [{ kind: 'next' }] };
  const start = { kind: 'run' } as const;
  const steps = base + (r.round - 1) * 10;
  if (r.phase === 'result') return { step: steps + 9, text: t(shift.after, WORDS), spots: [{ kind: 'next' }] };
  if (r.phase === 'draft') {
    const i = Math.max(0, lessonPick(r) ?? 0);
    return { step: steps + 1, text: shift.pick ? say(shift.pick.say, touch) : t('coach.pick'), spots: [{ kind: 'offer', i }] };
  }
  const n = shift.moves.findIndex((m) => !moveDone(m, r));
  if (n < 0) return { step: steps + 8, text: t(shift.start, WORDS), spots: [start] };
  const m = shift.moves[n];
  const step = steps + 2 + n;
  const about = aboutOf(m.about);
  if (m.do === 'turn') return { step, text: say(m.say, touch), spots: [{ kind: 'cell', x: m.x, y: m.y }], about };
  if (m.do === 'buy') return { step, text: say(m.say, touch), spots: [{ kind: 'buy' }], about };
  if (m.do === 'sell') {
    const i = r.bin.findIndex((q) => q.kind === m.kind);
    const held = r.bin[i]?.id === selected;
    return { step, text: t(held ? m.sayTap : m.say, WORDS), spots: held ? [{ kind: 'sell' }] : [{ kind: 'shelf', i }], about };
  }
  const i = r.bin.findIndex((q) => q.kind === m.kind);
  return {
    step,
    text: say(m.say, touch),
    spots: [
      { kind: 'shelf', i },
      { kind: 'cell', x: m.x, y: m.y },
    ],
    about,
  };
}

/** The coach outside the lesson: the pick, the build, the shift, the summary, each one instruction. */
function coach(r: RunState, ctx: GuideContext): { text: string; spots: Spot[] } {
  if (ctx.mode === 'running' || ctx.mode === 'paused')
    return { text: ctx.watching ? t('hint.watching', { label: ctx.watching }) : t('coach.running'), spots: [] };
  if (r.phase === 'result') return { text: t(r.round >= RULES.rounds ? 'hint.summaryFinal' : 'hint.summary'), spots: [{ kind: 'next' }] };
  if (r.phase === 'draft') {
    const wanted = nextNeeded(r);
    const order = orderFor(r);
    const text =
      wanted && r.offers.includes(wanted)
        ? t('coach.pickNeed', { name: machineName(wanted) })
        : order !== null
          ? t('coach.pickOrder', { amount: money(order) })
          : t('coach.pick');
    return { text, spots: [] };
  }
  // the parts just picked wait on the shelf (spare parts never hold the coach up: a card's parts have the newest ids in the game)
  const newest = Math.max(0, ...r.layout.machines.map((m) => m.id), ...r.bin.map((m) => m.id));
  const card = r.picks.length ? cardParts(r.picks[r.picks.length - 1], r.job, r.seed).length : 0;
  const i = card ? r.bin.findIndex((m) => m.id > newest - card) : -1;
  if (i >= 0) {
    const kind = r.bin[i].kind;
    const belt = BELT_PARTS.includes(kind);
    const key = kind === 'tuner' ? 'coach.placeTuner' : belt ? 'coach.place' : 'coach.placeYard';
    const how = ctx.touch ? (ctx.selected === r.bin[i].id ? 'Selected' : 'Touch') : '';
    const homes = belt ? lineFromHopper(r).filter((m) => m.kind === 'conveyor' && beltShape(r.layout, m) === 'straight') : [];
    return {
      text: t(`${key}${how}` as StringKey, { name: machineName(kind) }),
      spots: [{ kind: 'shelf', i }, ...homes.map((m) => ({ kind: 'cell' as const, x: m.x, y: m.y, soft: true }))],
    };
  }
  if (flowLinks(r.layout).some((l) => !l.ok)) {
    const outOfBelts = !r.bin.some((m) => m.kind === 'conveyor') && canBuyBelt(r) === null;
    return outOfBelts ? { text: t('coach.brokenBuy'), spots: [{ kind: 'buy' }] } : { text: t('coach.broken'), spots: [] };
  }
  return { text: t('coach.ready'), spots: [{ kind: 'run' }] };
}

/** What the coach says now. A resume notice comes first, once; the lesson runs its own script. */
export function hintFor(run: RunState, ctx: GuideContext): Guidance {
  if (ctx.resumeNotice) return { text: ctx.resumeNotice, spots: [], step: 0 };
  if (ctx.watching) return { text: t('hint.watching', { label: ctx.watching }), spots: [], step: 0 };
  if (ctx.tutorial && ctx.mode !== 'running' && ctx.mode !== 'paused') {
    const s = lessonStep(run, ctx.touch, ctx.selected ?? null);
    return { text: s.text, spots: s.spots, step: s.step, about: s.about };
  }
  return { ...coach(run, ctx), step: 0 };
}
