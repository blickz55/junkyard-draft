/**
 * DOM UI layer (DOSSIER-v1 0.4.0). Screens that are mostly text and buttons (title, results) are real HTML laid over
 * the canvas instead of hand-positioned Phaser Text: text reflows at every text size, buttons are focusable and
 * readable by assistive tech, and layout is CSS. The overlay covers the canvas's container (production roadmap 0.10.0:
 * the canvas sizes to the container, render/viewport.ts); the base font size comes from the device class (16 px on a
 * desktop, 15 on a tablet, 14 on a phone), `--text-scale` carries the player's text-size preference, and `--fit` (1
 * unless the title would need to scroll on a wide screen) shrinks the title just enough to keep its bottom strip in view
 * when the platform's fallback font runs wider than the one it was laid out with (DejaVu Sans on the Linux CI runner
 * wraps the how-to lines at 130 %). On a phone the title scrolls instead. One screen is mounted at a time; a Phaser
 * panel (tips) can hide it. Board-anchored sizes (ui/GamePanel.ts) use `--px`, one logical board pixel in CSS px.
 * Every interactive element carries `data-testid`, which the e2e uses instead of Phaser object names.
 */
import type Phaser from 'phaser';
import { CSS, DISPLAY, FONT, MONO } from '../render/palette';
import { prefs } from '../render/prefs';
import { audio } from '../render/audio';
import { t } from '../content/strings';

export type Child = string | number | Node | null | undefined | false;
export interface Attrs {
  class?: string;
  tid?: string;
  text?: string;
  html?: never;
  title?: string;
  type?: string;
  value?: string;
  min?: string;
  max?: string;
  step?: string;
  disabled?: boolean;
  href?: string;
  src?: string;
  alt?: string;
  style?: string;
  ariaLabel?: string;
  role?: string;
  onClick?: (e: MouseEvent) => void;
  onInput?: (e: Event) => void;
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
  if (attrs.onClick)
    el.addEventListener('click', (e) => {
      audio.unlock();
      audio.click();
      attrs.onClick!(e as MouseEvent);
    });
  if (attrs.onInput) el.addEventListener('input', attrs.onInput);
  if (attrs.text != null) el.textContent = attrs.text;
  for (const c of children) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : String(c));
  }
  return el;
}

/** The foreman's box (0.9.1): his name tag and one line; hidden when the line is empty (lessons only). */
export function foremanBox(text: string, tid = 'foreman', style = '', tag = t('foreman.name')): HTMLElement {
  const box = h(
    'div',
    { class: 'jd-foreman', tid, style: `${text ? '' : 'display:none; '}${style}` },
    h('span', { class: 'jd-foreman-tag' }, tag),
    h('span', { class: 'jd-foreman-text' }, text),
  );
  return box;
}
/** Replace the box's line; an empty line hides it. */
export function setForeman(box: HTMLElement, text: string): void {
  const el = box.querySelector('.jd-foreman-text');
  if (el) el.textContent = text;
  box.style.display = text ? '' : 'none';
}

/** A button in the house style. variant: 'primary' (amber) | 'steel' | 'dark' (default). */
export function btn(
  text: string,
  tid: string,
  onClick: () => void,
  o: { variant?: 'primary' | 'steel' | 'dark'; disabled?: boolean; small?: boolean; title?: string } = {},
): HTMLButtonElement {
  return h('button', {
    class: `jd-btn jd-btn-${o.variant ?? 'dark'}${o.small ? ' jd-btn-small' : ''}`,
    tid,
    text,
    onClick,
    disabled: o.disabled ?? false,
    title: o.title,
    type: 'button',
  });
}

