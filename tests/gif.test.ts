import { test } from 'node:test';
import assert from 'node:assert/strict';
import { quantize, encodeGif, lzwEncode } from '../game/src/render/gif';

// --- a small reference decoder, so the writer is checked against the format and not against itself ---
const u16 = (b: Uint8Array, i: number) => b[i] | (b[i + 1] << 8);
function lzwDecode(data: Uint8Array, minCodeSize: number, expected: number): Uint8Array {
  const clear = 1 << minCodeSize, eoi = clear + 1;
  let codeSize = minCodeSize + 1, next = eoi + 1;
  let dict: number[][] = [];
  const reset = () => { dict = []; for (let i = 0; i < clear; i++) dict[i] = [i]; dict[clear] = []; dict[eoi] = []; next = eoi + 1; codeSize = minCodeSize + 1; };
  reset();
  const out: number[] = []; let acc = 0, bits = 0, pos = 0, prev: number[] | null = null;
  while (out.length < expected) {
    while (bits < codeSize) { if (pos >= data.length) throw new Error('lzw: ran out of data'); acc |= data[pos++] << bits; bits += 8; }
    const code = acc & ((1 << codeSize) - 1); acc >>>= codeSize; bits -= codeSize;
    if (code === clear) { reset(); prev = null; continue; }
    if (code === eoi) break;
    let entry: number[];
    if (code < next && dict[code]) entry = dict[code];
    else if (prev) entry = [...prev, prev[0]];
    else throw new Error(`lzw: bad code ${code}`);
    out.push(...entry);
    if (prev && next < 4096) { dict[next++] = [...prev, entry[0]]; if (next === 1 << codeSize && codeSize < 12) codeSize++; }
    prev = entry;
  }
  return Uint8Array.from(out);
}
function parseGif(b: Uint8Array) {
  assert.equal(String.fromCharCode(...b.subarray(0, 6)), 'GIF89a');
  const width = u16(b, 6), height = u16(b, 8), packed = b[10];
  assert.equal(packed & 0x80, 0x80, 'global colour table flag');
  const gctSize = 1 << ((packed & 7) + 1);
  let p = 13; const palette = b.subarray(p, p + gctSize * 3); p += gctSize * 3;
  const frames: { delayCs: number; w: number; h: number; indices: Uint8Array }[] = []; let loop: number | null = null; let delay = 0;
  while (p < b.length) {
    const tag = b[p++];
    if (tag === 0x3b) return { width, height, palette, frames, loop, trailerAt: p - 1, length: b.length };
    if (tag === 0x21) {
      const label = b[p++];
      if (label === 0xff) { const n = b[p++]; const id = String.fromCharCode(...b.subarray(p, p + n)); p += n; const sub: number[] = []; for (;;) { const l = b[p++]; if (!l) break; for (let i = 0; i < l; i++) sub.push(b[p++]); } if (id === 'NETSCAPE2.0') { assert.deepEqual(sub.slice(0, 1), [1]); loop = sub[1] | (sub[2] << 8); } }
      else if (label === 0xf9) { assert.equal(b[p++], 4); p++; delay = u16(b, p); p += 2; p++; assert.equal(b[p++], 0); }
      else throw new Error(`unexpected extension ${label}`);
    } else if (tag === 0x2c) {
      const w = u16(b, p + 4), h = u16(b, p + 6); assert.equal(b[p + 8] & 0x80, 0, 'no local colour table'); p += 9;
      const min = b[p++]; const data: number[] = []; for (;;) { const l = b[p++]; if (!l) break; for (let i = 0; i < l; i++) data.push(b[p++]); }
      frames.push({ delayCs: delay, w, h, indices: lzwDecode(Uint8Array.from(data), min, w * h) });
    } else throw new Error(`unexpected block ${tag} at ${p - 1}`);
  }
  throw new Error('no trailer');
}
const rgba = (w: number, h: number, fn: (x: number, y: number) => [number, number, number]) => { const a = new Uint8ClampedArray(w * h * 4); for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const [r, g, b] = fn(x, y); const p = (y * w + x) * 4; a[p] = r; a[p + 1] = g; a[p + 2] = b; a[p + 3] = 255; } return a; };

