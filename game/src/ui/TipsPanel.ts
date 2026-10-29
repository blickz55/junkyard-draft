/**
 * Tips panel (PLAN-v1 0.3.6; DOM since 0.4.12): a list of tips with one live mini-simulation, stepped by the real
 * simulation and drawn from the real textures onto a small 2D canvas, so it can never contradict the rules. Opened
 * from the title and from the build phase as a layer over the current DOM screen; opening a tip marks it read
 * (storage) so its badge never returns. Tips never write to the hint strip: rejections (0.3.2) own that channel.
 */
import type Phaser from 'phaser';
import { TIPS, type Tip } from '../sim/tips';
import { createSim, step, cellIndex, type SimState } from '../sim/sim';
import type { Material } from '../sim/types';
import { CELL, itemTexture, machineTexture } from '../render/textures';
import { artFrame } from '../render/atlas';
import { P } from '../render/palette';
import { loadReadTips, markTipRead } from '../render/storage';
import { prefs } from '../render/prefs';
import { telemetry } from '../render/telemetry';
import { btn, h, ui } from './dom';

const DEMO_CELL = 54;
const DEMO_ITEM = 18;
const DEMO_TICK_MS = 240;
const BACKING = 2; // canvas pixels per logical pixel; crisp at the overlay's usual scale
const hex = (n: number) => `#${n.toString(16).padStart(6, '0')}`;
const easeInOut = (t: number) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);

export class TipsPanel {
  private root: HTMLElement | null = null;
  private body: HTMLElement | null = null;
  private watch: HTMLElement | null = null;
  private canvas: HTMLCanvasElement | null = null;
  private nav = new Map<string, HTMLButtonElement>();
  private frames = new Map<string, ReturnType<typeof artFrame>>();
  private demoSim: SimState | null = null;
  private demoTip: Tip | null = null;
  private timer: Phaser.Time.TimerEvent | null = null;
  private raf = 0;
  private lastTickAt = 0;
  private current: string | null = null;

  constructor(private readonly scene: Phaser.Scene, private readonly onClose?: () => void) {}

  get isOpen(): boolean { return this.root != null; }
  get currentId(): string | null { return this.current; }
  /** Demo progress for tests: current tick and what shipped so far in this loop. */
  demoState() { return this.demoSim ? { tip: this.demoTip?.id ?? null, tick: this.demoSim.tick, shipped: { ...this.demoSim.shipped } } : null; }

  open(tipId?: string) {
    if (this.root) { if (tipId) this.show(tipId); return; }
    const read = loadReadTips();
    this.nav.clear();
    const list = h('div', { class: 'jd-tips-nav', role: 'tablist' }, ...TIPS.map((t) => { const b = btn((read.includes(t.id) ? '' : '● ') + t.title, `tip-${t.id}`, () => this.show(t.id), { small: true }); b.setAttribute('role', 'tab'); this.nav.set(t.id, b); return b; }));
    this.body = h('div', { class: 'jd-tips-body' });
    const box = h('div', { class: 'jd-tips-box jd-panel', role: 'dialog', ariaLabel: 'Tips', tid: 'tips-panel' },
      h('div', { class: 'jd-row jd-between' }, h('div', { class: 'jd-head' }, 'Tips — each demo is the real simulation'), btn('Close (Esc)', 'tips-close', () => this.close(), { small: true })),
      h('div', { class: 'jd-tips-cols' }, list, this.body));
    this.root = h('div', { class: 'jd-tips', onClick: (e) => { if (e.target === this.root) this.close(); } }, box);
    ui.layer(this.scene, this.root);
    this.show(tipId ?? TIPS[0].id);
  }

  close() {
    if (!this.root) return;
    this.stopDemo();
    this.root.remove(); this.root = null; this.body = null; this.watch = null; this.canvas = null; this.current = null;
    this.onClose?.();
  }

  /** Show one tip: its text, its demo loop, and mark it read. */
  private show(tipId: string) {
    const tip = TIPS.find((t) => t.id === tipId); if (!tip || !this.body) return;
    this.current = tipId;
    markTipRead(tipId);
    telemetry.track('tip_opened', { id: tipId });
    for (const [id, b] of this.nav) { b.classList.toggle('jd-active', id === tipId); b.setAttribute('aria-selected', String(id === tipId)); if (id === tipId) b.textContent = tip.title; }
    this.stopDemo();
    this.body.replaceChildren(h('div', { class: 'jd-tips-title' }, tip.title), h('p', { class: 'jd-dim jd-tips-text' }, tip.text));
    this.canvas = null; this.watch = null;
    if (!tip.layout) return;
    const gw = tip.layout.width * DEMO_CELL, gh = tip.layout.height * DEMO_CELL;
    const canvas = h('canvas', { class: 'jd-tips-demo', tid: 'tips-demo', ariaLabel: `${tip.title}: live demo` });
    canvas.width = gw * BACKING; canvas.height = gh * BACKING;
    canvas.style.width = `calc(${gw} * var(--px))`; canvas.style.height = `calc(${gh} * var(--px))`;
    this.watch = h('div', { class: 'jd-tips-watch', tid: 'tips-watch' }, tip.watch);
    this.body.append(canvas, this.watch);
    this.canvas = canvas;
    this.startDemo(tip);
  }

