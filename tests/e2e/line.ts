/**
 * Helpers for tests that play on any yard (rules v4): where the belt runs depends on the seed, so a test asks the layout
 * rather than naming cells. `straightPieces` lists the conveyors fed from behind, the only belt cells a machine can
 * replace; `dropOnLine` swaps a shelf part into the first of them, keeping the piece's facing.
 */
import { apply, type RunState } from '../../game/src/sim/run';
import { outputDirs } from '../../game/src/sim/advice';
import { DIR_DX, DIR_DY } from '../../game/src/sim/rules';
import type { Machine, MachineKind } from '../../game/src/sim/types';

export function straightPieces(s: RunState): Machine[] {
  const fedFromBehind = (m: Machine) => {
    const b = s.layout.machines.find((o) => o.x === m.x - DIR_DX[m.dir] && o.y === m.y - DIR_DY[m.dir]);
    return !!b && outputDirs(b.kind, b.dir).includes(m.dir);
  };
  return s.layout.machines.filter((m) => m.kind === 'conveyor' && fedFromBehind(m));
}

/** Swap a shelf part of this kind (default the newest part) into the first straight piece of the belt. */
export function dropOnLine(s: RunState, kind?: MachineKind): void {
  const part = kind ? s.bin.find((m) => m.kind === kind)! : s.bin[s.bin.length - 1];
  const slot = straightPieces(s)[0];
  const { x, y, dir } = slot;
  apply(s, { t: 'unplace', id: slot.id });
  apply(s, { t: 'place', id: part.id, x, y, dir });
}
