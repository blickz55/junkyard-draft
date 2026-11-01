/**
 * Reading a playtest (tools/playtest-report.ts): how far each tester got, where they stopped, which lesson steps held them up and what
 * they said. Pure, so it can be tested on rows made up by hand.
 */
import { LESSONS } from '../game/src/content/lessons';
import type { Answers } from '../deploy/test-link/worker';

export interface EventRow {
  install: string;
  name: string;
  props: string;
  at: string;
}
export interface FeedbackRow {
  code: string;
  install: string | null;
  tester: string | null;
  answers: string;
  received: string;
}
export interface Answered extends Answers {
  code: string;
  tester: string | null;
  /** what the play data says about the person who sent this: none when their browser asks not to be tracked */ minutes: number | null;
  stopped: string | null;
}
export interface Summary {
  testers: number;
  milestones: { label: string; testers: number }[];
  stops: { where: string; testers: number }[];
  slowest: { step: string; seconds: number; testers: number }[];
  medianMinutes: number;
  answered: number;
  clear: number | null;
  fun: number | null;
  back: Record<string, number>;
  pay: Record<string, number>;
  answers: Answered[];
}

/** The events that say where a tester is; the rest (a setting, a tip) say nothing about how far they got. */
const PLACES = new Set(['tutorial_step_start', 'tutorial_step_complete', 'lesson_done', 'game_begin', 'round_complete', 'game_complete']);
/** A gap longer than this is someone who walked away, not someone playing. */
const IDLE_MS = 10 * 60_000;

const median = (xs: readonly number[]): number => {
  const a = [...xs].sort((x, y) => x - y);
  return a.length ? a[Math.floor(a.length / 2)] : 0;
};
const mean = (xs: readonly number[]): number | null => (xs.length ? Math.round((10 * xs.reduce((a, b) => a + b, 0)) / xs.length) / 10 : null);
const oneDecimal = (n: number): number => Math.round(10 * n) / 10;
const props = (e: EventRow): Record<string, unknown> => JSON.parse(e.props) as Record<string, unknown>;

function kindLabel(kind: unknown): string {
  const lesson = /^lesson-(\d)$/.exec(String(kind));
  return lesson ? `Lesson ${lesson[1]}` : kind === 'daily' ? "Today's yard" : 'Practice yard';
}

/** A lesson step's number in words: lesson n's steps start at (n - 1) × 100 and each shift at 10 × (shift - 1), as render/guide.ts counts them. */
export function stepLabel(n: number): string {
  const lesson = LESSONS[Math.floor(n / 100)];
  const inLesson = n % 100;
  if (!lesson) return `Step ${n}`;
  if (inLesson === 99) return `Lesson ${lesson.n}: the last screen`;
  const shift = lesson.shifts[Math.floor(inLesson / 10)];
  if (!shift) return `Lesson ${lesson.n}: step ${inLesson}`;
  const head = `Lesson ${lesson.n}, shift ${Math.floor(inLesson / 10) + 1}`;
  const k = inLesson % 10;
  if (k === 1) return `${head}: pick the ${shift.pick?.kind ?? 'part'}`;
  if (k === 8) return `${head}: start the shift`;
  if (k === 9) return `${head}: reading the result`;
  const m = shift.moves[k - 2];
  if (!m) return `${head}: step ${k}`;
  if (m.do === 'place') return `${head}: place the ${m.kind}`;
  if (m.do === 'turn') return `${head}: turn the belt`;
  return m.do === 'buy' ? `${head}: buy belts` : `${head}: sell the ${m.kind}`;
}

/** Where a tester stopped, in words, from the last game they began. */
function stoppedAt(list: readonly EventRow[]): string {
  const places = list.filter((e) => PLACES.has(e.name));
  if (!places.length) return 'On Home, never started anything';
  const begun = places.map((e) => e.name).lastIndexOf('game_begin');
  const since = places.slice(begun + 1);
  const done = since.find((e) => e.name === 'lesson_done');
  if (done) return `Finished lesson ${String(props(done).n)}, then left`;
  if (since.some((e) => e.name === 'game_complete')) return 'Finished a game, then left';
  const steps = since.filter((e) => e.name.startsWith('tutorial_step'));
  if (steps.length) return stepLabel(props(steps[steps.length - 1]).n as number);
  const shift = since.filter((e) => e.name === 'round_complete').length + 1;
  return `${kindLabel(begun < 0 ? null : props(places[begun]).kind)}, shift ${shift}`;
}

function activeMinutes(list: readonly EventRow[]): number {
  let ms = 0;
  for (let i = 1; i < list.length; i++) {
    const gap = Date.parse(list[i].at) - Date.parse(list[i - 1].at);
    if (gap < IDLE_MS) ms += gap;
  }
  return oneDecimal(ms / 60_000);
}

