/**
 * DOM UI layer (DOSSIER-v1 0.4.0). Screens that are mostly text and buttons (title, results) are real HTML laid over
 * the canvas instead of hand-positioned Phaser Text: text reflows at every text size, buttons are focusable and
 * readable by assistive tech, and layout is CSS. The overlay tracks the canvas rectangle (Phaser FIT scaling) and
 * exposes it as `--k` (overlay width ÷ logical width) so sizes in `em` follow the canvas scale; `--text-scale`
 * carries the player's text-size preference. One screen is mounted at a time; a Phaser panel (tips) can hide it.
 * Every interactive element carries `data-testid`, which the e2e uses instead of Phaser object names.
 */
import type Phaser from 'phaser';
import { CSS, FONT, MONO } from '../render/palette';
import { prefs } from '../render/prefs';
import { W } from '../render/layout';
import { audio } from '../render/audio';

export type Child = string | number | Node | null | undefined | false;
export interface Attrs {
  class?: string; tid?: string; text?: string; html?: never; title?: string; type?: string; value?: string; min?: string; max?: string; step?: string;
  disabled?: boolean; href?: string; src?: string; alt?: string; style?: string; ariaLabel?: string; role?: string;
  onClick?: (e: MouseEvent) => void; onInput?: (e: Event) => void;
}

/** Tiny element builder: h('button', { class: 'jd-btn', tid: 'daily', onClick }, 'Today\'s challenge'). */
export function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Attrs = {}, ...children: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (attrs.class) el.className = attrs.class;
  if (attrs.tid) el.dataset.testid = attrs.tid;
  if (attrs.title) el.title = attrs.title;
  if (attrs.style) el.setAttribute('style', attrs.style);
  if (attrs.ariaLabel) el.setAttribute('aria-label', attrs.ariaLabel);
  if (attrs.role) el.setAttribute('role', attrs.role);
  if (attrs.type && el instanceof HTMLInputElement) el.type = attrs.type;
  if (attrs.value != null && el instanceof HTMLInputElement) el.value = attrs.value;
  if (attrs.min != null && el instanceof HTMLInputElement) el.min = attrs.min;
  if (attrs.max != null && el instanceof HTMLInputElement) el.max = attrs.max;
  if (attrs.step != null && el instanceof HTMLInputElement) el.step = attrs.step;
  if (attrs.disabled != null && (el instanceof HTMLButtonElement || el instanceof HTMLInputElement)) el.disabled = attrs.disabled;
  if (attrs.src != null && el instanceof HTMLImageElement) el.src = attrs.src;
  if (attrs.alt != null && el instanceof HTMLImageElement) el.alt = attrs.alt;
  if (attrs.onClick) el.addEventListener('click', (e) => { audio.unlock(); audio.click(); attrs.onClick!(e as MouseEvent); });
  if (attrs.onInput) el.addEventListener('input', attrs.onInput);
  if (attrs.text != null) el.textContent = attrs.text;
  for (const c of children) { if (c == null || c === false) continue; el.append(c instanceof Node ? c : String(c)); }
  return el;
}

/** A button in the house style. variant: 'primary' (amber) | 'steel' | 'dark' (default). */
export function btn(text: string, tid: string, onClick: () => void, o: { variant?: 'primary' | 'steel' | 'dark'; disabled?: boolean; small?: boolean; title?: string } = {}): HTMLButtonElement {
  return h('button', { class: `jd-btn jd-btn-${o.variant ?? 'dark'}${o.small ? ' jd-btn-small' : ''}`, tid, text, onClick, disabled: o.disabled ?? false, title: o.title, type: 'button' });
}

