/**
 * The daily reminder's dialog (production roadmap 0.10.4): one sentence on what it is, the hour picker and one button.
 * Opened from the bests panel's head, so the title grows by nothing (the title must not shrink the player's text size for
 * a settings row). `onChange` lets the title relabel its button.
 */
import type Phaser from 'phaser';
import { h, btn, ui } from './dom';
import { t, type StringKey } from '../content/strings';
import '../content/strings-more';
import { localHour } from '../content/format';
import { loadReminder, enableReminder, disableReminder, setReminderSocial, type Reminder, type SocialKind } from '../render/push';

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
  const status = h('div', { class: 'jd-mono jd-dim', tid: 'push-note', style: 'font-size:0.75em; min-height:1.3em' });
  const label = () => (current ? t('title.pushOff', { time: localHour(current.hourLocal) }) : t('title.pushOn'));
  // what else this device hears (0.11.7): both off until asked for, and only once the reminder is on
  const social = h('div', { tid: 'push-social', style: 'display:flex; flex-direction:column; gap:0.35em' });
  const SOCIAL: [SocialKind, StringKey][] = [
    ['reply', 'title.pushReply'],
    ['challenge', 'title.pushChallenge'],
  ];
  const drawSocial = () => {
    const on = current?.social ?? [];
    const choice = ([kind, key]: [SocialKind, StringKey]) => {
      const box = h('input', { type: 'checkbox', tid: `push-${kind}`, style: 'width:auto; margin:0' });
      box.checked = on.includes(kind);
      box.addEventListener('change', () => {
        const kinds = SOCIAL.map(([k]) => k).filter((k) => (k === kind ? box.checked : on.includes(k)));
        void setReminderSocial(verifierUrl, kinds).then((r) => {
          current = r ?? current;
          if (!r) status.textContent = t('thread.refused.failed');
          drawSocial();
        });
      });
      return h('label', { style: 'display:flex; gap:0.5em; align-items:center; font-size:0.875em' }, box, t(key));
    };
    social.replaceChildren(
      ...(current
        ? [
            h('div', { class: 'jd-dim', style: 'font-size:0.8125em' }, t('title.pushSocial')),
            ...SOCIAL.map(choice),
            h('div', { class: 'jd-dim', style: 'font-size:0.75em' }, t('title.pushSocialNote')),
          ]
        : []),
    );
  };
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
      status.textContent = '';
      drawSocial();
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
    social,
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
  drawSocial();
  ui.layer(scene, layer);
  pushBtn.focus();
}
