// Press, splitter, dock and tuner. See machines.mjs for the rules every machine follows.
import { Defs, bolt, cham, circle, f, hazard, part, poly, rng, rr, well } from './lib.mjs';
import { contact, corners, finish, sheen, steelH } from './machines.mjs';
import { portIn, portOut } from './ports.mjs';

// ---------- press: a steel-blue frame; a chrome ram runs down the chamber onto an anvil, north to south ----------
export function press(drop) {
  const defs = new Defs();
  const body = rr(12, 6, 120, 132, 12);
  let b = contact(body);
  b += part(body, sheen(defs, '#6f8fb0', '#4f6b8a', '#2a3a4c'), { shade: 0, bevel: 'bevelL', lineW: 2.2 });
  // the chamber
  const chamber = rr(24, 28, 96, 92, 5);
  b += well(defs, chamber, '#141a21', { width: 10, depth: 'b4', opacity: 1 });
  // guide rails down both sides of the chamber
  const guide = defs.lin(
    [
      [0, '#39424b'],
      [0.5, '#9fb0bf'],
      [1, '#39424b'],
    ],
    0,
    28,
    0,
    120,
  );
  b += `<rect x="28" y="30" width="5" height="88" fill="${guide}"/><rect x="111" y="30" width="5" height="88" fill="${guide}"/>`;
  // anvil
  const anvil = rr(30, 100, 84, 18, 2.5);
  b += part(anvil, steelH(defs, 30, 114), { shade: 0.7, blur: 'b2', bevel: 'bevelS' });
  b += `<rect x="36" y="103" width="72" height="2" fill="#fff" opacity=".25"/>`;
  // plate on the anvil, thinner as the ram lands
  const pt = drop >= 32 ? 96 : drop >= 16 ? 93 : 90;
  const plate = rr(42 - drop / 8, pt, 60 + drop / 4, 100 - pt, 1.5);
  b += part(plate, '#7f9bb8', { shade: 0.5, blur: 'b1_5', bevel: 'bevelS', lineW: 1.2 });
  // cylinder across the top, rod, ram head
  const headY = 40 + drop;
  const rodFill = defs.lin(
    [
      [0, '#5f6a75'],
      [0.38, '#eef3f6'],
      [0.62, '#eef3f6'],
      [1, '#5f6a75'],
    ],
    60,
    0,
    84,
    0,
  );
  b += `<rect x="60" y="20" width="24" height="${headY - 18}" fill="${rodFill}" stroke="#10151a" stroke-width="1.2"/>`;
  const cyl = rr(28, 8, 88, 22, 6);
  const cylFill = defs.lin(
    [
      [0, '#222e3a'],
      [0.3, '#7f99b2'],
      [0.5, '#93adc4'],
      [0.7, '#7f99b2'],
      [1, '#222e3a'],
    ],
    0,
    8,
    0,
    30,
  );
  b += part(cyl, cylFill, { shade: 0.6, blur: 'b2', bevel: 'bevelS', lineW: 1.6 });
  for (let i = 0; i < 5; i++) b += bolt(40 + i * 16, 19, 2.3);
  const head = rr(30, headY, 84, 20, 3);
  b += part(head, steelH(defs, 30, 114), { shade: 0.75, blur: 'b3', bevel: 'bevelS' });
  b += hazard(defs, rr(34, headY + 13, 76, 5, 1), { pitch: 11 });
  let s = finish(b, 4);
  if (drop >= 32) {
    s += `<rect x="40" y="${headY + 18}" width="64" height="9" fill="#ffd27a" opacity=".55" filter="url(#b4)"/>`;
    const sp = rng(14);
    for (let i = 0; i < 8; i++) s += `<circle cx="${f(36 + sp() * 72)}" cy="${f(headY + 18 + sp() * 10)}" r="${f(0.7 + sp() * 0.9)}" fill="#ffe9b8"/>`;
  }
  s += portIn(defs, 20) + portOut(defs, 20);
  return { defs, body: s };
}

