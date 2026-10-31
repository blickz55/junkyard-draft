/**
 * The coach (docs/UX-STANDARD.md, rules v4; extracted from GameScene in 0.9.4): a pure function of the run to the one thing
 * to do right now, plus what to touch. Nothing here touches the DOM or Phaser; the scene shows the words and the panel lights
 * the spots. The lesson's checks read the real layout (fed-ness via placementWarning, flow via a short real simulation), and
 * the lesson walks the actual belt, so a player who built it differently is still told something true.
 */
import type { RunState } from '../sim/run';
import type { Machine, MachineKind, Material } from '../sim/types';
import { DIR_DX, DIR_DY, RULES } from '../sim/rules';
import { TUTORIAL_GAP } from '../sim/yard';
import { outputDirs } from '../sim/advice';
import { runLayout } from '../sim/sim';
import { t, type StringKey } from '../content/strings';
import { money } from '../content/format';
import { machineName } from '../content/machines';
import { nextNeeded } from '../content/job';
import { flowLinks } from './FlowOverlay';
import { beltShape } from './placement';

/** Something to touch: a card, a shelf slot, a spot in the yard, or a button. */
export type Spot =
  | { kind: 'offer'; i: number }
  | { kind: 'shelf'; i: number }
  | { kind: 'cell'; x: number; y: number; /** one of several places it could go */ soft?: boolean }
  | { kind: 'run' }
  | { kind: 'next' };

/** One step of the lesson: the instruction, the funnel step and what to touch. */
export interface LessonStep {
  text: string;
  step: number;
  spots: Spot[];
}
export interface GuideContext {
  tutorial: boolean;
  /** a finger rather than a mouse: tap wording */ touch: boolean;
  /** watching a recording: no advice */ watching: boolean;
  /** build | running | paused | summary, from the scene */ mode: string;
  /** the machine selected right now */ selected?: number | null;
  resumeNotice?: string | null;
}
export interface Guidance {
  text: string;
  spots: Spot[];
  /** lesson step on screen, 0 outside the lesson */ step: number;
}

/** Parts that go in the line, on a belt piece. */
const BELT_PARTS: readonly MachineKind[] = ['crusher', 'furnace', 'press', 'splitter'];
/** The lesson ends with this shift's result. */
export const LESSON_LAST_SHIFT = 4;

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
/** The first straight belt piece after a machine of this kind on the line (after the hopper when `after` is not on it). */
function beltAfter(run: RunState, after: MachineKind): { x: number; y: number } | null {
  const line = lineFromHopper(run);
  const from = Math.max(
    0,
    line.findIndex((m) => m.kind === after),
  );
  const m = line.slice(from + 1).find((q) => q.kind === 'conveyor' && beltShape(run.layout, q) === 'straight');
  return m ? { x: m.x, y: m.y } : null;
}
const reaches = (run: RunState, mat?: Material): boolean => {
  const flow = runLayout(run.layout, 40);
  return mat ? flow.shipped[mat] > 0 : Object.values(flow.shipped).some((n) => n > 0);
};

/** Drop this shelf part on the lit belt piece. */
function dropStep(run: RunState, kind: MachineKind, after: MachineKind, step: number, touch: boolean): LessonStep {
  const i = run.bin.findIndex((m) => m.kind === kind);
  const cell = beltAfter(run, after);
  const key = kind === 'crusher' ? (touch ? 'lesson.dropCrusherTouch' : 'lesson.dropCrusher') : touch ? 'lesson.dropFurnaceTouch' : 'lesson.dropFurnace';
  return { step, text: t(key), spots: [{ kind: 'shelf', i }, ...(cell ? [{ kind: 'cell' as const, ...cell }] : [])] };
}

