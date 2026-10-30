/**
 * Daily archive (PLAN-v3 0.6.2): our server's closed days, newest first, each with its final board's top entry, the
 * foreman's mark and the number of checked games. Any day can be played as practice (a game on a closed day is checked
 * but never ranked) and its best recording watched. A modal DOM layer like the tips panel: Esc or Close dismisses it.
 */
import type Phaser from 'phaser';
import { h, btn, ui } from './dom';
import { fetchVerifiedReplay, playVerifiedReplay } from '../render/verified';
import { audio } from '../render/audio';
import { clearSave, loadSubmissions } from '../render/storage';
import { medalFor, medalsLine, type Medals } from '../daily/medals';
import { t } from '../content/strings';
import { money, utcDate, utcDateTime } from '../content/format';

export interface ArchiveDay {
  date: string;
  key?: string;
  kind?: 'daily' | 'weekly';
  seed: string;
  closesAt: string;
  frozenAt: string;
  n: number;
  botPar: number | null;
  medals?: Medals | null;
  top: { player: string; score: number; replayHash: string; replayAvailable?: boolean }[];
}

export function openArchive(scene: Phaser.Scene, verifierUrl: string): void {
  const prev = document.activeElement as HTMLElement | null;
  const list = h(
    'div',
    { tid: 'archive-list', class: 'jd-mono', style: 'font-size:0.8em; display:flex; flex-direction:column; gap:0.4em; max-height:50vh; overflow:auto' },
    h('div', { class: 'jd-dim' }, t('archive.loading')),
  );
  const close = () => {
    layer.remove();
    prev?.focus?.();
  };
  const box = h(
    'div',
    { class: 'jd-dialog jd-panel', role: 'dialog', ariaLabel: t('archive.aria'), tid: 'archive-dialog' },
    h(
      'div',
      { class: 'jd-row jd-between' },
      h('div', { class: 'jd-head' }, t('archive.head')),
      btn(t('common.close'), 'archive-close', close, { small: true }),
    ),
    h('div', { class: 'jd-dim jd-dialog-label' }, t('archive.intro')),
    list,
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
    if (e.key === 'Escape') {
      e.preventDefault();
      close();
    }
  });
  ui.layer(scene, layer);
  (box.querySelector('[data-testid=archive-close]') as HTMLElement | null)?.focus();
  const play = (seed: string) => {
    close();
    audio.unlock();
    clearSave();
    scene.scene.start('Game', { seed, fresh: true });
  };
  fetch(`${verifierUrl}/archive?limit=30`)
    .then((r) => r.json())
    .then((a: { days: ArchiveDay[] }) => {
      if (!layer.isConnected) return;
      list.replaceChildren();
      if (!a.days?.length) {
        list.append(h('div', { class: 'jd-dim' }, t('archive.none')));
        return;
      }
      for (const d of a.days) {
        const top = d.top[0];
        const text = t('archive.row', {
          day: d.kind === 'weekly' ? t('archive.week', { week: d.key ?? d.date }) : utcDate(d.date),
          n: d.n,
          top: top ? t('archive.rowTop', { score: money(top.score), player: top.player }) : '',
          mark: d.botPar != null ? t('archive.rowMark', { score: money(d.botPar) }) : '',
        });
        // medals only when the server sent thresholds (PLAN-v3 0.6.4); this device's own checked game on that day gets its medal named
        const mine = loadSubmissions()[d.seed];
        const medalText = d.medals
          ? t('archive.medals', {
              line: medalsLine(d.medals),
              yours: mine ? t('archive.medalsYours', { score: money(mine.score), medal: medalFor(mine.score, d.medals) ?? t('results.medalNone') }) : '',
            })
          : '';
        const row = h(
          'div',
          { class: 'jd-row jd-between', tid: 'archive-row', title: t('archive.rowTitle', { seed: d.seed, closed: utcDateTime(d.closesAt) }) },
          h('span', {}, text, medalText ? h('span', { tid: 'archive-medals', class: 'jd-amber' }, medalText) : null),
          h(
            'span',
            { class: 'jd-row', style: 'gap:0.4em' },
            btn(t('archive.play'), 'archive-play', () => play(d.seed), { small: true }),
            top?.replayAvailable
              ? btn(
                  t('archive.watch'),
                  'archive-watch',
                  () => {
                    close();
                    fetchVerifiedReplay(verifierUrl, top.replayHash, d.seed)
                      .then((r) => playVerifiedReplay(scene, r))
                      .catch(() => {
                        /* the title strip reports server trouble */
                      });
                  },
                  { small: true },
                )
              : null,
          ),
        );
        row.dataset.date = d.date;
        row.dataset.kind = d.kind ?? 'daily';
        list.append(row);
      }
    })
    .catch(() => {
      if (layer.isConnected) {
        list.replaceChildren(h('div', { class: 'jd-red' }, t('archive.offline')));
      }
    });
}