const STYLE = `
#game { position: relative; }
#ui { position: absolute; left: 0; top: 0; width: 0; height: 0; pointer-events: none; z-index: 5; font-family: ${FONT}; color: ${CSS.text}; --px: calc(1px * var(--k, 1));
  font-size: calc(16px * var(--k, 1) * var(--text-scale, 1)); line-height: 1.3; }
#ui.jd-hidden { display: none; }
#ui * { box-sizing: border-box; }
#ui .jd-screen { position: absolute; inset: 0; pointer-events: auto; overflow-y: auto; overflow-x: hidden; display: flex; flex-direction: column; padding: 0.5em 1.25em; gap: 0.35em; }
#ui .jd-mono { font-family: ${MONO}; }
#ui .jd-dim { color: ${CSS.dim}; }
#ui .jd-amber { color: ${CSS.amber}; }
#ui .jd-green { color: ${CSS.green}; }
#ui .jd-red { color: ${CSS.red}; }
#ui .jd-blue { color: ${CSS.blue}; }
#ui .jd-gold { color: ${CSS.gold}; }
#ui .jd-head { font-weight: 700; letter-spacing: 0.15em; color: ${CSS.amber}; font-size: 0.8125em; text-transform: uppercase; }
#ui .jd-panel { background: rgba(36, 32, 26, 0.92); border: 1px solid #3f382d; border-radius: 0.25em; padding: 0.55em 0.85em; }
#ui .jd-row { display: flex; flex-wrap: wrap; gap: 0.6em; align-items: center; }
#ui .jd-center { justify-content: center; }
#ui .jd-between { justify-content: space-between; }
#ui .jd-grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 0.75em; }
@media (max-width: 900px) { #ui .jd-grid2 { grid-template-columns: 1fr; } }
#ui .jd-btn { font: inherit; font-weight: 700; font-size: 0.875em; padding: 0.5em 1.1em; border-radius: 0.2em; border: 2px solid rgba(0,0,0,0.35); cursor: pointer; color: #1a1612; background: ${CSS.amber}; box-shadow: 0 2px 0 rgba(0,0,0,0.35); white-space: nowrap; }
#ui .jd-btn-steel { background: #8e9aa6; color: #1a1612; }
#ui .jd-btn-dark { background: #5a6670; color: ${CSS.text}; }
#ui .jd-btn-small { font-size: 0.75em; padding: 0.4em 0.9em; }
#ui .jd-btn:hover:not(:disabled) { filter: brightness(1.12); }
#ui .jd-btn-dark:hover:not(:disabled) { filter: brightness(0.88); }
#ui .jd-btn:active:not(:disabled) { transform: translateY(1px); box-shadow: 0 1px 0 rgba(0,0,0,0.35); }
#ui .jd-btn:disabled { opacity: 0.4; cursor: default; }
#ui .jd-btn:focus-visible, #ui input:focus-visible, #ui .jd-entry:focus-visible { outline: 3px solid #d6f0ff; outline-offset: 2px; }
#ui input[type=range] { accent-color: ${CSS.amber}; width: 12em; }
#ui .jd-entry { font: inherit; font-family: ${MONO}; font-size: 0.75em; background: none; border: 0; color: ${CSS.text}; text-align: left; padding: 0.1em 0; cursor: pointer; }
#ui .jd-entry:hover { color: ${CSS.blue}; }
#ui .jd-entry:disabled { cursor: default; color: ${CSS.text}; }
#ui .jd-bar { height: 1em; background: ${CSS.amber}; border-radius: 0.1em; }
#ui .jd-bar-last { background: ${CSS.gold}; }
#ui .jd-pop { animation: jd-pop 0.5s cubic-bezier(0.34, 1.56, 0.64, 1); }
@keyframes jd-pop { from { transform: scale(0.5); } to { transform: scale(1); } }
#ui.jd-reduced-motion .jd-pop { animation: none; }
#ui .jd-item { width: 1.5em; height: 1.5em; vertical-align: middle; image-rendering: auto; }
#ui .jd-badge-pill { display: inline-block; font-size: 0.75em; font-weight: 700; color: #1a1612; background: ${CSS.green}; border-radius: 1em; padding: 0.15em 0.7em; }
#ui .jd-hist { display: flex; align-items: flex-end; gap: 2px; height: 3.25em; margin-top: 0.25em; }
#ui .jd-hist-bin { flex: 1; display: flex; flex-direction: column; justify-content: flex-end; align-items: center; min-width: 0; height: 100%; }
#ui .jd-hist-bar { width: 100%; background: #5a6670; border-radius: 0.1em 0.1em 0 0; min-height: 1px; }
#ui .jd-hist-mine .jd-hist-bar { background: ${CSS.amber}; }
#ui .jd-hist-count { font-size: 0.625em; color: ${CSS.dim}; line-height: 1.2; }
#ui .jd-hist-mine .jd-hist-count { color: ${CSS.amber}; font-weight: 700; }
#ui .jd-hist-axis { display: flex; justify-content: space-between; font-size: 0.625em; color: ${CSS.dim}; font-family: ${MONO}; }
#ui .jd-hist-mini { display: inline-flex; align-items: flex-end; gap: 1px; height: 1.6em; vertical-align: middle; margin-left: 0.75em; }
#ui .jd-hist-mini .jd-hist-bar { width: 0.45em; }
#ui .jd-around { font-family: ${MONO}; font-size: 0.7em; margin-top: 0.3em; columns: 2; column-gap: 1.5em; }
#ui .jd-around .jd-mine { color: ${CSS.amber}; font-weight: 700; }
`;

