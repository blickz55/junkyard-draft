/**
 * The inbox (0.11.7): who reacted to your games, who beat your score, how your division and your crew did. Opening it reads it.
 * A line with something to do has a button: a division opens its board, a beaten challenge can be beaten back, a decision can be
 * put to a person (0.11.2). A modal layer like Your record: Esc or Close dismisses it. Loaded on first use (ui/panels.ts).
 */
import type Phaser from 'phaser';
import { btn, h, ui } from './dom';
import { choiceDialog } from './choice';
import { withArt } from './opening';
import { openThread } from './ThreadPanel';
import { openDivision } from './DivisionPanel';
import { inboxText } from '../content/inbox';
import { utcDay } from '../content/format';
import { t } from '../content/strings';
import '../content/strings-more';
import { fetchChallenge } from '../render/challenge';
import type { Placement } from '../render/divisions';
import { loadInbox, markInboxRead, sendAppeal, type AppealResult, type InboxLine } from '../render/inbox';

const appealMessage: Record<Exclude<AppealResult, 'sent'>, () => string> = {
  empty: () => t('inbox.appealEmpty'),
  refused: () => t('inbox.appealRefused'),
  closed: () => t('inbox.appealClosed'),
  failed: () => t('inbox.appealFailed'),
};
/** One try: ask a person to look at a decision again. `onSent` takes the button off the line. */
function openAppeal(scene: Phaser.Scene, verifierUrl: string, action: number, onSent: () => void) {
  const field = h('textarea', { class: 'jd-words', tid: 'appeal-field', ariaLabel: t('inbox.appealField') });
  field.placeholder = t('inbox.appealField');
  field.maxLength = 500;
  const status = h('p', { class: 'jd-amber', tid: 'appeal-status', role: 'status' });
  const close = choiceDialog(scene, {
    title: t('inbox.appealHead'),
    tid: 'appeal-dialog',
    lead: [h('p', {}, t('inbox.appealLead')), field, status],
    choices: [
      {
        label: t('inbox.appealSend'),
        tid: 'appeal-send',
        primary: true,
        keepOpen: true,
        run: (button) => {
          button.disabled = true;
          status.textContent = t('inbox.appealSending');
          void sendAppeal(verifierUrl, action, field.value).then((r) => {
            status.textContent = r === 'sent' ? t('inbox.appealSent') : appealMessage[r]();
            button.disabled = r === 'sent';
            if (r === 'sent') {
              onSent();
              (ui.element?.querySelector('[data-testid=appeal-close]') as HTMLElement | null)?.focus();
            } else field.focus();
          });
        },
      },
      { label: t('common.close'), tid: 'appeal-close' },
    ],
    onDismiss: () => {},
  });
  field.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Escape') close();
  });
  field.focus();
}

export function openInbox(scene: Phaser.Scene, verifierUrl: string, onRead: () => void): void {
  const prev = document.activeElement as HTMLElement | null;
  const close = () => {
    layer.remove();
    prev?.focus?.();
  };
  const action = (line: InboxLine): HTMLElement | null => {
    if (line.kind === 'moderation' && line.payload.appealable) {
      const ask: HTMLElement = btn(
        t('inbox.appeal'),
        `inbox-appeal-${line.id}`,
        () => openAppeal(scene, verifierUrl, line.payload.action as number, () => ask.remove()),
        {
          small: true,
        },
      );
      return ask;
    }
    if (line.kind === 'thread-reply')
      return btn(t('inbox.threadOpen'), `inbox-thread-${line.id}`, () => openThread(scene, verifierUrl, line.payload.key as string), { small: true });
    if (line.kind === 'division')
      return btn(t('division.open'), `inbox-division-${line.id}`, () => openDivision(scene, verifierUrl, line.payload as unknown as Placement), {
        small: true,
      });
    if (line.kind === 'challenge')
      return btn(
        t('inbox.challengeBack'),
        `inbox-challenge-${line.id}`,
        () =>
          void fetchChallenge(verifierUrl, line.payload.hash as string).then((c) => {
            if (c) withArt(scene, () => scene.scene.start('Game', { seed: c.seed, fresh: true, challenge: c }));
          }),
        { small: true },
      );
    return null;
  };
  const rows = h('div', { class: 'jd-inbox-rows', tid: 'inbox-rows' }, t('inbox.loading'));
  const box = h(
    'div',
    { class: 'jd-dialog jd-panel', role: 'dialog', ariaLabel: t('inbox.aria'), tid: 'inbox-dialog' },
    h('div', { class: 'jd-row jd-between' }, h('div', { class: 'jd-head' }, t('inbox.head')), btn(t('common.close'), 'inbox-close', close, { small: true })),
    rows,
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
  (box.querySelector('[data-testid=inbox-close]') as HTMLElement | null)?.focus();
  void loadInbox(verifierUrl).then((inbox) => {
    if (!inbox) {
      rows.textContent = t('inbox.noLoad');
      return;
    }
    const lines = inbox.items.flatMap((line) => {
      const text = inboxText(line.kind, line.payload);
      if (!text) return [];
      return [
        h(
          'div',
          { class: `jd-inbox-row${line.read ? ' jd-dim' : ''}`, tid: `inbox-${line.kind}` },
          h('div', { class: 'jd-inbox-text' }, text, h('div', { class: 'jd-dim jd-inbox-day' }, utcDay(new Date(line.createdAt).toISOString().slice(0, 10)))),
          action(line),
        ),
      ];
    });
    rows.replaceChildren(...(lines.length ? lines : [t('inbox.none')]));
    if (inbox.unread) {
      void markInboxRead(verifierUrl);
      onRead();
    }
  });
}
