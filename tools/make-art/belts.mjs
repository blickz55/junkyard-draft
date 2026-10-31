// The conveyor: a straight run and its corner, each a static frame plus eight overlay frames that roll the belt. The belt is
// 60 px wide between 12 px rails and reaches the cell's edges, so a line of conveyors reads as one piece. The chevrons repeat
// every half cell and step an eighth of that per frame, on the corner along the arc, so a straight and a corner stay in phase.
import { CELL, MID, Defs, ao, bolt, f, part, poly, rr } from './lib.mjs';

export const BELT_TOP = 42;
export const BELT_BOT = 102;
export const RAIL = 12;
const PITCH = 72; // chevron repeat: half a cell
const RIB = 36; // cross ribs: they move a quarter of a rib per frame, so the eye reads them forward
const STEP = PITCH / 8;

const chevronPts = (x, y, l = 13, w = 21, t = 13) => [
  [x - l, y - w],
  [x - l + t, y - w],
  [x + l + t - 9, y],
  [x - l + t, y + w],
  [x - l, y + w],
  [x + l - 9, y],
];
/** A chevron at (x, y) turned by `deg`, with a soft dark bed so it stands off the rubber. */
function chevron(defs, x, y, deg = 0) {
  const d = poly(chevronPts(0, 0));
  return `<g transform="translate(${f(x)} ${f(y)}) rotate(${f(deg)})"><path d="${d}" fill="#080503" opacity=".75" filter="url(#b1_5)"/><path d="${d}" fill="${defs.chev}"/><path d="${d}" fill="none" stroke="#ffe2a0" stroke-opacity=".55" stroke-width=".9"/></g>`;
}
function beltDefs(defs) {
  defs.chev = defs.lin(
    [
      [0, '#c9852a'],
      [0.5, '#ffbf45'],
      [1, '#c9852a'],
    ],
    0,
    -21,
    0,
    21,
  );
}
const rubber = (defs) =>
  defs.lin(
    [
      [0, '#17140f'],
      [0.12, '#26221c'],
      [0.5, '#35302a'],
      [0.88, '#26221c'],
      [1, '#17140f'],
    ],
    0,
    BELT_TOP,
    0,
    BELT_BOT,
  );

/** Belt surface between the rails, phase `k` of 8. */
function beltStraight(defs, k) {
  let s = `<rect x="0" y="${BELT_TOP}" width="${CELL}" height="${BELT_BOT - BELT_TOP}" fill="${rubber(defs)}"/>`;
  const off = k * STEP;
  for (let x = -RIB; x < CELL + RIB; x += RIB) {
    const px = x + (off % RIB);
    s += `<rect x="${f(px)}" y="${BELT_TOP}" width="2.4" height="${BELT_BOT - BELT_TOP}" fill="#0d0b08" opacity=".55"/><rect x="${f(px + 2.4)}" y="${BELT_TOP}" width="1.2" height="${BELT_BOT - BELT_TOP}" fill="#6a6158" opacity=".28"/>`;
  }
  const clip = defs.id('c');
  defs.push(`<clipPath id="${clip}"><rect x="0" y="${BELT_TOP}" width="${CELL}" height="${BELT_BOT - BELT_TOP}"/></clipPath>`);
  s += `<g clip-path="url(#${clip})">`;
  for (let x = -PITCH; x < CELL + PITCH; x += PITCH) s += chevron(defs, x + off, MID);
  return `${s}</g>`;
}
function railGradient(defs, y0, h) {
  return defs.lin(
    [
      [0, '#2c3238'],
      [0.28, '#8e9aa4'],
      [0.5, '#b4bec6'],
      [0.72, '#8e9aa4'],
      [1, '#2c3238'],
    ],
    0,
    y0,
    0,
    y0 + h,
  );
}

export function conveyor() {
  const defs = new Defs();
  beltDefs(defs);
  const top = 30,
    bot = 114;
  let s = `<rect x="-20" y="${top - 1}" width="${CELL + 40}" height="${bot - top + 2}" fill="#0a0604" opacity=".62" filter="url(#b4)"/>`;
  // feet bolted to the ground, two a side
  for (const x of [36, 108])
    for (const y of [20, 112]) {
      s += part(rr(x - 13, y, 26, 12, 2.5), '#4d565f', { shade: 0.5, blur: 'b1_5', bevel: 'bevelS' });
      s += bolt(x - 7, y + 6, 2.2) + bolt(x + 7, y + 6, 2.2);
    }
  s += beltStraight(defs, 0);
  for (const [y, h] of [
    [top, RAIL],
    [BELT_BOT, RAIL],
  ]) {
    s += `<rect x="0" y="${y}" width="${CELL}" height="${h}" fill="${railGradient(defs, y, h)}"/>`;
    s += `<rect x="0" y="${y - 0.8}" width="${CELL}" height="1.2" fill="#0f0b08" opacity=".9"/><rect x="0" y="${y + h - 0.4}" width="${CELL}" height="1.2" fill="#0f0b08" opacity=".9"/>`;
    for (const x of [18, 54, 90, 126]) s += bolt(x, y + h / 2, 2.6);
  }
  // occlusion the rails throw on the belt
  s += `<rect x="0" y="${BELT_TOP}" width="${CELL}" height="5" fill="#000" opacity=".4" filter="url(#b1_5)"/><rect x="0" y="${BELT_BOT - 5}" width="${CELL}" height="5" fill="#000" opacity=".4" filter="url(#b1_5)"/>`;
  return { defs, body: s };
}
export function beltFrame(k) {
  const defs = new Defs();
  beltDefs(defs);
  return { defs, body: beltStraight(defs, k) };
}

