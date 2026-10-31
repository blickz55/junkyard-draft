// The yard floor as one picture, 8 × 6 cells at 144 px: poured slabs (their joints tell one spot from the next), faded corner
// marks, packed dirt where the concrete has flaked away, oil, drum rings, cracks, tyre tracks, grit and a few weeds. It is one
// frame, not tiles, so nothing repeats. Everything raised or cut is drawn twice: once in colour and once in a height sketch that
// a low light rakes across, which is what makes the floor feel like a surface. The ground never turns, so its light may lean;
// the machines' light may not. `tile` is a single slab for the places that lay a small yard (the clip, the tips demo).
import { Defs, f, rng } from './lib.mjs';

export const GW = 1152;
export const GH = 864;
const C = 144;

function floorFilters(defs, w, h) {
  const box = `filterUnits="userSpaceOnUse" x="0" y="0" width="${w}" height="${h}" color-interpolation-filters="sRGB"`;
  // soft mottling through a warm grey ramp
  defs.push(`<filter id="concrete" ${box}>
    <feTurbulence type="fractalNoise" baseFrequency="0.0075" numOctaves="4" seed="8" result="n"/>
    <feColorMatrix in="n" type="matrix" values="1.4 0 0 0 -0.2  1.4 0 0 0 -0.2  1.4 0 0 0 -0.2  0 0 0 0 1" result="g"/>
    <feComponentTransfer in="g">
      <feFuncR type="table" tableValues="0.262 0.3 0.338 0.366 0.394"/>
      <feFuncG type="table" tableValues="0.238 0.272 0.305 0.331 0.357"/>
      <feFuncB type="table" tableValues="0.208 0.235 0.263 0.285 0.308"/>
    </feComponentTransfer>
  </filter>`);
  // flaked patches: a hard threshold keeps their edges crisp, the fine octaves break them up
  defs.push(`<filter id="dirt" ${box}>
    <feTurbulence type="fractalNoise" baseFrequency="0.0058 0.0072" numOctaves="7" seed="31" result="n"/>
    <feColorMatrix in="n" type="matrix" values="0 0 0 0 0.255  0 0 0 0 0.190  0 0 0 0 0.130  9 0 0 0 -4.9"/>
  </filter>`);
  defs.push(`<filter id="dust" ${box}>
    <feTurbulence type="fractalNoise" baseFrequency="0.0042 0.0062" numOctaves="6" seed="52" result="n"/>
    <feColorMatrix in="n" type="matrix" values="0 0 0 0 0.56  0 0 0 0 0.47  0 0 0 0 0.35  3.5 0 0 0 -1.9"/>
  </filter>`);
  // wobble for joints so nothing is ruled
  defs.push(`<filter id="rough" ${box}>
    <feTurbulence type="fractalNoise" baseFrequency="0.03" numOctaves="3" seed="5" result="n"/>
    <feDisplacementMap in="SourceGraphic" in2="n" scale="4.5" xChannelSelector="R" yChannelSelector="G"/>
  </filter>`);
  // a liquid's edge: strongly displaced, barely softened
  defs.push(`<filter id="spill" ${box}>
    <feTurbulence type="fractalNoise" baseFrequency="0.022" numOctaves="4" seed="12" result="n"/>
    <feDisplacementMap in="SourceGraphic" in2="n" scale="34" xChannelSelector="R" yChannelSelector="G" result="d"/>
    <feGaussianBlur in="d" stdDeviation="1.1"/>
  </filter>`);
  // paint worn off by noise
  defs.push(`<filter id="worn" ${box}>
    <feTurbulence type="fractalNoise" baseFrequency="0.09" numOctaves="4" seed="21" result="n"/>
    <feColorMatrix in="n" type="matrix" values="0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  4.5 0 0 0 -1.75" result="m"/>
    <feComposite in="SourceGraphic" in2="m" operator="in"/>
  </filter>`);
  // the raking light: the height sketch (white ground, black cuts) plus a broad bump, lit from the upper left
  defs.push(`<filter id="relief" ${box}>
    <feColorMatrix in="SourceGraphic" type="matrix" values="0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0.33 0.33 0.33 0 0" result="sketch"/>
    <feGaussianBlur in="sketch" stdDeviation="0.7" result="cut"/>
    <feTurbulence type="fractalNoise" baseFrequency="0.055" numOctaves="4" seed="4" result="bump"/>
    <feComposite in="cut" in2="bump" operator="arithmetic" k2="0.62" k3="0.38" result="h"/>
    <feDiffuseLighting in="h" surfaceScale="3.8" diffuseConstant="1.22" lighting-color="#fff8ee"><feDistantLight azimuth="235" elevation="54"/></feDiffuseLighting>
  </filter>`);
}

