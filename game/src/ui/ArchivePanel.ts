/**
 * Daily archive (PLAN-v3 0.6.2): the verifier's closed days, newest first, each with its final board's top entry, the
 * bot par and the number of verified runs. Any day can be played as practice (a run on a closed day is verified but
 * never ranked) and its best replay watched. A modal DOM layer like the tips panel: Esc or Close dismisses it.
 */
import type Phaser from 'phaser';
import { h, btn, ui } from './dom';
import { fetchVerifiedReplay, playVerifiedReplay } from '../render/verified';
import { audio } from '../render/audio';
import { clearSave } from '../render/storage';

export interface ArchiveDay { date: string; seed: string; closesAt: string; frozenAt: string; n: number; botPar: number | null; top: { player: string; score: number; replayHash: string; replayAvailable?: boolean }[] }

export function openArchive(scene: Phaser.Scene, verifierUrl: string): void {
  const prev = document.activeElement as HTMLElement | null;
  const list = h('div', { tid: 'archive-list', class: 'jd-mono', style: 'font-size:0.8em; display:flex; flex-direction:column; gap:0.4em; max-height:50vh; overflow:auto' }, h('div', { class: 'jd-dim' }, 'Loading the archive…'));
  const close = () => { layer.remove(); prev?.focus?.(); };
  const box = h('div', { class: 'jd-dialog jd-panel', role: 'dialog', ariaLabel: 'Daily archive', tid: 'archive-dialog' },
    h('div', { class: 'jd-row jd-between' }, h('div', { class: 'jd-head' }, 'Daily archive — closed days, final boards'), btn('Close (Esc)', 'archive-close', close, { small: true })),
    h('div', { class: 'jd-dim jd-dialog-label' }, 'A day closes 48 hours after 00:00 UTC of its date and its board is then final. Any day can be played as practice: a run on a closed day is verified but never ranked.'),
    list);
  const layer = h('div', { class: 'jd-modal', onClick: (e) => { if (e.target === layer) close(); } }, box);
  layer.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Escape') { e.preventDefault(); close(); } });
  ui.layer(scene, layer);
  (box.querySelector('[data-testid=archive-close]') as HTMLElement | null)?.focus();
  const play = (seed: string) => { close(); audio.unlock(); clearSave(); scene.scene.start('Game', { seed, fresh: true }); };
  fetch(`${verifierUrl}/archive?limit=30`).then((r) => r.json()).then((a: { days: ArchiveDay[] }) => {
    if (!layer.isConnected) return;
    list.replaceChildren();
    if (!a.days?.length) { list.append(h('div', { class: 'jd-dim' }, 'No closed days yet. The first archive entry appears 48 hours after the first minted daily.')); return; }
    for (const d of a.days) {
      const top = d.top[0];
      const text = `${d.date} · final · ${d.n} verified run${d.n === 1 ? '' : 's'}${top ? ` · #1 $${top.score} ${top.player}` : ''}${d.botPar != null ? ` · bot par $${d.botPar}` : ''}`;
      const row = h('div', { class: 'jd-row jd-between', tid: 'archive-row', title: `seed ${d.seed} · closed ${d.closesAt}` },
        h('span', {}, text),
        h('span', { class: 'jd-row', style: 'gap:0.4em' },
          btn('Play as practice', 'archive-play', () => play(d.seed), { small: true }),
          top?.replayAvailable ? btn('Watch #1', 'archive-watch', () => { close(); fetchVerifiedReplay(verifierUrl, top.replayHash).then((r) => playVerifiedReplay(scene, r)).catch(() => { /* the title strip reports verifier trouble */ }); }, { small: true }) : null));
      row.dataset.date = d.date;
      list.append(row);
    }
  }).catch(() => { if (layer.isConnected) { list.replaceChildren(h('div', { class: 'jd-red' }, 'Verifier unreachable: the archive lives on the verifier.')); } });
}
