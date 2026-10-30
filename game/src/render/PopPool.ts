/**
 * Pooled "+$value" pops (0.3.9; extracted from GameScene in production roadmap 0.9.4). A busy round ships dozens of items
 * and a fresh Text per ship rasterised a canvas each time, so at most POP_POOL texts exist; when all are busy the visual is
 * skipped and a counter says so. The scene supplies how to make a text and how to tween it, so the pool knows no Phaser.
 */
import { CSS } from './palette';
import { px as fpx } from './prefs';

export const POP_POOL = 16;

/** The part of a text object the pool drives (Phaser.GameObjects.Text satisfies it). */
export interface PopText { visible: boolean; setText(text: string): unknown; setStyle(style: { fontSize: string; color: string }): unknown; setPosition(x: number, y: number): unknown; setAlpha(a: number): unknown; setVisible(v: boolean): unknown }
export interface PopTween { targets: PopText; alpha: number; y?: number; duration: number; delay?: number; onComplete: () => void }
export interface PopFactory { /** a hidden text, origin centred, above everything else */ make(): PopText; tween(cfg: PopTween): void }

export class PopPool {
  private pool: PopText[] = [];
  private alive = 0;
  private peak = 0;
  private skipped = 0;
  constructor(private readonly f: PopFactory, private readonly max: number = POP_POOL) {}

  /** Show "+$value" at a cell; reduced motion fades in place instead of travelling. */
  pop(x: number, y: number, value: number, reducedMotion: boolean): boolean {
    let txt = this.pool.find((p) => !p.visible);
    if (!txt) {
      if (this.pool.length >= this.max) { this.skipped++; return false; }
      txt = this.f.make();
      this.pool.push(txt);
    }
    const p = txt;
    p.setText(`+$${value}`); p.setStyle({ fontSize: fpx(value >= 12 ? 20 : 15), color: value >= 12 ? CSS.gold : value >= 3 ? CSS.green : CSS.text }); p.setPosition(x, y - 10); p.setAlpha(1); p.setVisible(true);
    this.alive++; this.peak = Math.max(this.peak, this.alive);
    const done = () => { p.setVisible(false); this.alive--; };
    if (reducedMotion) this.f.tween({ targets: p, alpha: 0, duration: 900, delay: 300, onComplete: done });
    else this.f.tween({ targets: p, y: y - 48, alpha: 0, duration: 700, onComplete: done });
    return true;
  }
  /** Counters (dev API / tests / perf): alive now, the peak so far, ships whose pop was skipped, pool size and cap. */
  counters() { return { popsAlive: this.alive, popsPeak: this.peak, popsSkipped: this.skipped, poolSize: this.pool.length, poolMax: this.max }; }
}
