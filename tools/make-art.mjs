#!/usr/bin/env node
/**
 * The game's art, from source to the one sprite sheet the game loads (docs/ART.md). Every frame is an SVG drawn in code under
 * tools/make-art/; this renders them in Playwright's Chromium, supersampled and scaled down, packs them on fixed grid
 * positions into game/public/art/sheet.webp, writes those positions to game/src/render/sheet.ts, and exports each SVG to
 * tools/make-art/svg/ so a frame can be opened in any vector tool. The same input gives the same output.
 *
 *   node tools/make-art.mjs [--quality 0.74] [--hero-quality 0.84] [--bg-quality 0.55] [--only sheet|scenes] [--no-svg] [--raw sheet.png]
 *
 * A file named after a frame in tools/make-art/override/ (<key>.png at the frame's size, or <key>.svg) replaces the drawing:
 * that is how an artist's work comes in, one frame at a time.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Renderer } from './make-art/render.mjs';
import { svgDoc } from './make-art/lib.mjs';
import { beltBendFrame, beltFrame, conveyor, conveyorBend } from './make-art/belts.mjs';
import { crusher, furnace, hopper } from './make-art/machines.mjs';
import { dock, press, splitter, tuner } from './make-art/machines2.mjs';
import { ingot, plate, scrap, shards, slag } from './make-art/items.mjs';
import { GH, GW, ground, tile } from './make-art/ground.mjs';
import { rubble0, rubble1, rubble2, rubble3 } from './make-art/junk.mjs';
import { SHELF_H, SHELF_W, glowFrame, shelf, tileBad, tileCursor, tileOk, tileSel } from './make-art/overlays.mjs';
import { hero, HERO_H, HERO_W, yardBg, BG_H, BG_W } from './make-art/scenes.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'game', 'public', 'art');
const SVG_OUT = path.join(ROOT, 'tools', 'make-art', 'svg');
const OVERRIDE = path.join(ROOT, 'tools', 'make-art', 'override');
const args = process.argv.slice(2);
const opt = (k, d) => {
  const i = args.indexOf(`--${k}`);
  return i >= 0 ? args[i + 1] : d;
};
const quality = Number(opt('quality', '0.74'));
const only = opt('only', '');
const CELL = 144,
  ITEM = 48,
  GUTTER = 4;

const cell = (key, make) => ({ key, w: CELL, h: CELL, ss: 4, make });
const item = (key, make) => ({ key, w: ITEM, h: ITEM, ss: 6, make });
const BELTS = 8;
/** The sheet row by row. A frame's place follows from this order, so appending a frame moves nothing. */
const ROWS = [
  [
    cell('tile', tile),
    cell('tile-ok', tileOk),
    cell('tile-bad', tileBad),
    cell('tile-sel', tileSel),
    cell('tile-cursor', tileCursor),
    cell('m-conveyor', conveyor),
    cell('m-conveyor-bend', conveyorBend),
    cell('m-hopper', hopper),
  ],
  [
    cell('m-crusher', () => crusher(false)),
    cell('m-crusher-1', () => crusher(true)),
    cell('m-furnace', () => furnace(false)),
    cell('m-furnace-1', () => furnace(true)),
    cell('m-press', () => press(0)),
    cell('m-press-1', () => press(16)),
    cell('m-press-2', () => press(32)),
    cell('m-splitter', () => splitter(false)),
  ],
  [
    cell('m-splitter-1', () => splitter(true)),
    cell('m-dock', dock),
    cell('m-tuner', tuner),
    cell('rubble-0', rubble0),
    cell('rubble-1', rubble1),
    cell('rubble-2', rubble2),
    cell('rubble-3', rubble3),
    cell('fx-glow', glowFrame),
  ],
  Array.from({ length: BELTS }, (_, k) => cell(`belt-${k}`, () => beltFrame(k))),
  Array.from({ length: BELTS }, (_, k) => cell(`belt-bend-${k}`, () => beltBendFrame(k))),
  [item('i-scrap', scrap), item('i-shards', shards), item('i-plate', plate), item('i-ingot', ingot), item('i-slag', slag)],
  [{ key: 'ground', w: GW, h: GH, ss: 2, make: ground }],
  [{ key: 'shelf', w: SHELF_W, h: SHELF_H, ss: 3, make: shelf }],
];

/** Fixed positions: rows of frames with a gutter that holds each frame's extruded edge. */
function pack() {
  const placed = [];
  let y = GUTTER,
    width = 0;
  for (const row of ROWS) {
    let x = GUTTER,
      tall = 0;
    for (const fr of row) {
      placed.push({ ...fr, x, y });
      x += fr.w + GUTTER * 2;
      tall = Math.max(tall, fr.h);
    }
    width = Math.max(width, x - GUTTER);
    y += tall + GUTTER * 2;
  }
  return { placed, width, height: y - GUTTER };
}

function overrideFor(key) {
  for (const ext of ['png', 'svg']) {
    const p = path.join(OVERRIDE, `${key}.${ext}`);
    if (fs.existsSync(p)) return { ext, data: fs.readFileSync(p) };
  }
  return null;
}

const r = new Renderer();
await r.open();
fs.mkdirSync(OUT, { recursive: true });
const report = {};

