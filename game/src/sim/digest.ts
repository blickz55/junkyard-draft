/**
 * Digests of a simulated run (production roadmap 0.8.11, determinism across engines): a SHA-256 of the final run state
 * and one of every round's event stream, over a canonical JSON (keys sorted, no undefined) so that two engines that
 * agree on the simulation produce the same hex strings. SHA-256 is written out in plain 32-bit integer arithmetic
 * (no WebCrypto: that API is async and needs a secure context, and the point here is to compare engines, not to use
 * their crypto). Pure and browser-free like the rest of the sim; used by tools/make-golden.ts (records the hashes in
 * tests/golden/INDEX.json), tests/golden.test.ts (Node agrees with the corpus) and tests/engines-e2e.test.mjs (the
 * same bundle in Chromium, Firefox and WebKit agrees with Node).
 */
import { replay, type RunState } from './run';
import type { ReplayFile } from './replay';

/** JSON with object keys sorted at every level; arrays keep their order; undefined values are dropped like JSON.stringify does. */
export function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map((v) => (v === undefined ? 'null' : canonical(v))).join(',')}]`;
  const o = value as Record<string, unknown>;
  const keys = Object.keys(o)
    .filter((k) => o[k] !== undefined)
    .sort((p, q) => (p < q ? -1 : p > q ? 1 : 0)); // code-unit order, stated: the lint forbids a bare sort()
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonical(o[k])}`).join(',')}}`;
}

const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74,
  0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d,
  0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e,
  0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5,
  0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);
const rotr = (x: number, n: number) => (x >>> n) | (x << (32 - n));

/** SHA-256 of the UTF-8 bytes of `text`, as 64 lower-case hex characters. */
export function sha256Hex(text: string): string {
  const bytes = new TextEncoder().encode(text);
  const bitLen = bytes.length * 8;
  const padded = new Uint8Array(((bytes.length + 9 + 63) >> 6) << 6);
  padded.set(bytes);
  padded[bytes.length] = 0x80;
  const view = new DataView(padded.buffer);
  view.setUint32(padded.length - 8, Math.floor(bitLen / 0x100000000), false);
  view.setUint32(padded.length - 4, bitLen >>> 0, false);
  const h = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
  const w = new Uint32Array(64);
  for (let off = 0; off < padded.length; off += 64) {
    for (let i = 0; i < 16; i++) w[i] = view.getUint32(off + i * 4, false);
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }
    let [a, b, c, d, e, f, g, hh] = h;
    for (let i = 0; i < 64; i++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const t1 = (hh + S1 + ch + K[i] + w[i]) >>> 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + maj) >>> 0;
      hh = g;
      g = f;
      f = e;
      e = (d + t1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (t1 + t2) >>> 0;
    }
    h[0] = (h[0] + a) >>> 0;
    h[1] = (h[1] + b) >>> 0;
    h[2] = (h[2] + c) >>> 0;
    h[3] = (h[3] + d) >>> 0;
    h[4] = (h[4] + e) >>> 0;
    h[5] = (h[5] + f) >>> 0;
    h[6] = (h[6] + g) >>> 0;
    h[7] = (h[7] + hh) >>> 0;
  }
  return Array.from(h, (x) => x.toString(16).padStart(8, '0')).join('');
}

export interface RunDigest {
  score: number;
  /** SHA-256 of the canonical final state (everything but the actions and the event streams) */ state: string;
  /** SHA-256 of each round's canonical event stream, in order */ rounds: string[];
}

/** The two digests of a finished (or partial) run. The actions are the input, not the outcome, so they are not hashed; the events get their own per-round hash. */
export function digestRun(s: RunState): RunDigest {
  const state = {
    seed: s.seed,
    rulesVersion: s.rulesVersion,
    round: s.round,
    phase: s.phase,
    score: s.score,
    sold: s.sold,
    rerolls: s.rerolls,
    rerolledRound: s.rerolledRound,
    nextId: s.nextId,
    picks: s.picks,
    offers: s.offers,
    layout: s.layout,
    bin: s.bin,
    rounds: s.rounds.map((r) => ({
      round: r.round,
      earned: r.earned,
      layout: r.layout,
      result: {
        earned: r.result.earned,
        shipped: r.result.shipped,
        spawned: r.result.spawned,
        absorbed: r.result.absorbed,
        ticks: r.result.ticks,
        cellStats: r.result.cellStats,
      },
    })),
  };
  return { score: s.score, state: sha256Hex(canonical(state)), rounds: s.rounds.map((r) => sha256Hex(canonical(r.result.events))) };
}

/** Re-simulate a replay file and digest the outcome. Throws like `replay` does on an illegal file. */
export const digestReplay = (r: ReplayFile): RunDigest => digestRun(replay(r.seed, r.actions, r.rulesVersion));
