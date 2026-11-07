/**
 * Last time (the consultant backlog, 2026-11-06): a try from a shift shows the previous game's line at that shift as faint outlines, so
 * the try reads as a deviation rather than a repeat (a tester tried again and scored the same to the dollar). Pure: given the previous
 * game's layout at the try's starting shift (RoundRecord.layout, which the device keeps per shift) and the layout as it stands, the spots
 * where the previous line had a part and nothing stands yet. A spot with a part on it, the same or another, shows nothing: the part covers
 * it and the player has decided there. Only what the previous game added shows; a part it sold or lifted that stands now is not marked.
 * render/SimView.ts draws the outlines under the sprites and drops them when the shift starts; render/mirror.ts says them for a screen
 * reader; tools/a11y-audit.ts holds the colour to 3:1 against the floor. Nothing here is interactive and nothing in the rules reads it.
 */
import type { Dir, Layout, MachineKind } from '../sim/types';
import { DIR_DX, DIR_DY } from '../sim/rules';
import { outputDirs } from '../sim/advice';
import { CELL } from './textures';
import { P } from './palette';

export interface LastTimeCell {
  x: number;
  y: number;
  kind: MachineKind;
  dir: Dir;
}

/** The spots to outline: the previous line's parts on spots that are empty now, row by row. */
export function lastTimeCells(previous: Layout, current: Layout): LastTimeCell[] {
  const taken = new Set(current.machines.map((m) => m.y * current.width + m.x));
  return previous.machines
    .filter((m) => !taken.has(m.y * current.width + m.x))
    .map(({ x, y, kind, dir }) => ({ x, y, kind, dir }))
    .sort((a, b) => a.y - b.y || a.x - b.x);
}

/** How an outline draws: the yard's steel, dim enough to read as a memory under the sprites, at the alpha the a11y audit measures against the floor. */
export const LAST_TIME = { colour: P.steel, alpha: 0.7, width: 2, inset: 7, radius: 6 } as const;

/** The part of a Graphics the outlines draw with (Phaser.GameObjects.Graphics satisfies it). */
export interface LastTimeGraphics {
  clear(): unknown;
  lineStyle(width: number, color: number, alpha: number): unknown;
  strokeRoundedRect(x: number, y: number, width: number, height: number, radius: number): unknown;
  lineBetween(x1: number, y1: number, x2: number, y2: number): unknown;
}

/** A rounded frame inside each spot and, for a part that sends somewhere, an arrow the way it faced. Clears first; an empty list leaves nothing. */
export function drawLastTime(g: LastTimeGraphics, cells: readonly LastTimeCell[], cellXY: (x: number, y: number) => { px: number; py: number }) {
  g.clear();
  if (!cells.length) return;
  const { width, colour, alpha, inset, radius } = LAST_TIME;
  g.lineStyle(width, colour, alpha);
  for (const c of cells) {
    const { px, py } = cellXY(c.x, c.y);
    g.strokeRoundedRect(px + inset, py + inset, CELL - 2 * inset, CELL - 2 * inset, radius);
    if (!outputDirs(c.kind, c.dir).length) continue; // a dock sends nothing on: the frame alone
    const dx = DIR_DX[c.dir],
      dy = DIR_DY[c.dir];
    const cx = px + CELL / 2,
      cy = py + CELL / 2;
    const tx = cx + dx * 14,
      ty = cy + dy * 14; // the arrow's tip, short of the frame
    g.lineBetween(cx - dx * 12, cy - dy * 12, tx, ty);
    g.lineBetween(tx, ty, tx - dx * 6 - dy * 5, ty - dy * 6 + dx * 5);
    g.lineBetween(tx, ty, tx - dx * 6 + dy * 5, ty - dy * 6 - dx * 5);
  }
}