const STYLE = `
#game { position: relative; background: #1a1612 url(art/yard-bg.webp) center / cover no-repeat; }
#ui { position: absolute; inset: 0; pointer-events: none; z-index: 5; font-family: ${FONT}; color: ${CSS.text}; --px: 1px; --base: 16px;
  --jd-display: ${DISPLAY}; --jd-glass: linear-gradient(180deg, rgba(46, 40, 33, 0.96), rgba(30, 26, 21, 0.96)); --jd-line: #4a4235; --jd-radius: 0.6em; --jd-shadow: 0 2px 10px rgba(0, 0, 0, 0.4);
  font-size: calc(var(--base) * var(--text-scale, 1) * var(--fit, 1)); line-height: 1.3; }
@media (max-width: 1024px) { #ui { --base: 15px; } }
@media (max-width: 600px) { #ui { --base: 14px; } }
#ui.jd-hidden { display: none; }
#ui * { box-sizing: border-box; }
#ui .jd-screen { position: absolute; inset: 0; pointer-events: auto; overflow-y: auto; overflow-x: hidden; display: flex; flex-direction: column; padding: 0.5em max(1.25em, calc((100% - 72em) / 2)); gap: 0.35em; }
@media (max-width: 600px) { #ui .jd-screen { padding: 0.4em 0.75em; } }
@media (pointer: coarse) { #ui .jd-btn, #ui .jd-offer, #ui .jd-entry, #ui .jd-link, #ui input[type=range] { min-height: 44px; } #ui .jd-btn { min-width: 44px; } }
#ui .jd-mono { font-variant-numeric: tabular-nums; }
#ui .jd-dim { color: ${CSS.dim}; }
#ui .jd-amber { color: ${CSS.amber}; }
#ui .jd-green { color: ${CSS.green}; }
#ui .jd-red { color: ${CSS.red}; }
#ui .jd-blue { color: ${CSS.blue}; }
#ui .jd-gold { color: ${CSS.gold}; }
#ui .jd-head { font-family: var(--jd-display); font-weight: 700; letter-spacing: 0.08em; color: ${CSS.amber}; font-size: 1em; text-transform: uppercase; margin: 0; }
#ui .jd-panel { background: var(--jd-glass); border: 1px solid var(--jd-line); border-radius: var(--jd-radius); box-shadow: var(--jd-shadow); padding: 0.55em 0.85em; }
#ui .jd-row { display: flex; flex-wrap: wrap; gap: 0.6em; align-items: center; }
#ui .jd-center { justify-content: center; }
#ui .jd-between { justify-content: space-between; }
#ui .jd-grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 0.75em; }
#ui .jd-actions { gap: 0.5em; margin-top: 0.3em; justify-content: center; }
#ui .jd-results-job { display: flex; flex-direction: column; align-items: center; }
#ui .jd-results-stars { font-size: 3em; line-height: 1; letter-spacing: 0.08em; color: #4a4235; }
#ui .jd-results-stars .on { color: #f5c542; text-shadow: 0 0 0.4em rgba(245, 197, 66, 0.5); display: inline-block; }
#ui .jd-results-jobline { font-family: var(--jd-display); font-weight: 700; font-size: 1.5em; line-height: 1.15; }
#ui .jd-results-score { font-family: var(--jd-display); font-size: 3.5em; font-weight: 700; line-height: 1.05; }
#ui .jd-results-rank { font-size: 0.875em; margin-top: 0.25em; }
#ui .jd-results-status { font-size: 0.8125em; min-height: 1.3em; text-align: center; }
#ui .jd-results [data-testid=headline]:empty { display: none; }
#ui .jd-strip-head, #ui .jd-strip-left, #ui .jd-strip-right { flex-wrap: nowrap; }
#ui .jd-strip-left { overflow: hidden; }
#ui .jd-strip-right { flex: 0 0 auto; }
@media (max-width: 900px) { #ui .jd-strip-head, #ui .jd-strip-left, #ui .jd-strip-right { flex-wrap: wrap; } #ui .jd-strip-left { overflow: visible; } #ui .jd-strip-right { flex: 1 1 100%; } }
@media (max-width: 900px) { #ui .jd-grid2 { grid-template-columns: 1fr; } }
#ui .jd-btn { font: inherit; font-weight: 700; font-size: 0.875em; padding: 0.5em 1.1em; border-radius: 0.2em; border: 2px solid rgba(0,0,0,0.35); cursor: pointer; color: #1a1612; background: ${CSS.amber}; box-shadow: 0 2px 0 rgba(0,0,0,0.35); white-space: nowrap; }
#ui .jd-btn-primary { background: linear-gradient(180deg, #ffc24d, #e0932a); color: #1a1612; box-shadow: 0 2px 0 #8f5c19, 0 3px 10px rgba(240, 168, 48, 0.3); }
#ui .jd-btn-steel { background: linear-gradient(180deg, #a2adb8, #828e9a); color: #1a1612; }
#ui .jd-btn-dark { background: linear-gradient(180deg, #4d463c, #3a342c); color: ${CSS.text}; border-color: #5f574a; }
#ui .jd-btn-small { font-size: 0.8125em; padding: 0.35em 0.8em; }
#ui .jd-choice { width: min(92%, 26em); gap: 0.65em; padding: 1em 1.1em; }
#ui .jd-choice .jd-head { font-size: 1.125em; }
#ui .jd-choice-buttons { display: flex; flex-direction: column; gap: 0.45em; margin-top: 0.2em; }
#ui .jd-choice-buttons .jd-btn { width: 100%; font-size: 1em; padding: 0.6em 1em; }
#ui .jd-choice-note { font-size: 0.75em; text-align: center; }
#ui .jd-job-flavour { font-size: 0.9375em; }
#ui .jd-job-goal { font-family: var(--jd-display); font-weight: 700; font-size: 2em; line-height: 1.05; }
#ui .jd-job-marks { display: flex; gap: 1.1em; margin-top: 0.25em; flex-wrap: wrap; }
#ui .jd-job-mark { display: inline-flex; gap: 0.35em; align-items: baseline; }
#ui .jd-recipe { display: flex; flex-wrap: wrap; align-items: center; gap: 0.15em 0.3em; margin-top: 0.45em; font-size: 0.8125em; }
#ui .jd-recipe-label { margin-right: 0.15em; }
#ui .jd-recipe-step { padding: 0.08em 0.5em; border-radius: 0.3em; border: 1px dashed ${CSS.edgeLight}; color: ${CSS.dim}; white-space: nowrap; }
#ui .jd-recipe-step.on { border: 1px solid ${CSS.green}; color: ${CSS.green}; background: rgba(111,207,138,0.1); }
#ui .jd-recipe-arrow { color: ${CSS.edgeLight}; }
#ui .jd-howto { margin: 0; padding-left: 1.3em; display: flex; flex-direction: column; gap: 0.35em; font-size: 0.9375em; }
#ui .jd-title { background: radial-gradient(ellipse at 50% 0%, rgba(240, 168, 48, 0.1), transparent 60%); gap: 0.6em; padding-top: 0.75em; padding-bottom: 0.75em; }
#ui .jd-hero { position: relative; flex: 0 0 auto; display: flex; flex-wrap: wrap; justify-content: space-between; align-items: center; gap: 0.4em 1.5em; padding: 0.75em 1.2em; border-radius: 0.8em; overflow: hidden; border: 1px solid var(--jd-line); background: linear-gradient(90deg, rgba(20, 17, 13, 0.92) 25%, rgba(20, 17, 13, 0.35) 70%), url(art/hero.webp) center / cover no-repeat, #2a241d; box-shadow: var(--jd-shadow); }
#ui .jd-wordmark { font-family: var(--jd-display); font-weight: 800; font-size: 3em; line-height: 0.95; letter-spacing: 0.02em; margin: 0; color: #ffc24d; text-shadow: 0 2px 0 #6a3f10, 0 0 1em rgba(240, 168, 48, 0.25); }
#ui .jd-tagline { font-size: 1.0625em; margin-top: 0.2em; }
#ui .jd-hero-name { flex: 0 1 auto; min-width: 0; }
#ui .jd-hero-side { flex: 0 1 26em; min-width: 0; display: flex; flex-direction: column; gap: 0.4em; }
#ui .jd-hero-corner { display: flex; gap: 0.6em; align-items: center; justify-content: flex-end; }
#ui .jd-player { font-size: 0.8125em; color: ${CSS.text}; white-space: nowrap; text-shadow: 0 1px 3px #1a1612; }
#ui .jd-home-main { display: grid; grid-template-columns: minmax(0, 1.25fr) minmax(0, 1fr); gap: 0.6em; align-items: stretch; flex: 0 0 auto; }
#ui .jd-home-lead, #ui .jd-home-side { display: flex; flex-direction: column; gap: 0.6em; min-width: 0; }
#ui .jd-hero { min-height: 6.5em; }
@media (min-height: 760px) and (min-width: 761px) { #ui .jd-hero { min-height: 13em; align-items: flex-end; } }
#ui [data-testid=today-job] { min-height: 9.5em; display: flex; flex-direction: column; gap: 0.35em; justify-content: center; }
#ui .jd-results { background: linear-gradient(180deg, rgba(26, 22, 18, 0.72), #1a1612 19em), url(art/hero.webp) top center / max(100%, 900px) auto no-repeat; }
#ui .jd-more { margin: 0.4em auto 0; max-width: 46em; width: 100%; text-align: center; }
#ui .jd-more > summary { cursor: pointer; font-weight: 700; font-size: 0.9375em; padding: 0.3em; }
#ui .jd-home-card { background: var(--jd-glass); border: 1px solid var(--jd-line); border-radius: var(--jd-radius); box-shadow: var(--jd-shadow); padding: 0.7em 0.95em; display: flex; flex-direction: column; gap: 0.35em; }
#ui .jd-home-today { flex: 1 0 auto; }
#ui .jd-home-card.jd-home-continue { flex-direction: row; align-items: center; gap: 0.75em; }
#ui .jd-home-card.jd-home-continue > .jd-btn { flex: 1 1 60%; width: auto; }
#ui .jd-home-continue > div { flex: 1 1 40%; min-width: 0; }
#ui .jd-hero .jd-foreman { background: rgba(20, 17, 13, 0.8); border-radius: 0.3em; }
#ui .jd-home-card > .jd-btn { width: 100%; font-family: var(--jd-display); font-size: 1.375em; padding: 0.3em 1em; }
#ui .jd-home-more { display: flex; flex-wrap: wrap; gap: 0.5em; justify-content: center; }
#ui .jd-home-more .jd-btn { flex: 1 1 11em; max-width: 20em; min-width: 0; white-space: normal; }
#ui .jd-home-foot { display: flex; flex-wrap: wrap; gap: 0.2em 1.1em; justify-content: center; font-size: 0.8125em; color: ${CSS.dim}; margin-top: auto; }
#ui .jd-home-note { font-size: 0.8125em; text-align: center; }
#ui .jd-rank-line { font-family: var(--jd-display); font-weight: 700; font-size: 1.5em; line-height: 1.1; color: ${CSS.gold}; }
#ui .jd-board-lines { font-size: 0.8125em; }
#ui .jd-board-line { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
#ui .jd-settings { width: min(94%, 34em); max-height: 92%; overflow-y: auto; gap: 0.7em; padding: 0.9em 1.1em; }
#ui .jd-settings-title { font-size: 1.25em; }
#ui .jd-set-section { display: flex; flex-direction: column; gap: 0.35em; border-top: 1px solid #3f382d; padding-top: 0.5em; }
#ui .jd-set-row { display: flex; align-items: center; gap: 0.6em; flex-wrap: wrap; }
#ui .jd-set-label { flex: 0 0 7em; font-size: 0.875em; }
#ui .jd-set-right { display: flex; align-items: center; gap: 0.5em; flex: 1 1 auto; min-width: 0; flex-wrap: wrap; }
#ui .jd-sound-list { display: flex; flex-direction: column; gap: 0.25em; margin-top: 0.3em; }
#ui .jd-sound-list .jd-set-label { flex: 1 1 auto; }
@media (max-height: 760px) { #ui .jd-home-today .jd-recipe { display: none; } #ui [data-testid=today-job] { min-height: 6.6em; } }
@media (max-height: 520px) and (orientation: landscape) { #ui [data-testid=today-job] { min-height: 0; } #ui .jd-hero { padding: 0.25em 0.8em; min-height: 0; } #ui .jd-wordmark { font-size: 1.5em; } #ui .jd-tagline, #ui .jd-hero .jd-foreman, #ui .jd-home-today .jd-job-flavour, #ui .jd-home-today .jd-recipe, #ui .jd-home-rank { display: none; } #ui .jd-hero-side { flex: 0 0 auto; } #ui .jd-job-goal { font-size: 1.5em; } }
@media (max-width: 760px) { #ui .jd-home-main { grid-template-columns: minmax(0, 1fr); } #ui .jd-wordmark { font-size: 2.5em; } #ui .jd-hero { padding: 0.8em 1em; } #ui .jd-hero-side { flex: 1 1 100%; } #ui .jd-hero-corner { justify-content: space-between; } }
#ui .jd-link { background: none; border: 0; padding: 0; margin: 0; font: inherit; color: inherit; text-decoration: underline; cursor: pointer; pointer-events: auto; }
#ui .jd-link:focus-visible { outline: 2px solid ${CSS.amber}; outline-offset: 2px; }
#ui .jd-foreman { display: flex; gap: 0.6em; align-items: baseline; border-left: 3px solid ${CSS.amber}; background: rgba(240, 168, 48, 0.08); padding: 0.3em 0.7em; font-size: 0.875em; }
#ui .jd-foreman-tag { font-weight: 700; letter-spacing: 0.15em; font-size: 0.75em; color: ${CSS.amber}; flex: 0 0 auto; }
#ui .jd-foreman-text { min-width: 0; }
#ui .jd-btn:hover:not(:disabled) { filter: brightness(1.12); }
#ui .jd-btn-dark:hover:not(:disabled) { filter: brightness(0.88); }
#ui .jd-btn:active:not(:disabled) { transform: translateY(1px); box-shadow: 0 1px 0 rgba(0,0,0,0.35); }
#ui .jd-btn:disabled { opacity: 0.4; cursor: default; }
#ui .jd-modal { position: absolute; inset: 0; pointer-events: auto; background: rgba(0,0,0,0.6); display: flex; align-items: center; justify-content: center; z-index: 20; }
#ui .jd-opening { font-family: var(--jd-display); font-size: 1.4em; color: var(--jd-text); }
#ui .jd-dialog { width: min(92%, 34em); display: flex; flex-direction: column; gap: 0.5em; }
#ui .jd-dialog-label { font-size: 0.8125em; }
#ui .jd-dialog input, #ui .jd-dialog textarea { font: inherit; font-size: 0.875em; width: 100%; box-sizing: border-box; background: #1a1612; color: ${CSS.text}; border: 1px solid #3f382d; border-radius: 0.2em; padding: 0.4em 0.5em; }
#ui .jd-dialog textarea { min-height: 8em; resize: vertical; font-family: ${MONO}; font-size: 0.75em; }
#ui .jd-tips { position: absolute; inset: 0; pointer-events: auto; background: rgba(0,0,0,0.6); display: flex; align-items: center; justify-content: center; z-index: 10; }
#ui .jd-tips-box { width: min(92%, 50em); max-height: 94%; overflow: auto; display: flex; flex-direction: column; gap: 0.5em; }
#ui .jd-tips-cols { display: flex; gap: 1em; align-items: flex-start; flex-wrap: wrap; }
#ui .jd-tips-nav { display: flex; flex-direction: column; gap: 0.35em; flex: 0 0 14em; }
@media (max-width: 600px) { #ui .jd-tips-nav { flex: 1 1 100%; flex-direction: row; flex-wrap: wrap; } #ui .jd-tips-nav .jd-btn { flex: 1 1 40%; } }
#ui .jd-tips-nav .jd-btn { text-align: left; white-space: normal; }
#ui .jd-tips-nav .jd-btn.jd-active { background: ${CSS.amber}; color: #1a1612; }
#ui .jd-tips-body { flex: 1 1 16em; min-width: 0; display: flex; flex-direction: column; gap: 0.4em; }
#ui .jd-tips-title { font-weight: 700; font-size: 1.05em; }
#ui .jd-tips-text { margin: 0; font-size: 0.8125em; }
#ui .jd-tips-demo { display: block; border: 1px solid #3f382d; align-self: center; max-width: 100%; height: auto; }
#ui .jd-tips-watch { color: ${CSS.amber}; font-size: 0.75em; }
#ui .jd-controls { border-collapse: collapse; width: 100%; font-size: 0.8125em; }
#ui .jd-controls th { text-align: left; font-weight: 700; letter-spacing: 0.12em; text-transform: uppercase; font-size: 0.75em; color: ${CSS.amber}; padding: 0.3em 0.5em; border-bottom: 1px solid #3f382d; }
#ui .jd-controls td { text-align: left; vertical-align: top; padding: 0.3em 0.5em; border-bottom: 1px solid #3f382d; }
#ui .jd-btn:focus-visible, #ui input:focus-visible, #ui .jd-entry:focus-visible { outline: 3px solid #d6f0ff; outline-offset: 2px; }
#ui input[type=range] { accent-color: ${CSS.amber}; width: 12em; }
#ui .jd-select { font: inherit; font-size: 0.8125em; background: #1a1612; color: ${CSS.text}; border: 1px solid #3f382d; border-radius: 0.2em; padding: 0.35em 0.5em; }
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
#ui .jd-results, #ui .jd-title { overflow-wrap: anywhere; } /* a wider fallback font (DejaVu Sans on the CI runner) must never push a line past the viewport */
#ui .jd-results .jd-grid2 > *, #ui .jd-title .jd-grid2 > * { min-width: 0; }
#ui .jd-around .jd-mine { color: ${CSS.amber}; font-weight: 700; }
`;

