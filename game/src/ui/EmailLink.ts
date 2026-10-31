/**
 * Sign in with email (0.11.1): one dialog to ask for a link or to sign out, and one for the link when it comes back. Loaded on first
 * use (ui/panels.ts). There is no password and no account page: a link proves the address, and the name and progress follow.
 */
import type Phaser from 'phaser';
import { alertText, h, ui } from './dom';
import { choiceDialog } from './choice';
import { t } from '../content/strings';
import { startLink, syncNow, unlinkEmail, verifyLink, type StartResult } from '../render/link';
import { loadLinked } from '../render/storage';

const startMessage: Record<Exclude<StartResult, 'sent'>, () => string> = {
  'bad-email': () => t('link.invalid'),
  'rate-limited': () => t('link.limited'),
  'email-off': () => t('link.off'),
  failed: () => t('link.failed'),
};

/** Ask for a link, or, signed in, say so and offer the way out. `onChange` runs when the answer to "signed in?" changes. */
export function openEmailLink(scene: Phaser.Scene, verifierUrl: string, onChange: () => void): void {
  if (loadLinked()) {
    choiceDialog(scene, {
      title: t('link.head'),
      tid: 'link-dialog',
      lead: [h('p', { tid: 'link-state' }, t('link.signedIn'))],
      choices: [
        { label: t('common.close'), tid: 'link-close', primary: true },
        {
          label: t('link.unlink'),
          tid: 'link-unlink',
          run: () => {
            void unlinkEmail(verifierUrl).then((done) => {
              onChange();
              void alertText(scene, t('link.head'), done ? t('link.unlinked') : t('link.failed'));
            });
          },
        },
      ],
      onDismiss: () => {},
    });
    return;
  }
  const field = h('input', { type: 'email', tid: 'link-email-field', ariaLabel: t('link.field') });
  field.placeholder = t('link.field');
  field.autocomplete = 'email';
  field.maxLength = 254;
  const status = h('p', { class: 'jd-amber', tid: 'link-status', role: 'status' });
  const submit = async (button: HTMLButtonElement) => {
    button.disabled = true;
    status.textContent = t('link.sending');
    const r = await startLink(verifierUrl, field.value);
    status.textContent = r === 'sent' ? t('link.sent') : startMessage[r]();
    button.disabled = r === 'sent';
    // the press disabled the button and took the focus with it: put it where the next key belongs
    if (r === 'sent') (ui.element?.querySelector('[data-testid=link-close]') as HTMLElement | null)?.focus();
    else field.focus();
  };
  const close = choiceDialog(scene, {
    title: t('link.head'),
    tid: 'link-dialog',
    lead: [h('p', {}, t('link.lead')), field, status],
    choices: [
      { label: t('link.send'), tid: 'link-send', primary: true, keepOpen: true, run: (b) => void submit(b) },
      { label: t('common.close'), tid: 'link-close' },
    ],
    note: t('link.note'),
    onDismiss: () => {},
  });
  field.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Escape') close();
    if (e.key === 'Enter') (ui.element?.querySelector('[data-testid=link-send]') as HTMLButtonElement | null)?.click();
  });
  field.focus();
}

/** The link came back to this device: ask, then sign in. Nothing happens before the press, so a mail scanner signs nobody in. */
export function openLinkLanding(scene: Phaser.Scene, verifierUrl: string, token: string, onDone: () => void): void {
  choiceDialog(scene, {
    title: t('link.confirmHead'),
    tid: 'link-confirm',
    lead: [h('p', {}, t('link.confirmLead'))],
    choices: [
      {
        label: t('link.confirm'),
        tid: 'link-confirm-yes',
        primary: true,
        run: () => {
          void verifyLink(verifierUrl, token).then(async (r) => {
            if (r.ok) await syncNow(verifierUrl);
            const text = r.ok
              ? r.joined
                ? t('link.doneJoined')
                : t('link.done')
              : r.code === 'link-gone'
                ? t('link.gone')
                : r.code === 'linked-elsewhere'
                  ? t('link.elsewhere')
                  : t('link.failed');
            await alertText(scene, t('link.head'), text);
            if (r.ok) onDone();
          });
        },
      },
      { label: t('link.notNow'), tid: 'link-confirm-no' },
    ],
  });
}
