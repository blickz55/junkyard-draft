/**
 * The daily reminder's dialog (production roadmap 0.10.4): one sentence on what it is, the hour picker and one button.
 * Opened from the bests panel's head, so the title grows by nothing (the title must not shrink the player's text size for
 * a settings row). `onChange` lets the title relabel its button.
 */
import type Phaser from 'phaser';
import { h, btn, ui } from './dom';
import { t } from '../content/strings';
import { localHour } from '../content/format';
import { loadReminder, enableReminder, disableReminder, type Reminder } from '../render/push';

export function openReminder(scene: Phaser.Scene, verifierUrl: string, onChange: (r: Reminder | null) => void): void {
  const prev = document.activeElement as HTMLElement | null;
  let current = loadReminder();
  const close = () => {
    layer.remove();
    prev?.focus?.();
  };
  const hourSel = h('select', { tid: 'push-hour', class: 'jd-select', ariaLabel: t('title.push') });
  for (let hh = 0; hh < 24; hh++) {
    const o = h('option', {}, localHour(hh));
    o.value = String(hh);
    o.selected = hh === (current?.hourLocal ?? 9);
    hourSel.append(o);
  }
  hourSel.disabled = !!current;
  const status = h('div', { class: 'jd-mono jd-dim', tid: 'push-note', style: 'font-size:0.75em; min-height:1.3em' }, t('title.pushNote'));
  const label = () => (current ? t('title.pushOff', { time: localHour(current.hourLocal) }) : t('title.pushOn'));
  const pushBtn = btn(label(), 'push', () => void toggle(), { variant: 'primary', small: true });
  const toggle = async () => {
    pushBtn.disabled = true;
    hourSel.disabled = true;
    try {
      if (current) {
        await disableReminder(verifierUrl);
        current = null;
      } else {
        pushBtn.textContent = t('title.pushWorking');
        current = await enableReminder(verifierUrl, Number(hourSel.value));
      }
      status.textContent = t('title.pushNote');
      onChange(current);
    } catch (e) {
      const why = e instanceof Error && /denied|permission/i.test(e.message) ? t('title.pushDenied') : ((e as Error).message ?? String(e));
      status.textContent = t('title.pushFailed', { why });
    } finally {
      pushBtn.disabled = false;
      hourSel.disabled = !!current;
      pushBtn.textContent = label();
      pushBtn.focus(); // a disabled button dropped the focus; Esc must still reach the dialog
    }
  };
  const box = h(
    'div',
    { class: 'jd-dialog jd-panel', role: 'dialog', ariaLabel: t('title.push'), tid: 'reminder-dialog' },
    h('div', { class: 'jd-row jd-between' }, h('div', { class: 'jd-head' }, t('title.push')), btn(t('common.close'), 'reminder-close', close, { small: true })),
    h('div', { class: 'jd-dialog-label' }, t('title.pushLead')),
    h(
      'div',
      { class: 'jd-row', style: 'gap:0.6em; align-items:center' },
      h('span', { class: 'jd-dim', style: 'font-size:0.8125em' }, t('title.pushHour')),
      hourSel,
      pushBtn,
    ),
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
    if (e.key === 'Escape') {
      e.preventDefault();
      close();
    }
  });
  ui.layer(scene, layer);
  pushBtn.focus();
}
