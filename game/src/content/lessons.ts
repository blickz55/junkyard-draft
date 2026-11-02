/**
 * The lessons (rules v5, the owner's second playtest): every shift says which part to take, where to put it and what it does,
 * so nothing is left to guess. A lesson is moves per shift, in order; `render/guide.ts` shows the first one not done yet and
 * the scene refuses anything else, so a lesson has one way through. The yards and the cards are rules and live in `sim/yard.ts`.
 * `tests/lessons.test.ts` plays every lesson from this table alone and fails when a part the game can offer is taught by none.
 */
import type { Dir, MachineKind } from '../sim/types';
import { isTutorialSeed, TUTORIAL_SEED } from '../sim/yard';
import { RULES } from '../sim/rules';
import type { StringKey } from './strings';

/** One line on a part: what it is for, in plain words. */
export interface About {
  kind: MachineKind;
  key: StringKey;
}
interface Said {
  /** the instruction; a key with a `Touch` twin reads that under a finger */ say: StringKey;
  about?: readonly About[];
}
export type Move = Said &
  (
    | { do: 'place'; kind: MachineKind; x: number; y: number; dir: Dir }
    | { do: 'turn'; x: number; y: number; dir: Dir }
    | { do: 'buy'; belts: number }
    | { do: 'sell'; kind: MachineKind; sold: number; sayTap: StringKey }
  );
export interface LessonShift {
  pick?: { kind: MachineKind; say: StringKey };
  moves: readonly Move[];
  start: StringKey;
  after: StringKey;
}
export interface Lesson {
  n: number;
  seed: string;
  title: StringKey;
  doneText: StringKey;
  shifts: readonly LessonShift[];
}

const R: Dir = 0;
const D: Dir = 1;
const L: Dir = 2;
const U: Dir = 3;

