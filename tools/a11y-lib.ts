/**
 * Colour accessibility math (no DOM): WCAG 2.x contrast, colour-vision-deficiency simulation
 * (Machado, Oliveira & Fernandes 2009 matrices at full severity, applied in linear RGB) and CIE76 ΔE in Lab.
 */
export type RGB = [number, number, number]; // 0..1 sRGB

export const hexToRgb = (hex: number | string): RGB => {
  const n = typeof hex === 'string' ? parseInt(hex.replace('#', ''), 16) : hex;
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
};
export const rgbToHex = (c: RGB): string => '#' + c.map((v) => Math.round(Math.max(0, Math.min(1, v)) * 255).toString(16).padStart(2, '0')).join('');

const toLinear = (v: number) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
const toSrgb = (v: number) => (v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055);
export const linear = (c: RGB): RGB => [toLinear(c[0]), toLinear(c[1]), toLinear(c[2])];
export const srgb = (c: RGB): RGB => [toSrgb(c[0]), toSrgb(c[1]), toSrgb(c[2])];

/** WCAG relative luminance */
export const luminance = (c: RGB): number => { const [r, g, b] = linear(c); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
/** WCAG contrast ratio (≥ 1) */
export const contrast = (a: RGB, b: RGB): number => { const la = luminance(a), lb = luminance(b); const [hi, lo] = la > lb ? [la, lb] : [lb, la]; return (hi + 0.05) / (lo + 0.05); };
/** Alpha-composite `fg` over `bg` (sRGB, as the canvas does) */
export const over = (fg: RGB, alpha: number, bg: RGB): RGB => [fg[0] * alpha + bg[0] * (1 - alpha), fg[1] * alpha + bg[1] * (1 - alpha), fg[2] * alpha + bg[2] * (1 - alpha)];

export type CvdKind = 'normal' | 'protanopia' | 'deuteranopia' | 'tritanopia';
export const CVD: Record<CvdKind, number[][]> = {
  normal: [[1, 0, 0], [0, 1, 0], [0, 0, 1]],
  protanopia: [[0.152286, 1.052583, -0.204868], [0.114503, 0.786281, 0.099216], [-0.003882, -0.048116, 1.051998]],
  deuteranopia: [[0.367322, 0.860646, -0.227968], [0.280085, 0.672501, 0.047413], [-0.011820, 0.042940, 0.968881]],
  tritanopia: [[1.255528, -0.076749, -0.178779], [-0.078411, 0.930809, 0.147602], [0.004733, 0.691367, 0.303900]],
};
export function simulate(c: RGB, kind: CvdKind): RGB {
  const m = CVD[kind]; const l = linear(c);
  const out: RGB = [0, 1, 2].map((i) => Math.max(0, Math.min(1, m[i][0] * l[0] + m[i][1] * l[1] + m[i][2] * l[2]))) as RGB;
  return srgb(out);
}

/** sRGB → CIE Lab (D65) */
export function lab(c: RGB): [number, number, number] {
  const [r, g, b] = linear(c);
  const x = (0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047, y = 0.2126 * r + 0.7152 * g + 0.0722 * b, z = (0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883;
  const f = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  return [116 * f(y) - 16, 500 * (f(x) - f(y)), 200 * (f(y) - f(z))];
}
/** CIE76 colour difference (≈2.3 is a just-noticeable difference; > 10–15 reads as clearly different) */
export const deltaE = (a: RGB, b: RGB): number => { const [l1, a1, b1] = lab(a), [l2, a2, b2] = lab(b); return Math.hypot(l1 - l2, a1 - a2, b1 - b2); };
/** Lightness difference alone (L* 0–100), the cue that survives every CVD type */
export const deltaL = (a: RGB, b: RGB): number => Math.abs(lab(a)[0] - lab(b)[0]);