// ---------- the corner: the belt turns about the cell's south-east corner, entering at the south edge and leaving east ----------
const O = CELL;
const ring = (r0, r1) => `M${O - r1} ${O}A${r1} ${r1} 0 0 1 ${O} ${O - r1}V${O - r0}A${r0} ${r0} 0 0 0 ${O - r0} ${O}Z`;
const at = (r, s) => {
  const a = Math.PI + (s * Math.PI) / 2;
  return [O + r * Math.cos(a), O + r * Math.sin(a), (a * 180) / Math.PI + 90];
};
function beltBend(defs, k) {
  const R0 = CELL - BELT_BOT,
    R1 = CELL - BELT_TOP;
  const grad = defs.rad(
    [
      [R0 / R1, '#17140f'],
      [(R0 + 7) / R1, '#26221c'],
      [(R0 + 30) / R1, '#35302a'],
      [(R1 - 7) / R1, '#26221c'],
      [1, '#17140f'],
    ],
    O,
    O,
    R1,
  );
  const clip = defs.id('c');
  defs.push(`<clipPath id="${clip}"><path d="${ring(R0, R1)}"/></clipPath>`);
  let s = `<path d="${ring(R0, R1)}" fill="${grad}"/><g clip-path="url(#${clip})">`;
  const off = k * STEP;
  const L = CELL; // arc parameter runs over one cell of travel, like a straight piece
  for (let x = -RIB; x < L + RIB; x += RIB) {
    const u = (x + (off % RIB)) / L;
    const [ax, ay] = at(R0 - 2, u),
      [bx, by] = at(R1 + 2, u);
    s += `<path d="M${f(ax)} ${f(ay)}L${f(bx)} ${f(by)}" stroke="#0d0b08" stroke-width="2.4" opacity=".55"/>`;
  }
  for (let x = -PITCH; x < L + PITCH; x += PITCH) {
    const u = (x + off) / L;
    const [cx, cy, deg] = at((R0 + R1) / 2, u);
    s += chevron(defs, cx, cy, deg);
  }
  return `${s}</g>`;
}
export function conveyorBend() {
  const defs = new Defs();
  beltDefs(defs);
  const R0 = CELL - BELT_BOT,
    R1 = CELL - BELT_TOP;
  let s = `<path d="${ring(R0 - RAIL, R1 + RAIL)}" fill="#0a0604" opacity=".62" filter="url(#b4)"/>`;
  s += beltBend(defs, 0);
  const railGrad = (r0, r1) =>
    defs.rad(
      [
        [r0 / r1, '#2c3238'],
        [(r0 + 0.28 * (r1 - r0)) / r1, '#8e9aa4'],
        [(r0 + 0.5 * (r1 - r0)) / r1, '#b4bec6'],
        [(r0 + 0.72 * (r1 - r0)) / r1, '#8e9aa4'],
        [1, '#2c3238'],
      ],
      O,
      O,
      r1,
    );
  for (const [r0, r1] of [
    [R0 - RAIL, R0],
    [R1, R1 + RAIL],
  ]) {
    // only the curved edges get a line: the ends must meet a straight rail with no seam
    s += `<path d="${ring(r0, r1)}" fill="${railGrad(r0, r1)}"/>`;
    s += `<path d="M${O - r0} ${O}A${r0} ${r0} 0 0 1 ${O} ${O - r0}M${O - r1} ${O}A${r1} ${r1} 0 0 1 ${O} ${O - r1}" fill="none" stroke="#0f0b08" stroke-width="1.2"/>`;
    for (const u of [0.125, 0.375, 0.625, 0.875]) {
      const [x, y] = at((r0 + r1) / 2, u);
      s += bolt(f(x), f(y), 2.6);
    }
  }
  return { defs, body: s + ao(ring(R0, R0 + 4), 'b1_5', 0.4) + ao(ring(R1 - 4, R1), 'b1_5', 0.4) };
}
export function beltBendFrame(k) {
  const defs = new Defs();
  beltDefs(defs);
  return { defs, body: beltBend(defs, k) };
}
