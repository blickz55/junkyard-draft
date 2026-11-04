/**
 * The coach (docs/UX-STANDARD.md, rules v4; extracted from GameScene in 0.9.4): a pure function of the run to the one thing
 * to do right now, plus what to touch. Nothing here touches the DOM or Phaser; the scene shows the words and the panel lights
 * the spots. A lesson is a script (content/lessons.ts): the first move not done yet is the instruction, and `lessonAllows`
 * says whether an edit is that move, so a lesson has one way through.
 */
import { apply, canBuyBelt, canReroll, cardParts, newRun, orderFor, RunError, type Action, type RunState } from '../sim/run';
import { runLayout } from '../sim/sim';
import { analyseRound, type Bottleneck } from '../sim/bottleneck';
import { isTutorialSeed, priceOf, truckLoad, yardFor } from '../sim/yard';
import type { Dir, Layout, Machine, MachineKind } from '../sim/types';
import { RULES } from '../sim/rules';
import { hasText, t, type StringKey } from '../content/strings';
import { money } from '../content/format';
import { machineName, machineShort } from '../content/machines';
import { nextNeeded } from '../content/job';
import { lessonOf, type About, type Move } from '../content/lessons';
import { flowLinks } from './FlowOverlay';
import { cardGain, type Placed } from './estimate';

