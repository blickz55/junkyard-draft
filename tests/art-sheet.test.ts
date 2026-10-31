// The art as files (docs/ART.md): the sheet the manifest describes, the budgets the first load depends on, a frame for every key
// the scenes ask for. What the frames look like in a browser is tests/render-e2e.test.mjs; their colours are tests/a11y.test.ts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FRAMES, SHEET_H, SHEET_SCALE, SHEET_W } from '../game/src/render/sheet';
import { BELT_FRAMES, CELL, itemTexture, machineTexture } from '../game/src/render/textures';
import { MACHINE_KINDS } from '../game/src/sim/rules';
import type { Material } from '../game/src/sim/types';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const art = (f: string) => path.join(ROOT, 'game', 'public', 'art', f);

/** Canvas size from a WebP's extended header (a sheet with alpha always has one). */
function webpSize(file: string) {
  const b = fs.readFileSync(file);
  assert.equal(b.toString('latin1', 0, 4), 'RIFF');
  assert.equal(b.toString('latin1', 8, 12), 'WEBP');
  assert.equal(b.toString('latin1', 12, 16), 'VP8X', `${file}: expected an extended header`);
  return { w: b.readUIntLE(24, 3) + 1, h: b.readUIntLE(27, 3) + 1 };
}

test('the sheet is the size the manifest says and stays within its budget; so do the hero and the background', () => {
  assert.deepEqual(webpSize(art('sheet.webp')), { w: SHEET_W, h: SHEET_H });
  const kib = (f: string) => fs.statSync(art(f)).size / 1024;
  assert.ok(kib('sheet.webp') <= 210, `sheet.webp is ${kib('sheet.webp').toFixed(0)} KiB`);
  assert.ok(kib('hero.webp') <= 60, `hero.webp is ${kib('hero.webp').toFixed(0)} KiB`);
  assert.ok(kib('yard-bg.webp') <= 30, `yard-bg.webp is ${kib('yard-bg.webp').toFixed(0)} KiB`);
});

test('no SVG is left in the public art folder: the build would ship and cache every one', () => {
  assert.deepEqual(
    fs.readdirSync(art('.')).filter((f) => !f.endsWith('.webp')),
    [],
  );
});

test('every key the scenes ask for has a frame, at 144 px a cell and 48 px an item', () => {
  const cell = CELL * SHEET_SCALE;
  const need = [
    ...MACHINE_KINDS.filter((k) => k !== 'sieve').map(machineTexture), // the sieve is never offered and has no art
    'm-conveyor-bend',
    'm-crusher-1',
    'm-furnace-1',
    'm-press-1',
    'm-press-2',
    'm-splitter-1',
    ...Array.from({ length: BELT_FRAMES }, (_, k) => `belt-${k}`),
    ...Array.from({ length: BELT_FRAMES }, (_, k) => `belt-bend-${k}`),
    'tile',
    'tile-ok',
    'tile-bad',
    'tile-sel',
    'tile-cursor',
    'fx-glow',
  ];
  for (const key of need) assert.deepEqual(FRAMES[key]?.slice(2), [cell, cell], key);
  for (const m of ['scrap', 'shards', 'plate', 'ingot', 'slag'] as Material[]) assert.deepEqual(FRAMES[itemTexture(m)]?.slice(2), [48, 48], m);
  assert.deepEqual(FRAMES.ground.slice(2), [cell * 8, cell * 6], 'the yard as one picture');
  assert.equal(FRAMES.shelf[2], cell * 8, 'the shelf is as wide as the yard');
});

test('frames sit inside the sheet with a gutter between them, so a scaled sprite never samples a neighbour', () => {
  const boxes = Object.entries(FRAMES);
  for (const [key, [x, y, w, h]] of boxes) assert.ok(x >= 4 && y >= 4 && x + w + 4 <= SHEET_W && y + h + 4 <= SHEET_H, `${key} leaves the sheet`);
  for (let i = 0; i < boxes.length; i++)
    for (let j = i + 1; j < boxes.length; j++) {
      const [ax, ay, aw, ah] = boxes[i][1];
      const [bx, by, bw, bh] = boxes[j][1];
      const apart = ax + aw + 8 <= bx || bx + bw + 8 <= ax || ay + ah + 8 <= by || by + bh + 8 <= ay;
      assert.ok(apart, `${boxes[i][0]} and ${boxes[j][0]} touch`);
    }
});

test('the bundled fonts are there, with their licences, and the page asks for them from its own origin', () => {
  const fonts = path.join(ROOT, 'game', 'public', 'fonts');
  const files = fs.readdirSync(fonts);
  for (const f of ['inter-latin-wght-normal.woff2', 'barlow-condensed-latin-700-normal.woff2', 'OFL-Inter.txt', 'OFL-BarlowCondensed.txt'])
    assert.ok(files.includes(f), f);
  const html = fs.readFileSync(path.join(ROOT, 'game', 'index.html'), 'utf8');
  const faces = [...html.matchAll(/src: url\(\.\/fonts\/([\w.-]+)\)/g)].map((m) => m[1]);
  assert.equal(faces.length, 4, 'two families, each with its pseudo-locale subset');
  for (const f of faces) assert.ok(files.includes(f), `the page asks for ${f}`);
  assert.equal((html.match(/font-display: swap/g) ?? []).length, 4, 'text is never held back for a font');
});