test('gif writer: header, screen size, global palette, loop extension, one image per frame, LZW round-trips every pixel, trailer', () => {
  const w = 7, h = 5;
  const f0 = rgba(w, h, (x) => (x < 3 ? [235, 103, 87] : [60, 140, 80]));
  const f1 = rgba(w, h, (x, y) => (y === 2 ? [250, 210, 60] : x < 3 ? [235, 103, 87] : [60, 140, 80]));
  const q = quantize([f0, f1], w, h);
  assert.equal(q.colours, 3);
  const gif = encodeGif(w, h, q.palette, [{ indices: q.frames[0], delayCs: 10 }, { indices: q.frames[1], delayCs: 10 }], 0);
  const g = parseGif(gif);
  assert.deepEqual([g.width, g.height, g.loop, g.frames.length], [w, h, 0, 2]);
  assert.equal(g.trailerAt, g.length - 1, 'the trailer is the last byte');
  assert.deepEqual(Array.from(g.frames[0].indices), Array.from(q.frames[0]));
  assert.deepEqual(Array.from(g.frames[1].indices), Array.from(q.frames[1]));
  assert.deepEqual(g.frames.map((f) => [f.w, f.h, f.delayCs]), [[w, h, 10], [w, h, 10]]);
  // the palette entries are the input colours (3 distinct, each bin averaged over identical pixels)
  const colour = (i: number) => [g.palette[i * 3], g.palette[i * 3 + 1], g.palette[i * 3 + 2]];
  const pix = (f: Uint8Array, x: number, y: number) => colour(f[y * w + x]);
  assert.deepEqual([pix(g.frames[0].indices, 0, 0), pix(g.frames[0].indices, 6, 0), pix(g.frames[1].indices, 6, 2)], [[235, 103, 87], [60, 140, 80], [250, 210, 60]]);
});

test('gif quantizer: more than 256 colours collapse to 256 nearest, and a long run exercises LZW code growth', () => {
  const w = 64, h = 32; // 2048 pixels, 1024 distinct colours, each twice
  const f = rgba(w, h, (x, y) => { const i = (y * w + x) >> 1; return [(i * 7) & 255, (i * 13) & 255, (i * 29) & 255]; });
  const q = quantize([f], w, h);
  assert.equal(q.colours, 256);
  let worst = 0;
  for (let i = 0, p = 0; i < w * h; i++, p += 4) { const c = q.frames[0][i]; const d = Math.hypot(q.palette[c * 3] - f[p], q.palette[c * 3 + 1] - f[p + 1], q.palette[c * 3 + 2] - f[p + 2]); worst = Math.max(worst, d); }
  assert.ok(worst < 120, `every pixel maps to a reasonably near palette colour (worst distance ${worst.toFixed(1)})`);
  const gif = encodeGif(w, h, q.palette, [{ indices: q.frames[0], delayCs: 5 }]);
  const g = parseGif(gif);
  assert.deepEqual(Array.from(g.frames[0].indices), Array.from(q.frames[0]), 'LZW round-trips a noisy frame');
  // a large flat frame compresses hard and still round-trips (dictionary resets past 4096 codes)
  const big = new Uint8Array(300 * 200).fill(0); for (let i = 0; i < big.length; i += 97) big[i] = (i / 97) & 255;
  const chunks: number[] = []; lzwEncode(big, { byte: (b) => chunks.push(b) }, 8);
  const data: number[] = []; let p = 1; for (;;) { const l = chunks[p++]; if (!l) break; for (let i = 0; i < l; i++) data.push(chunks[p++]); }
  assert.deepEqual(Array.from(lzwDecode(Uint8Array.from(data), 8, big.length)), Array.from(big));
  assert.ok(chunks.length < big.length / 4, `flat data compresses (${chunks.length} bytes for ${big.length} pixels)`);
});
