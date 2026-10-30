/**
 * Tips panel (PLAN-v1 0.3.6; DOM since 0.4.12): a list of tips with one live mini-simulation, stepped by the real
 * simulation and drawn from the real textures onto a small 2D canvas, so it can never contradict the rules. Opened
 * from the title and from the build phase as a layer over the current DOM screen; opening a tip marks it read
 * (storage) so its badge never returns. Tips never write to the hint strip: rejections (0.3.2) own that channel.
 * The texts come from the string table through game/src/content/tips.ts (0.9.0).
 */
import type Phaser from 'phaser';
import { tips as allTips, type Tip } from '../content/tips';
import { createSim, step, cellIndex, type SimState } from '../sim/sim';
import type { Material } from '../sim/types';
import { itemTexture, machineTexture } from '../render/textures';
import { artFrame } from '../render/atlas';
import { P } from '../render/palette';
import { loadReadTips, markTipRead } from '../render/storage';
import { prefs } from '../render/prefs';
import { telemetry } from '../render/telemetry';
import { btn, h, ui } from './dom';
import { t } from '../content/strings';
import { materialName } from '../content/machines';

const DEMO_CELL = 54;
const DEMO_ITEM = 18;
const DEMO_TICK_MS = 240;
const BACKING = 2; // canvas pixels per logical pixel; crisp at the overlay's usual scale
const hex = (n: number) => `#${n.toString(16).padStart(6, '0')}`;
const easeInOut = (x: number) => (x < 0.5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2);

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
  private prevFocus: HTMLElement | null = null;
  private list: Tip[] = [];

  constructor(private readonly scene: Phaser.Scene, private readonly onClose?: () => void) {}

  get isOpen(): boolean { return this.root != null; }
  get currentId(): string | null { return this.current; }
  /** Demo progress for tests: current tick and what shipped so far in this loop. */
  demoState() { return this.demoSim ? { tip: this.demoTip?.id ?? null, tick: this.demoSim.tick, shipped: { ...this.demoSim.shipped } } : null; }

  open(tipId?: string) {
    if (this.root) { if (tipId) this.show(tipId); return; }
    this.list = allTips();
    const read = loadReadTips();
    this.nav.clear();
    const nav = h('div', { class: 'jd-tips-nav', role: 'tablist' }, ...this.list.map((tip) => { const b = btn((read.includes(tip.id) ? '' : t('tips.unread')) + tip.title, `tip-${tip.id}`, () => this.show(tip.id), { small: true }); b.setAttribute('role', 'tab'); this.nav.set(tip.id, b); return b; }));
    this.body = h('div', { class: 'jd-tips-body' });
    const box = h('div', { class: 'jd-tips-box jd-panel', role: 'dialog', ariaLabel: t('tips.aria'), tid: 'tips-panel' },
      h('div', { class: 'jd-row jd-between' }, h('div', { class: 'jd-head' }, t('tips.head')), btn(t('common.close'), 'tips-close', () => this.close(), { small: true })),
      h('div', { class: 'jd-tips-cols' }, nav, this.body));
    this.root = h('div', { class: 'jd-tips', onClick: (e) => { if (e.target === this.root) this.close(); } }, box);
    // modal focus: keys typed here never reach the scenes, Tab cycles inside the dialog, focus returns on close
    this.prevFocus = document.activeElement as HTMLElement | null;
    this.root.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { e.preventDefault(); this.close(); }
      else if (e.key === 'Tab') { const f = [...box.querySelectorAll<HTMLElement>('button, [tabindex]:not([tabindex="-1"])')]; const i = f.indexOf(document.activeElement as HTMLElement); if (f.length) { e.preventDefault(); f[(i + (e.shiftKey ? -1 : 1) + f.length) % f.length].focus(); } }
      e.stopPropagation();
    });
    ui.layer(this.scene, this.root);
    this.show(tipId ?? this.list[0].id);
    (box.querySelector('[data-testid=tips-close]') as HTMLElement | null)?.focus();
  }

  close() {
    if (!this.root) return;
    this.stopDemo();
    this.root.remove(); this.root = null; this.body = null; this.watch = null; this.canvas = null; this.current = null;
    const back = this.prevFocus; this.prevFocus = null; if (back && back.isConnected) back.focus();
    this.onClose?.();
  }

  /** Show one tip: its text, its demo loop, and mark it read. */
  private show(tipId: string) {
    const tip = this.list.find((x) => x.id === tipId); if (!tip || !this.body) return;
    this.current = tipId;
    markTipRead(tipId);
    telemetry.track('tip_opened', { id: tipId });
    for (const [id, b] of this.nav) { b.classList.toggle('jd-active', id === tipId); b.setAttribute('aria-selected', String(id === tipId)); if (id === tipId) b.textContent = tip.title; }
    this.stopDemo();
    this.body.replaceChildren(h('div', { class: 'jd-tips-title' }, tip.title), h('p', { class: 'jd-dim jd-tips-text' }, tip.text));
    this.canvas = null; this.watch = null;
    if (!tip.layout) return;
    const gw = tip.layout.width * DEMO_CELL, gh = tip.layout.height * DEMO_CELL;
    const canvas = h('canvas', { class: 'jd-tips-demo', tid: 'tips-demo', ariaLabel: t('tips.demoAria', { title: tip.title }) });
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
      const sc = it.hold > 0 ? 0.85 : 1;
      this.blit(ctx, itemTexture(it.mat as Material), x - (DEMO_ITEM / 2) * sc, y - (DEMO_ITEM / 2) * sc, DEMO_ITEM * sc, DEMO_ITEM * sc);
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
      const shipped = (Object.entries(now.shipped) as [Material, number][]).filter(([, n]) => n > 0).map(([k, n]) => `${n} ${materialName(k)}`).join(', ');
      if (this.watch) this.watch.textContent = t('tips.watchLine', { watch: tip.watch, tick: now.tick, total: tip.ticks, shipped: shipped || t('tips.nothingYet') });
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
