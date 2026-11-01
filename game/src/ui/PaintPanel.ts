/**
 * The paint shop (0.11.12): what a player has earned to wear and what the rest takes. The server keeps it and says what is earned, so the
 * panel only reads and asks. Loaded on first use (ui/panels.ts).
 */
import type Phaser from 'phaser';
import { COSMETIC_KINDS, COSMETICS, measures, type Cosmetic, type CosmeticKind, type Look, type Needs, type Progress } from '../content/cosmetics';
import { int } from '../content/format';
import { t, type StringKey } from '../content/strings';
import '../content/strings-more';
import { lookName } from '../content/title';
import { loadShop, wearLook } from '../render/looks';
import { CSS } from '../render/palette';
import { addStyle, alertText, btn, h, ui, type Child } from './dom';

const STYLE = `
#ui .jd-paint { display: flex; flex-direction: column; gap: 0.75em; }
#ui .jd-paint-list { max-height: 62vh; overflow: auto; display: flex; flex-direction: column; gap: 0.35em; }
#ui .jd-paint-row { display: flex; align-items: center; justify-content: space-between; gap: 0.75em; min-height: 2em; }
#ui .jd-paint-need { font-size: 0.8125em; text-align: right; }
#ui .jd-paint-row .jd-btn:disabled { color: ${CSS.amber}; border-color: ${CSS.amber}; opacity: 1; }
#ui .jd-swatch { display: inline-block; width: 0.9em; height: 0.9em; margin-right: 0.5em; border-radius: 2px; vertical-align: -0.1em; }
`;
const GROUP: Record<CosmeticKind, StringKey> = { yard: 'paint.yard', skin: 'paint.skin', title: 'paint.title' };
const NEED: Record<keyof Needs, StringKey> = { days: 'paint.needDays', medals: 'paint.needMedals', gold: 'paint.needGold', top: 'paint.needTop' };

const needLine = (c: Cosmetic, p: Progress) => {
  const have = measures(p);
  return (Object.keys(c.needs) as (keyof Needs)[]).map((k) => t(NEED[k], { n: c.needs[k]!, have: int(have[k]) })).join(' · ');
};

export async function openPaint(scene: Phaser.Scene, verifierUrl: string): Promise<void> {
  const shop = await loadShop(verifierUrl);
  if (!shop) return void alertText(scene, t('common.cantOpenTitle'), t('common.cantOpen'));
  addStyle('jd-paint-style', STYLE);
  const owned = new Set(shop.owned);
  let look: Look = shop.look;
  const prev = document.activeElement as HTMLElement | null;
  const close = () => {
    layer.remove();
    prev?.focus?.();
  };
  const status = h('div', { class: 'jd-amber', tid: 'paint-status' });
  const list = h('div', { class: 'jd-paint-list', tid: 'paint-list' });
  const choose = (id: string, on: boolean) =>
    void wearLook(verifierUrl, id, on).then((now) => {
      status.textContent = now ? '' : t('thread.refused.failed');
      if (now) {
        look = now;
        draw();
      }
    });
  const swatch = (c: Cosmetic): Child => (c.colour ? h('span', { class: 'jd-swatch', style: `background:${c.colour}` }) : null);
  const row = (c: Cosmetic) => {
    if (!owned.has(c.id))
      return h(
        'div',
        { class: 'jd-paint-row jd-dim', tid: `paint-locked-${c.id}` },
        h('span', {}, swatch(c), lookName(c.id)),
        h('span', { class: 'jd-paint-need' }, needLine(c, shop.progress)),
      );
    const wearing = look[c.kind] === c.id;
    const use = btn(wearing ? t('paint.inUse') : t('paint.use'), `paint-use-${c.id}`, () => choose(c.id, true), { small: true, disabled: wearing });
    return h('div', { class: 'jd-paint-row', tid: `paint-row-${c.id}` }, h('span', {}, swatch(c), lookName(c.id)), use);
  };
  const plainRow = (kind: CosmeticKind) => {
    const on = look[kind];
    const use = btn(on ? t('paint.use') : t('paint.inUse'), `paint-plain-${kind}`, () => on && choose(on, false), { small: true, disabled: !on });
    return h('div', { class: 'jd-paint-row' }, h('span', {}, t('paint.plain')), use);
  };
  const draw = () =>
    list.replaceChildren(
      ...COSMETIC_KINDS.flatMap((kind) => [
        h('div', { class: 'jd-head', tid: `paint-group-${kind}` }, t(GROUP[kind])),
        plainRow(kind),
        ...COSMETICS.filter((c) => c.kind === kind).map(row),
      ]),
    );
  const box = h(
    'div',
    { class: 'jd-dialog jd-panel jd-paint', role: 'dialog', ariaLabel: t('paint.head'), tid: 'paint-dialog' },
    h('div', { class: 'jd-row jd-between' }, h('div', { class: 'jd-head' }, t('paint.head')), btn(t('common.close'), 'paint-close', close, { small: true })),
    h('div', { class: 'jd-dim', tid: 'paint-lead' }, t('paint.lead')),
    list,
    status,
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
  draw();
  ui.layer(scene, layer);
  (box.querySelector('[data-testid=paint-close]') as HTMLElement | null)?.focus();
}