/** Corner marks of one spot, faded yellow paint. */
const marks = (x, y, inset = 11, len = 19, t = 3.4) => {
  const a = x + inset,
    b = x + C - inset,
    c = y + inset,
    d = y + C - inset;
  const seg = (x0, y0, dx, dy) => `<path d="M${x0 + dx * len} ${y0}H${x0}V${y0 + dy * len}" fill="none" stroke-width="${t}"/>`;
  return seg(a, c, 1, 1) + seg(b, c, -1, 1) + seg(a, d, 1, -1) + seg(b, d, -1, -1);
};

/** A crack as a jittered walk; thick where it starts, thin where it dies. */
function crackPaths(r, x, y, a, steps, spread = 0.5) {
  const out = [];
  let w = 2.6;
  for (let i = 0; i < steps; i++) {
    a += (r() - 0.5) * spread * 2;
    const l = 8 + r() * 14;
    const nx = x + Math.cos(a) * l,
      ny = y + Math.sin(a) * l;
    out.push(`<path d="M${f(x)} ${f(y)}L${f(nx)} ${f(ny)}" stroke-width="${f(w)}"/>`);
    x = nx;
    y = ny;
    w = Math.max(0.7, w * 0.88);
  }
  return out.join('');
}

function joints(w, h, cols, rows) {
  let d = '';
  for (let x = 1; x < cols; x++) d += `M${x * C} -8V${h + 8}`;
  for (let y = 1; y < rows; y++) d += `M-8 ${y * C}H${w + 8}`;
  return d;
}

/** A weed in a joint: a few dry blades. */
function weed(r, x, y) {
  let s = `<ellipse cx="${x}" cy="${y}" rx="9" ry="7" fill="#100c08" opacity=".35" filter="url(#b2)"/>`;
  const n = 6 + Math.floor(r() * 5);
  for (let i = 0; i < n; i++) {
    const a = r() * 6.28,
      l = 8 + r() * 11;
    const c = ['#6f7a45', '#87894e', '#5a6a3c', '#9a8f55'][Math.floor(r() * 4)];
    s += `<path d="M${x} ${y}Q${f(x + Math.cos(a + 0.4) * l * 0.6)} ${f(y + Math.sin(a + 0.4) * l * 0.6)} ${f(x + Math.cos(a) * l)} ${f(y + Math.sin(a) * l)}" stroke="${c}" stroke-width="1.5" fill="none" stroke-linecap="round"/>`;
  }
  return s;
}

/** Oil: a main pool and its drips, dark at heart, with a faint blue-black film. */
function oil(x, y, rx, ry, r) {
  let d = '',
    e = '';
  for (let i = 0; i < 4; i++) {
    const a = r() * 6.28,
      k = 0.3 + r() * 0.55;
    d += `<ellipse cx="${f(x + Math.cos(a) * rx * 0.7)}" cy="${f(y + Math.sin(a) * ry * 0.7)}" rx="${f(rx * k)}" ry="${f(ry * k)}"/>`;
  }
  d += `<ellipse cx="${x}" cy="${y}" rx="${rx}" ry="${ry}"/>`;
  for (let i = 0; i < 8; i++) {
    const a = r() * 6.28,
      l = 1.25 + r() * 0.7;
    e += `<circle cx="${f(x + Math.cos(a) * rx * l)}" cy="${f(y + Math.sin(a) * ry * l)}" r="${f(1.5 + r() * 3.5)}"/>`;
  }
  return `<g filter="url(#spill)"><g fill="#0b0a0a" opacity=".5">${d}</g></g><g fill="#0d0c0c" opacity=".45">${e}</g><g filter="url(#spill)"><ellipse cx="${x}" cy="${y}" rx="${f(rx * 0.6)}" ry="${f(ry * 0.6)}" fill="#0a0f16" opacity=".5"/></g>`;
}

/** The ring an old drum left. */
const drumRing = (x, y, R, c, o) => `<circle cx="${x}" cy="${y}" r="${R}" fill="none" stroke="${c}" stroke-width="6" opacity="${o}" filter="url(#spill)"/>`;

function floorColour(defs, w, h, cols, rows, seed) {
  const r = rng(seed);
  let s = `<rect width="${w}" height="${h}" fill="#000" filter="url(#concrete)"/>`;
  for (let y = 0; y < rows; y++)
    for (let x = 0; x < cols; x++) {
      const t = r();
      s += `<rect x="${x * C}" y="${y * C}" width="${C}" height="${C}" fill="${t < 0.5 ? '#000' : '#fff2d8'}" opacity="${f(0.012 + r() * 0.042)}"/>`;
    }
  s += `<rect width="${w}" height="${h}" fill="#000" filter="url(#dust)" opacity=".42"/>`;
  s += `<rect width="${w}" height="${h}" fill="#000" filter="url(#dirt)" opacity=".66"/>`;
  return { s, r };
}