/** The lesson, one thing per shift, checked against the real line. */
export function lessonStep(run: RunState, touch = false): LessonStep {
  const r = run;
  const find = (k: MachineKind) => r.layout.machines.find((m) => m.kind === k);
  const start = { kind: 'run' } as const;
  if (r.phase === 'result') {
    const after =
      r.round === 1
        ? t('lesson.after1', { scrap: money(RULES.value.scrap) })
        : r.round === 2
          ? t('lesson.after2')
          : r.round === 3
            ? t('lesson.after3')
            : t('hint.summary');
    return { step: r.round * 3, text: after, spots: [{ kind: 'next' }] };
  }
  if (r.round === 1) {
    const gap = r.layout.machines.find((m) => m.x === TUTORIAL_GAP.x && m.y === TUTORIAL_GAP.y);
    if (!gap)
      return {
        step: 1,
        text: t(touch ? 'lesson.gapTouch' : 'lesson.gap'),
        spots: [
          { kind: 'shelf', i: 0 },
          { kind: 'cell', ...TUTORIAL_GAP },
        ],
      };
    if (!reaches(r)) return { step: 2, text: t('lesson.turn'), spots: [{ kind: 'cell', x: gap.x, y: gap.y }] };
    return { step: 2, text: t('lesson.start1'), spots: [start] };
  }
  if (r.round === 2) {
    if (r.phase === 'draft') return { step: 4, text: t('lesson.pickCrusher'), spots: [{ kind: 'offer', i: 0 }] };
    const crusher = find('crusher');
    if (!crusher) return dropStep(r, 'crusher', 'hopper', 5, touch);
    if (!reaches(r, 'shards')) return { step: 5, text: t('lesson.turn'), spots: [{ kind: 'cell', x: crusher.x, y: crusher.y }] };
    return { step: 5, text: t('lesson.start2', { shards: money(RULES.value.shards) }), spots: [start] };
  }
  if (r.round === 3) {
    if (r.phase === 'draft') return { step: 7, text: t('lesson.pickFurnace'), spots: [{ kind: 'offer', i: 0 }] };
    const furnace = find('furnace');
    if (!furnace) return dropStep(r, 'furnace', 'crusher', 8, touch);
    const line = lineFromHopper(r);
    if (line.indexOf(furnace) >= 0 && line.indexOf(furnace) < line.findIndex((m) => m.kind === 'crusher'))
      return { step: 8, text: t('lesson.order'), spots: [{ kind: 'cell', x: furnace.x, y: furnace.y }] };
    if (!reaches(r, 'ingot')) return { step: 8, text: t('lesson.turn'), spots: [{ kind: 'cell', x: furnace.x, y: furnace.y }] };
    return { step: 8, text: t('lesson.start3', { price: money(RULES.job.price) }), spots: [start] };
  }
  if (r.phase === 'draft') return { step: 10, text: t('lesson.choice'), spots: r.offers.map((_, i) => ({ kind: 'offer' as const, i })) };
  return { step: 10, text: t('lesson.free'), spots: [start] };
}

/** The coach outside the lesson: the pick, the build, the shift, the summary, each one instruction. */
function coach(r: RunState, ctx: GuideContext): { text: string; spots: Spot[] } {
  if (ctx.mode === 'running' || ctx.mode === 'paused') return { text: ctx.watching ? t('hint.watching') : t('coach.running'), spots: [] };
  if (r.phase === 'result') return { text: t(r.round >= RULES.rounds ? 'hint.summaryFinal' : 'hint.summary'), spots: [{ kind: 'next' }] };
  if (r.phase === 'draft') {
    const wanted = nextNeeded(r);
    return { text: wanted && r.offers.includes(wanted) ? t('coach.pickNeed', { name: machineName(wanted) }) : t('coach.pick'), spots: [] };
  }
  // the part just picked waits on the shelf (spare parts never hold the coach up: the picked part has the newest id in the game)
  const newest = Math.max(0, ...r.layout.machines.map((m) => m.id), ...r.bin.map((m) => m.id));
  const i = r.picks.length ? r.bin.findIndex((m) => m.id === newest) : -1;
  if (i >= 0) {
    const kind = r.bin[i].kind;
    const belt = BELT_PARTS.includes(kind);
    const key = kind === 'tuner' ? 'coach.placeTuner' : belt ? 'coach.place' : 'coach.placeYard';
    const how = ctx.touch ? (ctx.selected === newest ? 'Selected' : 'Touch') : '';
    const homes = belt ? lineFromHopper(r).filter((m) => m.kind === 'conveyor' && beltShape(r.layout, m) === 'straight') : [];
    return {
      text: t(`${key}${how}` as StringKey, { name: machineName(kind) }),
      spots: [{ kind: 'shelf', i }, ...homes.map((m) => ({ kind: 'cell' as const, x: m.x, y: m.y, soft: true }))],
    };
  }
  if (flowLinks(r.layout).some((l) => !l.ok)) return { text: t('coach.broken'), spots: [] };
  return { text: t('coach.ready'), spots: [{ kind: 'run' }] };
}

/** What the coach says now. A resume notice comes first, once; the lesson runs its own script. */
export function hintFor(run: RunState, ctx: GuideContext): Guidance {
  if (ctx.resumeNotice) return { text: ctx.resumeNotice, spots: [], step: 0 };
  if (ctx.watching) return { text: t('hint.watching'), spots: [], step: 0 };
  if (ctx.tutorial && ctx.mode !== 'running' && ctx.mode !== 'paused') {
    const s = lessonStep(run, ctx.touch);
    return { text: s.text, spots: s.spots, step: s.step };
  }
  return { ...coach(run, ctx), step: 0 };
}
