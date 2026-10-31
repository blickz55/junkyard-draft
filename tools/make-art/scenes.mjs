// The title's hero and the page background. The hero is a scrapyard at dusk: a low sun behind a crawler crane, stacks of baled
// cars, a conveyor climbing to a hopper, work lamps coming on. Its left third falls into shadow so light text can sit on it.
// The background is the yard's own floor at night, out of focus, so the page around the board is not flat colour.
import { Defs, f, poly, rng } from './lib.mjs';

export const HERO_W = 1200;
export const HERO_H = 420;
export const BG_W = 1280;
export const BG_H = 800;
const W = HERO_W,
  H = HERO_H;
const SUN = [968, 286];

/** Mix two #rrggbb colours. */
function mix(a, b, t) {
  const p = (c) => [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16)];
  const [x, y] = [p(a), p(b)];
  return `#${x
    .map((v, i) =>
      Math.round(v + (y[i] - v) * t)
        .toString(16)
        .padStart(2, '0'),
    )
    .join('')}`;
}
/** How much of the low sun reaches a point. */
const sunlight = (x, y) => Math.exp(-Math.hypot(x - SUN[0], (y - SUN[1]) * 1.4) / 330);

const CAR = ['#5c6c78', '#7a4436', '#3f5563', '#9a6a44', '#6a6a60', '#8a3f30', '#46596a', '#a8805a', '#574a44'];

/** One baled car seen from the side: squashed bands of colour under a lit top edge. */
function bale(defs, r, x, y, w, h, shadow) {
  const id = defs.id('c');
  const outline = poly([
    [x + (r() - 0.5) * 2, y + (r() - 0.5) * 2],
    [x + w * 0.4, y + (r() - 0.5) * 2.4],
    [x + w + (r() - 0.5) * 2, y + (r() - 0.5) * 2],
    [x + w + (r() - 0.5) * 3, y + h * 0.55],
    [x + w + (r() - 0.5) * 2, y + h + (r() - 0.5) * 1.5],
    [x + w * 0.5, y + h + (r() - 0.5) * 1.5],
    [x + (r() - 0.5) * 2, y + h + (r() - 0.5) * 1.5],
    [x + (r() - 0.5) * 3, y + h * 0.45],
  ]);
  defs.push(`<clipPath id="${id}"><path d="${outline}"/></clipPath>`);
  const light = sunlight(x + w / 2, y);
  const tint = mix(shadow, '#ff9a4d', light * 0.55);
  let s = `<g clip-path="url(#${id})"><rect x="${f(x)}" y="${f(y)}" width="${f(w)}" height="${f(h)}" fill="${mix(shadow, CAR[Math.floor(r() * CAR.length)], 0.3)}"/>`;
  let py = y - 2;
  while (py < y + h) {
    const bh = 2.5 + r() * 6;
    const pts = [[x - 2, py]];
    for (let px = x; px < x + w + 6; px += 6 + r() * 8) pts.push([px, py + (r() - 0.5) * 3.4]);
    pts.push([x + w + 2, py + bh + 2], [x - 2, py + bh + 2]);
    s += `<path d="${poly(pts)}" fill="${mix(CAR[Math.floor(r() * CAR.length)], tint, 0.42)}"/>`;
    py += bh;
  }
  for (let i = 0; i < 3; i++) {
    const cx = x + r() * w;
    s += `<path d="M${f(cx)} ${f(y)}L${f(cx + (r() - 0.5) * 7)} ${f(y + h)}" stroke="#0c0808" stroke-width="${f(0.7 + r())}" opacity=".5"/>`;
  }
  // the dark side away from the sun
  const away = x + w / 2 < SUN[0] ? 'left' : 'right';
  const g = defs.lin(
    [
      [0, shadow, away === 'left' ? 0.72 : 0],
      [1, shadow, away === 'left' ? 0 : 0.72],
    ],
    x,
    0,
    x + w,
    0,
  );
  s += `<rect x="${f(x)}" y="${f(y)}" width="${f(w)}" height="${f(h)}" fill="${g}"/></g>`;
  s += `<path d="M${f(x)} ${f(y + 0.6)}H${f(x + w)}" stroke="${mix('#6a3a30', '#ffc27a', Math.min(1, light * 1.6))}" stroke-width="${f(0.8 + light * 1.2)}"/>`;
  s += `<path d="${outline}" fill="none" stroke="#0c0808" stroke-width="1" opacity=".85"/>`;
  return s;
}

