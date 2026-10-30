/**
 * Render the two impact samples (DOSSIER-v1 §3.3, 0.4.13) as small mono 22 kHz 16-bit WAVs under game/public/sfx/:
 *   ship.wav  — a short metallic clink (three inharmonic partials with fast decays and a 5 ms noise transient)
 *   press.wav — a dull thud (a 110 → 55 Hz sine sweep under a low-passed noise burst)
 * Deterministic (seeded noise), so re-running reproduces the files byte for byte. Usage: node --import tsx tools/make-sfx.ts
 */
import fs from 'node:fs';
import path from 'node:path';

const RATE = 22050;
const OUT = path.resolve(process.cwd(), 'game/public/sfx');

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function clink(): Float32Array {
  const n = Math.round(RATE * 0.14),
    out = new Float32Array(n),
    rand = rng(7);
  const partials = [
    [2140, 0.03, 1],
    [3370, 0.04, 0.6],
    [5210, 0.022, 0.45],
    [7900, 0.012, 0.25],
  ];
  for (let i = 0; i < n; i++) {
    const t = i / RATE;
    let v = 0;
    for (const [f, tau, a] of partials) v += a * Math.sin(2 * Math.PI * f * t) * Math.exp(-t / tau);
    if (t < 0.005) v += (rand() * 2 - 1) * 0.8 * (1 - t / 0.005);
    out[i] = v;
  }
  return out;
}
function thud(): Float32Array {
  const n = Math.round(RATE * 0.18),
    out = new Float32Array(n),
    rand = rng(11);
  let phase = 0,
    lp = 0;
  for (let i = 0; i < n; i++) {
    const t = i / RATE;
    const f = 110 * Math.pow(0.5, t / 0.12);
    phase += (2 * Math.PI * f) / RATE;
    const body = Math.sin(phase) * Math.exp(-t / 0.06);
    const noise = (rand() * 2 - 1) * Math.exp(-t / 0.02);
    lp += (noise - lp) * 0.12;
    out[i] = body * 1.0 + lp * 1.6;
  }
  return out;
}
function wav(samples: Float32Array): Buffer {
  let peak = 0;
  for (const v of samples) peak = Math.max(peak, Math.abs(v));
  const gain = peak > 0 ? 0.8 / peak : 1;
  const fade = Math.round(RATE * 0.004);
  const data = Buffer.alloc(samples.length * 2);
  for (let i = 0; i < samples.length; i++) {
    const env = i >= samples.length - fade ? (samples.length - i) / fade : 1; // tail fade: no click at the loop point
    data.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(samples[i] * gain * env * 32767))), i * 2);
  }
  const h = Buffer.alloc(44);
  h.write('RIFF', 0);
  h.writeUInt32LE(36 + data.length, 4);
  h.write('WAVE', 8);
  h.write('fmt ', 12);
  h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20);
  h.writeUInt16LE(1, 22);
  h.writeUInt32LE(RATE, 24);
  h.writeUInt32LE(RATE * 2, 28);
  h.writeUInt16LE(2, 32);
  h.writeUInt16LE(16, 34);
  h.write('data', 36);
  h.writeUInt32LE(data.length, 40);
  return Buffer.concat([h, data]);
}

fs.mkdirSync(OUT, { recursive: true });
for (const [name, fn] of [
  ['ship', clink],
  ['press', thud],
] as const) {
  const buf = wav(fn());
  fs.writeFileSync(path.join(OUT, `${name}.wav`), buf);
  console.log(`${name}.wav  ${buf.length} bytes  ${(((buf.length - 44) / 2 / RATE) * 1000) | 0} ms`);
}
