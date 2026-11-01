/**
 * The yard in words (0.12.4), for a screen reader: the canvas says nothing to one, so a hidden list says what is on each spot, which way it
 * faces and whether its output goes anywhere. Pure, the same answer the flow overlay gives, so a test can read it. The foreman's lines are
 * already live regions; the list changes with the layout and the cursor speaks as it moves.
 */
import { machineName } from '../content/machines';
import { t, type StringKey } from '../content/strings';
import type { RunState } from '../sim/run';
import { RULES } from '../sim/rules';
import type { Machine, MachineKind } from '../sim/types';
import { flowLinks } from './FlowOverlay';

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

/** Everything on the yard, row by row, then the shelf. */
export function yardLines(run: RunState): string[] {
  const placed = [...run.layout.machines].sort((a, b) => a.y - b.y || a.x - b.x);
  const rubble = (run.layout.rubble ?? []).map((c) => t('mirror.rubble', { spot: place(c % RULES.gridWidth, Math.floor(c / RULES.gridWidth)) }));
  return [
    t('mirror.size', { w: RULES.gridWidth, h: RULES.gridHeight }),
    ...placed.map((m) => machineLine(m, run)),
    ...rubble,
    ...run.bin.map((m) => t('mirror.shelf', { machine: machineName(m.kind) })),
  ];
}
/** What the keyboard's cursor is on, and what is in hand. */
export function cellLine(run: RunState, x: number, y: number, held?: MachineKind | null): string {
  const m = run.layout.machines.find((q) => q.x === x && q.y === y);
  const here = m ? machineLine(m, run) : rubbleAt(run, x, y) ? t('mirror.rubble', { spot: place(x, y) }) : t('mirror.empty', { spot: place(x, y) });
  return held ? t('mirror.holding', { here, machine: machineName(held) }) : here;
}
