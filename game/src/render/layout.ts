import { CELL } from './textures';
import { RULES } from '../sim/rules';

export const W = 1120;
export const H = 700;
export const GRID_X = 32;
export const GRID_Y = 72;
export const GRID_W = RULES.gridWidth * CELL; // 576
export const GRID_H = RULES.gridHeight * CELL; // 432
export const SIDE_X = GRID_X + GRID_W + 24; // 632
export const SIDE_W = W - SIDE_X - 24; // 464
export const BIN_Y = GRID_Y + GRID_H + 16; // 520
