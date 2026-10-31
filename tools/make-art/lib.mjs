// Shared drawing kit for the art (docs/ART.md): every frame is a standalone SVG string built from these helpers. Units are
// sheet pixels: a cell frame is 144 × 144 and shows at 72 CSS px, an item frame is 48 × 48 and shows at 24.
//
// The light is overhead and has no direction: a machine rotates by sprite angle, so a directional shadow would flip with it.
// Depth comes from ambient occlusion (a soft dark halo under each part), a rim on each bevel that is the same on all four
// sides, and gradients that are symmetric about the part. Nothing here may add a drop shadow with an offset.

export const CELL = 144;
export const ITEM = 48;
export const MID = CELL / 2;

const blurId = (s) => `b${String(s).replace('.', '_')}`;

/** The filters every frame can use. `svgDoc` keeps only the ones a frame refers to, so each exported SVG stays small. */
export const FILTERS = {
  // plain blurs for ambient occlusion and glows
  ...Object.fromEntries(
    [0.6, 1, 1.5, 2, 3, 4, 5, 6, 8, 10, 14].map((s) => [
      blurId(s),
      `<filter id="${blurId(s)}" x="-60%" y="-60%" width="220%" height="220%"><feGaussianBlur stdDeviation="${s}"/></filter>`,
    ]),
  ),
  // a soft bevel: the surface darkens toward its edge (overhead diffuse) and the slope catches a thin highlight on all four sides
  bevel: bevelFilter('bevel', 1.6, 3.2, 0.8),
  bevelS: bevelFilter('bevelS', 0.8, 2.2, 0.7),
  bevelL: bevelFilter('bevelL', 2.6, 4.2, 0.65),
  // paint: faint mottling and a few fine scratches, inside the alpha of the source
  paint: `<filter id="paint" x="0" y="0" width="100%" height="100%" color-interpolation-filters="sRGB">
    <feTurbulence type="fractalNoise" baseFrequency="0.05" numOctaves="4" seed="7" result="n1"/>
    <feColorMatrix in="n1" type="matrix" values="0 0 0 0 0.07  0 0 0 0 0.05  0 0 0 0 0.03  1.7 0 0 0 -0.72" result="m1"/>
    <feComposite in="m1" in2="SourceAlpha" operator="in" result="grime"/>
    <feTurbulence type="fractalNoise" baseFrequency="0.8 0.05" numOctaves="2" seed="11" result="n2"/>
    <feColorMatrix in="n2" type="matrix" values="0 0 0 0 1  0 0 0 0 0.96  0 0 0 0 0.88  2.4 0 0 0 -1.5" result="m2"/>
    <feComposite in="m2" in2="SourceAlpha" operator="in" result="scr"/>
    <feMerge><feMergeNode in="SourceGraphic"/><feMergeNode in="grime"/><feMergeNode in="scr"/></feMerge>
  </filter>`,
  // worn edges: bare metal shows in a broken line along the outline of the source
  wear: `<filter id="wear" x="-2%" y="-2%" width="104%" height="104%" color-interpolation-filters="sRGB">
    <feMorphology in="SourceAlpha" operator="erode" radius="1.6" result="in"/>
    <feComposite in="SourceAlpha" in2="in" operator="out" result="edge"/>
    <feTurbulence type="fractalNoise" baseFrequency="0.16" numOctaves="3" seed="23" result="n"/>
    <feColorMatrix in="n" type="matrix" values="0 0 0 0 0.86  0 0 0 0 0.84  0 0 0 0 0.8  5 0 0 0 -2.4" result="chip"/>
    <feComposite in="chip" in2="edge" operator="in" result="c"/>
    <feMerge><feMergeNode in="SourceGraphic"/><feMergeNode in="c"/></feMerge>
  </filter>`,
};

for (let i = 1; i <= 9; i++) FILTERS[`finish${i}`] = finishFilter(`finish${i}`, i);

