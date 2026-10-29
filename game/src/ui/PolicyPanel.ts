/**
 * Fairness and verification policy panel (PLAN-v3 0.6.5). Renders game/public/policy.json, which tools/make-policy.ts
 * generates from the rules module and the verifier's constants, so what the player reads is what the code does.
 * The JSON is bundled at build time (no fetch: it works in the packaged app and offline). A modal layer like the tips panel.
 */
import type Phaser from 'phaser';
import { h, btn, ui } from './dom';
import policy from '../../public/policy.json';

export function openPolicy(scene: Phaser.Scene): void {
  const prev = document.activeElement as HTMLElement | null;
  const close = () => { layer.remove(); prev?.focus?.(); };
  const body = h('div', { tid: 'policy-body', style: 'max-height:60vh; overflow:auto; font-size:0.875em; display:flex; flex-direction:column; gap:0.6em' },
    h('div', { class: 'jd-amber', tid: 'policy-headline', style: 'font-weight:700' }, `Rules version ${policy.rulesVersion} · verifier protocol ${policy.protocol}`),
    h('div', { class: 'jd-mono jd-dim', tid: 'policy-tie', style: 'font-size:0.875em' }, `Tie-break: ${policy.tieBreak}`),
    ...policy.sections.map((s) => h('div', {},
      h('div', { class: 'jd-head', style: 'margin-bottom:0.2em' }, s.title),
      ...s.lines.map((l) => h('div', { class: 'jd-dim', style: 'font-size:0.9em; margin-left:0.6em; text-indent:-0.6em; margin-top:0.15em' }, `· ${l}`)))),
    h('div', { class: 'jd-mono jd-dim', style: 'font-size:0.7em' }, 'Generated from the code by tools/make-policy.ts; also at policy.json next to the game and docs/POLICY.md in the repository.'));
  const box = h('div', { class: 'jd-dialog jd-panel', role: 'dialog', ariaLabel: 'Fairness and verification policy', tid: 'policy-dialog', style: 'width:min(92%, 46em)' },
    h('div', { class: 'jd-row jd-between' }, h('div', { class: 'jd-head' }, 'Fairness and verification policy'), btn('Close (Esc)', 'policy-close', close, { small: true })),
    body);
  const layer = h('div', { class: 'jd-modal', onClick: (e) => { if (e.target === layer) close(); } }, box);
  layer.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Escape') { e.preventDefault(); close(); } });
  ui.layer(scene, layer);
  (box.querySelector('[data-testid=policy-close]') as HTMLElement | null)?.focus();
}