class UiLayer {
  private root: HTMLDivElement | null = null;
  private screen: HTMLElement | null = null;
  private keyHandler: ((e: KeyboardEvent) => void) | null = null;

  /** Create the overlay once and keep it aligned with the canvas. */
  attach(game: Phaser.Game) {
    if (this.root) return;
    if (!document.getElementById('jd-ui-style')) {
      const st = document.createElement('style');
      st.id = 'jd-ui-style';
      st.textContent = STYLE;
      document.head.append(st);
    }
    const root = document.createElement('div');
    root.id = 'ui';
    (document.getElementById('game') ?? document.body).append(root);
    this.root = root;
    const sync = () => this.sync();
    game.scale.on('resize', sync);
    window.addEventListener('resize', sync);
    requestAnimationFrame(sync);
    // the bundled faces arrive after the first layout, and the title fits itself to what it measures
    void document.fonts?.ready.then(sync);
    document.fonts?.addEventListener?.('loadingdone', sync);
    this.sync();
  }
  /** Publish the player's preferences as CSS state and refit the title (the overlay itself covers the container by CSS). */
  sync() {
    const root = this.root;
    if (!root) return;
    root.style.setProperty('--text-scale', String(prefs.textScale));
    root.classList.toggle('jd-reduced-motion', prefs.reducedMotion);
    this.fit();
  }
  /**
   * Title on a wide screen only: when the mounted title needs to scroll (a wider fallback font wrapped lines the layout
   * assumed were one line), lower `--fit` in 2 % steps until it fits, down to 0.8; if even that does not fit, keep the
   * chosen text size and let the screen scroll. Phones (under 700 px wide) scroll by design and keep their text size.
   * Synchronous (each step reads layout once), idempotent, run on mount and on every resize.
   */
  private fit() {
    const root = this.root,
      screen = this.screen;
    if (!root) return;
    root.style.setProperty('--fit', '1');
    if (!screen || !screen.classList.contains('jd-title') || screen.clientHeight < 50 || root.clientWidth < 700) return;
    const fits = () => screen.scrollHeight <= screen.clientHeight + 1;
    if (fits()) return;
    for (let f = 0.98; f >= 0.8 - 1e-9; f = Math.round((f - 0.02) * 100) / 100) {
      root.style.setProperty('--fit', String(f));
      if (fits()) return;
    }
    root.style.setProperty('--fit', '1');
  }
  /** Show one screen (replacing any other). `onKey` receives document keydowns while it is mounted. */
  mount(scene: Phaser.Scene, screen: HTMLElement, onKey?: (e: KeyboardEvent) => void) {
    this.unmount();
    if (!this.root) this.attach(scene.game);
    if (!this.root) return;
    this.sync();
    screen.classList.add('jd-screen');
    this.root.append(screen);
    this.screen = screen;
    this.fit();
    if (onKey) {
      this.keyHandler = onKey;
      document.addEventListener('keydown', onKey);
    }
  }
  unmount() {
    this.root?.querySelectorAll('.jd-modal').forEach((m) => m.remove()); // a dialog belongs to the screen it opened on
    if (this.screen) {
      this.screen.remove();
      this.screen = null;
      this.root?.style.setProperty('--fit', '1');
    }
    if (this.keyHandler) {
      document.removeEventListener('keydown', this.keyHandler);
      this.keyHandler = null;
    }
    this.setHidden(false);
  }
  /** True while a modal text dialog is open: gameplay shortcuts stand down (review F05). */
  get dialogOpen(): boolean {
    return !!this.root?.querySelector('.jd-modal');
  }
  /** Add an element above the current screen (a dialog such as the tips panel); the caller removes it. */
  layer(scene: Phaser.Scene, el: HTMLElement) {
    if (!this.root) this.attach(scene.game);
    if (!this.root) return;
    this.sync();
    this.root.append(el);
  }
  /** Hide the whole DOM overlay (kept for callers that draw something Phaser-side above the canvas). */
  setHidden(hidden: boolean) {
    this.root?.classList.toggle('jd-hidden', hidden);
  }
  get mounted(): boolean {
    return this.screen != null;
  }
  get element(): HTMLDivElement | null {
    return this.root;
  }
}

