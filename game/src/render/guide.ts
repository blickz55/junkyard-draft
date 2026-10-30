/**
 * The onboarding guide (production roadmap 0.9.4, extracted from GameScene): a pure function of the run state to the hint
 * strip's text, the lesson step it is on, the Tips demo it can show, and which of the foreman's situations fits. Nothing
 * here touches the DOM or Phaser; the scene renders what comes back. The lesson's checks read the real layout (fed-ness via
 * placementWarning, flow via a short real simulation), as PLAN-v1 0.3.4 asked: one guidance surface, never a modal.
 */
import type { RunState } from '../sim/run';
import type { Dir, Machine, Material } from '../sim/types';
import { DIR_DX, DIR_DY, leftOf, rightOf, RULES } from '../sim/rules';
import { inputTravelDirs } from '../sim/advice';
import { runLayout } from '../sim/sim';
import { analyseRound, type Bottleneck } from '../sim/bottleneck';
import { t } from '../content/strings';
import { money } from '../content/format';
import { machineName } from '../content/machines';
import { placementWarning } from '../content/advice';
import { bottleneckLine } from '../content/bottleneck';
import { recommendFirstPick } from '../content/firstpick';
import type { Situation } from '../content/foreman';

/** One step of the lesson: the text, the funnel step (1 pick crusher, 2 place it, 3 run it, 4 furnace, 5 splitter, 6 free draft) and the demo to show. */
export interface LessonStep {
  text: string;
  step: number;
  demo?: string;
}
export interface GuideContext {
  tutorial: boolean;
  onboarded: boolean;
  /** watching a recording: no advice, no first pick */ watching: boolean;
  resumeNotice?: string | null;
}
export interface Guidance {
  text: string;
  demo?: string;
  /** lesson step on screen, 0 outside the lesson */ step: number;
  /** the foreman's situation for this moment, or null to leave his line as it is */ foreman: Situation | null;
}

/** The tutorial seed's lesson, one rule per round, checked against the layout. Round 3 comes in three short steps (0.9.3). */
export function lessonStep(run: RunState): LessonStep {
  const r = run;
  const L = r.layout;
  const find = (k: Machine['kind']) => L.machines.find((m) => m.kind === k);
  const at = (x: number, y: number) => L.machines.find((m) => m.x === x && m.y === y);
  const fed = (m: Machine) => placementWarning(L, m.kind, m.x, m.y, m.dir, m.id) == null;
  const $ = (m: Material) => money(RULES.value[m]);
  if (r.round === 1) {
    if (r.phase === 'draft') return { step: 1, text: t('lesson.1draft', { scrap: $('scrap'), shards: $('shards') }) };
    const crusher = find('crusher');
    if (!crusher) return { step: 2, text: t('lesson.1place') };
    return fed(crusher) ? { step: 3, text: t('lesson.1fed', { shards: $('shards') }) } : { step: 3, text: t('lesson.1unfed') };
  }
  if (r.round === 2) {
    if (r.phase === 'draft') return { step: 4, text: t('lesson.2draft', { ingot: $('ingot'), slag: $('slag') }) };
    const furnace = find('furnace');
    const crusher = find('crusher');
    if (!furnace) return { step: 4, text: t('lesson.2place') };
    if (crusher && furnace.y === crusher.y && furnace.x < crusher.x) return { step: 4, text: t('lesson.2order') };
    return fed(furnace) ? { step: 4, text: t('lesson.2fed', { ingot: $('ingot') }) } : { step: 4, text: t('lesson.2unfed') };
  }
  if (r.round === 3) {
    if (r.phase === 'draft') return { step: 5, text: t('lesson.3draft'), demo: 'splitter' };
    const splitter = find('splitter');
    if (!splitter) return { step: 5, text: t('lesson.3place'), demo: 'splitter' };
    // a branch is back on the belt when: a conveyor on the output cell, a conveyor where it points, and that one points into something that takes it
    const joined = (out: Dir) => {
      const a = at(splitter.x + DIR_DX[out], splitter.y + DIR_DY[out]);
      if (!a || a.kind !== 'conveyor') return false;
      const b = at(a.x + DIR_DX[a.dir], a.y + DIR_DY[a.dir]);
      if (!b || b.kind !== 'conveyor') return false;
      const c = at(b.x + DIR_DX[b.dir], b.y + DIR_DY[b.dir]);
      return !!c && inputTravelDirs(c.kind, c.dir).includes(b.dir);
    };
    if (!joined(leftOf(splitter.dir))) return { step: 5, text: t('lesson.3top'), demo: 'sideload' };
    if (!joined(rightOf(splitter.dir))) return { step: 5, text: t('lesson.3bottom'), demo: 'sideload' };
    const flow = runLayout(L, 40);
    if (flow.shipped.ingot > 0) return { step: 5, text: t('lesson.3flow', { sell: money(RULES.sellValue) }), demo: 'sideload' };
    return { step: 5, text: t('lesson.3noflow'), demo: 'sideload' };
  }
  return { step: 6, text: t('lesson.done', { sell: money(RULES.sellValue) }) };
}