class UiLayer {
  private root: HTMLDivElement | null = null;
  private game: Phaser.Game | null = null;
  private screen: HTMLElement | null = null;
  private keyHandler: ((e: KeyboardEvent) => void) | null = null;

  /** Create the overlay once and keep it aligned with the canvas. */
  attach(game: Phaser.Game) {
    if (this.root) return;
    this.game = game;
    if (!document.getElementById('jd-ui-style')) { const st = document.createElement('style'); st.id = 'jd-ui-style'; st.textContent = STYLE; document.head.append(st); }
    const root = document.createElement('div'); root.id = 'ui';
    (document.getElementById('game') ?? document.body).append(root);
    this.root = root;
    const sync = () => this.sync();
    game.scale.on('resize', sync);
    window.addEventListener('resize', sync);
    requestAnimationFrame(sync);
    this.sync();
  }
  /** Position the overlay over the canvas and publish the scale factors as CSS variables. */
  sync() {
    const root = this.root, game = this.game; if (!root || !game) return;
    const r = game.canvas.getBoundingClientRect();
    const parent = root.parentElement?.getBoundingClientRect() ?? { left: 0, top: 0 };
    root.style.left = `${r.left - parent.left}px`; root.style.top = `${r.top - parent.top}px`; root.style.width = `${r.width}px`; root.style.height = `${r.height}px`;
    root.style.setProperty('--k', String(r.width / W || 1));
    root.style.setProperty('--text-scale', String(prefs.textScale));
    root.classList.toggle('jd-reduced-motion', prefs.reducedMotion);
  }
  /** Show one screen (replacing any other). `onKey` receives document keydowns while it is mounted. */
  mount(scene: Phaser.Scene, screen: HTMLElement, onKey?: (e: KeyboardEvent) => void) {
    this.unmount();
    if (!this.root) this.attach(scene.game);
    if (!this.root) return;
    this.sync();
    screen.classList.add('jd-screen');
    this.root.append(screen); this.screen = screen;
    if (onKey) { this.keyHandler = onKey; document.addEventListener('keydown', onKey); }
  }
  unmount() {
    if (this.screen) { this.screen.remove(); this.screen = null; }
    if (this.keyHandler) { document.removeEventListener('keydown', this.keyHandler); this.keyHandler = null; }
    this.setHidden(false);
  }
  /** Hide the DOM screen while a Phaser panel (tips) is open above the canvas. */
  setHidden(hidden: boolean) { this.root?.classList.toggle('jd-hidden', hidden); }
  get mounted(): boolean { return this.screen != null; }
  get element(): HTMLDivElement | null { return this.root; }
}

export const ui = new UiLayer();

/** A material icon from the generated textures as an <img>, so the DOM shows exactly what the canvas draws. */
export function textureImg(game: Phaser.Game, key: string, alt: string): HTMLImageElement {
  let src = '';
  try { src = game.textures.getBase64(key); } catch { /* texture missing: empty img */ }
  return h('img', { class: 'jd-item', src, alt });
}
