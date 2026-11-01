/**
 * Fairness and verification policy panel (PLAN-v3 0.6.5). Renders game/public/policy.json, which tools/make-policy.ts
 * generates from the rules module and the verifier's constants, so what the player reads is what the code does.
 * The JSON is bundled at build time, as a chunk of its own (no fetch: it works in the packaged app and offline). A modal layer like the tips panel.
 * The policy page is the one place the glossary allows the technical words (verified, protocol, rules version). The monthly
 * moderation counts are live: they come from the server when it can be reached (0.11.2) and the page reads the same without them.
 */
import type Phaser from 'phaser';
import { h, btn, ui } from './dom';
import { t } from '../content/strings';
import '../content/strings-more';
import { verifierUrl } from '../render/config';
import { int } from '../content/format';

interface Month {
  month: string;
  posts: number;
  hidden: number;
  removed: number;
  appeals: number;
  upheld: number;
  overturned: number;
}
/** What the server publishes; null when it cannot be reached. */
async function moderationCounts(): Promise<{ slaHours: number; medianReviewHours: number | null; months: Month[] } | null> {
  try {
    const res = await fetch(`${verifierUrl()}/transparency`);
    return res.ok ? ((await res.json()) as { slaHours: number; medianReviewHours: number | null; months: Month[] }) : null;
  } catch {
    return null;
  }
}

export async function openPolicy(scene: Phaser.Scene): Promise<void> {
  const { default: policy } = await import('../../public/policy.json');
  const prev = document.activeElement as HTMLElement | null;
  const close = () => {
    layer.remove();
    prev?.focus?.();
  };
  const counts = h('div', { tid: 'policy-counts' });
  const body = h(
    'div',
    { tid: 'policy-body', style: 'max-height:60vh; overflow:auto; font-size:0.875em; display:flex; flex-direction:column; gap:0.6em' },
    h(
      'div',
      { class: 'jd-amber', tid: 'policy-headline', style: 'font-weight:700' },
      t('policy.headline', { rules: policy.rulesVersion, protocol: policy.protocol }),
    ),
    h('div', { class: 'jd-mono jd-dim', tid: 'policy-tie', style: 'font-size:0.875em' }, t('policy.tie', { tie: policy.tieBreak })),
    ...policy.sections.map((sec) =>
      h(
        'div',
        {},
        h('div', { class: 'jd-head', style: 'margin-bottom:0.2em' }, sec.title),
        ...sec.lines.map((l) => h('div', { class: 'jd-dim', style: 'font-size:0.9em; margin-left:0.6em; text-indent:-0.6em; margin-top:0.15em' }, `· ${l}`)),
      ),
    ),
    counts,
    h('div', { class: 'jd-mono jd-dim', style: 'font-size:0.7em' }, t('policy.footer')),
  );
  void moderationCounts().then((c) => {
    if (!c) return;
    const target =
      c.medianReviewHours === null
        ? t('policy.countsTarget', { hours: c.slaHours })
        : t('policy.countsMeasured', { hours: c.slaHours, median: c.medianReviewHours });
    counts.replaceChildren(
      h('div', { class: 'jd-head', style: 'margin-bottom:0.2em' }, t('policy.countsHead')),
      h('div', { class: 'jd-dim', style: 'font-size:0.9em' }, target),
      ...(c.months.length ? c.months : [null]).map((m) =>
        h(
          'div',
          { class: 'jd-dim', tid: 'policy-month', style: 'font-size:0.9em' },
          m
            ? t('policy.countsMonth', {
                month: m.month,
                posts: int(m.posts),
                hidden: int(m.hidden),
                removed: int(m.removed),
                appeals: int(m.appeals),
                upheld: int(m.upheld),
                overturned: int(m.overturned),
              })
            : t('policy.countsNone'),
        ),
      ),
    );
  });
  const box = h(
    'div',
    { class: 'jd-dialog jd-panel', role: 'dialog', ariaLabel: t('policy.title'), tid: 'policy-dialog', style: 'width:min(92%, 46em)' },
    h('div', { class: 'jd-row jd-between' }, h('div', { class: 'jd-head' }, t('policy.title')), btn(t('common.close'), 'policy-close', close, { small: true })),
    body,
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
  (box.querySelector('[data-testid=policy-close]') as HTMLElement | null)?.focus();
}