/** Which of the foreman's openers fits a round's bottleneck (0.9.1). */
export function situationFor(b: Bottleneck): Situation {
  return b.kind === 'disconnected'
    ? 'bottleneckDisconnected'
    : b.kind === 'dead-end'
      ? 'bottleneckDeadEnd'
      : b.kind === 'slag'
        ? 'bottleneckSlag'
        : b.kind === 'saturated'
          ? b.machine?.kind === 'conveyor'
            ? 'bottleneckMerge'
            : 'bottleneckSaturated'
          : b.kind === 'starved'
            ? 'bottleneckStarved'
            : 'bottleneckBalanced';
}

/** The idle hints, rotated by round and machine count so the strip is never blank. */
export function idleTip(run: RunState): string {
  const tips = [
    t('hint.tip1'),
    t('hint.tip2'),
    t('hint.tip3'),
    t('hint.tip4'),
    t('hint.tip5'),
    t('hint.tip6', { shards: money(RULES.value.shards), plate: money(RULES.value.plate) }),
  ];
  return tips[(run.round + run.layout.machines.length) % tips.length];
}

/**
 * The hint strip for a build or draft moment: the lesson in the tutorial; the first draft's pick (after the newcomer's
 * pointer to the lesson); a resume notice when there is one; after a round, the last round's bottleneck (and the foreman's
 * opener for it); else an idle tip. The foreman's situation comes back separately so the scene can leave his line alone.
 */
export function hintFor(run: RunState, ctx: GuideContext): Guidance {
  const r = run;
  let text = '';
  let demo: string | undefined;
  let step = 0;
  let foreman: Situation | null = null;
  if (ctx.tutorial) {
    const s = lessonStep(r);
    text = s.text;
    demo = s.demo;
    step = s.step;
  } else if (r.round === 1 && r.phase === 'draft' && !ctx.watching) {
    // 0.9.3: the first draft says which card to take and why
    const rec = recommendFirstPick(r.offers);
    const pick = rec ? t('hint.firstPick', { n: rec.index + 1, name: machineName(rec.kind), why: rec.why }) : '';
    text = ctx.onboarded ? pick : `${t('hint.newHere')} ${pick}`.trim();
  }
  if (ctx.resumeNotice) text = ctx.resumeNotice;
  if (!text && r.phase === 'draft' && r.rounds.length && !ctx.watching) {
    // 0.8.8: the last round's bottleneck line is the draft's hint
    const last = r.rounds[r.rounds.length - 1];
    const b = analyseRound(last.layout, last.result, r.round);
    text = t('hint.lastRound', { line: bottleneckLine(b) });
    foreman = situationFor(b);
  } else if (r.phase === 'draft' && !r.rounds.length && !ctx.watching) foreman = ctx.tutorial ? 'lesson1' : 'firstDraft';
  else if (ctx.tutorial && r.phase === 'draft' && r.round < 4) foreman = `lesson${r.round}` as Situation; // the lesson ends after round 3 (the scene then leaves the tutorial)
  if (!text) text = idleTip(r);
  return { text, demo, step, foreman };
}
