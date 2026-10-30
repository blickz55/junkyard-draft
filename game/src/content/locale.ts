/**
 * Locale selection and the pseudo-locale (production roadmap 0.9.0). The game ships in English; the pseudo-locale
 * exists to prove the layout survives translation: every letter gets an accent and every string grows by about 30 %,
 * so a label that only fits because it is English shows up in the render e2e at 130 % text. It is chosen with
 * `?locale=pseudo` (any build) or the `jd.locale` key in storage, and never affects the simulation, the share text's
 * machine-readable parts (numbers, dollar signs, glyphs survive untouched) or anything sent to the verifier.
 */
export type Locale = 'en' | 'pseudo';

let current: Locale | null = null;

export function detectLocale(): Locale {
  try {
    if (typeof location !== 'undefined') {
      const q = new URLSearchParams(location.search).get('locale');
      if (q === 'pseudo' || q === 'en') return q;
    }
    if (typeof localStorage !== 'undefined') {
      const v = localStorage.getItem('jd.locale');
      if (v === 'pseudo' || v === 'en') return v;
    }
  } catch {
    /* storage or location unavailable: English */
  }
  return 'en';
}
export function locale(): Locale {
  if (current === null) current = detectLocale();
  return current;
}
export function setLocale(l: Locale): void {
  current = l;
}

const ACCENTS: Record<string, string> = {
  a: 'á',
  b: 'ƀ',
  c: 'ç',
  d: 'ď',
  e: 'é',
  f: 'ƒ',
  g: 'ğ',
  h: 'ĥ',
  i: 'í',
  j: 'ĵ',
  k: 'ķ',
  l: 'ĺ',
  m: 'ɱ',
  n: 'ñ',
  o: 'ó',
  p: 'þ',
  q: 'ɋ',
  r: 'ŕ',
  s: 'š',
  t: 'ť',
  u: 'ú',
  v: 'ṽ',
  w: 'ŵ',
  x: 'ẋ',
  y: 'ý',
  z: 'ž',
  A: 'Á',
  B: 'Ɓ',
  C: 'Ç',
  D: 'Ď',
  E: 'É',
  F: 'Ƒ',
  G: 'Ğ',
  H: 'Ĥ',
  I: 'Í',
  J: 'Ĵ',
  K: 'Ķ',
  L: 'Ĺ',
  M: 'Ṁ',
  N: 'Ñ',
  O: 'Ó',
  P: 'Þ',
  Q: 'Ꝗ',
  R: 'Ŕ',
  S: 'Š',
  T: 'Ť',
  U: 'Ú',
  V: 'Ṽ',
  W: 'Ŵ',
  X: 'Ẋ',
  Y: 'Ý',
  Z: 'Ž',
};
/** Growth target: translated strings run about a third longer than English. */
export const PSEUDO_GROWTH = 0.3;
const PAD = '≈';

/** Accent every Latin letter and pad the string by PSEUDO_GROWTH of its letter count; digits, `$`, punctuation and the share glyphs stay. */
export function pseudo(text: string): string {
  let letters = 0;
  const out = text.replace(/[A-Za-z]/g, (ch) => {
    letters++;
    return ACCENTS[ch] ?? ch;
  });
  const pad = Math.ceil(letters * PSEUDO_GROWTH);
  return pad > 0 ? `${out} ${PAD.repeat(pad)}` : out;
}