/** Dirt that gathers in blotches and a fine grain, inside the alpha of everything under it, over one whole frame. */
function finishFilter(id, seed, size = 144) {
  return `<filter id="${id}" filterUnits="userSpaceOnUse" x="0" y="0" width="${size}" height="${size}" color-interpolation-filters="sRGB">
    <feTurbulence type="fractalNoise" baseFrequency="0.03" numOctaves="4" seed="${seed * 13}" result="n"/>
    <feColorMatrix in="n" type="matrix" values="0 0 0 0 0.09  0 0 0 0 0.06  0 0 0 0 0.035  1.5 0 0 0 -0.66" result="dirt"/>
    <feComposite in="dirt" in2="SourceAlpha" operator="in" result="d"/>
    <feTurbulence type="fractalNoise" baseFrequency="0.42" numOctaves="2" seed="${seed * 7 + 2}" result="g"/>
    <feColorMatrix in="g" type="matrix" values="0 0 0 0 1  0 0 0 0 0.94  0 0 0 0 0.82  0.55 0 0 0 -0.27" result="light"/>
    <feComposite in="light" in2="SourceAlpha" operator="in" result="l"/>
    <feColorMatrix in="g" type="matrix" values="0 0 0 0 0.05  0 0 0 0 0.03  0 0 0 0 0.02  0 0.7 0 0 -0.34" result="dark"/>
    <feComposite in="dark" in2="SourceAlpha" operator="in" result="k"/>
    <feMerge><feMergeNode in="SourceGraphic"/><feMergeNode in="d"/><feMergeNode in="l"/><feMergeNode in="k"/></feMerge>
  </filter>`;
}

function bevelFilter(id, blur, scale, rim) {
  const spec = (az, r) =>
    `<feSpecularLighting in="h" surfaceScale="${scale}" specularConstant="1" specularExponent="48" lighting-color="#fff4e2" result="${r}"><feDistantLight azimuth="${az}" elevation="38"/></feSpecularLighting>`;
  return `<filter id="${id}" x="-8%" y="-8%" width="116%" height="116%" color-interpolation-filters="sRGB">
    <feGaussianBlur in="SourceAlpha" stdDeviation="${blur}" result="h"/>
    <feDiffuseLighting in="h" surfaceScale="${scale}" diffuseConstant="1" lighting-color="#fff" result="d"><feDistantLight azimuth="0" elevation="90"/></feDiffuseLighting>
    <feComposite in="SourceGraphic" in2="d" operator="arithmetic" k1="1" k2="0" k3="0" k4="0" result="lit"/>
    ${spec(0, 's1')}${spec(90, 's2')}${spec(180, 's3')}${spec(270, 's4')}
    <feComposite in="s1" in2="s2" operator="arithmetic" k2="1" k3="1" result="s12"/>
    <feComposite in="s3" in2="s4" operator="arithmetic" k2="1" k3="1" result="s34"/>
    <feComposite in="s12" in2="s34" operator="arithmetic" k2="1" k3="1" result="s"/>
    <feComposite in="s" in2="SourceAlpha" operator="in" result="rim"/>
    <feComposite in="rim" in2="lit" operator="arithmetic" k2="${rim}" k3="1" result="out"/>
    <feComposite in="out" in2="SourceAlpha" operator="in"/>
  </filter>`;
}

let nextId = 0;
/** Per-frame gradient and pattern collector. */
export class Defs {
  list = [];
  push(def) {
    this.list.push(def);
  }
  id(prefix = 'g') {
    return `${prefix}${++nextId}`;
  }
  /** any linear gradient in user space; stops are [offset, colour, opacity?] */
  lin(stops, x1, y1, x2, y2) {
    const id = this.id('l');
    this.list.push(
      `<linearGradient id="${id}" gradientUnits="userSpaceOnUse" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}">${stops.map(stop).join('')}</linearGradient>`,
    );
    return `url(#${id})`;
  }
  rad(stops, cx, cy, r, fx = cx, fy = cy) {
    const id = this.id('r');
    this.list.push(
      `<radialGradient id="${id}" gradientUnits="userSpaceOnUse" cx="${cx}" cy="${cy}" r="${r}" fx="${fx}" fy="${fy}">${stops.map(stop).join('')}</radialGradient>`,
    );
    return `url(#${id})`;
  }
}
const stop = ([o, c, a]) => `<stop offset="${o}" stop-color="${c}"${a != null ? ` stop-opacity="${a}"` : ''}/>`;

