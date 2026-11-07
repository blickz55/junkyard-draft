/**
 * The yard in words (0.12.4), for a screen reader: the canvas says nothing to one, so a hidden list says what is on each spot, which way it
 * faces and whether its output goes anywhere. Pure, the same answer the flow overlay gives, so a test can read it. The foreman's lines are
 * already live regions; the list changes with the layout and the cursor speaks as it moves.
 */
import { machineName } from '../content/machines';
import { t, type StringKey } from '../content/strings';
import type { RunState } from '../sim/run';
import { RULES } from '../sim/rules';
import type { Layout, Machine, MachineKind } from '../sim/types';
import { flowLinks } from './FlowOverlay';
import { lastTimeCells, type LastTimeCell } from './lasttime';

const FACING: readonly StringKey[] = ['mirror.right', 'mirror.down', 'mirror.left', 'mirror.up'];
const place = (x: number, y: number) => t('mirror.spot', { row: y + 1, col: x + 1 });

function stateOf(m: Machine, run: RunState): string {
  const out = flowLinks(run.layout).filter((l) => l.x === m.x && l.y === m.y);
  if (!out.length) return '';
  return t(out.every((l) => l.ok) ? 'mirror.joined' : out.some((l) => l.ok) ? 'mirror.partJoined' : 'mirror.loose');
}
function machineLine(m: Machine, run: RunState): string {
  return t('mirror.machine', { spot: place(m.x, m.y), machine: machineName(m.kind), facing: t(FACING[m.dir]), state: stateOf(m, run) });
}
const rubbleAt = (run: RunState, x: number, y: number) => !!run.layout.rubble?.includes(y * RULES.gridWidth + x);
const keptAt = (run: RunState, x: number, y: number) => !!run.layout.reserved?.includes(y * RULES.gridWidth + x);
const keptLine = (c: number) => t('mirror.truck', { spot: place(c % RULES.gridWidth, Math.floor(c / RULES.gridWidth)) });
/** A try's outline (render/lasttime.ts): what stood on an empty spot last time, and which way it faced. */
const lastTimeLine = (c: LastTimeCell) => t('mirror.lastTime', { spot: place(c.x, c.y), machine: machineName(c.kind), facing: t(FACING[c.dir]) });

/** Everything on the yard, row by row, then the shelf. On a try, `lastTime` is the previous game's line at this shift: its outlined spots follow the yard's own. */
export function yardLines(run: RunState, lastTime: Layout | null = null): string[] {
  const placed = [...run.layout.machines].sort((a, b) => a.y - b.y || a.x - b.x);
  const rubble = (run.layout.rubble ?? []).map((c) => t('mirror.rubble', { spot: place(c % RULES.gridWidth, Math.floor(c / RULES.gridWidth)) }));
  const memory = lastTime ? lastTimeCells(lastTime, run.layout) : [];
  return [
    t('mirror.size', { w: RULES.gridWidth, h: RULES.gridHeight }),
    ...placed.map((m) => machineLine(m, run)),
    ...rubble,
    ...(run.layout.reserved ?? []).map(keptLine),
    ...memory.map(lastTimeLine),
    ...run.bin.map((m) => t('mirror.shelf', { machine: machineName(m.kind) })),
  ];
}
/** What the keyboard's cursor is on, and what is in hand; on a try, what stood on an empty spot last time. */
export function cellLine(run: RunState, x: number, y: number, held?: MachineKind | null, lastTime: Layout | null = null): string {
  const m = run.layout.machines.find((q) => q.x === x && q.y === y);
  const was = !m && lastTime ? lastTimeCells(lastTime, run.layout).find((c) => c.x === x && c.y === y) : undefined;
  const here = m
    ? machineLine(m, run)
    : rubbleAt(run, x, y)
      ? t('mirror.rubble', { spot: place(x, y) })
      : keptAt(run, x, y)
        ? keptLine(y * RULES.gridWidth + x)
        : was
          ? lastTimeLine(was)
          : t('mirror.empty', { spot: place(x, y) });
  return held ? t('mirror.holding', { here, machine: machineName(held) }) : here;
}
