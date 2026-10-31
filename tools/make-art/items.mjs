// The five materials at 48 × 48 (they show at 24 px on a 72 px cell). Each has its own outline first and its own colour
// second: a lump, a spray of splinters, a flat bar with two rivets, a trapezoid ingot, a slumped blob with a hot crack. The
// colours sit close to palette.ts so the colour-vision audit (tools/a11y-audit.ts) speaks for the sprites too.
import { Defs, chunk, f, poly, rng } from './lib.mjs';

const shadow = (d, o = 0.6) => `<path d="${d}" fill="#0a0604" opacity="${o}" filter="url(#b1_5)"/>`;
const outline = (d, c = '#120b07', w = 1.8) => `<path d="${d}" fill="none" stroke="${c}" stroke-width="${w}" stroke-linejoin="round"/>`;

export function scrap() {
  const defs = new Defs();
  const r = rng(5);
  const d = poly([
    [8, 22],
    [15, 8],
    [27, 5],
    [40, 12],
    [43, 27],
    [33, 41],
    [18, 42],
    [10, 34],
  ]);
  const fill = defs.rad(
    [
      [0, '#c49a6c'],
      [0.6, '#8a6d4e'],
      [1, '#54402c'],
    ],
    23,
    21,
    26,
  );
  let s = shadow(d) + outline(d) + `<path d="${d}" fill="${fill}" filter="url(#bevelS)"/>`;
  // torn facets and rust
  s += `<path d="${poly([
    [15, 8],
    [27, 5],
    [24, 19],
    [13, 22],
  ])}" fill="#d9b58a" opacity=".55"/>`;
  s += `<path d="${poly([
    [24, 19],
    [40, 12],
    [43, 27],
    [30, 30],
  ])}" fill="#5c4631" opacity=".75"/>`;
  s += `<path d="${poly([
    [13, 22],
    [24, 19],
    [30, 30],
    [18, 42],
    [10, 34],
  ])}" fill="#7a5a3e" opacity=".55"/>`;
  s += `<path d="M15 8L13 22L24 19L27 5M24 19L30 30L18 42M30 30L43 27" fill="none" stroke="#2a1c12" stroke-width="1.1" opacity=".75"/>`;
  for (let i = 0; i < 5; i++) s += `<circle cx="${f(16 + r() * 22)}" cy="${f(14 + r() * 24)}" r="${f(1 + r() * 1.6)}" fill="#a0522d" opacity=".6"/>`;
  s += `<path d="M16 9L26 6.5" stroke="#fff2dc" stroke-width="1.4" stroke-linecap="round" opacity=".85"/>`;
  return { defs, body: s };
}

export function shards() {
  const defs = new Defs();
  const big = poly([
    [24, 3],
    [32, 30],
    [22, 44],
    [15, 26],
  ]);
  const left = poly([
    [5, 22],
    [17, 30],
    [15, 43],
    [7, 38],
  ]);
  const right = poly([
    [44, 19],
    [40, 39],
    [29, 44],
    [33, 29],
  ]);
  const all = `${big}${left}${right}`;
  const fill = defs.lin(
    [
      [0, '#ffffff'],
      [0.5, '#d6e1ea'],
      [1, '#8fa2b2'],
    ],
    12,
    4,
    36,
    44,
  );
  let s = shadow(all) + outline(all, '#141a20', 2);
  s += `<path d="${all}" fill="${fill}"/>`;
  s += `<path d="${poly([
    [24, 3],
    [24, 41],
    [15, 26],
  ])}" fill="#fff" opacity=".6"/>`;
  s += `<path d="${poly([
    [5, 22],
    [13, 33],
    [7, 38],
  ])}" fill="#fff" opacity=".55"/>`;
  s += `<path d="${poly([
    [44, 19],
    [34, 34],
    [33, 29],
  ])}" fill="#fff" opacity=".6"/>`;
  s += `<path d="M24 3L32 30L22 44" fill="none" stroke="#6d8294" stroke-width="1" opacity=".8"/>`;
  return { defs, body: s };
}

