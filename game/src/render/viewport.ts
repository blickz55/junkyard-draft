/**
 * The canvas sizes to its container (production roadmap 0.10.0). Phaser runs in Scale.NONE with `zoom: 1 / DPR`: the
 * backing store is the container's CSS size times the device pixel ratio (render/dpr.ts) and the canvas's CSS size is
 * the container's. A ResizeObserver on the container (the window's resize as a fallback) resizes the game and tells the
 * scenes. Title and results show the container's CSS-pixel space (`fitScreen`); the game scene fits its camera to the
 * board slot the DOM shell lays out (GameScene.layoutBoard).
 */
import type Phaser from 'phaser';
import { DPR } from './dpr';

type Listener = (width: number, height: number) => void;

class Viewport {
  /** the container's CSS size */
  width = 0;
  height = 0;
  private game: Phaser.Game | null = null;
  private el: HTMLElement | null = null;
  private readonly fns = new Set<Listener>();

  attach(game: Phaser.Game, el: HTMLElement) {
    this.game = game;
    this.el = el;
    if (typeof ResizeObserver !== 'undefined') new ResizeObserver(() => this.measure()).observe(el);
    window.addEventListener('resize', () => this.measure());
    if (game.isBooted) this.measure();
    else game.events.once('ready', () => this.measure());
  }
  /** Read the container; when its size changed, resize the game and notify. Idempotent. */
  measure(): boolean {
    const game = this.game,
      el = this.el;
    if (!game || !el || !game.isBooted) return false;
    const { w, h } = containerSize(el);
    if (w === this.width && h === this.height) return false;
    this.width = w;
    this.height = h;
    game.scale.resize(Math.round(w * DPR), Math.round(h * DPR));
    const st = game.canvas.style;
    st.width = `${w}px`;
    st.height = `${h}px`;
    for (const fn of this.fns) fn(w, h);
    return true;
  }
  on(fn: Listener): () => void {
    this.fns.add(fn);
    return () => {
      this.fns.delete(fn);
    };
  }
}
export const viewport = new Viewport();

/** The container's CSS size, never zero (a hidden tab reports 0×0; Phaser refuses a 0-sized canvas). */
export function containerSize(el: HTMLElement): { w: number; h: number } {
  return { w: Math.max(1, Math.round(el.clientWidth)), h: Math.max(1, Math.round(el.clientHeight)) };
}

/** Title and results: world (0, 0) is the container's top-left CSS pixel, crisp at DPR; re-applied on every resize until the scene shuts down. */
export function fitScreen(scene: Phaser.Scene) {
  const apply = () => scene.cameras.main.setZoom(DPR).centerOn(viewport.width / 2, viewport.height / 2);
  apply();
  const off = viewport.on(apply);
  scene.events.once('shutdown', off);
}