export const ui = new UiLayer();

/**
 * Modal text dialogs (review F04): Electron has no window.prompt, so naming, custom seeds, replay import and the
 * clipboard fallback use these. Resolves with the entered text, or null when cancelled (Esc, Cancel, click outside).
 * Keyboard events inside the dialog never reach the scenes (stopPropagation at the layer), focus goes to the field
 * and returns to the control that opened the dialog.
 */
export interface DialogOptions {
  title: string;
  label?: string;
  value?: string;
  multiline?: boolean;
  readonly?: boolean;
  ok?: string;
  cancel?: string | null;
  maxLength?: number;
  placeholder?: string;
  /** secondary actions (left of Cancel/OK): the dialog closes with null, then the handler runs */ extra?: {
    label: string;
    tid: string;
    onClick: () => void;
  }[];
}
export function dialog(scene: Phaser.Scene, o: DialogOptions): Promise<string | null> {
  return new Promise((resolve) => {
    const prev = document.activeElement as HTMLElement | null;
    const field = o.multiline
      ? h('textarea', { tid: 'dialog-input', ariaLabel: o.label ?? o.title })
      : h('input', { type: 'text', tid: 'dialog-input', ariaLabel: o.label ?? o.title });
    field.value = o.value ?? '';
    if (o.maxLength && field instanceof HTMLInputElement) field.maxLength = o.maxLength;
    if (o.placeholder) field.placeholder = o.placeholder;
    if (o.readonly) field.readOnly = true;
    if (o.readonly && !o.multiline && !o.value) field.style.display = 'none'; // a plain message needs no field
    let done = false;
    const finish = (v: string | null) => {
      if (done) return;
      done = true;
      layer.remove();
      prev?.focus?.();
      resolve(v);
    };
    const okBtn = btn(o.ok ?? t('common.ok'), 'dialog-ok', () => finish(field.value), { variant: 'primary', small: true });
    const cancelBtn = o.cancel === null ? null : btn(o.cancel ?? t('common.cancel'), 'dialog-cancel', () => finish(null), { small: true });
    const extras = (o.extra ?? []).map((x) =>
      btn(
        x.label,
        x.tid,
        () => {
          finish(null);
          x.onClick();
        },
        { small: true },
      ),
    );
    const box = h(
      'div',
      { class: 'jd-dialog jd-panel', role: 'dialog', ariaLabel: o.title, tid: 'dialog' },
      h('div', { class: 'jd-head' }, o.title),
      o.label ? h('div', { class: 'jd-dim jd-dialog-label' }, o.label) : null,
      field,
      h(
        'div',
        { class: 'jd-row', style: 'justify-content:flex-end; gap:0.5em; flex-wrap:wrap' },
        ...extras,
        extras.length ? h('span', { style: 'flex:1' }) : null,
        cancelBtn,
        okBtn,
      ),
    );
    const layer = h(
      'div',
      {
        class: 'jd-modal',
        onClick: (e) => {
          if (e.target === layer) finish(null);
        },
      },
      box,
    );
    layer.addEventListener('keydown', (e) => {
      e.stopPropagation(); // the scenes' global shortcuts never see keys typed into a dialog
      if (e.key === 'Escape') {
        e.preventDefault();
        finish(null);
      } else if (e.key === 'Enter' && (!o.multiline || e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        finish(field.value);
      } else if (e.key === 'Tab') {
        // keep focus inside the dialog
        const f = ([field, ...extras, cancelBtn, okBtn] as (HTMLElement | null)[]).filter((x): x is HTMLElement => x != null);
        const i = f.indexOf(document.activeElement as HTMLElement);
        if (i >= 0) {
          e.preventDefault();
          f[(i + (e.shiftKey ? -1 : 1) + f.length) % f.length]?.focus();
        }
      }
    });
    ui.layer(scene, layer);
    field.focus();
    if (!o.multiline && field.value) (field as HTMLInputElement).select();
    else if (o.readonly) field.select();
  });
}
/** One-line text entry with a default; null when cancelled. */
export const promptText = (scene: Phaser.Scene, title: string, label: string, value = '', maxLength?: number) =>
  dialog(scene, { title, label, value, maxLength });
/** A message the player acknowledges. */
export const alertText = (scene: Phaser.Scene, title: string, text: string) =>
  dialog(scene, { title, label: text, value: '', readonly: true, cancel: null, ok: t('common.ok'), multiline: false }).then(() => undefined);
/** Show text for manual copying when the clipboard API is unavailable (selected, read-only). */
export const showText = (scene: Phaser.Scene, title: string, text: string) =>
  dialog(scene, { title, label: t('common.selectAndCopy'), value: text, readonly: true, multiline: true, cancel: null, ok: t('common.closeShort') }).then(
    () => undefined,
  );

/** A material icon from the generated textures as an <img>, so the DOM shows exactly what the canvas draws. */
export function textureImg(game: Phaser.Game, key: string, alt: string): HTMLImageElement {
  let src = '';
  try {
    src = game.textures.getBase64(key);
  } catch {
    /* texture missing: empty img */
  }
  return h('img', { class: 'jd-item', src, alt });
}
