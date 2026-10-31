// The machines, seen from straight above and facing east. Every one keeps its identity at 40 px: its own outline and its own
// colour. Rotation is by sprite angle, so nothing here may have a direction to its light.
import { Defs, ao, bolt, cham, chunk, circle, f, hazard, part, poly, rng, rr, well } from './lib.mjs';
import { portIn, portOut } from './ports.mjs';

/** A sheen that lifts the middle of a plate and falls away evenly to its edges. */
export const sheen = (defs, c0, c1, c2, cx = 72, cy = 72, r = 92) =>
  defs.rad(
    [
      [0, c0],
      [0.55, c1],
      [1, c2],
    ],
    cx,
    cy,
    r,
  );
/** Soft ground shadow under a whole machine, kept inside the frame. */
export const contact = (d, o = 0.72) => ao(d, 'b4', o);
export const finish = (s, n) => `<g filter="url(#finish${n})">${s}</g>`;
export const steelH = (defs, x0 = 20, x1 = 124) =>
  defs.lin(
    [
      [0, '#59636c'],
      [0.22, '#a3afb8'],
      [0.5, '#d4dde3'],
      [0.78, '#a3afb8'],
      [1, '#59636c'],
    ],
    x0,
    0,
    x1,
    0,
  );
export const corners = (a, b, r = 3) => [bolt(a, a, r), bolt(b, a, r), bolt(a, b, r), bolt(b, b, r)].join('');

// ---------- hopper: a rust-red funnel full of scrap, tipping into a chute on the east side ----------
export function hopper() {
  const defs = new Defs();
  const rim = cham(8, 12, 116, 120, 18);
  let b = contact(rim);
  b += part(rim, sheen(defs, '#c9613f', '#a8503a', '#6a2f22', 66, 72, 88), { shade: 0, bevel: 'bevelL', lineW: 2.2 });
  // sloped walls down to the throat
  const ix0 = 22,
    ix1 = 110,
    iy0 = 26,
    iy1 = 118,
    tx0 = 42,
    tx1 = 92,
    ty0 = 48,
    ty1 = 96;
  const wall = (pts, fill) => `<path d="${poly(pts)}" fill="${fill}"/>`;
  const fall = (x1, y1, x2, y2) =>
    defs.lin(
      [
        [0, '#8c4530'],
        [0.5, '#5e2d20'],
        [1, '#26130d'],
      ],
      x1,
      y1,
      x2,
      y2,
    );
  b += ao(cham(ix0, iy0, ix1 - ix0, iy1 - iy0, 10), 'b2', 0.7);
  b += wall(
    [
      [ix0, iy0],
      [ix1, iy0],
      [tx1, ty0],
      [tx0, ty0],
    ],
    fall(0, iy0, 0, ty0),
  );
  b += wall(
    [
      [ix0, iy1],
      [ix1, iy1],
      [tx1, ty1],
      [tx0, ty1],
    ],
    fall(0, iy1, 0, ty1),
  );
  b += wall(
    [
      [ix0, iy0],
      [tx0, ty0],
      [tx0, ty1],
      [ix0, iy1],
    ],
    fall(ix0, 0, tx0, 0),
  );
  b += wall(
    [
      [ix1, iy0],
      [tx1, ty0],
      [tx1, ty1],
      [ix1, iy1],
    ],
    fall(ix1, 0, tx1, 0),
  );
  for (const [x1, y1, x2, y2] of [
    [ix0, iy0, tx0, ty0],
    [ix1, iy0, tx1, ty0],
    [ix0, iy1, tx0, ty1],
    [ix1, iy1, tx1, ty1],
  ])
    b += `<path d="M${x1} ${y1}L${x2} ${y2}" stroke="#1a0c07" stroke-width="1.4" opacity=".8"/>`;
  b += `<rect x="${tx0}" y="${ty0}" width="${tx1 - tx0}" height="${ty1 - ty0}" fill="#0f0806"/>`;
  // the way out to the chute
  b += `<path d="${poly([
    [tx1 - 4, 52],
    [ix1 + 16, 46],
    [ix1 + 16, 98],
    [tx1 - 4, 92],
  ])}" fill="#120a07"/>`;
  // rivets around the lip
  for (let i = 0; i < 5; i++) {
    const x = 30 + i * 18;
    b += bolt(x, 19, 2.3) + bolt(x, 125, 2.3);
  }
  for (let i = 0; i < 4; i++) b += bolt(15, 44 + i * 19, 2.3);
  // the scrap heap
  const r = rng(41);
  const cols = ['#8a6d4e', '#a0805a', '#6f5238', '#b5764a', '#7a8088', '#5c4631', '#c08a52'];
  let heap = `<ellipse cx="66" cy="72" rx="37" ry="39" fill="#080403" opacity=".75" filter="url(#b3)"/>`;
  for (let i = 0; i < 26; i++) {
    const a = r() * 6.28,
      d = Math.sqrt(r()) * 32;
    const x = 66 + Math.cos(a) * d,
      y = 72 + Math.sin(a) * d * 1.08;
    const size = 8.5 + r() * 6;
    const c = chunk(r, x, y, size, 5 + Math.floor(r() * 3), 0.75);
    heap += `<path d="${c}" fill="#090504" opacity=".6" filter="url(#b1_5)"/><path d="${c}" fill="${cols[Math.floor(r() * cols.length)]}" stroke="#1a100a" stroke-width=".8" filter="url(#bevelS)"/>`;
  }
  b += heap;
  let s = finish(b, 1);
  s += portOut(defs, 24);
  return { defs, body: s };
}