/** Something to touch: a card, a shelf slot, a spot in the yard, or a button. */
export type Spot =
  | { kind: 'offer'; i: number }
  | { kind: 'shelf'; i: number }
  | { kind: 'cell'; x: number; y: number; /** one of several places it could go */ soft?: boolean }
  | { kind: 'run' }
  | { kind: 'next' }
  | { kind: 'buy' }
  | { kind: 'sell' }
  | { kind: 'offers' };

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
  /** the machine in hand */ held?: number | null;
  /** the player turned the lit spots off */ lights?: boolean;
  resumeNotice?: string | null;
}
export interface Guidance {
  text: string;
  spots: Spot[];
  /** lesson step on screen, 0 outside the lesson */ step: number;
  /** what the parts in this step do, in the lesson */ about?: { kind: MachineKind; text: string }[];
  /** a spot is known but not lit: the panel offers "Show me" */ showMe?: boolean;
  /** a part of the card just picked that its plan did not need: the panel offers to sell it */ sell?: { id: number; name: string };
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
/** The lesson's next move is to turn the piece at this spot: a first tap there turns it rather than only picking it up. */
export function lessonTurnAt(r: RunState, x: number, y: number): boolean {
  const m = nextMove(r);
  return m?.do === 'turn' && m.x === x && m.y === y;
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

let planned: { key: string; plan: Placed[] } | null = null;
/**
 * The plan for the card just picked: where its parts earn what the card said (render/estimate.ts). It is made once, from the yard as the
 * build began, because a plan made again halfway would chase its own half-built line. Undo rebuilds the run, so the key is what the plan
 * is made of, not the object.
 */
export function cardPlan(r: RunState): Placed[] {
  const pick = r.picks[r.picks.length - 1];
  if (r.phase !== 'build' || !pick) return [];
  const before = r.rounds[r.rounds.length - 1]?.layout;
  const key = `${r.seed}:${r.picks.join()}:${before ? JSON.stringify(before.machines) : ''}`;
  if (planned?.key !== key) {
    const start = before ? buildStart(r, before) : newRun(r.seed).layout.machines;
    const belts = r.bin.filter((m) => m.kind === 'conveyor').length;
    planned = { key, plan: cardGain({ ...r.layout, machines: start }, cardParts(pick, r.job, r.seed), belts).plan };
  }
  return planned.plan;
}
/**
 * The yard as this build began: the line as it ran last shift, and the scrap truck's load when it came as this shift started (rules v11).
 * Without the load the coach planned the shift-4 card on a yard with no truck, and said no spot paid where the card's tag had seen one in
 * front of the truck's Crusher (the eleventh panel, twice).
 */
function buildStart(r: RunState, before: Layout): Machine[] {
  const top = Math.max(0, ...r.layout.machines.map((m) => m.id));
  const load = truckLoad(r.seed, r.round, before).map(
    (m, i) => r.layout.machines.find((q) => q.kind === m.kind && q.x === m.x && q.y === m.y) ?? { id: top + 1 + i, ...m },
  );
  return [...before.machines, ...load];
}
/** What a card on offer does for the line as it stands, on its own, in its best spot (render/estimate.ts). */
export interface Worth {
  gain: number;
  /** a Dock that gives a full line somewhere to go */ room: boolean;
  /** it adds, but under a twentieth of what the line makes: a third Hopper that adds $42 does not "fit" a $3,000 line */ little: boolean;
}
let worths: { key: string; list: Worth[] } | null = null;
/** The cards on offer, worked out once per deal and yard: the cards' tags and the coach read the same answer. */
export function offerWorths(r: RunState): Worth[] {
  const belts = r.bin.filter((m) => m.kind === 'conveyor').length;
  const key = `${r.seed}:${r.round}:${r.offers.join()}:${belts}:${r.layout.rubble?.join() ?? ''}:${JSON.stringify(r.layout.machines)}`;
  if (worths?.key !== key) {
    const line = runLayout(r.layout).earned;
    worths = {
      key,
      list: r.offers.map((k) => {
        const g = cardGain(r.layout, cardParts(k, r.job, r.seed), belts);
        return { gain: g.gain, room: !!g.room, little: g.gain > 0 && g.gain < Math.max(30, line * 0.05) };
      }),
    };
  }
  return worths.list;
}

let fixesMemo: { key: string; pays: MachineKind[] } | null = null;
/**
 * The summary's fixes that pay on this yard now, as the cards' tags would say. In Sal's games on the 40 held-out yards the summary named a
 * second job machine behind a Splitter 65 times and that machine's card had a paying spot 18 times, and three of the eleventh panel met
 * the card saying "No spot pays more yet" right after the summary had named it. `nothingPays` is true when every fix named was dropped.
 */
export function payingFixes(r: RunState, b: Bottleneck): { b: Bottleneck; nothingPays: boolean } {
  const checked: MachineKind[] = r.job ? b.fixes.filter((k) => k === 'tuner' || k === 'splitter' || k === 'hopper') : [];
  if (!checked.length) return { b, nothingPays: false };
  const belts = r.bin.filter((m) => m.kind === 'conveyor').length;
  const key = `${r.seed}:${r.round}:${belts}:${checked.join()}:${b.machine?.kind ?? ''}:${JSON.stringify(r.layout.machines)}`;
  if (fixesMemo?.key !== key) {
    // a second machine behind a Splitter is that machine's card: on a job's yard it brings its own Splitter
    const card = (k: MachineKind): MachineKind => (k === 'splitter' && b.machine ? b.machine.kind : k);
    fixesMemo = { key, pays: checked.filter((k) => cardGain(r.layout, cardParts(card(k), r.job, r.seed), belts).gain > 0) };
  }
  const pays = fixesMemo.pays;
  const fixes = b.fixes.filter((k) => !checked.includes(k) || pays.includes(k));
  return { b: { ...b, fixes }, nothingPays: fixes.length < b.fixes.length && !fixes.length };
}

/** The way the plan wants a part to face, when this is one of its spots. */
export function plannedFacing(r: RunState, kind: MachineKind, x: number, y: number): Dir | undefined {
  if (isTutorialSeed(r.seed)) {
    const m = nextMove(r);
    return m?.do === 'place' && m.kind === kind && m.x === x && m.y === y ? m.dir : undefined;
  }
  return cardPlan(r).find((p) => p.kind === kind && p.x === x && p.y === y)?.dir;
}

/** The first step of the plan not made yet: what the coach lights and what a tap on the lit spot does. `part` is null when the shelf has none. */
export function nextPlanned(r: RunState): { step: Placed; part: Machine | null; at: number; of: number } | null {
  const plan = cardPlan(r);
  const at = plan.findIndex((p) => !r.layout.machines.some((m) => m.kind === p.kind && m.x === p.x && m.y === p.y));
  return at < 0 ? null : { step: plan[at], part: r.bin.find((m) => m.kind === plan[at].kind) ?? null, at, of: plan.length };
}
/** Halfway through a plan: a line in pieces earns less until the last one is in, and the forecast should not read as a mistake. */
export const planUnderway = (r: RunState): boolean => {
  const next = nextPlanned(r);
  return !!next?.part && next.at > 0;
};

/** The coach outside the lesson: the pick, the build, the shift, the summary, each one instruction. */
/**
 * A Plate Press on an ingot yard pays less per shard than the Furnaces it would take shards from, so no spot pays: the card and the coach
 * say that, instead of a spot it has not got (the eighth panel: five of six met the card, and one read "No easy spot yet" as a full yard).
 */
export function pressPaysLess(r: Pick<RunState, 'job' | 'layout'>, kind: MachineKind): boolean {
  return !!r.job && kind === 'press' && r.job.material === 'ingot' && priceOf(r.layout, 'plate') / RULES.pressShards < priceOf(r.layout, 'ingot');
}

/**
 * Why no spot pays for a part, in the line's own terms: the line is short of scrap (every machine keeps up, or one waits for things to do),
 * or another machine is the slow one. The eighth panel's youngest took a Furnace kit marked "No easy spot yet" on a yard of empty squares,
 * put its parts down anywhere, and read "unused" and "nothing came" without learning why.
 */
function noSpotText(r: RunState, kind: MachineKind): string {
  const name = machineName(kind);
  const b = analyseRound(r.layout, runLayout(r.layout), r.round + 1);
  if (b.kind === 'starved' || b.kind === 'balanced') return t('coach.noSpotFeed', { name });
  if (b.kind === 'saturated' && b.machine && b.machine.kind !== kind && b.machine.kind !== 'conveyor')
    return t('coach.noSpotSlow', { name, slow: machineName(b.machine.kind) });
  return t('coach.noSpot', { name });
}

function coach(r: RunState, ctx: GuideContext): { text: string; spots: Spot[]; showMe?: boolean; sell?: { id: number; name: string } } {
  if (ctx.mode === 'running' || ctx.mode === 'paused')
    return { text: ctx.watching ? t('hint.watching', { label: ctx.watching }) : t('coach.running'), spots: [] };
  if (r.phase === 'result') return { text: t(r.round >= RULES.rounds ? 'hint.summaryFinal' : 'hint.summary'), spots: [{ kind: 'next' }] };
  if (r.phase === 'draft') {
    // nothing on offer adds to the line or gives it room: New offers deals three more, and on 60 yards, played Sal's way, that found a
    // better card 24 times in 37 (docs/DESIGN.md); with a card that fits, the coach never suggests paying for more
    if (canReroll(r) === null && offerWorths(r).every((w) => w.gain <= 0 && !w.room))
      return { text: t('coach.pickNone', { cost: money(RULES.rerollCost) }), spots: [{ kind: 'offers' }] };
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
  const moving = ctx.held != null ? r.layout.machines.find((m) => m.id === ctx.held) : undefined;
  if (moving) return { text: t('coach.moveHere', { name: machineName(moving.kind) }), spots: [] };
  // the card's plan, one lit spot at a time; a part put somewhere else ends it, and the plain words take over
  const next = nextPlanned(r);
  const lit = ctx.lights !== false;
  if (lit && next?.part) {
    const said = t(ctx.touch ? 'coach.planTouch' : 'coach.plan', { name: next.step.kind === 'conveyor' ? t('coach.planBelt') : machineName(next.step.kind) });
    return {
      text: next.of > 1 ? `${said} ${t('coach.planOf', { n: next.at + 1, total: next.of })}` : said,
      spots: [
        { kind: 'shelf', i: r.bin.indexOf(next.part) },
        { kind: 'cell', x: next.step.x, y: next.step.y },
      ],
    };
  }
  const buy = next?.step.kind === 'conveyor' && canBuyBelt(r) === null;
  if (lit && next && buy) return { text: t('coach.planBuy'), spots: [{ kind: 'buy' }, { kind: 'cell', x: next.step.x, y: next.step.y }] };
  // with the spots dark the player works it out, and "Show me" stays one tap away while a spot is known (the fourth panel)
  const showMe = !lit && (!!next?.part || buy);
  let sell: { id: number; name: string } | undefined;
  const say = (g: { text: string; spots: Spot[] }) => ({ ...g, ...(showMe ? { showMe } : {}), ...(sell ? { sell } : {}) });
  // a card's parts have the newest ids in the game: spare parts never hold the coach up, and where no spot is known the coach says so
  const newest = Math.max(0, ...r.layout.machines.map((m) => m.id), ...r.bin.map((m) => m.id));
  const card = r.picks.length ? cardParts(r.picks[r.picks.length - 1], r.job, r.seed).length : 0;
  // once the card's plan is all in, what is left of the card is spare: the coach stops asking for it (the ninth panel was told again and
  // again where to put a kit's Dock that the line did not need) and says it can wait
  const spare = cardPlan(r).length > 0 && !nextPlanned(r);
  const i = card && !spare ? r.bin.findIndex((m) => m.id > newest - card) : -1;
  const left = card && spare ? r.bin.find((m) => m.id > newest - card && m.kind !== 'conveyor') : undefined; // a belt bought on the way is never a card's
  // and it sells, one tap from the coach: every card brings what its own plan needs, so a spare waits for nothing, and all six of the
  // eleventh panel had a shelf of them with nothing said about what they were for. Sal sells his too (render/sal.ts)
  if (left) sell = { id: left.id, name: machineShort(left.kind) };
  // where no spot pays, the coach says what could change that instead of promising one (the fourth panel)
  // on a touch screen it says the two taps, because a tap on the yard with nothing in hand only lets go (the seventh panel tapped the yard
  // for a spare Dock and nothing happened)
  const free = ctx.touch ? 'coach.placeFreeTouch' : 'coach.placeFree';
  if (i >= 0) {
    const kind = r.bin[i].kind;
    const text = cardPlan(r).length
      ? t(free, { name: machineName(kind) })
      : pressPaysLess(r, kind)
        ? t('coach.pressPaysLess', { plate: money(priceOf(r.layout, 'plate')), ingot: money(priceOf(r.layout, 'ingot')) })
        : noSpotText(r, kind);
    return say({ text, spots: [{ kind: 'shelf', i }] });
  }
  // a piece that leads nowhere matters when something reaches it: one nothing feeds costs nothing, and "this piece leads nowhere" over a
  // rising forecast read as a mistake that was not there (the tenth panel)
  const res = runLayout(r.layout);
  const stuck = (x: number, y: number) => {
    const st = res.cellStats[y * r.layout.width + x];
    return !!st && (st.jammedTicks > 0 || st.blockedTicks > 0);
  };
  const loose = flowLinks(r.layout).find((l) => !l.ok && stuck(l.x, l.y));
  // the scrap truck's Crusher is not a mistake to turn, it is a feed waiting for somewhere to send its shards (rules v11)
  const truck = yardFor(r.seed).delivery?.crusher;
  if (loose && truck && loose.x === truck.x && loose.y === truck.y)
    return say({ text: t('coach.truckCrusher'), spots: [{ kind: 'cell', x: truck.x, y: truck.y }] });
  if (loose) {
    const outOfBelts = !r.bin.some((m) => m.kind === 'conveyor') && canBuyBelt(r) === null;
    const spot: Spot = { kind: 'cell', x: loose.x, y: loose.y };
    return say(outOfBelts ? { text: t('coach.brokenBuy'), spots: [spot, { kind: 'buy' }] } : { text: t('coach.broken'), spots: [spot] });
  }
  // ready, but short of the order: by how much, and which machine is the slow one, lit, so there is one concrete thing to look at (the
  // seventh panel: "when I am short, tell me one concrete thing to try"; the Start button glowed over a shift that would miss)
  const order = orderFor(r);
  if (order !== null && res.earned < order) {
    const b = analyseRound(r.layout, res, r.round + 1);
    const amount = money(order - res.earned);
    const m = b.machine;
    if (m && b.kind === 'saturated' && m.kind !== 'conveyor')
      return say({ text: t('coach.shortSlow', { amount, name: machineName(m.kind) }), spots: [{ kind: 'cell', x: m.x, y: m.y }, { kind: 'run' }] });
    if (m && b.kind === 'starved')
      return say({ text: t('coach.shortStarved', { amount, name: machineName(m.kind) }), spots: [{ kind: 'cell', x: m.x, y: m.y }, { kind: 'run' }] });
    // every machine keeps up: the line is short of scrap, which is a thing to do, not "try a change" (the tenth panel's worst moment)
    if (b.kind === 'balanced') return say({ text: t('coach.shortFeed', { amount }), spots: [{ kind: 'run' }] });
    return say({ text: t('coach.short', { amount }), spots: [{ kind: 'run' }] });
  }
  return say({
    text: left ? t('coach.readySpare', { name: machineName(left.kind), amount: money(RULES.sellValue) }) : t('coach.ready'),
    spots: [{ kind: 'run' }],
  });
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
