/**
 * What a card would add on its own (the first panel, 2026-11-01: picks that did nothing, and no way to know until the shift ran). The
 * shift is exact, so the game can try a part in every spot: every free cell and every belt piece, every facing, and take the best. It
 * looks one part ahead and no further: a Splitter or a second Hopper reads as nothing until its partner comes, which is true and worth
 * knowing, and the gains a good player plans for two shifts out stay theirs to find. Pure and browser-free.
 */
import { runLayout } from '../sim/sim';
import type { Dir, Layout, MachineKind } from '../sim/types';

const ALL: readonly Dir[] = [0, 1, 2, 3];

export interface Gain {
  /** dollars a shift, the best this part can add right now; 0 when no spot helps */
  gain: number;
}
export function cardGain(layout: Layout, kind: MachineKind): Gain {
  const base = runLayout(layout).earned;
  const faces = kind === 'dock' || kind === 'tuner' ? ALL.slice(0, 1) : ALL;
  let best = base;
  for (let y = 0; y < layout.height; y++)
    for (let x = 0; x < layout.width; x++) {
      if (layout.rubble?.includes(y * layout.width + x)) continue;
      const under = layout.machines.find((m) => m.x === x && m.y === y);
      if (under && under.kind !== 'conveyor') continue;
      const rest = under ? layout.machines.filter((m) => m !== under) : layout.machines;
      for (const dir of faces) {
        const earned = runLayout({ ...layout, machines: [...rest, { id: -1, kind, x, y, dir }] }).earned;
        if (earned > best) best = earned;
      }
    }
  return { gain: best - base };
}