/** A complete SVG document in sheet pixels, rendered at `ss` times its size. */
export function svgDoc(w, h, defs, body, ss = 1) {
  const seen = new Set();
  const wanted = [];
  const scan = (s) => {
    for (const m of s.matchAll(/url\(#([\w-]+)\)/g))
      if (FILTERS[m[1]] && !seen.has(m[1])) {
        seen.add(m[1]);
        wanted.push(FILTERS[m[1]]);
      }
  };
  scan(defs.list.join(''));
  scan(body);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w * ss}" height="${h * ss}" viewBox="0 0 ${w} ${h}"><defs>${wanted.join('')}${defs.list.join('')}</defs>${body}</svg>`;
}

// ---------- paths ----------
export const f = (n) => +n.toFixed(2);
/** Rounded rectangle as a path. */
export const rr = (x, y, w, h, r) =>
  `M${f(x + r)} ${f(y)}H${f(x + w - r)}A${r} ${r} 0 0 1 ${f(x + w)} ${f(y + r)}V${f(y + h - r)}A${r} ${r} 0 0 1 ${f(x + w - r)} ${f(y + h)}H${f(x + r)}A${r} ${r} 0 0 1 ${f(x)} ${f(y + h - r)}V${f(y + r)}A${r} ${r} 0 0 1 ${f(x + r)} ${f(y)}Z`;
/** Rectangle with cut corners. */
export const cham = (x, y, w, h, c) =>
  `M${f(x + c)} ${f(y)}H${f(x + w - c)}L${f(x + w)} ${f(y + c)}V${f(y + h - c)}L${f(x + w - c)} ${f(y + h)}H${f(x + c)}L${f(x)} ${f(y + h - c)}V${f(y + c)}Z`;
export const circle = (cx, cy, r) => `M${f(cx - r)} ${f(cy)}A${r} ${r} 0 1 0 ${f(cx + r)} ${f(cy)}A${r} ${r} 0 1 0 ${f(cx - r)} ${f(cy)}Z`;
export const poly = (pts) => `M${pts.map(([x, y]) => `${f(x)} ${f(y)}`).join('L')}Z`;

// ---------- parts ----------
/** Ambient occlusion: a soft dark halo the size of the path. */
export const ao = (d, blur = 'b3', opacity = 0.65) => `<path d="${d}" fill="#0c0705" opacity="${opacity}" filter="url(#${blur})"/>`;
/** A raised part: occlusion under it, a dark outline, the fill with its bevel. */
export function part(d, fill, { blur = 'b2', shade = 0.6, bevel = 'bevel', line = '#120c08', lineW = 1.6 } = {}) {
  const under = shade ? ao(d, blur, shade) : '';
  const edge = line ? `<path d="${d}" fill="none" stroke="${line}" stroke-width="${lineW}" stroke-linejoin="round"/>` : '';
  return `${under}${edge}<path d="${d}" fill="${fill}"${bevel ? ` filter="url(#${bevel})"` : ''}/>`;
}
/** A recess: a dark floor with occlusion inside its own edge. */
export function well(defs, d, fill, { depth = 'b3', opacity = 0.8, width = 7 } = {}) {
  const id = defs.id('c');
  defs.push(`<clipPath id="${id}"><path d="${d}"/></clipPath>`);
  return `<path d="${d}" fill="${fill}"/><g clip-path="url(#${id})"><path d="${d}" fill="none" stroke="#050302" stroke-width="${width}" opacity="${opacity}" filter="url(#${depth})"/></g>`;
}
/** Hex-socket bolt with its washer. */
export function bolt(x, y, r = 3.4) {
  return `<circle cx="${x}" cy="${y}" r="${f(r + 1.2)}" fill="#0d0a08" opacity=".7"/><circle cx="${x}" cy="${y}" r="${r}" fill="#9aa4ab"/><circle cx="${x}" cy="${y}" r="${f(r * 0.72)}" fill="#5e676e"/><circle cx="${x}" cy="${y}" r="${f(r * 0.42)}" fill="#22282c"/><circle cx="${x}" cy="${y}" r="${f(r * 0.88)}" fill="none" stroke="#e6edf0" stroke-width=".6" opacity=".55"/>`;
}
/** Hazard stripes on a path; `pitch` is the stripe period in px. */
export function hazard(defs, d, { pitch = 14, a = '#e8a92e', b = '#1c1712', angle = 45 } = {}) {
  const id = defs.id('p');
  defs.push(
    `<pattern id="${id}" width="${pitch}" height="${pitch}" patternUnits="userSpaceOnUse" patternTransform="rotate(${angle})"><rect width="${pitch}" height="${pitch}" fill="${a}"/><rect width="${pitch / 2}" height="${pitch}" fill="${b}"/></pattern>`,
  );
  return `<path d="${d}" fill="url(#${id})"/>`;
}
/** Seeded random numbers, so a redraw gives the same art. */
export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
/** An angular lump of metal: an irregular polygon around (x, y). */
export function chunk(r, x, y, size, n = 6, squash = 0.8, turn = r() * 6.28) {
  const pts = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + (r() - 0.5) * 0.5;
    const l = size * (0.68 + r() * 0.42);
    const px = Math.cos(a) * l,
      py = Math.sin(a) * l * squash;
    pts.push([x + px * Math.cos(turn) - py * Math.sin(turn), y + px * Math.sin(turn) + py * Math.cos(turn)]);
  }
  return poly(pts);
}
/** A light that spills: a blurred copy of a shape. */
export const glow = (d, color, blur = 'b4', opacity = 0.8) => `<path d="${d}" fill="${color}" opacity="${opacity}" filter="url(#${blur})"/>`;
