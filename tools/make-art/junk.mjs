// Rubble: junk piles on spots where nothing can stand. Four piles, each a real mound: it fills most of the cell, sits in a
// collar of dark dirt, and its pieces darken toward the rim so it rises in the middle. Against a flat floor a blocked spot reads
// at a glance. The view picks one by cell index and turns it by quarter turns, which the overhead light allows.
import { Defs, chunk, f, poly, rng, rr } from './lib.mjs';

const RUST = ['#b05a3e', '#94492f', '#c0804f', '#7c4029', '#cb9458', '#864f33'];
const STEEL = ['#8a929a', '#6b747c', '#9ca8b3', '#565e66'];
const CONC = ['#a09a8b', '#8b8676', '#b0aa9a', '#7c7869'];

/** A colour pulled toward the dark of the mound's rim. */
function shade(hex, k) {
  const n = parseInt(hex.slice(1), 16);
  const c = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => Math.round(v * k + 14 * (1 - k)));
  return `rgb(${c.join(',')})`;
}
/** How much light a piece at distance d from the middle of the mound gets. */
const dome = (x, y, R = 62) => 1 - 0.55 * Math.min(1, (Math.hypot(x - 72, y - 72) / R) ** 2);

/** The dirt the pile sits in: a broken blot, darker at its heart. */
function bed(r, R = 60) {
  const d = chunk(r, 72, 72, R, 12, 0.94, 0);
  const inner = chunk(r, 72, 72, R * 0.8, 10, 0.92, 0);
  return `<path d="${d}" fill="#0a0704" opacity=".7" filter="url(#b4)"/><path d="${d}" fill="#2c2117" filter="url(#b2)"/><path d="${inner}" fill="#120c08" opacity=".9" filter="url(#b3)"/>`;
}
function lump(r, x, y, size, cols, n = 6, squash = 0.82, bevel = 'bevelS') {
  const c = chunk(r, x, y, size, n, squash);
  const tone = shade(cols[Math.floor(r() * cols.length)], dome(x, y));
  return `<path d="${c}" fill="#060302" opacity=".75" filter="url(#b2)"/><path d="${c}" fill="${tone}" stroke="#140c07" stroke-width="1.1" stroke-linejoin="round" filter="url(#${bevel})"/>`;
}
/** Pieces in rings from the rim to the top, so the top ones overlap the rest. */
function mound(r, cols, { rings = [44, 28, 12], counts = [12, 8, 4], sizes = [16, 17, 16], alt = null, altChance = 0 } = {}) {
  let s = '';
  rings.forEach((R, k) => {
    for (let i = 0; i < counts[k]; i++) {
      const a = (i / counts[k]) * 6.28 + r() * 0.5;
      const d = R * (0.8 + r() * 0.4);
      const x = 72 + Math.cos(a) * d,
        y = 72 + Math.sin(a) * d;
      s += lump(r, x, y, sizes[k] * (0.8 + r() * 0.45), alt && r() < altChance ? alt : cols);
    }
  });
  return s;
}
function tyre(defs, x, y, R = 24) {
  const rub = defs.rad(
    [
      [0.4, '#0b0a09'],
      [0.44, '#35332f'],
      [0.74, '#1c1a19'],
      [0.97, '#302e2b'],
      [1, '#121110'],
    ],
    x,
    y,
    R,
  );
  let s = `<circle cx="${x}" cy="${y}" r="${R + 2}" fill="#050302" opacity=".8" filter="url(#b3)"/><circle cx="${x}" cy="${y}" r="${R}" fill="${rub}" stroke="#090807" stroke-width="1.2"/>`;
  for (let i = 0; i < 20; i++) {
    const a = (i / 20) * Math.PI * 2;
    s += `<path d="M${f(x + Math.cos(a) * (R * 0.74))} ${f(y + Math.sin(a) * (R * 0.74))}L${f(x + Math.cos(a) * (R * 0.96))} ${f(y + Math.sin(a) * (R * 0.96))}" stroke="#46433e" stroke-width="1.6" opacity=".75"/>`;
  }
  s += `<circle cx="${x}" cy="${y}" r="${f(R * 0.3)}" fill="#6b5a4a" opacity=".5"/>`;
  return s;
}
function bar(x0, y0, x1, y1, w = 3.2, c = '#8f5635') {
  const d = `M${f(x0)} ${f(y0)}L${f(x1)} ${f(y1)}`;
  return `<path d="${d}" stroke="#080503" stroke-width="${w + 3}" opacity=".6" filter="url(#b1_5)"/><path d="${d}" stroke="#1a0f08" stroke-width="${w + 1.4}" stroke-linecap="round"/><path d="${d}" stroke="${c}" stroke-width="${w}" stroke-linecap="round"/>`;
}