// ---------- splitter: a teal junction box; the line comes in on the west and forks to north and south ----------
export function splitter(toSouth) {
  const defs = new Defs();
  const body = cham(14, 14, 116, 116, 30);
  let b = contact(body);
  b += part(body, sheen(defs, '#7cc0ae', '#4a8a7c', '#234a43'), { shade: 0, bevel: 'bevelL', lineW: 2.2 });
  // a hatch with louvres on the closed east side
  const hatch = rr(100, 52, 24, 40, 3);
  b += part(hatch, '#35665c', { shade: 0.5, blur: 'b1_5', bevel: 'bevelS', lineW: 1.3 });
  for (let i = 0; i < 4; i++) b += `<rect x="105" y="${58 + i * 7.6}" width="14" height="3.4" rx="1" fill="#10201d"/>`;
  // the fork: a dark channel with a steel rim
  const fork = 'M14 72H56C70 72 72 62 72 48V14M72 96V130M56 72C70 72 72 82 72 96';
  b += `<path d="${fork}" fill="none" stroke="#0c1311" stroke-width="42" opacity=".45" filter="url(#b3)"/>`;
  b += `<path d="${fork}" fill="none" stroke="#2c4a44" stroke-width="35"/><path d="${fork}" fill="none" stroke="#9cc4ba" stroke-width="33" opacity=".35"/>`;
  b += `<path d="${fork}" fill="none" stroke="#10201d" stroke-width="29"/>`;
  for (const [x, y] of [
    [28, 30],
    [28, 114],
    [46, 22],
    [46, 122],
    [114, 34],
    [114, 110],
  ])
    b += bolt(x, y, 2.5);
  let s = finish(b, 5);
  const lit = (d, on) =>
    `${on ? `<path d="${d}" fill="none" stroke="#ff9d2e" stroke-width="11" opacity=".75" filter="url(#b3)"/>` : ''}<path d="${d}" fill="none" stroke="${on ? '#ffbf45' : '#6f5a30'}" stroke-width="7.5" stroke-linecap="round"/>`;
  const north = 'M22 72H56C68 72 72 62 72 50V30';
  const south = 'M22 72H56C68 72 72 82 72 94V114';
  s += lit(toSouth ? north : south, false) + lit(toSouth ? south : north, true);
  // the hub and its flap, which leans toward the way the next item goes
  s += `<circle cx="72" cy="72" r="26" fill="#050807" opacity=".75" filter="url(#b3)"/>`;
  const hub = defs.rad(
    [
      [0, '#d3dbdf'],
      [0.6, '#8d979f'],
      [1, '#3c444b'],
    ],
    72,
    72,
    20,
  );
  s += part(circle(72, 72, 20), hub, { shade: 0, bevel: 'bevelS', lineW: 1.8 });
  const deg = toSouth ? 42 : -42;
  s += `<g transform="rotate(${deg} 72 72)"><path d="${rr(52, 66, 42, 12, 5)}" fill="#ffbf45" stroke="#2a1a08" stroke-width="1.4"/><path d="${rr(56, 68, 34, 3, 1.5)}" fill="#ffe6ae"/></g>`;
  s += `<circle cx="72" cy="72" r="5" fill="#2a2f33" stroke="#0e1012" stroke-width="1"/><circle cx="72" cy="72" r="1.8" fill="#8d979f"/>`;
  s += portIn(defs, 20);
  s += `<g transform="rotate(-90 72 72)">${portOut(defs, 20)}</g><g transform="rotate(90 72 72)">${portOut(defs, 20)}</g>`;
  return { defs, body: s };
}

// ---------- dock: a green bay with a pallet of crates; it takes a line from any side ----------
export function dock() {
  const defs = new Defs();
  const body = cham(5, 5, 134, 134, 12);
  let b = contact(body, 0.8);
  b += part(body, sheen(defs, '#4f9a68', '#357a50', '#1d4630'), { shade: 0, bevel: 'bevelL', lineW: 2.2 });
  // hazard lip
  const lip = 'M22 12H122L132 22V122L122 132H22L12 122V22ZM26 24L24 26V118L26 120H118L120 118V26L118 24Z';
  b += `<path d="${lip}" fill-rule="evenodd" fill="#183a28"/>`;
  // the bay floor
  const floor = rr(24, 24, 96, 96, 4);
  b += well(defs, floor, '#14241b', { width: 9, depth: 'b3', opacity: 0.9 });
  // inward chevrons on all four sides: any side takes a line
  const inward = poly([
    [-15, -5],
    [0, 4],
    [15, -5],
    [15, 1],
    [0, 10],
    [-15, 1],
  ]);
  for (const a of [0, 90, 180, 270]) b += `<g transform="rotate(${a} 72 72) translate(72 17)"><path d="${inward}" fill="#8ff0ae"/></g>`;
  // the pallet
  const crate = (x, y, w, h, tone) => {
    const d = rr(x, y, w, h, 1.5);
    const fill = defs.lin(
      [
        [0, tone[1]],
        [0.5, tone[0]],
        [1, tone[1]],
      ],
      x,
      y,
      x + w,
      y + h,
    );
    let c = part(d, fill, { shade: 0.7, blur: 'b2', bevel: 'bevelS', line: '#3a2610', lineW: 1.3 });
    const n = Math.round(w / 9);
    for (let i = 1; i < n; i++) c += `<rect x="${f(x + (i * w) / n)}" y="${y + 1}" width="1" height="${h - 2}" fill="#6a4a20" opacity=".65"/>`;
    c += `<rect x="${x + 1.5}" y="${f(y + h * 0.5 - 2)}" width="${w - 3}" height="4" fill="#4a3a26" opacity=".55"/>`;
    for (const [px, py] of [
      [x + 3.5, y + 3.5],
      [x + w - 3.5, y + 3.5],
      [x + 3.5, y + h - 3.5],
      [x + w - 3.5, y + h - 3.5],
    ])
      c += `<circle cx="${f(px)}" cy="${f(py)}" r="1.1" fill="#3a2610"/>`;
    return c;
  };
  const wood = ['#e0ba74', '#a87e3e'];
  const wood2 = ['#cfa55e', '#8f6a32'];
  b += `<path d="${rr(34, 36, 76, 72, 3)}" fill="#000" opacity=".55" filter="url(#b3)"/>`;
  b += crate(34, 66, 37, 42, wood2);
  b += crate(73, 66, 37, 42, wood);
  b += crate(48, 34, 48, 32, wood);
  let s = finish(b, 6);
  s += corners(14, 130, 2.8);
  return { defs, body: s };
}

