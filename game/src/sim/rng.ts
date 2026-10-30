/** Small deterministic PRNG (mulberry32) seeded from a string or number. */
export function hashSeed(seed: string | number): number {
  const s = String(seed);
  let h = 1779033703 ^ s.length;
  for (let i = 0; i < s.length; i++) {
    h = Math.imul(h ^ s.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  h = Math.imul(h ^ (h >>> 16), 2246822507);
  h = Math.imul(h ^ (h >>> 13), 3266489909);
  return (h ^ (h >>> 16)) >>> 0;
}

export class Rng {
  private a: number;
  constructor(seed: string | number) { this.a = hashSeed(seed); }
  /** float in [0,1) */
  next(): number {
    let t = (this.a += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  int(maxExclusive: number): number { return Math.floor(this.next() * maxExclusive); }
  pick<T>(arr: readonly T[]): T { return arr[this.int(arr.length)]; }
  weighted<K extends string>(weights: Record<K, number>): K {
    const keys = Object.keys(weights) as K[];
    const total = keys.reduce((s, k) => s + weights[k], 0);
    let r = this.next() * total;
    for (const k of keys) { r -= weights[k]; if (r < 0) return k; }
    return keys[keys.length - 1];
  }
}
