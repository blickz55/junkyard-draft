// The two ports every machine that a line runs through shares: the intake on its west edge with a blue "in" chevron, the
// outlet on its east edge with an amber arrow. They line up with a conveyor's rails, so a belt runs straight into a mouth.
import { BELT_BOT, BELT_TOP } from './belts.mjs';
import { bolt, f, glow, poly, rr } from './lib.mjs';

export const IN_BLUE = '#6fb4ff';
const collar = (defs, x, w) => {
  const g = defs.lin(
    [
      [0, '#22272c'],
      [0.1, '#8d98a1'],
      [0.5, '#5c666f'],
      [0.9, '#8d98a1'],
      [1, '#22272c'],
    ],
    0,
    26,
    0,
    118,
  );
  return `<path d="${rr(x, 28, w, 88, 3)}" fill="${g}" stroke="#0f0b08" stroke-width="1.4"/>`;
};
/** Intake at the west edge: x runs 0 to `w`. */
export function portIn(defs, w = 20) {
  const h = BELT_BOT - BELT_TOP;
  const c = poly([
    [w * 0.22, 50],
    [w * 0.52, 50],
    [w * 0.98, 72],
    [w * 0.52, 94],
    [w * 0.22, 94],
    [w * 0.66, 72],
  ]);
  return `${collar(defs, 0, w)}<rect x="0" y="${BELT_TOP}" width="${w}" height="${h}" fill="#0b0806"/><rect x="${w - 7}" y="${BELT_TOP}" width="7" height="${h}" fill="#000" opacity=".6"/>
    ${glow(c, IN_BLUE, 'b3', 0.85)}<path d="${c}" fill="${IN_BLUE}"/><path d="${c}" fill="none" stroke="#dcefff" stroke-width=".9" stroke-opacity=".8"/>
    ${bolt(f(w / 2), 35, 2.2)}${bolt(f(w / 2), 109, 2.2)}`;
}
/** Outlet at the east edge: x runs 144 - w to 144, and the arrow points out. */
export function portOut(defs, w = 22, cell = 144) {
  const x0 = cell - w;
  const h = BELT_BOT - BELT_TOP;
  const arrow = poly([
    [x0 + 3, 49],
    [x0 + 11, 49],
    [cell - 2, 72],
    [x0 + 11, 95],
    [x0 + 3, 95],
    [x0 + 11.5, 72],
  ]);
  return `${collar(defs, x0, w)}<rect x="${x0}" y="${BELT_TOP}" width="${w}" height="${h}" fill="#0b0806"/><rect x="${x0}" y="${BELT_TOP}" width="7" height="${h}" fill="#000" opacity=".6"/>
    ${glow(arrow, '#ff9d2e', 'b3', 0.85)}<path d="${arrow}" fill="#ffb53c"/><path d="${arrow}" fill="none" stroke="#ffe6b0" stroke-width=".9" stroke-opacity=".85"/>
    ${bolt(f(x0 + w / 2), 35, 2.2)}${bolt(f(x0 + w / 2), 109, 2.2)}`;
}
