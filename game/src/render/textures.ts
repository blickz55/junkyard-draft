import Phaser from 'phaser';
import { P } from './palette';
import type { MachineKind, Material } from '../sim/types';

export const CELL = 72;
/** belt animation frames (belt-0 … belt-N-1); belt-0 is the rest frame reduced motion shows */
export const BELT_FRAMES = 8;
const C = CELL;
const H = C / 2;

/** Generate all procedural textures once. Machines face EAST in their base texture. */
export function generateTextures(scene: Phaser.Scene) {
  const g = scene.make.graphics({ x: 0, y: 0 }, false);
  const make = (key: string, w: number, h: number, draw: (g: Phaser.GameObjects.Graphics) => void) => {
    if (scene.textures.exists(key)) return;
    g.clear(); draw(g); g.generateTexture(key, w, h);
  };

  // floor tile
  make('tile', C, C, (g) => {
    g.fillStyle(P.floor, 1); g.fillRect(0, 0, C, C);
    g.lineStyle(1, P.floorLine, 1); g.strokeRect(0.5, 0.5, C - 1, C - 1);
    g.fillStyle(P.floorAlt, 0.5); g.fillRect(4, 4, 3, 3); g.fillRect(C - 8, C - 8, 3, 3);
  });
  make('tile-ok', C, C, (g) => { g.fillStyle(P.green, 0.28); g.fillRect(0, 0, C, C); g.lineStyle(2, P.green, 0.9); g.strokeRect(1, 1, C - 2, C - 2); });
  make('tile-bad', C, C, (g) => { g.fillStyle(P.red, 0.28); g.fillRect(0, 0, C, C); g.lineStyle(2, P.red, 0.9); g.strokeRect(1, 1, C - 2, C - 2); });
  make('tile-sel', C, C, (g) => { g.lineStyle(3, P.amber, 1); g.strokeRect(2, 2, C - 4, C - 4); });
  // keyboard cursor: blue frame with corner ticks (distinct from the amber selection)
  make('tile-cursor', C, C, (g) => {
    g.lineStyle(2, P.cursor, 0.95); g.strokeRect(3, 3, C - 6, C - 6);
    g.fillStyle(P.cursor, 1);
    for (const [x, y] of [[3, 3], [C - 3, 3], [3, C - 3], [C - 3, C - 3]] as const) { g.fillRect(Math.min(x, x - 10 + (x < H ? 10 : 0)), y - 2, 10, 4); g.fillRect(x - 2, Math.min(y, y - 10 + (y < H ? 10 : 0)), 4, 10); }
  });

  const body = (g: Phaser.GameObjects.Graphics, color: number, inset = 8, radius = 8) => {
    g.fillStyle(0x000000, 0.35); g.fillRoundedRect(inset + 2, inset + 3, C - inset * 2, C - inset * 2, radius);
    g.fillStyle(color, 1); g.fillRoundedRect(inset, inset, C - inset * 2, C - inset * 2, radius);
    g.lineStyle(2, 0x000000, 0.35); g.strokeRoundedRect(inset, inset, C - inset * 2, C - inset * 2, radius);
    g.fillStyle(0xffffff, 0.08); g.fillRoundedRect(inset + 3, inset + 3, C - inset * 2 - 6, 8, 4);
  };
  const arrow = (g: Phaser.GameObjects.Graphics, x: number, y: number, size: number, color = P.text, alpha = 0.9) => {
    g.fillStyle(color, alpha);
    g.fillTriangle(x - size * 0.5, y - size * 0.6, x - size * 0.5, y + size * 0.6, x + size * 0.6, y);
  };
  const bolt = (g: Phaser.GameObjects.Graphics, x: number, y: number) => { g.fillStyle(0x000000, 0.4); g.fillCircle(x, y, 2.5); g.fillStyle(0xffffff, 0.25); g.fillCircle(x - 0.7, y - 0.7, 1.2); };

  // conveyor: belt with chevrons pointing east
  make('m-conveyor', C, C, (g) => {
    g.fillStyle(0x000000, 0.3); g.fillRoundedRect(6, 16, C - 10, C - 30, 6);
    g.fillStyle(P.steelDark, 1); g.fillRoundedRect(4, 14, C - 10, C - 30, 6);
    g.fillStyle(0x3a4148, 1); g.fillRect(8, 20, C - 18, C - 42);
    for (let i = 0; i < 3; i++) arrow(g, 20 + i * 16, H, 11, P.amber, 0.85);
    g.fillStyle(P.steel, 1); g.fillRect(4, 14, C - 10, 4); g.fillRect(4, C - 20, C - 10, 4);
    bolt(g, 9, 19); bolt(g, C - 11, 19); bolt(g, 9, C - 18); bolt(g, C - 11, C - 18);
  });
  // conveyor chevron overlay frames for belt motion (BELT_FRAMES frames, 2 px per step over a 16 px chevron pitch)
  for (let f = 0; f < BELT_FRAMES; f++) make(`belt-${f}`, C, C, (g) => {
    g.fillStyle(0x3a4148, 1); g.fillRect(8, 20, C - 18, C - 42);
    for (let i = -1; i < 4; i++) { const x = 20 + i * 16 + f * (16 / BELT_FRAMES); if (x > 10 && x < C - 10) arrow(g, x, H, 11, P.amber, 0.85); }
  });

  // hopper: funnel, mouth east
  make('m-hopper', C, C, (g) => {
    body(g, P.rust, 7, 10);
    g.fillStyle(0x2a1a14, 1); g.fillRoundedRect(14, 14, 30, C - 28, 6); // bin
    g.fillStyle(P.scrap, 1); for (let i = 0; i < 6; i++) g.fillCircle(20 + (i % 3) * 9, 24 + Math.floor(i / 3) * 10 + (i % 2) * 3, 4.5);
    g.fillStyle(P.steel, 1); g.fillTriangle(44, 22, 44, C - 22, C - 8, H); // chute
    g.fillStyle(P.amber, 1); g.fillTriangle(50, 28, 50, C - 28, C - 10, H);
    bolt(g, 12, 12); bolt(g, 12, C - 12);
  });
  // crusher: box with gear teeth + jaws
  make('m-crusher', C, C, (g) => {
    body(g, P.steelDark, 7, 6);
    g.fillStyle(0x2b2f33, 1); g.fillRect(12, 18, C - 24, C - 36);
    g.fillStyle(P.steel, 1);
    for (let i = 0; i < 4; i++) { g.fillTriangle(16 + i * 11, 18, 22 + i * 11, 18, 19 + i * 11, 30); g.fillTriangle(16 + i * 11, C - 18, 22 + i * 11, C - 18, 19 + i * 11, C - 30); }
    g.fillStyle(P.amber, 1); g.fillCircle(H, H, 7); g.fillStyle(0x000000, 0.5); g.fillCircle(H, H, 3);
    arrow(g, C - 12, H, 9, P.amber);
    bolt(g, 12, 12); bolt(g, C - 12, 12); bolt(g, 12, C - 12); bolt(g, C - 12, C - 12);
  });
  // crusher, jaws closed (state frame while an item is held): the teeth meet at the middle
  make('m-crusher-1', C, C, (g) => {
    body(g, P.steelDark, 7, 6);
    g.fillStyle(0x2b2f33, 1); g.fillRect(12, 18, C - 24, C - 36);
    g.fillStyle(P.steel, 1);
    for (let i = 0; i < 4; i++) { g.fillTriangle(16 + i * 11, 18, 22 + i * 11, 18, 19 + i * 11, H - 1); g.fillTriangle(16 + i * 11, C - 18, 22 + i * 11, C - 18, 19 + i * 11, H + 1); }
    g.fillStyle(P.amber, 1); g.fillCircle(H, H, 5); g.fillStyle(0x000000, 0.5); g.fillCircle(H, H, 2);
    arrow(g, C - 12, H, 9, P.amber);
    bolt(g, 12, 12); bolt(g, C - 12, 12); bolt(g, 12, C - 12); bolt(g, C - 12, C - 12);
  });
  // furnace: dark box with glowing mouth facing east, chimney
  make('m-furnace', C, C, (g) => {
    body(g, 0x4a3a30, 7, 6);
    g.fillStyle(0x1a1210, 1); g.fillRoundedRect(14, 16, C - 28, C - 32, 6);
    g.fillStyle(0xff7a2a, 1); g.fillRoundedRect(20, 24, C - 40, C - 48, 5);
    g.fillStyle(0xffd27a, 1); g.fillRoundedRect(26, 30, C - 52, C - 60, 4);
    g.fillStyle(0x3b2f28, 1); g.fillRect(10, 4, 12, 14); g.fillStyle(0x6b5a4a, 1); g.fillRect(8, 2, 16, 4);
    arrow(g, C - 12, H, 9, P.amber);
    bolt(g, 12, C - 12); bolt(g, C - 12, C - 12);
  });
  // press: steel frame, ram pressing a plate, output east
  make('m-press', C, C, (g) => {
    body(g, 0x4f6b8a, 7, 6);
    g.fillStyle(0x263340, 1); g.fillRoundedRect(14, 14, C - 28, C - 28, 5);
    g.fillStyle(P.steel, 1); g.fillRect(22, 12, C - 44, 14); // ram head
    g.fillStyle(P.steelDark, 1); g.fillRect(H - 5, 26, 10, 10); // piston rod
    g.fillStyle(P.plate, 1); g.fillRoundedRect(20, 38, C - 40, 8, 2); // plate being pressed
    g.fillStyle(0x3a4a5a, 1); g.fillRect(16, 48, C - 32, 8); // anvil
    arrow(g, C - 12, H, 9, P.amber);
    bolt(g, 12, 12); bolt(g, C - 12, 12); bolt(g, 12, C - 12); bolt(g, C - 12, C - 12);
  });
  // press ram descending (state frames while pressing): head lower, rod longer, plate flatter
  for (const [f, drop] of [[1, 8], [2, 16]] as const) make(`m-press-${f}`, C, C, (g) => {
    body(g, 0x4f6b8a, 7, 6);
    g.fillStyle(0x263340, 1); g.fillRoundedRect(14, 14, C - 28, C - 28, 5);
    g.fillStyle(P.steel, 1); g.fillRect(22, 12 + drop, C - 44, 14); // ram head
    g.fillStyle(P.steelDark, 1); g.fillRect(H - 5, 12, 10, 14 + drop); // piston rod
    g.fillStyle(P.plate, 1); g.fillRoundedRect(20 - drop / 4, 40 + drop / 4, C - 40 + drop / 2, 8 - drop / 4, 2); // plate flattening
    g.fillStyle(0x3a4a5a, 1); g.fillRect(16, 48, C - 32, 8); // anvil
    arrow(g, C - 12, H, 9, P.amber);
    bolt(g, 12, 12); bolt(g, C - 12, 12); bolt(g, 12, C - 12); bolt(g, C - 12, C - 12);
  });
  // splitter: Y plate, input west, outputs north+south
  make('m-splitter', C, C, (g) => {
    body(g, 0x5c6a52, 7, 8);
    g.fillStyle(0x2f3a2a, 1); g.fillRoundedRect(14, 14, C - 28, C - 28, 8);
    g.lineStyle(5, P.amber, 0.95);
    g.beginPath(); g.moveTo(16, H); g.lineTo(H, H); g.lineTo(H, 16); g.strokePath();
    g.beginPath(); g.moveTo(H, H); g.lineTo(H, C - 16); g.strokePath();
    g.fillStyle(P.amber, 1); g.fillTriangle(H - 6, 18, H + 6, 18, H, 8); g.fillTriangle(H - 6, C - 18, H + 6, C - 18, H, C - 8);
    bolt(g, 12, 12); bolt(g, C - 12, 12); bolt(g, 12, C - 12); bolt(g, C - 12, C - 12);
  });
  // dock: green bay with crates
  make('m-dock', C, C, (g) => {
    body(g, 0x3e6b4a, 6, 8);
    g.fillStyle(0x1f3a28, 1); g.fillRoundedRect(12, 12, C - 24, C - 24, 6);
    g.fillStyle(0xd9b36c, 1); g.fillRect(18, 30, 16, 16); g.fillRect(38, 30, 16, 16); g.fillRect(28, 16, 16, 12);
    g.lineStyle(1.5, 0x8a6a30, 1); g.strokeRect(18, 30, 16, 16); g.strokeRect(38, 30, 16, 16); g.strokeRect(28, 16, 16, 12);
    g.fillStyle(P.green, 1); g.fillRect(16, C - 20, C - 32, 4);
    bolt(g, 11, 11); bolt(g, C - 11, 11); bolt(g, 11, C - 11); bolt(g, C - 11, C - 11);
  });

  // items
  const S = 24;
  make('i-scrap', S, S, (g) => { g.fillStyle(0x000000, 0.35); g.fillCircle(13, 14, 9); g.fillStyle(P.scrap, 1); g.fillCircle(12, 12, 9); g.fillStyle(0x5c4631, 1); g.fillCircle(9, 10, 3); g.fillCircle(15, 14, 2.5); g.fillStyle(0xffffff, 0.2); g.fillCircle(9, 8, 2); });
  make('i-shards', S, S, (g) => { g.fillStyle(0x000000, 0.35); g.fillTriangle(5, 21, 21, 21, 13, 5); g.fillStyle(P.shards, 1); g.fillTriangle(4, 19, 20, 19, 12, 3); g.fillTriangle(6, 21, 14, 21, 9, 13); g.fillStyle(0xffffff, 0.5); g.fillTriangle(9, 15, 12, 15, 11, 8); });
  make('i-plate', S, S, (g) => { g.fillStyle(0x000000, 0.35); g.fillRoundedRect(3, 10, 19, 9, 2); g.fillStyle(P.plate, 1); g.fillRoundedRect(2, 8, 19, 9, 2); g.fillStyle(0xffffff, 0.35); g.fillRect(4, 10, 15, 2); g.fillStyle(0x3a4a5a, 1); g.fillCircle(6, 13, 1.3); g.fillCircle(17, 13, 1.3); });
  make('i-ingot', S, S, (g) => { g.fillStyle(0x000000, 0.35); g.fillRoundedRect(3, 9, 19, 12, 3); g.fillStyle(P.ingot, 1); g.fillRoundedRect(2, 7, 19, 12, 3); g.fillStyle(0xfff2b0, 1); g.fillRect(5, 9, 10, 3); g.lineStyle(1.5, 0x9a7a1a, 1); g.strokeRoundedRect(2, 7, 19, 12, 3); });
  make('i-slag', S, S, (g) => { g.fillStyle(0x000000, 0.35); g.fillCircle(13, 14, 8); g.fillStyle(P.slag, 1); g.fillCircle(12, 12, 8); g.fillStyle(0x3a1e1e, 1); g.fillCircle(9, 11, 3); g.fillStyle(0xd34a2a, 0.7); g.fillCircle(15, 14, 2); });

  // ui
  make('dot', 8, 8, (g) => { g.fillStyle(0xffffff, 1); g.fillCircle(4, 4, 4); });
  make('px', 2, 2, (g) => { g.fillStyle(0xffffff, 1); g.fillRect(0, 0, 2, 2); });
  g.destroy();
}

export const machineTexture = (k: MachineKind) => `m-${k}`;
export const itemTexture = (m: Material) => `i-${m}`;