if (only !== 'scenes') {
  const { placed, width, height } = pack();
  if (!args.includes('--no-svg')) fs.mkdirSync(SVG_OUT, { recursive: true });
  for (const fr of placed) {
    const o = overrideFor(fr.key);
    if (o) {
      await r.eval(
        async ([key, url, w, h]) => {
          const img = new Image();
          img.src = url;
          await img.decode();
          const c = document.createElement('canvas');
          c.width = w;
          c.height = h;
          c.getContext('2d').drawImage(img, 0, 0, w, h);
          window.__frames.set(key, c);
        },
        [fr.key, `data:image/${o.ext === 'svg' ? 'svg+xml' : 'png'};base64,${o.data.toString('base64')}`, fr.w, fr.h],
      );
      console.log(`override ${fr.key}.${o.ext}`);
      continue;
    }
    const a = fr.make();
    await r.frame(fr.key, svgDoc(fr.w, fr.h, a.defs, a.body, fr.ss), fr.w, fr.h, { sharpen: fr.key === 'ground' ? 0 : 0.35 });
    if (!args.includes('--no-svg')) fs.writeFileSync(path.join(SVG_OUT, `${fr.key}.svg`), svgDoc(fr.w, fr.h, a.defs, a.body, 1) + '\n');
  }
  await r.eval(
    ([placed, width, height, gutter]) => {
      const sheet = document.createElement('canvas');
      sheet.width = width;
      sheet.height = height;
      const g = sheet.getContext('2d');
      for (const { key, x, y, w, h } of placed) {
        const src = window.__frames.get(key);
        // the edge pixels run out into the gutter, so a scaled sprite never samples a neighbour or empty space
        g.drawImage(src, 0, 0, 1, h, x - gutter, y, gutter, h);
        g.drawImage(src, w - 1, 0, 1, h, x + w, y, gutter, h);
        g.drawImage(src, 0, 0, w, 1, x, y - gutter, w, gutter);
        g.drawImage(src, 0, h - 1, w, 1, x, y + h, w, gutter);
        g.drawImage(src, 0, 0, w, h, x, y, w, h);
      }
      window.__frames.set('sheet', sheet);
    },
    [placed.map(({ key, x, y, w, h }) => ({ key, x, y, w, h })), width, height, GUTTER],
  );
  if (opt('raw', '')) fs.writeFileSync(opt('raw', ''), await r.bytes('sheet'));
  // what each item sprite actually looks like on average, so the colour-vision audit holds the drawing and not only the palette
  const means = await r.eval(() =>
    Object.fromEntries(
      ['scrap', 'shards', 'plate', 'ingot', 'slag'].map((m) => {
        const c = window.__frames.get(`i-${m}`);
        const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
        const sum = [0, 0, 0];
        let n = 0;
        for (let i = 0; i < d.length; i += 4)
          if (d[i + 3] > 230) {
            for (let k = 0; k < 3; k++) sum[k] += d[i + k];
            n++;
          }
        return [
          m,
          `#${sum
            .map((v) =>
              Math.round(v / n)
                .toString(16)
                .padStart(2, '0'),
            )
            .join('')}`,
        ];
      }),
    ),
  );
  fs.writeFileSync(path.join(ROOT, 'tools', 'make-art', 'item-colours.json'), JSON.stringify(means, null, 2) + '\n');
  const bytes = await r.bytes('sheet', 'image/webp', quality);
  fs.writeFileSync(path.join(OUT, 'sheet.webp'), bytes);
  report.sheet = { width, height, bytes: bytes.length, frames: placed.length };
  const lines = placed.map((p) => `  ${/^[a-z]+$/.test(p.key) ? p.key : `'${p.key}'`}: [${p.x}, ${p.y}, ${p.w}, ${p.h}],`);
  fs.writeFileSync(
    path.join(ROOT, 'game', 'src', 'render', 'sheet.ts'),
    `// Generated by tools/make-art.mjs: where each frame sits in game/public/art/sheet.webp ([x, y, w, h] in sheet pixels). Do not edit.
export const SHEET_W = ${width};
export const SHEET_H = ${height};
/** Sheet pixels per logical pixel. */
export const SHEET_SCALE = 2;
export const FRAMES: Record<string, readonly [number, number, number, number]> = {
${lines.join('\n')}
};
`,
  );
}

if (only !== 'sheet') {
  const a = hero();
  await r.frame('hero', svgDoc(HERO_W, HERO_H, a.defs, a.body, 2), HERO_W, HERO_H, { sharpen: 0 });
  const hb = await r.bytes('hero', 'image/webp', Number(opt('hero-quality', '0.84')));
  fs.writeFileSync(path.join(OUT, 'hero.webp'), hb);
  report.hero = { width: HERO_W, height: HERO_H, bytes: hb.length };
  const b = yardBg();
  await r.frame('bg', svgDoc(BG_W, BG_H, b.defs, b.body, 1), BG_W, BG_H, { sharpen: 0 });
  const bb = await r.bytes('bg', 'image/webp', Number(opt('bg-quality', '0.55')));
  fs.writeFileSync(path.join(OUT, 'yard-bg.webp'), bb);
  report.bg = { width: BG_W, height: BG_H, bytes: bb.length };
  if (!args.includes('--no-svg')) {
    fs.writeFileSync(path.join(SVG_OUT, 'hero.svg'), svgDoc(HERO_W, HERO_H, a.defs, a.body, 1) + '\n');
    fs.writeFileSync(path.join(SVG_OUT, 'yard-bg.svg'), svgDoc(BG_W, BG_H, b.defs, b.body, 1) + '\n');
  }
}
await r.close();
console.log(JSON.stringify(report));