/** Tyres on a bed of torn iron. */
export function rubble0() {
  const defs = new Defs();
  const r = rng(301);
  let s = bed(r);
  s += mound(r, RUST, { rings: [46, 26], counts: [13, 7], sizes: [16, 15], alt: STEEL, altChance: 0.2 });
  s += tyre(defs, 54, 58, 31);
  s += tyre(defs, 96, 90, 28);
  const sheet = poly([
    [70, 16],
    [126, 30],
    [118, 62],
    [92, 54],
    [80, 60],
  ]);
  s += `<path d="${sheet}" fill="#000" opacity=".6" filter="url(#b3)"/><path d="${sheet}" fill="#b0623f" stroke="#1a0f08" stroke-width="1.6" stroke-linejoin="round" filter="url(#bevelS)"/>`;
  s += `<path d="M78 24L120 34M84 36L114 44" stroke="#6f3a26" stroke-width="2" opacity=".7"/>`;
  s += bar(22, 96, 66, 124, 4, '#9ca8b3');
  s = `<g filter="url(#finish1)">${s}</g>`;
  return { defs, body: s };
}

/** A heap of rusted iron with rods sticking out. */
export function rubble1() {
  const defs = new Defs();
  const r = rng(77);
  let s = bed(r, 62);
  s += mound(r, RUST, { rings: [48, 32, 15], counts: [14, 10, 5], sizes: [15, 17, 18], alt: STEEL, altChance: 0.16 });
  s += bar(38, 44, 104, 18, 4) + bar(60, 62, 128, 60, 3.6) + bar(34, 112, 84, 66, 4, '#9a6340');
  s = `<g filter="url(#finish2)">${s}</g>`;
  return { defs, body: s };
}

/** A baled car: a crushed block with its colours in layers. */
export function rubble2() {
  const defs = new Defs();
  const r = rng(19);
  let s = bed(r, 62);
  for (let k = 0; k < 9; k++) {
    const a = (k / 9) * 6.28;
    s += lump(r, 72 + Math.cos(a) * 54, 72 + Math.sin(a) * 52, 11 + r() * 5, RUST);
  }
  const d = rr(18, 22, 108, 100, 5);
  s += `<g transform="rotate(-9 72 72)"><path d="${d}" fill="#050302" opacity=".85" filter="url(#b5)"/>`;
  const clip = defs.id('c');
  defs.push(`<clipPath id="${clip}"><path d="${d}"/></clipPath>`);
  let layers = '';
  const tones = ['#3f6680', '#6f3a26', '#2c4d63', '#a8503a', '#54606a', '#8a6d4e', '#30556e', '#7a3e2a', '#46545e', '#b5764a'];
  let y = 18;
  let i = 0;
  while (y < 124) {
    const h = 7 + r() * 12;
    const pts = [];
    let px = 14;
    pts.push([14, y]);
    while (px < 130) {
      px += 8 + r() * 12;
      pts.push([px, y + (r() - 0.5) * 7]);
    }
    pts.push([130, y + h + 7], [14, y + h + 7]);
    layers += `<path d="${poly(pts)}" fill="${tones[i++ % tones.length]}" stroke="#120b07" stroke-width="1.8" stroke-linejoin="round"/>`;
    y += h;
  }
  s += `<g clip-path="url(#${clip})"><g filter="url(#finish4)">${layers}</g>`;
  s += `<path d="${d}" fill="none" stroke="#000" stroke-width="9" opacity=".5" filter="url(#b4)"/></g>`;
  s += `<path d="${d}" fill="none" stroke="#120b07" stroke-width="2.2"/>`;
  for (const x of [46, 100]) s += `<path d="M${x} 22V122" stroke="#d6dfe5" stroke-width="2.2" opacity=".9"/>`;
  s += '</g>';
  return { defs, body: s };
}

/** Broken concrete with its reinforcing bars bent out. */
export function rubble3() {
  const defs = new Defs();
  const r = rng(4242);
  let s = bed(r, 60);
  s += mound(r, CONC, { rings: [50], counts: [10], sizes: [11] });
  s += bar(22, 34, 58, 72, 3.4) + bar(122, 26, 90, 66, 3.4) + bar(128, 100, 90, 86, 3);
  for (const [x, y, sz] of [
    [44, 50, 30],
    [100, 54, 27],
    [62, 100, 30],
    [108, 104, 22],
    [28, 96, 18],
    [74, 34, 17],
  ]) {
    const c = chunk(r, x, y, sz, 6, 0.9);
    const tone = shade(CONC[Math.floor(r() * CONC.length)], dome(x, y, 76));
    s += `<path d="${c}" fill="#070403" opacity=".8" filter="url(#b3)"/><path d="${c}" fill="${tone}" stroke="#191410" stroke-width="1.4" stroke-linejoin="round" filter="url(#bevel)"/>`;
    for (let k = 0; k < 9; k++) {
      const a = r() * 6.28,
        l = r() * sz * 0.62;
      s += `<circle cx="${f(x + Math.cos(a) * l)}" cy="${f(y + Math.sin(a) * l)}" r="${f(0.8 + r() * 1.7)}" fill="#3a352b" opacity=".65"/>`;
    }
  }
  s += bar(38, 122, 58, 88, 3.2, '#9a6340');
  s = `<g filter="url(#finish3)">${s}</g>`;
  return { defs, body: s };
}