export function plate() {
  const defs = new Defs();
  const d = 'M6 15H42A2 2 0 0 1 44 17V31A2 2 0 0 1 42 33H6A2 2 0 0 1 4 31V17A2 2 0 0 1 6 15Z';
  const fill = defs.lin(
    [
      [0, '#a9c2da'],
      [0.28, '#7f9bb8'],
      [0.72, '#6a87a6'],
      [1, '#4b6480'],
    ],
    0,
    15,
    0,
    33,
  );
  let s = shadow(d, 0.7) + outline(d, '#0f151c', 2) + `<path d="${d}" fill="${fill}" filter="url(#bevelS)"/>`;
  s += `<path d="M7 18.4H41" stroke="#e6f2ff" stroke-width="1.7" stroke-linecap="round" opacity=".9"/>`;
  s += `<path d="${poly([
    [28, 16],
    [36, 16],
    [24, 32],
    [16, 32],
  ])}" fill="#fff" opacity=".14"/>`;
  for (const x of [11, 37]) s += `<circle cx="${x}" cy="25.5" r="3" fill="#2a3a4c"/><circle cx="${x}" cy="25.5" r="1.7" fill="#a9c2da"/>`;
  return { defs, body: s };
}

export function ingot() {
  const defs = new Defs();
  const d = poly([
    [4, 36],
    [11, 12],
    [37, 12],
    [44, 36],
  ]);
  const top = poly([
    [14, 16],
    [34, 16],
    [38, 32],
    [10, 32],
  ]);
  const fill = defs.lin(
    [
      [0, '#fff0a8'],
      [0.35, '#f5c542'],
      [1, '#a8760f'],
    ],
    0,
    12,
    0,
    36,
  );
  const face = defs.lin(
    [
      [0, '#fff7c4'],
      [0.5, '#ffd95c'],
      [1, '#e8ae2c'],
    ],
    10,
    16,
    38,
    32,
  );
  let s = shadow(d, 0.7) + outline(d, '#2a1a04', 2.1) + `<path d="${d}" fill="${fill}" filter="url(#bevelS)"/>`;
  s += `<path d="${top}" fill="${face}" stroke="#a8760f" stroke-width="1"/>`;
  s += `<path d="M16 19.5H30" stroke="#fff" stroke-width="2.4" stroke-linecap="round" opacity=".95"/>`;
  s += `<path d="${poly([
    [29, 16],
    [34, 16],
    [38, 32],
    [33, 32],
  ])}" fill="#fff" opacity=".22"/>`;
  return { defs, body: s };
}

export function slag() {
  const defs = new Defs();
  const r = rng(12);
  const d = 'M9 30C4 21 11 11 20 12C24 5 36 7 37 15C45 17 45 30 39 34C36 41 24 42 20 38C15 41 11 36 9 30Z';
  const fill = defs.rad(
    [
      [0, '#7d4545'],
      [0.6, '#5a2f2f'],
      [1, '#2a1414'],
    ],
    24,
    22,
    24,
  );
  let s = shadow(d) + outline(d, '#120808', 2) + `<path d="${d}" fill="${fill}" filter="url(#bevelS)"/>`;
  for (let i = 0; i < 6; i++) s += `<path d="${chunk(r, 13 + r() * 24, 15 + r() * 20, 2 + r() * 2.2, 5)}" fill="#1f1010" opacity=".8"/>`;
  const crack = 'M14 24C19 26 22 22 26 26C30 29 33 26 37 28M26 26C25 30 28 33 27 36';
  s += `<path d="${crack}" fill="none" stroke="#ff6a1f" stroke-width="3.8" opacity=".7" filter="url(#b1)"/>`;
  s += `<path d="${crack}" fill="none" stroke="#ffb347" stroke-width="1.5" stroke-linecap="round"/>`;
  s += `<path d="M15 16C19 13 23 13 26 15" fill="none" stroke="#fff" stroke-width="1.3" stroke-linecap="round" opacity=".5"/>`;
  return { defs, body: s };
}