// ---------- tuner: a violet instrument case; a gauge in the middle and a copper coil toward each neighbour it speeds up ----------
export function tuner() {
  const defs = new Defs();
  const body = cham(12, 12, 120, 120, 34);
  let b = contact(body);
  b += part(body, sheen(defs, '#8a80ad', '#5f5780', '#332e4a'), { shade: 0, bevel: 'bevelL', lineW: 2.2 });
  const coil = (a) => {
    let c = `<g transform="rotate(${a} 72 72)">`;
    c += `<rect x="60" y="4" width="24" height="22" rx="2" fill="#0d0b12" opacity=".6" filter="url(#b2)"/>`;
    for (let i = 0; i < 6; i++) c += `<rect x="62" y="${6 + i * 3.4}" width="20" height="2.6" rx="1.2" fill="#d9925a" stroke="#4a2410" stroke-width=".7"/>`;
    c += `<rect x="66" y="3" width="12" height="3.4" rx="1.2" fill="#d7f2ff" stroke="#5a7a8a" stroke-width=".6"/>`;
    return `${c}</g>`;
  };
  for (const a of [0, 90, 180, 270]) b += coil(a);
  let s = finish(b, 7);
  // the gauge
  s += `<circle cx="72" cy="72" r="41" fill="#0b0a10" opacity=".7" filter="url(#b3)"/>`;
  const ring = defs.rad(
    [
      [0.8, '#59626a'],
      [0.9, '#cdd6dc'],
      [1, '#4a525a'],
    ],
    72,
    72,
    37,
  );
  s += part(circle(72, 72, 37), ring, { shade: 0, bevel: 'bevelS', lineW: 1.8 });
  const dial = defs.rad(
    [
      [0, '#2b2840'],
      [0.8, '#191726'],
      [1, '#0d0b14'],
    ],
    72,
    72,
    31,
  );
  s += `<circle cx="72" cy="72" r="31" fill="${dial}"/>`;
  // scale: seven ticks and a hot end
  for (let i = 0; i <= 8; i++) {
    const a = ((-210 + i * 30) * Math.PI) / 180;
    const x0 = 72 + Math.cos(a) * 25,
      y0 = 72 + Math.sin(a) * 25,
      x1 = 72 + Math.cos(a) * (i % 2 ? 28 : 29.5),
      y1 = 72 + Math.sin(a) * (i % 2 ? 28 : 29.5);
    s += `<path d="M${f(x0)} ${f(y0)}L${f(x1)} ${f(y1)}" stroke="${i >= 7 ? '#ffb53c' : '#d7d4e6'}" stroke-width="${i % 2 ? 1.4 : 2}" stroke-linecap="round"/>`;
  }
  const a = (-48 * Math.PI) / 180;
  const nx = 72 + Math.cos(a) * 24,
    ny = 72 + Math.sin(a) * 24;
  s += `<path d="M72 72L${f(nx)} ${f(ny)}" stroke="#ff9d2e" stroke-width="7" opacity=".5" filter="url(#b2)"/>`;
  s += `<path d="M72 72L${f(nx)} ${f(ny)}" stroke="#ffbf45" stroke-width="3.2" stroke-linecap="round"/>`;
  s += `<circle cx="72" cy="72" r="5.4" fill="#ffbf45" stroke="#3a2408" stroke-width="1.2"/><circle cx="72" cy="72" r="2" fill="#3a2408"/>`;
  s += bolt(32, 32, 2.8) + bolt(112, 32, 2.8) + bolt(32, 112, 2.8) + bolt(112, 112, 2.8);
  return { defs, body: s };
}
