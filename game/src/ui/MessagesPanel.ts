/**
 * Talking with a friend (0.11.9): friends only, and private. The panel says so, because it is what makes it worth using: nothing reads
 * a message unless the player it was sent to reports it. Loaded on first use (ui/panels.ts); a modal layer like the inbox.
 */
import type Phaser from 'phaser';
import { addStyle, btn, h, ui } from './dom';
import { choiceDialog } from './choice';
import { reasonLabel, refusedText } from './ThreadPanel';
import { utcDateTime } from '../content/format';
import { t } from '../content/strings';
import '../content/strings-more';
import { REPORT_REASONS } from '../identity/identity';
import { loadConversation, reportMessage, sendMessage, type DirectMessage } from '../render/messages';

const MESSAGE_MAX = 500;
const STYLE = `
#ui .jd-messages { width: min(94%, 34em); max-height: 92%; display: flex; flex-direction: column; gap: 0.5em; }
#ui .jd-messages-list { flex: 1 1 auto; min-height: 8em; overflow: auto; font-size: 0.875em; display: flex; flex-direction: column; gap: 0.4em; }
#ui .jd-message { max-width: 85%; align-self: flex-start; }
#ui .jd-message.jd-mine { align-self: flex-end; text-align: right; }
#ui .jd-message-words { white-space: pre-wrap; overflow-wrap: anywhere; background: rgba(255, 255, 255, 0.06); border-radius: 0.3em; padding: 0.25em 0.5em; }
#ui .jd-message-meta { font-size: 0.75em; }
`;

export function openMessages(scene: Phaser.Scene, verifierUrl: string, handle: string): void {
  addStyle('jd-messages-style', STYLE);
  const prev = document.activeElement as HTMLElement | null;
  const close = () => {
    layer.remove();
    prev?.focus?.();
  };
  const head = h('div', { class: 'jd-head', tid: 'messages-head' }, t('messages.aria'));
  const list = h('div', { class: 'jd-messages-list', tid: 'messages-list' }, t('messages.loading'));
  const foot = h('div', { tid: 'messages-foot', style: 'display:flex; flex-direction:column; gap:0.35em; font-size:0.875em' });
  const box = h(
    'div',
    { class: 'jd-dialog jd-panel jd-messages', role: 'dialog', ariaLabel: t('messages.aria'), tid: 'messages-dialog' },
    h('div', { class: 'jd-row jd-between' }, head, btn(t('common.close'), 'messages-close', close, { small: true })),
    list,
    foot,
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
  (box.querySelector('[data-testid=messages-close]') as HTMLElement | null)?.focus();

  const report = (m: DirectMessage, note: HTMLElement) =>
    choiceDialog(scene, {
      title: t('messages.reportHead'),
      tid: 'report-message-dialog',
      lead: [h('p', {}, t('messages.reportLead'))],
      choices: [
        ...REPORT_REASONS.map((reason) => ({
          label: reasonLabel(reason),
          tid: `report-message-${reason}`,
          run: () => {
            void reportMessage(verifierUrl, m.id, reason).then((ok) => {
              note.textContent = ok ? t('thread.reported') : t('thread.refused.failed');
            });
          },
        })),
        { label: t('common.cancel'), tid: 'report-message-cancel' },
      ],
      onDismiss: () => {},
    });
  const row = (m: DirectMessage) => {
    const note = h('div', { class: 'jd-amber jd-message-meta', tid: `message-note-${m.id}` });
    return h(
      'div',
      { class: `jd-message${m.mine ? ' jd-mine' : ''}`, tid: `message-${m.id}` },
      h('div', { class: `jd-message-words${m.removed ? ' jd-dim' : ''}` }, m.removed ? t('messages.removed') : m.body),
      h('div', { class: 'jd-dim jd-message-meta' }, utcDateTime(new Date(m.at).toISOString())),
      note,
      !m.mine && !m.removed ? btn(t('thread.report'), `message-report-${m.id}`, () => report(m, note), { small: true }) : '',
    );
  };
  void loadConversation(verifierUrl, handle).then((c) => {
    if (!c) {
      list.textContent = t('messages.noLoad');
      return;
    }
    head.textContent = t('messages.head', { player: c.player });
    const rows = c.messages.map(row);
    list.replaceChildren(...(rows.length ? rows : [h('div', { class: 'jd-dim', tid: 'messages-empty' }, t('messages.empty'))]));
    list.scrollTop = list.scrollHeight;
    if (c.next !== null) {
      let next: number | null = c.next;
      const older: HTMLButtonElement = btn(
        t('messages.older'),
        'messages-older',
        () => {
          void loadConversation(verifierUrl, handle, next ?? undefined).then((page) => {
            if (!page) return;
            older.after(...page.messages.map(row));
            next = page.next;
            if (next === null) older.remove();
          });
        },
        { small: true },
      ) as HTMLButtonElement;
      list.prepend(older);
    }
    if (!c.friends) {
      foot.replaceChildren(h('div', { class: 'jd-dim', tid: 'messages-closed' }, t('messages.notFriends')));
      return;
    }
    const field = h('textarea', { class: 'jd-words', tid: 'messages-field', ariaLabel: t('messages.write', { player: c.player }) });
    field.placeholder = t('messages.write', { player: c.player });
    field.maxLength = MESSAGE_MAX;
    const status = h('div', { class: 'jd-amber', tid: 'messages-status', role: 'status' });
    const send: HTMLButtonElement = btn(
      t('messages.send'),
      'messages-send',
      () => {
        send.disabled = true;
        void sendMessage(verifierUrl, handle, field.value).then((r) => {
          send.disabled = false;
          if (!r.ok) {
            status.textContent = refusedText(r.code);
            field.focus();
            return;
          }
          status.textContent = '';
          field.value = '';
          list.querySelector('[data-testid=messages-empty]')?.remove();
          list.append(row(r.message));
          list.scrollTop = list.scrollHeight;
        });
      },
      { small: true, variant: 'primary' },
    ) as HTMLButtonElement;
    foot.replaceChildren(field, h('div', { class: 'jd-dim', tid: 'messages-private' }, t('messages.private')), status, send);
    field.focus();
  });
}
