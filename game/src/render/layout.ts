/**
 * Board geometry (production roadmap 0.10.0: the fixed 1120×700 canvas is gone). The yard keeps drawing in one logical
 * space: the grid's top-left at (GRID_X, GRID_Y) with CELL-sized cells and the shelf below it; the camera then maps that
 * board onto the rectangle the DOM shell gives it (ui/GamePanel.ts lays out by media query; render/viewport.ts sizes the
 * canvas to its container). `fitBoard` and `boardCameraCenter` are pure so the matrix can be unit-tested.
 */
import { CELL } from './textures';
import { RULES } from '../sim/rules';

export const GRID_X = 32;
export const GRID_Y = 72;
export const GRID_W = RULES.gridWidth * CELL; // 576
export const GRID_H = RULES.gridHeight * CELL; // 432
export const BIN_Y = GRID_Y + GRID_H + 16; // 520
export const BIN_H = 100;
/** the board the camera fits: the grid plus the shelf under it */
export const BOARD_W = GRID_W;
export const BOARD_H = BIN_Y + BIN_H - GRID_Y; // 548
/** a cell never grows past CELL (1920×1080 gets margins, not scaling; and a scaled sprite is a slower blit on the Canvas renderer: perf preset B) */
export const MAX_BOARD_SCALE = 1;

export interface BoardFit {
  /** CSS px per logical px */
  s: number;
  /** the board's CSS size */
  w: number;
  h: number;
  /** the board's offset inside the slot (centred) */
  dx: number;
  dy: number;
}
/** Fit the board into a slot of CSS px, centred, never above MAX_BOARD_SCALE. */
export function fitBoard(slotW: number, slotH: number): BoardFit {
  const s = Math.max(0.05, Math.min(MAX_BOARD_SCALE, slotW / BOARD_W, slotH / BOARD_H));
  const w = BOARD_W * s,
    h = BOARD_H * s;
  return { s, w, h, dx: Math.round((slotW - w) / 2), dy: Math.round((slotH - h) / 2) };
}
/**
 * The world point the camera centres on so that the board's centre lands at its CSS position (boardX, boardY: the
 * board's top-left in CSS px relative to the canvas) on a canvas of cssW × cssH CSS px. The camera's zoom is DPR × fit.s.
 */
export function boardCameraCenter(fit: BoardFit, boardX: number, boardY: number, cssW: number, cssH: number): { x: number; y: number } {
  const bcx = GRID_X + BOARD_W / 2,
    bcy = GRID_Y + BOARD_H / 2;
  const cx = boardX + fit.w / 2,
    cy = boardY + fit.h / 2;
  return { x: bcx + (cssW / 2 - cx) / fit.s, y: bcy + (cssH / 2 - cy) / fit.s };
}
/** The shelf slot i's logical top-left (the scene and the tests' geometry share it). */
export const binSlotXY = (i: number) => ({ px: GRID_X + 12 + i * (CELL + 8), py: BIN_Y + 28 });
