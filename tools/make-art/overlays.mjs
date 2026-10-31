// The build overlays (a spot that takes the part, a spot that refuses it, the selection, the keyboard cursor) and the shelf.
// An overlay says what it means by shape as well as colour: brackets for yes, hatching for no, heavy corners for the
// selection, ticks for the cursor.
import { Defs, ao, bolt, part, rr, well } from './lib.mjs';

const C = 144;
const brackets = (inset, len, stroke, w, extra = '') => {
  const a = inset,
    b = C - inset;
  const seg = (x, y, dx, dy) =>
    `<path d="M${x + dx * len} ${y}H${x}V${y + dy * len}" fill="none" stroke="${stroke}" stroke-width="${w}" stroke-linecap="square"${extra}/>`;
  return seg(a, a, 1, 1) + seg(b, a, -1, 1) + seg(a, b, 1, -1) + seg(b, b, -1, -1);
};

export function tileOk() {
  const defs = new Defs();
  const fill = defs.rad(
    [
      [0, '#6fcf8a', 0.14],
      [1, '#6fcf8a', 0.42],
    ],
    72,
    72,
    100,
  );
  const s = `<rect x="2" y="2" width="140" height="140" rx="4" fill="${fill}"/><rect x="3" y="3" width="138" height="138" rx="4" fill="none" stroke="#6fcf8a" stroke-width="2.4" opacity=".75"/>${brackets(4, 30, '#b6f5c8', 5)}`;
  return { defs, body: s };
}

export function tileBad() {
  const defs = new Defs();
  const id = defs.id('h');
  defs.push(
    `<pattern id="${id}" width="22" height="22" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="22" height="22" fill="#eb6757" fill-opacity=".16"/><rect width="9" height="22" fill="#eb6757" fill-opacity=".4"/></pattern>`,
  );
  const s = `<rect x="2" y="2" width="140" height="140" rx="4" fill="url(#${id})"/><rect x="3" y="3" width="138" height="138" rx="4" fill="none" stroke="#eb6757" stroke-width="4" opacity=".95"/>`;
  return { defs, body: s };
}

export function tileSel() {
  const defs = new Defs();
  const s = `<rect x="5" y="5" width="134" height="134" rx="6" fill="none" stroke="#f0a830" stroke-width="3" opacity=".9"/>${brackets(5, 34, '#ffc95e', 7.5)}`;
  return { defs, body: s };
}

export function tileCursor() {
  const defs = new Defs();
  const s = `<rect x="8" y="8" width="128" height="128" rx="3" fill="none" stroke="#d6f0ff" stroke-width="3" opacity=".9"/>${brackets(6, 24, '#d6f0ff', 7)}`;
  return { defs, body: s };
}

// ---------- the shelf: a steel rack under the yard, 576 × 100 logical, seven bays ----------
export const SHELF_W = 1152;
export const SHELF_H = 200;
export function shelf() {
  const defs = new Defs();
  const W = SHELF_W,
    H = SHELF_H;
  // tread plate
  const tread = defs.id('t');
  defs.push(
    `<pattern id="${tread}" width="26" height="26" patternUnits="userSpaceOnUse"><rect width="26" height="26" fill="#2a2e31"/><g fill="#3e4448" stroke="#14171a" stroke-width=".8"><rect x="2" y="9.5" width="9" height="3" rx="1.5" transform="rotate(45 6.5 11)"/><rect x="15" y="22.5" width="9" height="3" rx="1.5" transform="rotate(45 19.5 24)"/><rect x="15" y="-3.5" width="9" height="3" rx="1.5" transform="rotate(45 19.5 -2)"/><rect x="15" y="9.5" width="9" height="3" rx="1.5" transform="rotate(-45 19.5 11)"/><rect x="2" y="22.5" width="9" height="3" rx="1.5" transform="rotate(-45 6.5 24)"/><rect x="2" y="-3.5" width="9" height="3" rx="1.5" transform="rotate(-45 6.5 -2)"/></g></pattern>`,
  );
  let s = `<rect width="${W}" height="${H}" fill="url(#${tread})"/>`;
  const dim = defs.rad(
    [
      [0, '#000', 0],
      [0.7, '#000', 0.2],
      [1, '#000', 0.55],
    ],
    W / 2,
    H / 2,
    W * 0.56,
  );
  s += `<rect width="${W}" height="${H}" fill="${dim}"/>`;
  // the header the label sits on
  const beam = defs.lin(
    [
      [0, '#585f65'],
      [0.1, '#3a3f44'],
      [0.85, '#262a2d'],
      [1, '#121416'],
    ],
    0,
    0,
    0,
    46,
  );
  s += ao(rr(-10, 0, W + 20, 48, 2), 'b3', 0.7);
  s += `<rect width="${W}" height="46" fill="${beam}"/><rect y="46" width="${W}" height="1.5" fill="#0a0807"/>`;
  // seven bays, each a pressed tray with faint marks
  for (let i = 0; i < 7; i++) {
    const x = 24 + i * 160,
      y = 56;
    const tray = rr(x, y, 144, 144, 7);
    s += `<path d="${rr(x - 3, y - 3, 150, 150, 9)}" fill="#596066" opacity=".55"/>`;
    s += well(defs, tray, '#1a1c1e', { width: 10, depth: 'b4', opacity: 0.95 });
    const a = x + 10,
      b = x + 134,
      c = y + 10,
      d = y + 134;
    s += `<path d="M${a + 14} ${c}H${a}V${c + 14}M${b - 14} ${c}H${b}V${c + 14}M${a + 14} ${d}H${a}V${d - 14}M${b - 14} ${d}H${b}V${d - 14}" fill="none" stroke="#e7c35a" stroke-width="2.4" opacity=".3"/>`;
  }
  // end posts
  for (const x of [0, W - 14]) s += part(rr(x, 0, 14, H, 1), '#3d4348', { shade: 0.5, blur: 'b2', bevel: 'bevelS', lineW: 1.4 });
  for (const y of [14, 60, 110, 160]) s += bolt(7, y, 2.8) + bolt(W - 7, y, 2.8);
  s += `<rect x="1" y="1" width="${W - 2}" height="${H - 2}" fill="none" stroke="#0b0907" stroke-width="2"/>`;
  return { defs, body: s };
}

/** A soft round light for a transform: white, so the game can tint it. */
export function glowFrame() {
  const defs = new Defs();
  const g = defs.rad(
    [
      [0, '#fff', 1],
      [0.25, '#fff', 0.72],
      [0.6, '#fff', 0.18],
      [1, '#fff', 0],
    ],
    72,
    72,
    72,
  );
  return { defs, body: `<circle cx="72" cy="72" r="72" fill="${g}"/>` };
}