// ---------- crusher: a yellow heavy housing with a mouth of steel teeth ----------
export function crusher(closed) {
  const defs = new Defs();
  const body = cham(12, 8, 120, 128, 18);
  const gap = closed ? 12 : 0;
  let b = contact(body);
  b += part(body, sheen(defs, '#eeb544', '#cf8f2a', '#7f5119'), { shade: 0, bevel: 'bevelL', lineW: 2.2 });
  const band = (y) => hazard(defs, rr(28, y, 88, 10, 2), { pitch: 15 }) + `<path d="${rr(28, y, 88, 10, 2)}" fill="none" stroke="#1a120b" stroke-width="1.4"/>`;
  b += band(13) + band(121);
  const mouth = rr(19, 30, 106, 84, 6);
  b += well(defs, mouth, '#0f0b09', { width: 10, depth: 'b4', opacity: 1 });
  const steel = steelH(defs);
  const toothW = 25,
    n = 4;
  const teeth = (y, dir, shift) => {
    let d = '';
    for (let i = 0; i < n; i++)
      d += poly([
        [22 + shift + i * toothW, y],
        [22 + shift + (i + 1) * toothW, y],
        [22 + shift + (i + 0.5) * toothW, y + dir * 25],
      ]);
    return d;
  };
  const jaw = (y0, y1, dir, shift) => {
    const block = rr(21, Math.min(y0, y1), 102, Math.abs(y1 - y0), 2.5);
    const t = teeth(y1, dir, shift);
    return `<path d="${t}" fill="#000" opacity=".6" filter="url(#b2)"/><path d="${t}" fill="${steel}" stroke="#14100c" stroke-width="1.3" stroke-linejoin="round" filter="url(#bevelS)"/>${part(block, steel, { shade: 0.55, blur: 'b2', bevel: 'bevelS' })}`;
  };
  // rods behind the jaws
  const rod = (x) =>
    defs.lin(
      [
        [0, '#6b7681'],
        [0.5, '#e6edf1'],
        [1, '#6b7681'],
      ],
      x - 5,
      0,
      x + 5,
      0,
    );
  for (const x of [50, 94])
    for (const [y, h] of [
      [28, 8 + gap],
      [108 - gap, 8 + gap],
    ])
      b += `<rect x="${x - 5}" y="${y}" width="10" height="${h}" fill="${rod(x)}" stroke="#14100c" stroke-width="1"/>`;
  b += jaw(34 + gap, 46 + gap, 1, 0);
  b += jaw(110 - gap, 98 - gap, -1, 12.5);
  let s = finish(b, 2);
  if (closed) {
    const c = circle(72, 72, 11);
    s += `<path d="${c}" fill="#ffb347" opacity=".75" filter="url(#b5)"/><path d="${circle(72, 72, 4)}" fill="#fff0c0" opacity=".9" filter="url(#b1_5)"/>`;
    const sp = rng(5);
    for (let i = 0; i < 7; i++) {
      const a = sp() * 6.28,
        d = 6 + sp() * 16;
      s += `<circle cx="${f(72 + Math.cos(a) * d)}" cy="${f(72 + Math.sin(a) * d * 0.7)}" r="${f(0.7 + sp() * 0.9)}" fill="#ffe2a0"/>`;
    }
  }
  s += corners(21, 123, 2.8);
  s += portIn(defs) + portOut(defs);
  return { defs, body: s };
}