  private blit(ctx: CanvasRenderingContext2D, key: string, dx: number, dy: number, dw: number, dh: number) {
    if (!this.frames.has(key)) this.frames.set(key, artFrame(this.scene.game, key));
    const f = this.frames.get(key); if (!f) return;
    ctx.drawImage(f.image, f.x, f.y, f.w, f.h, dx, dy, dw, dh);
  }
  /** Draw the demo's current state; `phase` 0..1 slides items that moved this tick. */
  private draw(phase: number) {
    const sim = this.demoSim, tip = this.demoTip, canvas = this.canvas; if (!sim || !tip?.layout || !canvas) return;
    const ctx = canvas.getContext('2d'); if (!ctx) return;
    const L = tip.layout; const at = (cell: number) => ({ x: (cell % L.width) * DEMO_CELL + DEMO_CELL / 2, y: Math.floor(cell / L.width) * DEMO_CELL + DEMO_CELL / 2 });
    ctx.save(); ctx.setTransform(BACKING, 0, 0, BACKING, 0, 0);
    ctx.fillStyle = hex(P.bg); ctx.fillRect(0, 0, L.width * DEMO_CELL, L.height * DEMO_CELL);
    for (let y = 0; y < L.height; y++) for (let x = 0; x < L.width; x++) this.blit(ctx, 'tile', x * DEMO_CELL, y * DEMO_CELL, DEMO_CELL, DEMO_CELL);
    for (const m of L.machines) {
      const c = at(cellIndex(m.x, m.y, L.width));
      ctx.save(); ctx.translate(c.x, c.y); ctx.rotate((m.dir * Math.PI) / 2);
      this.blit(ctx, machineTexture(m.kind), -DEMO_CELL / 2, -DEMO_CELL / 2, DEMO_CELL, DEMO_CELL);
      ctx.restore();
    }
    for (const it of sim.items) {
      const to = at(it.cell); let x = to.x, y = to.y;
      if (it.movedAt === sim.tick && it.from >= 0 && phase < 1) { const from = at(it.from); const e = easeInOut(phase); x = from.x + (to.x - from.x) * e; y = from.y + (to.y - from.y) * e; }
      const s = it.hold > 0 ? 0.85 : 1;
      this.blit(ctx, itemTexture(it.mat as Material), x - (DEMO_ITEM / 2) * s, y - (DEMO_ITEM / 2) * s, DEMO_ITEM * s, DEMO_ITEM * s);
    }
    ctx.restore();
  }

  private startDemo(tip: Tip) {
    if (!tip.layout) return;
    this.demoTip = tip;
    this.demoSim = createSim(tip.layout);
    this.lastTickAt = performance.now();
    const tickOnce = () => {
      const sim = this.demoSim; if (!sim || !tip.layout) return;
      if (sim.tick >= tip.ticks) { this.demoSim = createSim(tip.layout); } // loop: restart from an empty line
      else step(sim);
      this.lastTickAt = performance.now();
      const now = this.demoSim!;
      const shipped = Object.entries(now.shipped).filter(([, n]) => n > 0).map(([k, n]) => `${n} ${k}`).join(', ');
      if (this.watch) this.watch.textContent = `${tip.watch}  ·  tick ${now.tick}/${tip.ticks}  ·  shipped: ${shipped || 'nothing yet'}`;
    };
    this.timer = this.scene.time.addEvent({ delay: DEMO_TICK_MS, loop: true, callback: tickOnce });
    const frame = () => {
      if (!this.demoSim) return;
      const phase = prefs.reducedMotion ? 1 : Math.min(1, (performance.now() - this.lastTickAt) / (DEMO_TICK_MS * 0.7));
      this.draw(phase);
      this.raf = requestAnimationFrame(frame);
    };
    this.draw(1);
    this.raf = requestAnimationFrame(frame);
  }
  private stopDemo() {
    this.timer?.remove(false); this.timer = null;
    if (this.raf) cancelAnimationFrame(this.raf); this.raf = 0;
    this.demoSim = null; this.demoTip = null;
  }
}