/** A stack of bales: rows from `base` up, each row shorter and a little out of line. */
function stack(defs, r, x, w, base, rows, bw, bh, shadow) {
  let s = '';
  for (let row = 0; row < rows; row++) {
    const inset = row * bw * (0.1 + r() * 0.35);
    const span = w - inset * 2;
    const n = Math.max(1, Math.round(span / bw));
    const each = span / n;
    for (let i = 0; i < n; i++) {
      if (row > 0 && r() < 0.12) continue;
      const h = bh * (0.88 + r() * 0.24);
      s += bale(defs, r, x + inset + i * each + (r() - 0.5) * 3, base - (row + 1) * bh - (r() - 0.5) * 2, each - 1.5, h, shadow);
    }
  }
  return s;
}

/** A lattice: two chords and zigzag members between them. */
function lattice(x0, y0, x1, y1, width, n, stroke, sw) {
  const dx = x1 - x0,
    dy = y1 - y0,
    len = Math.hypot(dx, dy);
  const nx = (-dy / len) * width,
    ny = (dx / len) * width;
  let d = `M${f(x0)} ${f(y0)}L${f(x1)} ${f(y1)}M${f(x0 + nx)} ${f(y0 + ny)}L${f(x1 + nx * 0.3)} ${f(y1 + ny * 0.3)}`;
  for (let i = 0; i < n; i++) {
    const t0 = i / n,
      t1 = (i + 0.5) / n,
      t2 = (i + 1) / n;
    const k = (t) => 1 - t * 0.7;
    d += `M${f(x0 + dx * t0)} ${f(y0 + dy * t0)}L${f(x0 + dx * t1 + nx * k(t1))} ${f(y0 + dy * t1 + ny * k(t1))}L${f(x0 + dx * t2)} ${f(y0 + dy * t2)}`;
  }
  return `<path d="${d}" fill="none" stroke="${stroke}" stroke-width="${sw}" stroke-linecap="round"/>`;
}

/** A work lamp on a pole: a hot head and a soft pool of light. */
function lamp(defs, x, top, base, side) {
  const pool = defs.rad(
    [
      [0, '#ffc266', 0.55],
      [0.4, '#ff9a3c', 0.2],
      [1, '#ff9a3c', 0],
    ],
    x + side * 16,
    top + 4,
    120,
  );
  const cone = poly([
    [x + side * 14, top + 4],
    [x + side * 150, base + 10],
    [x - side * 40, base + 10],
  ]);
  return `<path d="${cone}" fill="#ffb255" opacity=".1" filter="url(#b8)"/><circle cx="${x + side * 16}" cy="${top + 4}" r="120" fill="${pool}"/>
    <path d="M${x} ${base}V${top}H${x + side * 16}" fill="none" stroke="#120d0c" stroke-width="3.4"/><rect x="${x + side * 16 - 9}" y="${top}" width="18" height="7" rx="1.5" fill="#1a1312"/>
    <rect x="${x + side * 16 - 7}" y="${top + 5}" width="14" height="3.4" rx="1" fill="#fff0c0"/><rect x="${x + side * 16 - 12}" y="${top + 2}" width="24" height="9" fill="#ffd27a" opacity=".85" filter="url(#b4)"/>`;
}

function skyline(r) {
  // far works on the horizon: stacks, a cooling tower, sheds
  let s = '';
  const base = 300;
  const pts = [[0, base]];
  let x = 0;
  while (x < W) {
    const kind = r();
    const w = 20 + r() * 46;
    const h = 8 + r() * 26;
    if (kind < 0.6) {
      pts.push([x, base - h], [x + w * 0.6, base - h - 6], [x + w, base - h]);
    } else {
      pts.push([x, base - h], [x, base - h - 10], [x + w, base - h - 10], [x + w, base - h]);
    }
    x += w;
  }
  pts.push([W, base]);
  s += `<path d="${poly(pts)}" fill="#3e2433" opacity=".92"/>`;
  for (const [cx, h, w] of [
    [560, 106, 9],
    [590, 84, 8],
    [1086, 96, 10],
    [1120, 118, 11],
    [700, 70, 7],
  ])
    s += `<path d="${poly([
      [cx - w, base],
      [cx - w * 0.7, base - h],
      [cx + w * 0.7, base - h],
      [cx + w, base],
    ])}" fill="#3a2230"/>`;
  s += `<path d="M640 300C652 262 654 244 648 214H720C714 244 716 262 728 300Z" fill="#40263a"/>`;
  return s;
}