// ---------- furnace: a round brick kiln with a crucible of molten metal, a feed on the west and a spout on the east ----------
export function furnace(hot) {
  const defs = new Defs();
  const plinth = cham(10, 10, 124, 124, 26);
  let b = contact(plinth);
  b += part(plinth, sheen(defs, '#4f4139', '#3c312b', '#231b17'), { shade: 0, bevel: 'bevel', lineW: 2.2 });
  // chimneys in two corners, soot around them
  for (const [x, y] of [
    [114, 30],
    [30, 114],
  ]) {
    b += `<circle cx="${x}" cy="${y}" r="17" fill="#070403" opacity=".55" filter="url(#b3)"/>`;
    const lip = defs.rad(
      [
        [0.55, '#2a221d'],
        [0.78, '#8a7a6c'],
        [1, '#3d332c'],
      ],
      x,
      y,
      11.5,
    );
    b += part(circle(x, y, 11.5), lip, { shade: 0, bevel: 'bevelS', lineW: 1.4 });
    b += `<circle cx="${x}" cy="${y}" r="6.6" fill="#050302"/>`;
  }
  // iron band with rivets
  const R = 55;
  b += `<circle cx="72" cy="72" r="${R + 5}" fill="#050302" opacity=".7" filter="url(#b3)"/>`;
  const band = defs.rad(
    [
      [0.78, '#3a3f44'],
      [0.9, '#858f97'],
      [1, '#3a3f44'],
    ],
    72,
    72,
    R,
  );
  b += part(circle(72, 72, R), band, { shade: 0, bevel: 'bevelS', lineW: 1.8 });
  for (let i = 0; i < 14; i++) {
    const a = (i / 14) * Math.PI * 2 + 0.22;
    b += bolt(f(72 + Math.cos(a) * (R - 5.2)), f(72 + Math.sin(a) * (R - 5.2)), 1.9);
  }
  // ring of firebrick
  const n = 16;
  for (let i = 0; i < n; i++) {
    const a0 = (i / n) * Math.PI * 2,
      a1 = ((i + 1) / n) * Math.PI * 2 - 0.035;
    const r0 = 31,
      r1 = 47;
    const q = (r, a) => [72 + Math.cos(a) * r, 72 + Math.sin(a) * r];
    const [ax, ay] = q(r0, a0),
      [bx, by] = q(r1, a0),
      [cx, cy] = q(r1, a1),
      [dx, dy] = q(r0, a1);
    const tone = ['#a4553a', '#8d4630', '#b0603f', '#97503a'][i % 4];
    b += `<path d="M${f(ax)} ${f(ay)}L${f(bx)} ${f(by)}A${r1} ${r1} 0 0 1 ${f(cx)} ${f(cy)}L${f(dx)} ${f(dy)}A${r0} ${r0} 0 0 0 ${f(ax)} ${f(ay)}Z" fill="${tone}" stroke="#1c0f0a" stroke-width="1.2" filter="url(#bevelS)"/>`;
  }
  let s = finish(b, 3);
  // the crucible
  s += `<path d="${circle(72, 72, 32)}" fill="#0d0604"/>`;
  const melt = defs.rad(
    hot
      ? [
          [0, '#fffbe6'],
          [0.38, '#ffe58a'],
          [0.68, '#ffa630'],
          [0.9, '#f0601e'],
          [1, '#9c2a0e'],
        ]
      : [
          [0, '#ffd27a'],
          [0.3, '#ff9f2e'],
          [0.66, '#d9551c'],
          [0.9, '#8a2a12'],
          [1, '#3d120a'],
        ],
    72,
    72,
    29,
  );
  // the gradient pushed about by noise reads as liquid, and needs no lines drawn on it
  const liquid = defs.id('f');
  defs.push(
    `<filter id="${liquid}" x="-20%" y="-20%" width="140%" height="140%"><feTurbulence type="fractalNoise" baseFrequency="0.04" numOctaves="3" seed="${hot ? 5 : 9}" result="n"/><feDisplacementMap in="SourceGraphic" in2="n" scale="${hot ? 11 : 15}" xChannelSelector="R" yChannelSelector="G"/></filter>`,
  );
  const pot = defs.id('c');
  defs.push(`<clipPath id="${pot}"><path d="${circle(72, 72, 29)}"/></clipPath>`);
  s += `<g clip-path="url(#${pot})"><path d="${circle(72, 72, 36)}" fill="${melt}" filter="url(#${liquid})"/></g>`;
  // cooling plates float on the melt, dark with a soft bright rim
  const r = rng(hot ? 9 : 8);
  for (let i = 0; i < (hot ? 3 : 6); i++) {
    const a = r() * 6.28,
      d = 13 + r() * 11;
    const c = chunk(r, 72 + Math.cos(a) * d, 72 + Math.sin(a) * d, 3.6 + r() * 3.6, 6, 0.8);
    s += `<path d="${c}" fill="#ffe2a0" stroke="#ffe2a0" stroke-width="1.6" opacity=".55" filter="url(#b1)"/><path d="${c}" fill="${hot ? '#b8401a' : '#3a150a'}"/>`;
  }
  // heat over the brick
  s += `<path d="${circle(72, 72, 34)}" fill="${hot ? '#ffae3c' : '#ff7a2a'}" opacity="${hot ? 0.75 : 0.42}" filter="url(#b${hot ? 8 : 6})"/>`;
  // feed and spout across the ring
  const trough = (x0, x1, c) =>
    `<rect x="${x0}" y="62" width="${x1 - x0}" height="20" rx="3" fill="#120907" stroke="#3a2e27" stroke-width="1.4"/><rect x="${x0 + 1}" y="66" width="${x1 - x0 - 2}" height="12" fill="${c}"/>`;
  s += trough(14, 42, '#2a221d');
  s += trough(102, 130, hot ? '#ffb347' : '#e46a22');
  if (hot) s += `<rect x="100" y="60" width="32" height="24" fill="#ffae3c" opacity=".6" filter="url(#b4)"/>`;
  s += portIn(defs, 18) + portOut(defs, 20);
  return { defs, body: s };
}