export const LESSONS: readonly Lesson[] = [
  {
    n: 1,
    seed: TUTORIAL_SEED,
    title: 'lesson.one.title',
    doneText: 'lesson.one.done',
    shifts: [
      {
        moves: [
          {
            do: 'place',
            kind: 'conveyor',
            x: 4,
            y: 1,
            dir: D,
            say: 'lesson.gap',
            about: [
              { kind: 'hopper', key: 'lesson.about.hopper' },
              { kind: 'conveyor', key: 'lesson.about.conveyor' },
              { kind: 'dock', key: 'lesson.about.dock' },
            ],
          },
        ],
        start: 'lesson.start1',
        after: 'lesson.after1',
      },
      {
        pick: { kind: 'crusher', say: 'lesson.pickCrusher' },
        moves: [{ do: 'place', kind: 'crusher', x: 2, y: 1, dir: R, say: 'lesson.dropCrusher', about: [{ kind: 'crusher', key: 'lesson.about.crusher' }] }],
        start: 'lesson.start2',
        after: 'lesson.after2',
      },
      {
        pick: { kind: 'furnace', say: 'lesson.pickFurnace' },
        moves: [{ do: 'place', kind: 'furnace', x: 3, y: 1, dir: R, say: 'lesson.dropFurnace', about: [{ kind: 'furnace', key: 'lesson.about.furnace' }] }],
        start: 'lesson.start3',
        after: 'lesson.after3',
      },
    ],
  },
  {
    n: 2,
    seed: 'tutorial-2',
    title: 'lesson.two.title',
    doneText: 'lesson.two.done',
    shifts: [
      {
        pick: { kind: 'press', say: 'lesson.pickPress' },
        moves: [
          { do: 'place', kind: 'press', x: 4, y: 2, dir: R, say: 'lesson.dropPress', about: [{ kind: 'press', key: 'lesson.about.press' }] },
          { do: 'turn', x: 5, y: 2, dir: R, say: 'lesson.turn', about: [{ kind: 'conveyor', key: 'lesson.about.turn' }] },
        ],
        start: 'lesson.startPress',
        after: 'lesson.afterPress',
      },
      {
        pick: { kind: 'hopper', say: 'lesson.pickHopper' },
        moves: [
          { do: 'place', kind: 'conveyor', x: 3, y: 3, dir: U, say: 'lesson.dropJoin', about: [{ kind: 'conveyor', key: 'lesson.about.join' }] },
          { do: 'place', kind: 'conveyor', x: 3, y: 4, dir: U, say: 'lesson.dropCorner', about: [{ kind: 'conveyor', key: 'lesson.about.corner' }] },
          { do: 'place', kind: 'crusher', x: 2, y: 4, dir: R, say: 'lesson.dropSpareCrusher', about: [{ kind: 'crusher', key: 'lesson.about.crusherFirst' }] },
          { do: 'place', kind: 'hopper', x: 1, y: 4, dir: R, say: 'lesson.dropHopper', about: [{ kind: 'hopper', key: 'lesson.about.hopperAnywhere' }] },
        ],
        start: 'lesson.startFeed',
        after: 'lesson.afterFeed',
      },
    ],
  },
  {
    n: 3,
    seed: 'tutorial-3',
    title: 'lesson.three.title',
    doneText: 'lesson.three.done',
    shifts: [
      { moves: [], start: 'lesson.startWatch', after: 'lesson.afterWatch' },
      {
        pick: { kind: 'tuner', say: 'lesson.pickTuner' },
        moves: [{ do: 'place', kind: 'tuner', x: 4, y: 2, dir: L, say: 'lesson.dropTuner', about: [{ kind: 'tuner', key: 'lesson.about.tuner' }] }], // facing the Splitter to come, so nothing goes in
        start: 'lesson.startTuner',
        after: 'lesson.afterTuner',
      },
      {
        pick: { kind: 'splitter', say: 'lesson.pickSplitter' },
        moves: [
          { do: 'place', kind: 'splitter', x: 3, y: 2, dir: R, say: 'lesson.dropSplitter', about: [{ kind: 'splitter', key: 'lesson.about.splitter' }] },
          { do: 'place', kind: 'furnace', x: 4, y: 3, dir: R, say: 'lesson.dropSpareFurnace', about: [{ kind: 'furnace', key: 'lesson.about.twoFurnaces' }] },
          { do: 'place', kind: 'conveyor', x: 3, y: 3, dir: R, say: 'lesson.dropBranch', about: [{ kind: 'splitter', key: 'lesson.about.branch' }] },
          { do: 'buy', belts: 1, say: 'lesson.buyBelt', about: [{ kind: 'conveyor', key: 'lesson.about.buy' }] },
          { do: 'place', kind: 'conveyor', x: 5, y: 3, dir: U, say: 'lesson.dropRejoin', about: [{ kind: 'conveyor', key: 'lesson.about.join' }] },
        ],
        start: 'lesson.startSplit',
        after: 'lesson.afterSplit',
      },
      {
        pick: { kind: 'dock', say: 'lesson.pickDock' },
        moves: [
          { do: 'place', kind: 'dock', x: 5, y: 1, dir: R, say: 'lesson.dropDock', about: [{ kind: 'dock', key: 'lesson.about.secondDock' }] },
          { do: 'sell', kind: 'conveyor', sold: 1, say: 'lesson.sellSpare', sayTap: 'lesson.sellNow', about: [{ kind: 'conveyor', key: 'lesson.about.sell' }] },
        ],
        start: 'lesson.startLast',
        after: 'lesson.afterLast',
      },
    ],
  },
];

/** The lesson on a reserved yard; the first one for any other `tutorial-*` name, as the yards have it. */
export const lessonOf = (seed: string): Lesson => LESSONS.find((l) => l.seed === seed) ?? LESSONS[0];
/** How many shifts this game runs before it is over: a lesson stops when its script does. */
export const shiftsOf = (seed: string): number => (isTutorialSeed(seed) ? lessonOf(seed).shifts.length : RULES.rounds);