export function ground() {
  const defs = new Defs();
  floorFilters(defs, GW, GH);
  const { s: base, r } = floorColour(defs, GW, GH, 8, 6, 2026);
  let s = base;
  // tyre tracks swinging across the yard
  const tracks = 'M-30 640C180 560 330 700 520 610S860 330 1190 400';
  for (const off of [-30, 30])
    s += `<path d="${tracks}" transform="translate(0 ${off})" fill="none" stroke="#0d0a07" stroke-width="22" stroke-dasharray="7 6" opacity=".13"/>`;
  // oil and old drums
  const pools = [
    [214, 196, 44, 30],
    [786, 112, 30, 22],
    [918, 566, 50, 34],
    [452, 742, 36, 24],
    [596, 330, 22, 17],
  ];
  for (const [x, y, rx, ry] of pools) s += oil(x, y, rx, ry, r);
  s +=
    drumRing(668, 628, 40, '#6a3a20', 0.3) +
    drumRing(742, 646, 40, '#1a1410', 0.3) +
    drumRing(346, 84, 38, '#6a3a20', 0.26) +
    drumRing(1056, 268, 36, '#1a1410', 0.3);
  // faded corner marks on every spot
  let paint = '';
  for (let y = 0; y < 6; y++) for (let x = 0; x < 8; x++) paint += marks(x * C, y * C);
  s += `<g stroke="#e7c35a" opacity=".5" filter="url(#worn)">${paint}</g>`;
  // cracks and joints in colour, a dark line each
  let cuts = '';
  for (let i = 0; i < 11; i++) {
    const x = Math.round(r() * 8) * C + (r() - 0.5) * 60;
    const y = Math.round(r() * 6) * C + (r() - 0.5) * 60;
    cuts += crackPaths(r, x, y, r() * 6.28, 5 + Math.floor(r() * 6));
  }
  const seams = joints(GW, GH, 8, 6);
  s += `<g filter="url(#rough)"><path d="${seams}" stroke="#0c0906" stroke-width="2.4" opacity=".5" fill="none"/></g>`;
  s += `<g stroke="#0e0a07" stroke-linecap="round" opacity=".6" fill="none">${cuts}</g>`;
  // grit: stones and flakes of metal
  for (let i = 0; i < 300; i++) {
    const x = r() * GW,
      y = r() * GH,
      sz = 0.8 + r() * r() * 3;
    const tone = ['#6f655a', '#958a7a', '#2e2820', '#b3a692', '#5a4530'][Math.floor(r() * 5)];
    s += `<circle cx="${f(x)}" cy="${f(y)}" r="${f(sz)}" fill="${tone}" opacity="${f(0.45 + r() * 0.4)}"/>`;
  }
  // weeds where the joints meet
  for (const [cx, cy] of [
    [1, 1],
    [3, 5],
    [6, 2],
    [2, 3],
    [7, 4],
    [5, 5],
    [7, 1],
    [1, 4],
  ])
    s += weed(r, cx * C + (r() - 0.5) * 8, cy * C + (r() - 0.5) * 8);
  // raking light over all of it
  const sketch = `<rect width="${GW}" height="${GH}" fill="#fff"/><g filter="url(#rough)"><path d="${seams}" stroke="#2a2a2a" stroke-width="3.4" fill="none"/></g><g stroke="#000" stroke-linecap="round" fill="none">${cuts}</g>`;
  s += `<g style="mix-blend-mode:multiply"><g filter="url(#relief)">${sketch}</g></g>`;
  // the light falls off to the fence
  const v = defs.rad(
    [
      [0, '#ffd9a8', 0.07],
      [0.45, '#ffd9a8', 0.015],
      [0.72, '#000', 0.14],
      [1, '#000', 0.56],
    ],
    GW / 2,
    GH * 0.48,
    Math.hypot(GW, GH) * 0.56,
  );
  s += `<rect width="${GW}" height="${GH}" fill="${v}"/>`;
  s += `<rect x="3" y="3" width="${GW - 6}" height="${GH - 6}" fill="none" stroke="#0c0906" stroke-width="10" opacity=".55" filter="url(#b6)"/>`;
  s += `<rect x="1.5" y="1.5" width="${GW - 3}" height="${GH - 3}" fill="none" stroke="#4d463c" stroke-width="3"/>`;
  return { defs, body: s };
}

/** One spot on its own: the tile the clip and the tips demo lay in rows. */
export function tile() {
  const defs = new Defs();
  floorFilters(defs, C, C);
  // no crack or stain here: the small yards repeat this one frame, and a repeated mark shows at once
  const { s: base } = floorColour(defs, C, C, 1, 1, 7);
  let s = base;
  s += `<g stroke="#e7c35a" opacity=".5" filter="url(#worn)">${marks(0, 0)}</g>`;
  s += `<g style="mix-blend-mode:multiply"><g filter="url(#relief)"><rect width="${C}" height="${C}" fill="#fff"/></g></g>`;
  s += `<rect x="0.75" y="0.75" width="${C - 1.5}" height="${C - 1.5}" fill="none" stroke="#0b0806" stroke-width="1.8" opacity=".7"/>`;
  return { defs, body: s };
}
