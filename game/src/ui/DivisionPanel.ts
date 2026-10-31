/**
 * A closed day's division (0.11.11): the final board of the players around your score, its medals, and your result to copy. A
 * modal layer like Your record: Esc or Close dismisses it. Loaded on first use (ui/panels.ts).
 */
import type Phaser from 'phaser';
import { btn, h, showText, ui } from './dom';
import { divisionName, medalGlyph, periodLabel, placeLine } from '../content/division';
import { money } from '../content/format';
import { t } from '../content/strings';
import { loadDivisionBoard, type Placement } from '../render/divisions';

export function openDivision(scene: Phaser.Scene, verifierUrl: string, p: Placement): void {
  const prev = document.activeElement as HTMLElement | null;
  const close = () => {
    layer.remove();
    prev?.focus?.();
  };
  const rows = h('div', { class: 'jd-division-rows', tid: 'division-rows' }, t('division.loading'));
  const text = t('division.share', { day: periodLabel(p.period), line: placeLine(p) });
  const copy = btn(t('division.copy'), 'division-copy', () => {
    const done = () => (copy.textContent = t('division.copied'));
    const fallback = () => void showText(scene, t('division.copy'), text);
    if (navigator.clipboard?.writeText) navigator.clipboard.writeText(text).then(done, fallback);
    else fallback();
  });
  const box = h(
    'div',
    { class: 'jd-dialog jd-panel', role: 'dialog', ariaLabel: t('division.aria'), tid: 'division-dialog' },
    h(
      'div',
      { class: 'jd-row jd-between' },
      h('div', { class: 'jd-head', tid: 'division-head' }, `${divisionName(p.name)} · ${periodLabel(p.period)}`),
      btn(t('common.close'), 'division-close', close, { small: true }),
    ),
    h('div', { class: 'jd-dim jd-dialog-label' }, t('division.note')),
    rows,
    h('div', { class: 'jd-row', style: 'margin-top:0.5em' }, copy),
  );
  const layer = h(
    'div',
    {
      class: 'jd-modal',
      onClick: (e) => {
        if (e.target === layer) close();
      },
    },
    box,
  );
  layer.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Escape') close();
  });
  ui.layer(scene, layer);
  (box.querySelector('[data-testid=division-close]') as HTMLElement | null)?.focus();
  void loadDivisionBoard(verifierUrl, p).then((b) => {
    if (!b) {
      rows.textContent = t('division.noBoard');
      return;
    }
    rows.replaceChildren(
      ...b.rows.map((r) =>
        h(
          'div',
          { class: `jd-division-row${r.you ? ' jd-amber' : ''}`, tid: r.you ? 'division-you' : undefined },
          h('span', {}, `#${r.place}`),
          h('span', { class: 'jd-division-name' }, r.player),
          h('span', {}, `${money(r.score)} ${medalGlyph(r.medal)}`.trim()),
        ),
      ),
    );
    box.querySelector('[data-testid=division-you]')?.scrollIntoView({ block: 'center' });
  });
}
