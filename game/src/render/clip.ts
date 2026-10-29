/**
 * Loop-clip export (PLAN-v1 0.4.2, DOSSIER-v1 §2.6): re-simulate one round with the real simulation and draw it with the
 * real generated textures onto an offscreen 2D canvas at 4×, cropped to the grid plus a 24 px margin, with a 56 px strip
 * (seed or date, round earnings, player, wordmark) on every frame; two passes with a short hold so the file loops cleanly;
 * recorded live through canvas.captureStream + MediaRecorder (VP9 → VP8 → MP4 by support). Always full motion: the
 * viewer's motion setting, not the exporter's, decides how a clip is watched. Nothing here touches scores or saves.
 * `renderGif` (0.4.11) draws the same round offline at 1× and 10 fps, one pass plus a hold, and encodes it with the
 * dependency-free GIF89a writer in gif.ts (one global palette quantised from every frame); GIFs loop natively.
 */
import type Phaser from 'phaser';
import { createSim, step, cellIndex, type SimState } from '../sim/sim';
import { RULES } from '../sim/rules';
import type { Layout, Material, SimEvent } from '../sim/types';
import { BELT_FRAMES, CELL, itemTexture, machineTexture } from './textures';
import { CSS, FONT, MONO, P } from './palette';
import { artFrame } from './atlas';
import { encodeGif, quantize } from './gif';

export interface ClipOptions {
  /** 1-based round to export; default the highest-earning round */
  round?: number;
  /** true only when this exact run's replay was accepted by a verifier: the footer says so, otherwise it says local (review F10) */
  verified?: boolean;
  speed?: number;
  passes?: number;
  holdMs?: number;
  fps?: number;
  player?: string;
  /** cap on the output height in device pixels (default 720) */
  maxHeight?: number;
  onProgress?: (fraction: number) => void;
}
export interface ClipResult { blob: Blob; mime: string; ms: number; frames: number; round: number; width: number; height: number; filename: string; footer: string }
/** The wordmark line on every frame: a verification claim only for a verified replay (CLAUDE.md: never label local results verified). */
export const clipFooter = (verified: boolean) => (verified ? 'junkyard draft · verified replay' : 'junkyard draft · local run · not verified');
export interface GifOptions { round?: number; speed?: number; holdMs?: number; fps?: number; player?: string; verified?: boolean; onProgress?: (fraction: number) => void }
export interface GifResult extends ClipResult { colours: number; magic: string }

const MARGIN = 24;
const STRIP = 56;
const TICK_MS = 170;
const POP_MS = 700;

/** The best-supported container for MediaRecorder here, or null when recording is unavailable. */
export function pickClipMime(): string | null {
  if (typeof MediaRecorder === 'undefined') return null;
  for (const m of ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm', 'video/mp4;codecs=avc1', 'video/mp4']) if (MediaRecorder.isTypeSupported(m)) return m;
  return null;
}
export const clipFilename = (seed: string, score: number, round: number, mime: string) => `junkyard-${seed.replace(/[^a-z0-9-]+/gi, '_').slice(0, 40)}-$${score}-r${round}.${mime.includes('gif') ? 'gif' : mime.includes('mp4') ? 'mp4' : 'webm'}`;
const hex = (n: number) => `#${n.toString(16).padStart(6, '0')}`;
const easeInOut = (t: number) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);