export function summarize(events: readonly EventRow[], feedback: readonly FeedbackRow[]): Summary {
  const byInstall = new Map<string, EventRow[]>();
  for (const e of events) byInstall.set(e.install, [...(byInstall.get(e.install) ?? []), e]);
  for (const list of byInstall.values()) list.sort((a, b) => a.at.localeCompare(b.at));
  const lists = [...byInstall.values()];
  const installs = new Set(feedback.map((f) => f.install));
  const count = (test: (list: EventRow[]) => boolean) => lists.filter(test).length;
  const has = (list: EventRow[], name: string, key: string, value: unknown) => list.some((e) => e.name === name && props(e)[key] === value);
  const realBegin = (e: EventRow) => e.name === 'game_begin' && !String(props(e).kind).startsWith('lesson');
  const finished = (e: EventRow) => e.name === 'game_complete' && props(e).mode !== 'replay';
  const milestones = [
    { label: 'Opened the game', testers: lists.length },
    { label: 'Started lesson 1', testers: count((l) => has(l, 'game_begin', 'kind', 'lesson-1')) },
    { label: 'Finished lesson 1', testers: count((l) => has(l, 'lesson_done', 'n', 1)) },
    { label: 'Finished lesson 2', testers: count((l) => has(l, 'lesson_done', 'n', 2)) },
    { label: 'Finished lesson 3', testers: count((l) => has(l, 'lesson_done', 'n', 3)) },
    { label: 'Started a real game', testers: count((l) => l.some(realBegin)) },
    { label: 'Finished a real game', testers: count((l) => l.some(finished)) },
    { label: 'Played again after that', testers: count((l) => l.slice(l.findIndex(finished) + 1).some(realBegin) && l.some(finished)) },
    { label: 'Came back on a later day', testers: count((l) => new Set(l.map((e) => e.at.slice(0, 10))).size > 1) },
    { label: 'Answered the survey', testers: count((l) => installs.has(l[0].install)) },
  ];

  const stopCounts = new Map<string, number>();
  for (const list of lists) stopCounts.set(stoppedAt(list), (stopCounts.get(stoppedAt(list)) ?? 0) + 1);
  const stops = [...stopCounts].map(([where, testers]) => ({ where, testers })).sort((a, b) => b.testers - a.testers || a.where.localeCompare(b.where));

  const spent = new Map<number, number[]>();
  for (const list of lists)
    list.forEach((e, i) => {
      if (e.name !== 'tutorial_step_start') return;
      const n = props(e).n as number;
      const end = list.slice(i + 1).find((x) => x.name === 'tutorial_step_complete' && props(x).n === n);
      if (end) spent.set(n, [...(spent.get(n) ?? []), (Date.parse(end.at) - Date.parse(e.at)) / 1000]);
    });
  const slowest = [...spent]
    .map(([n, s]) => ({ step: stepLabel(n), seconds: Math.round(median(s)), testers: s.length }))
    .sort((a, b) => b.seconds - a.seconds)
    .slice(0, 5);

  const answers: Answered[] = feedback.map((f) => {
    const list = f.install ? byInstall.get(f.install) : undefined;
    return {
      ...(JSON.parse(f.answers) as Answers),
      code: f.code,
      tester: f.tester,
      minutes: list ? activeMinutes(list) : null,
      stopped: list ? stoppedAt(list) : null,
    };
  });
  const tally = (key: 'back' | 'pay') => {
    const out: Record<string, number> = { yes: 0, maybe: 0, no: 0 };
    for (const a of answers) out[a[key]]++;
    return out;
  };
  return {
    testers: lists.length,
    milestones,
    stops,
    slowest,
    medianMinutes: median(lists.map(activeMinutes)),
    answered: answers.length,
    clear: mean(answers.map((a) => a.clear)),
    fun: mean(answers.map((a) => a.fun)),
    back: tally('back'),
    pay: tally('pay'),
    answers,
  };
}

/** The report as plain text. */
export function render(s: Summary): string {
  const people = (n: number) => `${n} tester${n === 1 ? '' : 's'}`;
  const pct = (n: number) => (s.testers ? `${Math.round((100 * n) / s.testers)} %` : '-');
  const tally = (t: Record<string, number>) => `yes ${t.yes}, maybe ${t.maybe}, no ${t.no}`;
  const out = [
    `PLAYTEST: ${people(s.testers)}, ${s.answered} answered the survey, about ${s.medianMinutes} minutes of play for the middle tester`,
    '',
    'HOW FAR THEY GOT',
  ];
  for (const m of s.milestones) out.push(`  ${m.label.padEnd(26)} ${String(m.testers).padStart(4)}  ${pct(m.testers).padStart(5)}`);
  out.push('', 'WHERE THEY STOPPED');
  for (const x of s.stops) out.push(`  ${String(x.testers).padStart(4)}  ${x.where}`);
  if (!s.stops.length) out.push('  nobody yet');
  out.push('', 'SLOWEST LESSON STEPS (the middle tester)');
  for (const x of s.slowest) out.push(`  ${String(x.seconds).padStart(4)} s  ${x.step} (${people(x.testers)})`);
  if (!s.slowest.length) out.push('  nothing yet');
  out.push(
    '',
    'SURVEY',
    `  How clear: ${s.clear ?? '-'} of 5`,
    `  How fun: ${s.fun ?? '-'} of 5`,
    `  Back tomorrow: ${tally(s.back)}`,
    `  Would pay: ${tally(s.pay)}`,
  );
  for (const a of s.answers) {
    out.push(
      '',
      `  ${a.code}${a.tester ? ` (${a.tester})` : ''}: clear ${a.clear}, fun ${a.fun}, back ${a.back}, pay ${a.pay}`,
      a.minutes == null ? '    No play data: their browser asks not to be tracked' : `    Played ${a.minutes} min. Stopped: ${a.stopped}`,
      `    Goal: ${a.goal}`,
      `    Worst: ${a.worst}`,
    );
  }
  return out.join('\n');
}
