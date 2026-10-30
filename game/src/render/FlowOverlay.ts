/**
 * The flow overlay (production roadmap 0.9.3; its geometry extracted in 0.9.4): for every placed machine and each of its
 * output directions, whether the neighbour takes items from that side. Pure geometry from sim/advice.ts, the same answer the
 * ghost's arrows and the placement warnings give; nothing is simulated. The drawing half takes a Graphics and a cell mapper.
 */
import type { Layout, Dir } from '../sim/types';
import { DIR_DX, DIR_DY } from '../sim/rules';
import { inputTravelDirs, outputDirs } from '../sim/advice';
import { CELL } from './textures';
import { P } from './palette';

export interface FlowLink { /** the machine's cell */ x: number; y: number; /** its output direction */ dir: Dir; /** the neighbour takes items from this side */ ok: boolean }

export function flowLinks(layout: Layout): FlowLink[] {
  const out: FlowLink[] = [];
  for (const m of layout.machines) for (const o of outputDirs(m.kind, m.dir)) {
    const nx = m.x + DIR_DX[o], ny = m.y + DIR_DY[o];
    const target = layout.machines.find((q) => q.x === nx && q.y === ny);
    out.push({ x: m.x, y: m.y, dir: o, ok: !!target && inputTravelDirs(target.kind, target.dir).includes(o) });
  }
  return out;
}

/** The part of a Graphics the overlay draws with (Phaser.GameObjects.Graphics satisfies it). */
export interface FlowGraphics { clear(): unknown; fillStyle(color: number, alpha: number): unknown; fillTriangle(x1: number, y1: number, x2: number, y2: number, x3: number, y3: number): unknown; fillRect(x: number, y: number, w: number, h: number): unknown }

/** An amber chevron across the shared edge for a connected output, a red chevron with a bar where the output goes nowhere. */
export function drawFlowLinks(g: FlowGraphics, links: readonly FlowLink[], cellXY: (x: number, y: number) => { px: number; py: number }) {
  g.clear();
  const chevron = (x: number, y: number, d: Dir, s: number) => {
    const dx = DIR_DX[d], dy = DIR_DY[d];
    g.fillTriangle(x + dx * s * 0.6, y + dy * s * 0.6, x - dx * s * 0.5 - dy * s * 0.7, y - dy * s * 0.5 + dx * s * 0.7, x - dx * s * 0.5 + dy * s * 0.7, y - dy * s * 0.5 - dx * s * 0.7);
  };
  for (const l of links) {
    const { px, py } = cellXY(l.x, l.y);
    const ex = px + CELL / 2 + DIR_DX[l.dir] * (CELL / 2), ey = py + CELL / 2 + DIR_DY[l.dir] * (CELL / 2); // the shared edge's midpoint
    if (l.ok) { g.fillStyle(P.amber, 0.5); chevron(ex, ey, l.dir, 14); }
    else {
      g.fillStyle(P.red, 0.55); chevron(ex - DIR_DX[l.dir] * 8, ey - DIR_DY[l.dir] * 8, l.dir, 10);
      g.fillStyle(P.red, 0.6); g.fillRect(ex - 2 - Math.abs(DIR_DY[l.dir]) * 9, ey - 2 - Math.abs(DIR_DX[l.dir]) * 9, 4 + Math.abs(DIR_DY[l.dir]) * 18, 4 + Math.abs(DIR_DX[l.dir]) * 18); // a bar across the edge: the line stops here
    }
  }
}