/** Draws one round of a layout frame by frame; pure canvas 2D over the generated textures. */
export class ClipPainter {
  readonly canvas: HTMLCanvasElement;
  readonly ctx: CanvasRenderingContext2D;
  readonly scale: number;
  readonly width: number;
  readonly height: number;
  private img = new Map<string, { image: CanvasImageSource; x: number; y: number; w: number; h: number } | null>();
  private pops: { x: number; y: number; value: number; at: number }[] = [];
  private jammed = new Set<number>();
  constructor(private readonly game: Phaser.Game, private readonly layout: Layout, private readonly label: { title: string; seed: string; player: string; round: number; totalBefore: number; footer: string }, maxHeight = 720, scaleCap = Infinity) {
    const w0 = layout.width * CELL + MARGIN * 2, h0 = layout.height * CELL + MARGIN * 2 + STRIP;
    this.scale = Math.min(Math.max(1, window.devicePixelRatio || 1), maxHeight / h0, scaleCap);
    this.width = Math.round(w0 * this.scale); this.height = Math.round(h0 * this.scale);
    this.canvas = document.createElement('canvas'); this.canvas.width = this.width; this.canvas.height = this.height;
    const ctx = this.canvas.getContext('2d'); if (!ctx) throw new Error('2D canvas unavailable');
    this.ctx = ctx;
  }
  /** Draw a texture key at dx,dy,dw,dh using its atlas cut (frame-aware, so aliases into the shared atlas draw only their region). */
  private blit(key: string, dx: number, dy: number, dw: number, dh: number) {
    if (!this.img.has(key)) this.img.set(key, artFrame(this.game, key));
    const f = this.img.get(key); if (!f) return;
    this.ctx.drawImage(f.image, f.x, f.y, f.w, f.h, dx, dy, dw, dh);
  }
  private cellXY(cell: number) { const x = cell % this.layout.width, y = Math.floor(cell / this.layout.width); return { x: MARGIN + x * CELL + CELL / 2, y: MARGIN + y * CELL + CELL / 2 }; }
  /** Record this tick's events (pops and jams) before drawing the frame. */
  onTick(evs: SimEvent[], nowMs: number) {
    this.jammed.clear();
    for (const e of evs) {
      if (e.kind === 'ship' && e.value != null) { const c = this.cellXY(e.cell); this.pops.push({ x: c.x, y: c.y - 10, value: e.value, at: nowMs }); }
      else if (e.kind === 'jam') this.jammed.add(e.cell);
    }
  }
  reset() { this.pops = []; this.jammed.clear(); }
  draw(sim: SimState, phase: number, nowMs: number, beltFrame: number) {
    const { ctx, scale } = this;
    ctx.save(); ctx.setTransform(scale, 0, 0, scale, 0, 0);
    ctx.fillStyle = hex(P.bg); ctx.fillRect(0, 0, this.width / scale, this.height / scale);
    for (let y = 0; y < this.layout.height; y++) for (let x = 0; x < this.layout.width; x++) this.blit('tile', MARGIN + x * CELL, MARGIN + y * CELL, CELL, CELL);
    ctx.strokeStyle = hex(P.panelLine); ctx.lineWidth = 2; ctx.strokeRect(MARGIN, MARGIN, this.layout.width * CELL, this.layout.height * CELL);
    for (const cell of this.jammed) { const c = this.cellXY(cell); ctx.fillStyle = 'rgba(235,103,87,0.28)'; ctx.fillRect(c.x - CELL / 2, c.y - CELL / 2, CELL, CELL); }
    for (const m of this.layout.machines) {
      const c = this.cellXY(cellIndex(m.x, m.y, this.layout.width));
      ctx.save(); ctx.translate(c.x, c.y); ctx.rotate((m.dir * Math.PI) / 2);
      const heldItem = sim.itemAt[cellIndex(m.x, m.y, this.layout.width)];
      const busy = !!heldItem && heldItem.hold > 0;
      const key = m.kind === 'crusher' && busy && sim.tick % 2 === 1 ? 'm-crusher-1' : m.kind === 'press' && busy ? (heldItem!.hold >= 2 ? 'm-press-1' : 'm-press-2') : machineTexture(m.kind);
      this.blit(key, -CELL / 2, -CELL / 2, CELL, CELL);
      if (m.kind === 'conveyor') this.blit(`belt-${beltFrame % BELT_FRAMES}`, -CELL / 2, -CELL / 2, CELL, CELL);
      ctx.restore();
    }
    for (const it of sim.items) {
      const to = this.cellXY(it.cell);
      let x = to.x, y = to.y;
      if (it.movedAt === sim.tick && it.from >= 0) { const from = this.cellXY(it.from); const e = easeInOut(phase); x = from.x + (to.x - from.x) * e; y = from.y + (to.y - from.y) * e; }
      const s = it.hold > 0 ? 0.85 : 1;
      this.blit(itemTexture(it.mat as Material), x - 12 * s, y - 12 * s, 24 * s, 24 * s);
    }
    ctx.font = `bold 15px ${FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    this.pops = this.pops.filter((p) => nowMs - p.at < POP_MS);
    for (const p of this.pops) { const t = (nowMs - p.at) / POP_MS; ctx.globalAlpha = 1 - t; ctx.fillStyle = p.value >= 12 ? CSS.gold : p.value >= 3 ? CSS.green : CSS.text; ctx.fillText(`+$${p.value}`, p.x, p.y - 38 * t); }
    ctx.globalAlpha = 1;
    // strip
    const sy = MARGIN * 2 + this.layout.height * CELL;
    ctx.fillStyle = hex(P.panel); ctx.fillRect(0, sy, this.width / scale, STRIP);
    ctx.fillStyle = hex(P.panelLine); ctx.fillRect(0, sy, this.width / scale, 1);
    ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = CSS.amber; ctx.font = `bold 14px ${FONT}`; ctx.fillText(this.label.title, 16, sy + 22);
    ctx.fillStyle = CSS.dim; ctx.font = `11px ${MONO}`; ctx.fillText(this.label.seed, 16, sy + 42);
    ctx.textAlign = 'center'; ctx.fillStyle = CSS.gold; ctx.font = `bold 20px ${FONT}`; ctx.fillText(`$${sim.earned}`, this.width / scale / 2, sy + 26);
    ctx.fillStyle = CSS.dim; ctx.font = `11px ${FONT}`; ctx.fillText(`round ${this.label.round} · tick ${sim.tick}/${RULES.ticksPerRound} · total $${this.label.totalBefore + sim.earned}`, this.width / scale / 2, sy + 44);
    ctx.textAlign = 'right'; ctx.fillStyle = CSS.text; ctx.font = `bold 12px ${FONT}`; ctx.fillText(this.label.player, this.width / scale - 16, sy + 24);
    ctx.fillStyle = CSS.dim; ctx.font = `10px ${MONO}`; ctx.fillText(this.label.footer, this.width / scale - 16, sy + 42);
    ctx.restore();
  }
}

/** Record a loop clip of one round. Runs in real time (speed × tick rate) because MediaRecorder captures live frames. */
export function recordClip(game: Phaser.Game, run: { seed: string; score: number; rounds: { round: number; earned: number; layout: Layout }[] }, o: ClipOptions = {}): Promise<ClipResult> {
  return new Promise((resolve, reject) => {
    const mime = pickClipMime();
    if (!mime) return reject(new Error('This browser cannot record video (MediaRecorder unavailable).'));
    const best = run.rounds.reduce((b, r) => (r.earned > b.earned ? r : b), run.rounds[0]);
    const rec = o.round ? run.rounds.find((r) => r.round === o.round) ?? best : best;
    if (!rec) return reject(new Error('No finished round to export.'));
    const totalBefore = run.rounds.filter((r) => r.round < rec.round).reduce((a, r) => a + r.earned, 0);
    const seedLabel = /^daily-(\d{4}-\d{2}-\d{2})$/.test(run.seed) ? `Daily ${run.seed.slice(6)}` : `seed ${run.seed}`;
    const footer = clipFooter(o.verified === true);
    const painter = new ClipPainter(game, rec.layout, { title: 'JUNKYARD DRAFT', seed: seedLabel, player: o.player || 'anonymous', round: rec.round, totalBefore, footer }, o.maxHeight ?? 720);
    const speed = o.speed ?? 4, passes = o.passes ?? 2, holdMs = o.holdMs ?? 300, fps = o.fps ?? 30;
    // the canvas must be painted to be captured: keep it in the document, out of sight
    painter.canvas.style.cssText = 'position:fixed;left:-10000px;top:0;pointer-events:none';
    document.body.append(painter.canvas);
    const stream = painter.canvas.captureStream(fps);
    const recorder = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 4_000_000 });
    const chunks: Blob[] = [];
    recorder.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
    const cleanup = () => { painter.canvas.remove(); stream.getTracks().forEach((t) => t.stop()); };
    const t0 = performance.now();
    let frames = 0;
    recorder.onerror = () => { cleanup(); reject(new Error('Recording failed.')); };
    recorder.onstop = () => {
      cleanup();
      const blob = new Blob(chunks, { type: mime });
      resolve({ blob, mime, ms: Math.round(performance.now() - t0), frames, round: rec.round, width: painter.width, height: painter.height, filename: clipFilename(run.seed, run.score, rec.round, mime), footer });
    };
    let sim: SimState = createSim(rec.layout);
    let pass = 0; let acc = 0; let last = 0; let holdUntil = 0; let belt = 0;
    const tickMs = TICK_MS / speed;
    const totalMs = passes * (RULES.ticksPerRound * tickMs + holdMs);
    const frame = (now: number) => {
      if (!last) last = now;
      const delta = Math.min(100, now - last); last = now;
      if (holdUntil) {
        if (now >= holdUntil) { holdUntil = 0; pass++; if (pass >= passes) { painter.draw(sim, 1, now, Math.floor(belt)); recorder.stop(); return; } sim = createSim(rec.layout); painter.reset(); acc = 0; }
      } else {
        acc += delta;
        let guard = 0;
        while (acc >= tickMs && guard++ < 10 && sim.tick < RULES.ticksPerRound) { acc -= tickMs; const evs = step(sim); painter.onTick(evs, now); }
        if (sim.tick >= RULES.ticksPerRound) holdUntil = now + holdMs;
      }
      belt = (belt + delta * speed * 0.012 * (BELT_FRAMES / 3)) % BELT_FRAMES;
      painter.draw(sim, Math.min(1, acc / tickMs), now, Math.floor(belt));
      frames++;
      o.onProgress?.(Math.min(1, (now - t0) / totalMs));
      requestAnimationFrame(frame);
    };
    recorder.start(250);
    requestAnimationFrame(frame);
  });
}

/** Which round a clip shows and its labels; shared by the video and GIF exporters. */
function pickRound(run: { seed: string; rounds: { round: number; earned: number; layout: Layout }[] }, round?: number) {
  const best = run.rounds.reduce((b, r) => (r.earned > b.earned ? r : b), run.rounds[0]);
  const rec = round ? run.rounds.find((r) => r.round === round) ?? best : best;
  if (!rec) return null;
  const totalBefore = run.rounds.filter((r) => r.round < rec.round).reduce((a, r) => a + r.earned, 0);
  const seedLabel = /^daily-(\d{4}-\d{2}-\d{2})$/.test(run.seed) ? `Daily ${run.seed.slice(6)}` : `seed ${run.seed}`;
  return { rec, totalBefore, seedLabel };
}

/**
 * Render one round as a looping GIF, offline (no real-time capture): one pass of the round at `speed` plus a short hold,
 * `fps` frames per second at 1× pixels. Two drawing passes over a deterministic clock — the first only gathers the
 * palette, the second indexes each frame as it is drawn, so memory stays at one byte per pixel per frame.
 */
export async function renderGif(game: Phaser.Game, run: { seed: string; score: number; rounds: { round: number; earned: number; layout: Layout }[] }, o: GifOptions = {}): Promise<GifResult> {
  const picked = pickRound(run, o.round);
  if (!picked) throw new Error('No finished round to export.');
  const { rec, totalBefore, seedLabel } = picked;
  const footer = clipFooter(o.verified === true);
  const painter = new ClipPainter(game, rec.layout, { title: 'JUNKYARD DRAFT', seed: seedLabel, player: o.player || 'anonymous', round: rec.round, totalBefore, footer }, Infinity, 1);
  const speed = o.speed ?? 4, holdMs = o.holdMs ?? 400, fps = o.fps ?? 10;
  const tickMs = TICK_MS / speed, frameMs = 1000 / fps;
  const totalMs = RULES.ticksPerRound * tickMs + holdMs;
  const frameCount = Math.ceil(totalMs / frameMs);
  const t0 = performance.now();
  const yieldNow = () => new Promise<void>((r) => setTimeout(r, 0));
  const drawAll = async (each: (data: Uint8ClampedArray, i: number) => void, progressBase: number) => {
    let sim: SimState = createSim(rec.layout); painter.reset();
    let acc = 0, belt = 0, now = 0;
    for (let i = 0; i < frameCount; i++) {
      if (sim.tick < RULES.ticksPerRound) {
        acc += frameMs;
        while (acc >= tickMs && sim.tick < RULES.ticksPerRound) { acc -= tickMs; const evs = step(sim); painter.onTick(evs, now); }
      }
      belt = (belt + frameMs * speed * 0.012 * (BELT_FRAMES / 3)) % BELT_FRAMES;
      painter.draw(sim, sim.tick < RULES.ticksPerRound ? Math.min(1, acc / tickMs) : 1, now, Math.floor(belt));
      each(painter.ctx.getImageData(0, 0, painter.width, painter.height).data, i);
      now += frameMs;
      if (i % 8 === 7) { o.onProgress?.(progressBase + (0.5 * (i + 1)) / frameCount); await yieldNow(); }
    }
  };
  // pass 1: palette from every frame
  const seen: Uint8ClampedArray[] = [];
  await drawAll((d) => { seen.push(d); }, 0);
  const q = quantize(seen, painter.width, painter.height);
  seen.length = 0;
  // pass 2: index each frame against it
  const frames: { indices: Uint8Array; delayCs: number }[] = [];
  await drawAll((d) => { frames.push({ indices: quantizeWith(q.palette, q.colours, d, painter.width * painter.height), delayCs: Math.round(frameMs / 10) }); }, 0.5);
  const bytes = encodeGif(painter.width, painter.height, q.palette, frames, 0);
  const blob = new Blob([bytes as unknown as BlobPart], { type: 'image/gif' });
  o.onProgress?.(1);
  return { blob, mime: 'image/gif', ms: Math.round(totalMs), frames: frames.length, round: rec.round, width: painter.width, height: painter.height, filename: clipFilename(run.seed, run.score, rec.round, 'image/gif'), footer, colours: q.colours, magic: String.fromCharCode(...bytes.subarray(0, 6)), elapsed: Math.round(performance.now() - t0) } as GifResult & { elapsed: number };
}
/** Index one RGBA frame against a fixed palette (nearest colour, cached per 15-bit bin). */
function quantizeWith(palette: Uint8Array, colours: number, data: Uint8ClampedArray, n: number): Uint8Array {
  const cache = new Int16Array(32768).fill(-1);
  const out = new Uint8Array(n);
  for (let i = 0, p = 0; i < n; i++, p += 4) {
    const r = data[p], g = data[p + 1], b = data[p + 2];
    const k = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);
    let c = cache[k];
    if (c < 0) { let best = 0, bd = Infinity; for (let j = 0; j < colours; j++) { const dr = palette[j * 3] - r, dg = palette[j * 3 + 1] - g, db = palette[j * 3 + 2] - b; const d = dr * dr + dg * dg + db * db; if (d < bd) { bd = d; best = j; } } c = best; cache[k] = c; }
    out[i] = c;
  }
  return out;
}

/** Save a finished clip: through the Electron bridge when present (no dialog), else a browser download. Returns where it went. */
export async function saveClip(clip: ClipResult): Promise<string> {
  const bridge = (window as unknown as { jdDesktop?: { saveClip?: (name: string, bytes: ArrayBuffer) => Promise<string> } }).jdDesktop;
  if (bridge?.saveClip) return bridge.saveClip(clip.filename, await clip.blob.arrayBuffer());
  const a = document.createElement('a');
  a.href = URL.createObjectURL(clip.blob); a.download = clip.filename; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  return clip.filename;
}
