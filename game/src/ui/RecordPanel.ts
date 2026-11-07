/**
 * Your record (production roadmap 0.9.7): a modal page of what this device remembers about its own play: days played and the
 * daily chain, medals, bests per yard, the standing of each checked game in order, machines drafted. Local data only: the
 * page sends nothing and asks our server nothing (0.11.1 syncs it later). A DOM layer like the archive: Esc or Close dismisses it.
 * Under the sections, the record as one file: "Save a copy" downloads it and "Open a copy" merges a saved one in and says what it
 * added (render/recordfile.ts; the desktop shell keeps that file by itself).
 */
import type Phaser from 'phaser';
import { h, btn, ui } from './dom';
import { recordData, type RecordData } from '../render/record';
import { packRecord, unpackRecord, takeRecord, RECORD_FILE_NAME, type Additions } from '../render/recordfile';
import { readSyncData } from '../render/storage';
import { t } from '../content/strings';
import '../content/strings-more';
import { money, int, utcDate } from '../content/format';
import { yardLabel } from '../content/yard';
import { machineName } from '../content/machines';
import { trophyLine } from '../content/division';

const cap = (x: string) => x.charAt(0).toUpperCase() + x.slice(1);

/** The sections, built from the data (exported for the unit test: no scene needed). */
export function recordSections(d: RecordData): HTMLElement[] {
  const section = (tid: string, head: string, ...body: (HTMLElement | null)[]) =>
    h('div', { class: 'jd-panel', tid, style: 'padding:0.5em 0.7em' }, h('div', { class: 'jd-head' }, head), ...body.filter((b): b is HTMLElement => !!b));
  const line = (text: string, cls = '') => h('div', { class: `jd-mono ${cls}`.trim(), style: 'font-size:0.8125em; margin-top:0.25em' }, text);
  // days and the chain
  const days = section(
    'record-days',
    t('record.daysHead'),
    line(
      t('record.daysLine', {
        n: d.days.played,
        span:
          d.days.first && d.days.last && d.days.first !== d.days.last ? t('record.daysSpan', { first: utcDate(d.days.first), last: utcDate(d.days.last) }) : '',
      }),
    ),
    line(t('record.dailiesLine', { n: d.dailies.checked, streak: int(d.dailies.current), longest: int(d.dailies.longest) }), 'jd-dim'),
  );
  // medals
  const medals = section(
    'record-medals',
    t('record.medalsHead'),
    d.medals.length
      ? h(
          'div',
          {},
          ...d.medals.map((m) =>
            line(t('record.medalRow', { medal: cap(m.medal), yard: yardLabel(m.seed), score: money(m.score), day: utcDate(m.at.slice(0, 10)) }), 'jd-amber'),
          ),
        )
      : line(t('record.medalsNone'), 'jd-dim'),
  );
  // bests
  const bests = section(
    'record-bests',
    t('record.bestsHead'),
    line(d.bests.overall ? t('record.bestOverall', { score: money(d.bests.overall.score), yard: yardLabel(d.bests.overall.seed) }) : t('record.bestsNone')),
    line(t('record.bestsCount', { yards: d.bests.yards, games: d.bests.games }), 'jd-dim'),
    d.bests.top.length > 1
      ? h(
          'div',
          { style: 'margin-top:0.25em' },
          ...d.bests.top.map((b) => line(t('record.bestRow', { yard: yardLabel(b.seed), score: money(b.score), day: utcDate(b.at.slice(0, 10)) }), 'jd-dim')),
        )
      : null,
  );
  // the standing of each checked game, oldest to newest; the newest bar in amber
  const n = d.standings.length;
  const latest = n ? d.standings[n - 1] : null;
  const trendWord =
    d.trend === 'up' ? t('record.trendUp') : d.trend === 'down' ? t('record.trendDown') : d.trend === 'flat' ? t('record.trendFlat') : t('record.trendFew');
  const trend = section(
    'record-trend',
    t('record.trendHead'),
    n
      ? h(
          'div',
          { class: 'jd-hist', role: 'img', ariaLabel: t('record.trendAria', { n }) },
          ...d.standings.slice(-20).map((s, i, arr) =>
            h(
              'div',
              {
                class: `jd-hist-bin${i === arr.length - 1 ? ' jd-hist-mine' : ''}`,
                tid: 'record-bar',
                title: t('record.barTitle', { yard: yardLabel(s.seed), pct: int(s.percentile), n: int(s.n), score: money(s.score) }),
              },
              h('div', { class: 'jd-hist-bar', style: `height:${Math.max(3, Math.round(s.percentile))}%` }),
            ),
          ),
        )
      : null,
    latest
      ? line(
          latest.n >= 5
            ? t('record.trendLine', { n, pct: int(latest.percentile), trend: trendWord })
            : t('record.trendLineFew', { n, rank: int(latest.rank), of: int(latest.n), trend: trendWord }),
          'jd-amber',
        )
      : line(t('record.trendNone'), 'jd-dim'),
  );
  // machines drafted per kind, as bars
  const max = Math.max(1, ...d.kinds.map((k) => k.count));
  const kinds = section(
    'record-kinds',
    t('record.kindsHead'),
    d.kinds.length
      ? h(
          'div',
          { style: 'display:flex; flex-direction:column; gap:0.2em; margin-top:0.25em' },
          ...d.kinds.map((k) =>
            h(
              'div',
              { class: 'jd-row', tid: `record-kind-${k.kind}`, style: 'flex-wrap:nowrap; gap:0.6em; font-size:0.8125em' },
              h('span', { style: 'width:7em; flex:0 0 auto' }, machineName(k.kind)),
              h(
                'div',
                { style: 'flex:1; height:0.7em; background:#2a241d; border-radius:0.2em; overflow:hidden' },
                h('div', { style: `width:${Math.round((100 * k.count) / max)}%; height:100%; background:#5a6670` }),
              ),
              h('span', { class: 'jd-mono', style: 'width:3em; text-align:right' }, int(k.count)),
            ),
          ),
        )
      : line(t('record.kindsNone'), 'jd-dim'),
  );
  // who watched this device's checked games, as the results last learnt it
  const watched = d.watched.length
    ? section(
        'record-watched',
        t('record.watchedHead'),
        ...d.watched.map((w) => line(t('record.watchedRow', { yard: yardLabel(w.seed), score: money(w.score), times: w.times, players: w.players }))),
      )
    : null;
  const earned = trophyLine(d.trophies);
  const trophies = earned ? section('record-trophies', t('record.trophiesHead'), line(earned, 'jd-amber')) : null;
  return [days, trend, medals, ...(trophies ? [trophies] : []), bests, ...(watched ? [watched] : []), kinds];
}