export function hero() {
  const defs = new Defs();
  const r = rng(1970);
  defs.push(`<filter id="cloud" filterUnits="userSpaceOnUse" x="0" y="0" width="${W}" height="${H}" color-interpolation-filters="sRGB">
    <feTurbulence type="fractalNoise" baseFrequency="0.0032 0.021" numOctaves="5" seed="14" result="n"/>
    <feColorMatrix in="n" type="matrix" values="0 0 0 0 1  0 0 0 0 0.58  0 0 0 0 0.36  3.6 0 0 0 -1.86" result="c"/>
    <feComposite in="c" in2="SourceAlpha" operator="in"/>
  </filter>`);
  defs.push(`<filter id="smoke" filterUnits="userSpaceOnUse" x="0" y="0" width="${W}" height="${H}" color-interpolation-filters="sRGB">
    <feTurbulence type="fractalNoise" baseFrequency="0.012 0.02" numOctaves="4" seed="3" result="n"/>
    <feDisplacementMap in="SourceGraphic" in2="n" scale="46" xChannelSelector="R" yChannelSelector="G"/>
    <feGaussianBlur stdDeviation="6"/>
  </filter>`);
  const sky = defs.lin(
    [
      [0, '#0e1024'],
      [0.32, '#2a1d3f'],
      [0.52, '#71304a'],
      [0.66, '#c8533a'],
      [0.74, '#f48a3a'],
      [0.8, '#ffb65c'],
    ],
    0,
    0,
    0,
    H,
  );
  let s = `<rect width="${W}" height="${H}" fill="${sky}"/>`;
  const fade = defs.lin(
    [
      [0, '#fff', 0.15],
      [0.45, '#fff', 0.8],
      [0.72, '#fff', 1],
      [1, '#fff', 0],
    ],
    0,
    0,
    0,
    310,
  );
  s += `<rect width="${W}" height="310" fill="${fade}" filter="url(#cloud)" opacity=".75"/>`;
  const sun = defs.rad(
    [
      [0, '#fff6d0'],
      [0.05, '#ffe9a8'],
      [0.14, '#ffc266', 0.9],
      [0.4, '#ff8a3a', 0.45],
      [1, '#ff6a2a', 0],
    ],
    SUN[0],
    SUN[1],
    520,
  );
  s += `<rect width="${W}" height="${H}" fill="${sun}"/>`;
  s += `<circle cx="${SUN[0]}" cy="${SUN[1]}" r="34" fill="#fff4cf"/>`;
  s += skyline(r);
  for (let i = 0; i < 46; i++)
    s += `<rect x="${f(430 + r() * 720)}" y="${f(268 + r() * 26)}" width="1.6" height="1.6" fill="#ffd28a" opacity="${f(0.3 + r() * 0.5)}"/>`;
  // a few gulls working the yard
  for (const [gx, gy, gs] of [
    [612, 104, 5],
    [640, 92, 4],
    [662, 112, 3.4],
    [700, 84, 3],
    [1132, 112, 3.6],
  ])
    s += `<path d="M${gx - gs} ${gy - gs * 0.4}Q${gx - gs * 0.4} ${gy - gs * 0.8} ${gx} ${gy}Q${gx + gs * 0.4} ${gy - gs * 0.8} ${gx + gs} ${gy - gs * 0.4}" fill="none" stroke="#17101a" stroke-width="1.2"/>`;
  // haze over the far works, and smoke from them
  const haze = defs.lin(
    [
      [0, '#ff9a4d', 0],
      [1, '#ff9a4d', 0.46],
    ],
    0,
    210,
    0,
    306,
  );
  s += `<rect y="210" width="${W}" height="96" fill="${haze}"/>`;
  s += `<path d="M586 190C600 150 640 130 700 112S860 70 980 74" fill="none" stroke="#5a3346" stroke-width="30" opacity=".5" filter="url(#smoke)"/>`;
  // ground plane
  const earth = defs.lin(
    [
      [0, '#3a2219'],
      [0.25, '#20130f'],
      [1, '#0d0908'],
    ],
    0,
    300,
    0,
    H,
  );
  s += `<rect y="300" width="${W}" height="${H - 300}" fill="${earth}"/>`;
  const shine = defs.rad(
    [
      [0, '#ff9a4d', 0.5],
      [1, '#ff9a4d', 0],
    ],
    SUN[0],
    312,
    360,
  );
  s += `<ellipse cx="${SUN[0]}" cy="312" rx="430" ry="60" fill="${shine}"/>`;
  // back rows of bales, in the haze
  s += stack(defs, r, 410, 250, 318, 4, 44, 19, '#4a2a2c');
  s += stack(defs, r, 820, 210, 322, 3, 40, 17, '#5a3028');
  s += `<rect y="228" width="${W}" height="96" fill="${haze}" opacity=".5"/>`;
  // the crane
  const ink = '#140d0c';
  const ax = 906,
    ay = 306,
    tx = 1064,
    ty = 44;
  s += `<path d="M892 262L874 182L${tx} ${ty}" fill="none" stroke="${ink}" stroke-width="1.6"/><path d="M874 182L${tx - 12} ${ty + 8}" fill="none" stroke="${ink}" stroke-width="1.1"/>`;
  s += lattice(ax, ay - 16, tx, ty, 13, 15, ink, 2.1);
  s += `<path d="M${tx} ${ty}V206" stroke="${ink}" stroke-width="1.8"/><path d="M${tx + 3} ${ty + 2}V206" stroke="${ink}" stroke-width="1"/>`;
  // rim of sun on the sun-side chord
  s += `<path d="M${ax + 4} ${ay - 22}L${tx - 1} ${ty + 2}" stroke="#ffb65c" stroke-width="1" opacity=".55"/>`;
  // the magnet and the car it holds
  s += `<path d="M1042 214H1086L1094 232H1034Z" fill="${ink}"/><rect x="1050" y="206" width="28" height="9" rx="2" fill="#1d1412"/>`;
  s += bale(defs, r, 1022, 232, 84, 30, '#3a2022');
  // cab and tracks
  s += `<path d="M866 292H950V270L938 252H886L866 272Z" fill="${ink}"/><path d="M904 260H932L940 271H904Z" fill="#ffb65c"/><path d="M904 260H918V271H904Z" fill="#ffe2a8"/><path d="M904 260H932L940 271H904Z" fill="#ffa64a" opacity=".5" filter="url(#b4)"/>`;
  s += `<rect x="852" y="294" width="124" height="20" rx="10" fill="#0f0a09"/><rect x="852" y="294" width="124" height="20" rx="10" fill="none" stroke="#5a3226" stroke-width="1.2"/>`;
  for (let i = 0; i < 6; i++) s += `<circle cx="${866 + i * 19.4}" cy="304" r="6" fill="#1f1512" stroke="#3a241c" stroke-width="1"/>`;
  // conveyor climbing to the hopper
  const b0 = [462, 372],
    b1 = [742, 196];
  s += lattice(b0[0], b0[1], b1[0], b1[1], 15, 12, '#0f0a09', 2.2);
  for (const [x, y0] of [
    [560, 312],
    [650, 254],
    [730, 204],
  ])
    s += `<path d="M${x} ${y0}V${380}" stroke="#100b0a" stroke-width="4.4"/><path d="M${x - 16} 380L${x} ${y0 + 40}L${x + 16} 380" fill="none" stroke="#100b0a" stroke-width="2.2"/>`;
  const dir = [b1[0] - b0[0], b1[1] - b0[1]];
  const L = Math.hypot(...dir);
  const u = [dir[0] / L, dir[1] / L];
  s += `<path d="M${b0[0]} ${b0[1]}L${b1[0]} ${b1[1]}" stroke="#1d1412" stroke-width="7"/><path d="M${b0[0]} ${b0[1] - 3}L${b1[0]} ${b1[1] - 3}" stroke="#ffae66" stroke-width="1.2" opacity=".65"/>`;
  for (let i = 1; i < 11; i++) {
    const t = i / 11;
    const x = b0[0] + dir[0] * t,
      y = b0[1] + dir[1] * t;
    const c = r();
    if (c < 0.8)
      s += `<rect x="${f(x - 5)}" y="${f(y - 9 - r() * 2)}" width="${f(8 + r() * 5)}" height="${f(5 + r() * 3)}" fill="${['#2a1b16', '#3a2318', '#1f1512'][Math.floor(r() * 3)]}" transform="rotate(-32 ${f(x)} ${f(y)})"/>`;
  }
  void u;
  // hopper at the top, on legs
  s += `<path d="M734 142H832L806 206H760Z" fill="#1a1110"/><path d="M734 142H832" stroke="#ffb06a" stroke-width="1.6" opacity=".8"/><path d="M764 206V380M802 206V380" stroke="#120c0b" stroke-width="5"/><path d="M764 250L802 300M802 250L764 300" stroke="#120c0b" stroke-width="2.4"/>`;
  s += `<path d="M744 142L760 124L786 134L806 120L824 142Z" fill="#20140f"/>`;
  // the scrap mountain the conveyor is fed from
  const hill = [[330, 372]];
  for (let hx = 340; hx < 640; hx += 9 + r() * 9) {
    const t = (hx - 330) / 310;
    hill.push([hx, 372 - Math.sin(t * Math.PI) ** 0.7 * 92 + (r() - 0.5) * 11]);
  }
  hill.push([650, 372]);
  const hillFill = defs.lin(
    [
      [0, '#3a241c'],
      [1, '#120c0b'],
    ],
    0,
    280,
    0,
    372,
  );
  s += `<path d="${poly(hill)}" fill="${hillFill}" stroke="#ff9d55" stroke-width=".8" stroke-opacity=".5"/>`;
  for (let i = 0; i < 38; i++) {
    const a = r(),
      hx = 350 + a * 280,
      hy = 372 - Math.sin(a * Math.PI) ** 0.7 * 92 * (0.25 + r() * 0.75) - 2;
    const c = ['#6a3a2a', '#4a3a36', '#7a5238', '#3a3438', '#8a4a30'][Math.floor(r() * 5)];
    s += `<path d="${poly([
      [hx - 6 - r() * 6, hy + r() * 4],
      [hx - r() * 3, hy - 4 - r() * 5],
      [hx + 6 + r() * 7, hy - r() * 3],
      [hx + 4 + r() * 3, hy + 5],
    ])}" fill="${c}" stroke="#120b0a" stroke-width=".8"/>`;
  }
  // near stacks: dark on the left for the text, warmer toward the sun
  s += stack(defs, r, -24, 300, 364, 5, 60, 27, '#160e10');
  s += stack(defs, r, 250, 216, 374, 3, 58, 26, '#1b1012');
  s += stack(defs, r, 1000, 240, 372, 3, 62, 26, '#2a1614');
  // lamps
  s += lamp(defs, 322, 176, 372, 1) + lamp(defs, 842, 150, 340, -1);
  // foreground heap
  const heap = [[0, H]];
  let x = 0;
  while (x < W + 20) {
    heap.push([x, 392 + Math.sin(x * 0.012) * 8 - (x > 500 && x < 780 ? 14 : 0) + (r() - 0.5) * 14]);
    x += 8 + r() * 22;
  }
  heap.push([W, H]);
  s += `<path d="${poly(heap)}" fill="#090605"/>`;
  for (let i = 0; i < 26; i++) {
    const cx = r() * W,
      cy = 386 + r() * 20;
    s += `<circle cx="${f(cx)}" cy="${f(cy)}" r="${f(7 + r() * 9)}" fill="none" stroke="#0d0908" stroke-width="${f(3 + r() * 3)}"/>`;
  }
  s += `<path d="${poly(heap)}" fill="none" stroke="#7a3f28" stroke-width="1" opacity=".7"/>`;
  for (const [tx2, ty2, tr] of [
    [612, 372, 22],
    [650, 384, 19],
    [1140, 372, 20],
    [1090, 386, 17],
  ]) {
    s += `<circle cx="${tx2}" cy="${ty2}" r="${tr}" fill="#0a0706"/><circle cx="${tx2}" cy="${ty2}" r="${tr * 0.46}" fill="#2a1a15"/><path d="M${tx2 - tr * 0.8} ${ty2 - tr * 0.6}A${tr} ${tr} 0 0 1 ${tx2 + tr * 0.84} ${ty2 - tr * 0.54}" fill="none" stroke="#ffa564" stroke-width="1.4" opacity=".7"/>`;
  }
  s += `<path d="M780 402L796 366L866 360L884 400Z" fill="#0d0908" stroke="#6a3a26" stroke-width="1"/><path d="M802 372L858 368M806 382L862 378" stroke="#2a1a15" stroke-width="3"/><path d="M892 402L922 344M902 404L944 356M736 404L720 352" stroke="#150e0c" stroke-width="3.4"/><path d="M892 402L922 344" stroke="#ffa564" stroke-width="1" opacity=".6"/>`;
  // embers in the air near the lamps
  for (let i = 0; i < 44; i++) {
    const cx = 420 + r() * 640,
      cy = 120 + r() * 240;
    s += `<circle cx="${f(cx)}" cy="${f(cy)}" r="${f(0.5 + r() * 1)}" fill="#ffd9a0" opacity="${f(0.2 + r() * 0.5)}"/>`;
  }
  // the left third falls into shadow for the title; the edges close in
  const left = defs.lin(
    [
      [0, '#0c0908', 0.97],
      [0.26, '#0c0908', 0.86],
      [0.46, '#0c0908', 0.34],
      [0.62, '#0c0908', 0],
    ],
    0,
    0,
    W,
    0,
  );
  s += `<rect width="${W}" height="${H}" fill="${left}"/>`;
  const edges = defs.lin(
    [
      [0, '#0c0908', 0.55],
      [0.22, '#0c0908', 0],
      [0.8, '#0c0908', 0],
      [1, '#0c0908', 0.75],
    ],
    0,
    0,
    0,
    H,
  );
  s += `<rect width="${W}" height="${H}" fill="${edges}"/>`;
  return { defs, body: s };
}

