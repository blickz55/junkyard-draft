/**
 * Dependency-free GIF89a writer (PLAN-v1 share horizon, 0.4.11). Pure functions over typed arrays so Node can test them:
 *   - `quantize`: one global palette of at most 256 colours from every frame's RGBA pixels (the most frequent 15-bit colour
 *     bins, each averaged), then every pixel mapped to its nearest palette entry (cached per bin), deterministic;
 *   - `encodeGif`: header, logical screen with a global colour table, NETSCAPE2.0 loop extension, one graphic-control +
 *     image block per frame (LZW, minimum code size 8, 255-byte sub-blocks), trailer.
 * No disposal tricks and no frame differencing: every frame is a full image, which keeps every decoder happy.
 */

export interface GifFrame { indices: Uint8Array; delayCs: number }
export interface Quantized { palette: Uint8Array; frames: Uint8Array[]; colours: number }

const KEY = (r: number, g: number, b: number) => ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);

/** Build a palette (≤ `max` colours, RGB triples) from RGBA frames and index every frame against it. */
export function quantize(frames: Uint8ClampedArray[] | Uint8Array[], width: number, height: number, max = 256): Quantized {
  const n = width * height;
  const count = new Uint32Array(32768), sr = new Float64Array(32768), sg = new Float64Array(32768), sb = new Float64Array(32768);
  for (const f of frames) for (let i = 0, p = 0; i < n; i++, p += 4) { const k = KEY(f[p], f[p + 1], f[p + 2]); count[k]++; sr[k] += f[p]; sg[k] += f[p + 1]; sb[k] += f[p + 2]; }
  const used: number[] = []; for (let k = 0; k < 32768; k++) if (count[k]) used.push(k);
  used.sort((a, b) => count[b] - count[a] || a - b);
  const chosen = used.slice(0, max);
  const palette = new Uint8Array(256 * 3);
  chosen.forEach((k, i) => { palette[i * 3] = Math.round(sr[k] / count[k]); palette[i * 3 + 1] = Math.round(sg[k] / count[k]); palette[i * 3 + 2] = Math.round(sb[k] / count[k]); });
  const index = new Int16Array(32768).fill(-1);
  chosen.forEach((k, i) => { index[k] = i; });
  const nearest = (r: number, g: number, b: number) => { let best = 0, bd = Infinity; for (let i = 0; i < chosen.length; i++) { const dr = palette[i * 3] - r, dg = palette[i * 3 + 1] - g, db = palette[i * 3 + 2] - b; const d = dr * dr + dg * dg + db * db; if (d < bd) { bd = d; best = i; } } return best; };
  const out = frames.map((f) => {
    const idx = new Uint8Array(n);
    for (let i = 0, p = 0; i < n; i++, p += 4) { const k = KEY(f[p], f[p + 1], f[p + 2]); let c = index[k]; if (c < 0) { c = nearest(f[p], f[p + 1], f[p + 2]); index[k] = c; } idx[i] = c; }
    return idx;
  });
  return { palette, frames: out, colours: chosen.length };
}

class ByteSink {
  private buf = new Uint8Array(1 << 16); private n = 0;
  byte(b: number) { if (this.n === this.buf.length) { const g = new Uint8Array(this.buf.length * 2); g.set(this.buf); this.buf = g; } this.buf[this.n++] = b & 0xff; }
  bytes(a: ArrayLike<number>) { for (let i = 0; i < a.length; i++) this.byte(a[i]); }
  u16(v: number) { this.byte(v & 0xff); this.byte((v >> 8) & 0xff); }
  ascii(s: string) { for (let i = 0; i < s.length; i++) this.byte(s.charCodeAt(i)); }
  result() { return this.buf.slice(0, this.n); }
}

/** GIF-flavoured LZW over 8-bit indices, written as 255-byte sub-blocks (including the terminating empty block). */
export function lzwEncode(indices: Uint8Array, out: ByteSinkLike, minCodeSize = 8) {
  const clear = 1 << minCodeSize, eoi = clear + 1;
  let codeSize = minCodeSize + 1, next = eoi + 1;
  let table = new Map<number, number>();
  let acc = 0, bits = 0;
  const block = new Uint8Array(255); let bn = 0;
  const flushBlock = () => { if (!bn) return; out.byte(bn); for (let i = 0; i < bn; i++) out.byte(block[i]); bn = 0; };
  const emit = (code: number) => { acc |= code << bits; bits += codeSize; while (bits >= 8) { block[bn++] = acc & 0xff; acc >>>= 8; bits -= 8; if (bn === 255) flushBlock(); } };
  out.byte(minCodeSize);
  emit(clear);
  if (indices.length) {
    let prefix = indices[0];
    for (let i = 1; i < indices.length; i++) {
      const k = indices[i]; const key = (prefix << 8) | k;
      const code = table.get(key);
      if (code !== undefined) { prefix = code; continue; }
      emit(prefix);
      if (next === 4096) { emit(clear); table = new Map(); next = eoi + 1; codeSize = minCodeSize + 1; }
      else { if (next >= 1 << codeSize) codeSize++; table.set(key, next++); }
      prefix = k;
    }
    emit(prefix);
  }
  emit(eoi);
  if (bits > 0) { block[bn++] = acc & 0xff; if (bn === 255) flushBlock(); }
  flushBlock();
  out.byte(0);
}
export interface ByteSinkLike { byte(b: number): void }

/** Encode frames (indices into `palette`, 256 RGB triples) as a looping GIF89a. `loop` 0 = forever. */
export function encodeGif(width: number, height: number, palette: Uint8Array, frames: GifFrame[], loop = 0): Uint8Array {
  const s = new ByteSink();
  s.ascii('GIF89a');
  s.u16(width); s.u16(height);
  s.byte(0xf7); // global colour table, 8 bits per channel, 256 entries
  s.byte(0); s.byte(0);
  s.bytes(palette.length >= 768 ? palette.subarray(0, 768) : (() => { const p = new Uint8Array(768); p.set(palette); return p; })());
  // NETSCAPE2.0 looping
  s.byte(0x21); s.byte(0xff); s.byte(11); s.ascii('NETSCAPE2.0'); s.byte(3); s.byte(1); s.u16(loop); s.byte(0);
  for (const f of frames) {
    s.byte(0x21); s.byte(0xf9); s.byte(4); s.byte(0x04); s.u16(Math.max(2, Math.round(f.delayCs))); s.byte(0); s.byte(0); // disposal: leave in place
    s.byte(0x2c); s.u16(0); s.u16(0); s.u16(width); s.u16(height); s.byte(0);
    lzwEncode(f.indices, s, 8);
  }
  s.byte(0x3b);
  return s.result();
}