/** What a copy added, as one sentence's list: "3 days, 2 medals and 1 best"; "other details" for what the counts do not name. */
export function additionsList(a: Additions): string {
  const counted = [
    a.days > 0 ? t('record.partDays', { n: a.days }) : '',
    a.dailies > 0 ? t('record.partChecked', { n: a.dailies }) : '',
    a.medals > 0 ? t('record.partMedals', { n: a.medals }) : '',
    a.bests > 0 ? t('record.partBests', { n: a.bests }) : '',
    a.standings > 0 ? t('record.partStandings', { n: a.standings }) : '',
  ].filter((p) => p);
  const parts = a.other || (a.any && counted.length === 0) ? [...counted, t('record.partOther')] : counted;
  return parts.reduce((list, p, i) => (i === 0 ? p : t(i === parts.length - 1 ? 'record.listAnd' : 'record.listComma', { a: list, b: p })), '');
}

/** `onChanged` runs when the page closes after a copy added something: Home redraws its bests. */
export function openRecord(scene: Phaser.Scene, onChanged?: () => void): void {
  const prev = document.activeElement as HTMLElement | null;
  let changed = false;
  const close = () => {
    layer.remove();
    prev?.focus?.();
    if (changed) onChanged?.();
  };
  const body = h('div', { style: 'display:flex; flex-direction:column; gap:0.5em; max-height:60vh; overflow:auto' }, ...recordSections(recordData()));
  // a copy of the record as one file (render/recordfile.ts): saved here, opened here; needs no server, so the test edition has it too
  const status = h('div', { class: 'jd-mono jd-dim', tid: 'record-status', style: 'font-size:0.75em; min-height:1.2em' });
  const say = (text: string) => {
    status.textContent = text;
  };
  const saveBtn = btn(
    t('record.save'),
    'record-save',
    () => {
      const text = JSON.stringify(packRecord(readSyncData()), null, 2);
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
      a.download = RECORD_FILE_NAME;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
      say(t('record.saved', { file: RECORD_FILE_NAME }));
    },
    { small: true, title: t('record.saveTitle') },
  );
  const file = h('input', { type: 'file', tid: 'record-file', style: 'display:none' });
  file.accept = '.json,application/json';
  file.addEventListener('change', () => {
    const chosen = file.files?.[0];
    file.value = '';
    if (!chosen) return;
    void chosen.text().then(
      (text) => {
        let raw: unknown;
        try {
          raw = JSON.parse(text);
        } catch {
          return say(t('record.unreadable'));
        }
        const copy = unpackRecord(raw);
        if (!copy) return say(t('record.notRecord'));
        const added = takeRecord(copy);
        if (added.any) {
          changed = true;
          body.replaceChildren(...recordSections(recordData()));
        }
        say(added.any ? t('record.added', { list: additionsList(added) }) : t('record.addedNone'));
      },
      () => say(t('record.unreadable')),
    );
  });
  const openBtn = btn(t('record.open'), 'record-open', () => file.click(), { small: true, title: t('record.openTitle') });
  const box = h(
    'div',
    { class: 'jd-dialog jd-panel', role: 'dialog', ariaLabel: t('record.aria'), tid: 'record-dialog' },
    h('div', { class: 'jd-row jd-between' }, h('div', { class: 'jd-head' }, t('record.head')), btn(t('common.close'), 'record-close', close, { small: true })),
    body,
    h('div', { class: 'jd-row', tid: 'record-copy', style: 'gap:0.5em' }, saveBtn, openBtn, file),
    status,
    h('div', { class: 'jd-dim jd-dialog-label', tid: 'record-note' }, t('record.note')),
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
  (box.querySelector('[data-testid=record-close]') as HTMLElement | null)?.focus();
}