export function yardBg() {
  const defs = new Defs();
  const r = rng(88);
  const box = `filterUnits="userSpaceOnUse" x="0" y="0" width="${BG_W}" height="${BG_H}" color-interpolation-filters="sRGB"`;
  defs.push(`<filter id="night" ${box}>
    <feTurbulence type="fractalNoise" baseFrequency="0.0065" numOctaves="5" seed="11" result="n"/>
    <feColorMatrix in="n" type="matrix" values="1.5 0 0 0 -0.25  1.5 0 0 0 -0.25  1.5 0 0 0 -0.25  0 0 0 0 1" result="g"/>
    <feComponentTransfer in="g" result="c">
      <feFuncR type="table" tableValues="0.082 0.108 0.135 0.165"/>
      <feFuncG type="table" tableValues="0.068 0.088 0.110 0.134"/>
      <feFuncB type="table" tableValues="0.054 0.068 0.084 0.102"/>
    </feComponentTransfer>
    <feTurbulence type="fractalNoise" baseFrequency="0.08" numOctaves="4" seed="4" result="b"/>
    <feDiffuseLighting in="b" surfaceScale="2.6" diffuseConstant="1.26" lighting-color="#fff8ee" result="l"><feDistantLight azimuth="235" elevation="54"/></feDiffuseLighting>
    <feComposite in="c" in2="l" operator="arithmetic" k1="1" k2="0" k3="0" k4="0"/>
  </filter>`);
  let s = `<rect width="${BG_W}" height="${BG_H}" fill="#000" filter="url(#night)"/>`;
  // tyre tracks swinging through
  for (const off of [-28, 28])
    s += `<path d="M-20 660C260 560 520 760 780 620S1120 300 1300 360" transform="translate(0 ${off})" fill="none" stroke="#050403" stroke-width="20" stroke-dasharray="6 6" opacity=".28"/>`;
  // grit
  for (let i = 0; i < 420; i++) {
    const tone = ['#2c261e', '#3a3228', '#120e0a', '#0c0a07'][Math.floor(r() * 4)];
    s += `<circle cx="${f(r() * BG_W)}" cy="${f(r() * BG_H)}" r="${f(0.9 + r() * r() * 3)}" fill="${tone}" opacity="${f(0.35 + r() * 0.4)}"/>`;
  }
  const warm = defs.rad(
    [
      [0, '#ffb066', 0.075],
      [0.55, '#ffb066', 0.02],
      [1, '#000', 0],
    ],
    BG_W * 0.42,
    BG_H * 0.42,
    BG_W * 0.62,
  );
  s += `<rect width="${BG_W}" height="${BG_H}" fill="${warm}"/>`;
  const v = defs.rad(
    [
      [0.45, '#000', 0],
      [1, '#000', 0.62],
    ],
    BG_W / 2,
    BG_H / 2,
    Math.hypot(BG_W, BG_H) * 0.55,
  );
  s += `<rect width="${BG_W}" height="${BG_H}" fill="${v}"/>`;
  return { defs, body: s };
}
