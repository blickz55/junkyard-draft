/**
 * A day's talk (0.11.5): Sal's opening and closing posts, what the players said, and a box to write in. The reveal gate covers the
 * words as it covers the recordings, so on an open yard the panel says so to anyone without a checked game. A post shows at once to
 * its author, and to the others when the classifier has read it. Loaded on first use (ui/panels.ts); a modal layer like the inbox.
 */
import type Phaser from 'phaser';
import { addStyle, btn, h, ui } from './dom';
import { choiceDialog } from './choice';
import { openEmailLink } from './EmailLink';
import { CSS } from '../render/palette';
import { periodLabel } from '../content/division';
import { categoryOf, isTopicKey } from '../content/hub';
import { categoryName } from '../content/sal-posts';
import { money, utcDateTime } from '../content/format';
import { reasonText } from '../content/inbox';
import { t, type StringKey } from '../content/strings';
import '../content/strings-more';
import { POST_MAX, REPORT_REASONS } from '../identity/identity';
import { askFriend, blockPlayer } from '../render/friends';
import { loadLinked, loadSubmissions } from '../render/storage';
import { changePost, loadThread, reportPost, sendPost, takeBackPost, type Sent, type ThreadPost, type ThreadView } from '../render/thread';
import { fetchVerifiedReplay, playVerifiedReplay } from '../render/verified';

const STYLE = `
#ui .jd-thread { width: min(94%, 40em); max-height: 92%; display: flex; flex-direction: column; gap: 0.5em; }
#ui .jd-thread-list { flex: 1 1 auto; min-height: 6em; overflow: auto; font-size: 0.875em; display: flex; flex-direction: column; gap: 0.5em; }
#ui .jd-thread-sal { border-left: 0.2em solid ${CSS.amber}; padding-left: 0.5em; font-size: 0.875em; }
#ui .jd-thread-post { border-top: 1px solid rgba(255, 255, 255, 0.08); padding-top: 0.35em; }
#ui .jd-thread-meta { font-size: 0.8125em; overflow-wrap: anywhere; }
#ui .jd-thread-words { white-space: pre-wrap; overflow-wrap: anywhere; }
#ui .jd-thread-note { font-size: 0.8125em; }
#ui .jd-thread-actions { display: flex; flex-wrap: wrap; gap: 0.35em; margin-top: 0.25em; }
#ui .jd-thread-foot { display: flex; flex-direction: column; gap: 0.35em; font-size: 0.875em; }
#ui .jd-thread-send { display: flex; align-items: center; gap: 0.6em; flex-wrap: wrap; }
#ui .jd-thread-send .jd-btn { margin-left: auto; }
#ui .jd-thread-attach { display: flex; align-items: center; gap: 0.3em; }
#ui .jd-thread-attach input { width: auto; }
`;

/** What each refusal from the server says to the player. */
const refusedKey: Record<string, StringKey> = {
  empty: 'thread.refused.empty',
  'too-long': 'thread.refused.tooLong',
  blocked: 'thread.refused.blocked',
  link: 'thread.refused.link',
  email: 'thread.refused.email',
  phone: 'thread.refused.phone',
  address: 'thread.refused.address',
  repeat: 'thread.refused.repeat',
  'rate-limited': 'thread.refused.slow',
  'too-late': 'thread.refused.tooLate',
  muted: 'thread.refused.muted',
  banned: 'thread.banned',
  'no-name': 'thread.noName',
  'not-linked': 'thread.signIn',
  'not-friends': 'messages.notFriends',
  locked: 'thread.refused.locked',
  'hub-closed': 'thread.refused.hubClosed',
};
export const refusedText = (code: string) => t(refusedKey[code] ?? 'thread.refused.failed');

/** The words a report offers for each reason: the same fixed list the server takes. */
export const reasonLabel = (reason: string) => t(`thread.report.${reason.replace(/-(\w)/g, (_, c: string) => c.toUpperCase())}` as StringKey);

export function openThread(scene: Phaser.Scene, verifierUrl: string, key: string): void {
  addStyle('jd-thread-style', STYLE);
  const prev = document.activeElement as HTMLElement | null;
  let open = true;
  const close = () => {
    open = false;
    layer.remove();
    prev?.focus?.();
  };
  const isGame = /^[0-9a-f]{64}$/.test(key);
  const category = categoryOf(key);
  const head = h(
    'div',
    { class: 'jd-head', tid: 'thread-head' },
    isGame ? t('thread.headGame') : category ? categoryName(category) : isTopicKey(key) ? '' : t('thread.head', { yard: periodLabel(key) }),
  );
  const salBox = h('div', { class: 'jd-thread-salbox', tid: 'thread-sal' });
  const list = h('div', { class: 'jd-thread-list', tid: 'thread-list' }, t('thread.loading'));
  const foot = h('div', { class: 'jd-thread-foot', tid: 'thread-foot' });
  const box = h(
    'div',
    { class: 'jd-dialog jd-panel jd-thread', role: 'dialog', ariaLabel: t('thread.aria'), tid: 'thread-dialog' },
    h('div', { class: 'jd-row jd-between' }, head, btn(t('common.close'), 'thread-close', close, { small: true })),
    salBox,
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
  (box.querySelector('[data-testid=thread-close]') as HTMLElement | null)?.focus();

  const report = (p: ThreadPost, line: HTMLElement, row: HTMLElement) =>
    choiceDialog(scene, {
      title: t('thread.reportHead'),
      tid: 'report-post-dialog',
      lead: [h('p', {}, t('thread.reportLead'))],
      choices: [
        ...REPORT_REASONS.map((reason) => ({
          label: reasonLabel(reason),
          tid: `report-post-${reason}`,
          run: () => {
            void reportPost(verifierUrl, p.id, reason).then((r) => {
              line.textContent = t(r === 'sent' ? 'thread.reported' : r === 'no-name' ? 'thread.reportNoName' : 'thread.refused.failed');
            });
          },
        })),
        {
          label: t('thread.blockPlayer'),
          tid: 'report-post-block',
          run: () => {
            void blockPlayer(verifierUrl, { postId: p.id }).then((ok) => {
              if (ok) row.remove();
              else line.textContent = t('thread.refused.failed');
            });
          },
        },
        { label: t('common.cancel'), tid: 'report-post-cancel' },
      ],
      onDismiss: () => {},
    });
  const takeBack = (p: ThreadPost, row: HTMLElement) =>
    choiceDialog(scene, {
      title: t('thread.takeBackHead'),
      tid: 'take-back-dialog',
      lead: [h('p', {}, t('thread.takeBackLead'))],
      choices: [
        {
          label: t('thread.takeBack'),
          tid: 'take-back-yes',
          primary: true,
          run: () => {
            void takeBackPost(verifierUrl, p.id).then((ok) => {
              if (ok) row.remove();
            });
          },
        },
        { label: t('common.cancel'), tid: 'take-back-no' },
      ],
      onDismiss: () => {},
    });
  const editor = (p: ThreadPost, row: HTMLElement) => {
    const field = h('textarea', { class: 'jd-words', tid: `post-edit-${p.id}`, ariaLabel: t('thread.write') });
    field.value = p.body;
    field.maxLength = POST_MAX;
    const note = h('div', { class: 'jd-amber jd-thread-note', tid: 'post-edit-status', role: 'status' });
    const form = h(
      'div',
      { class: 'jd-thread-post', tid: `post-${p.id}` },
      field,
      note,
      h(
        'div',
        { class: 'jd-thread-actions' },
        btn(
          t('thread.save'),
          `post-save-${p.id}`,
          () => {
            void changePost(verifierUrl, p.id, field.value).then((r: Sent) => {
              if (r.ok) form.replaceWith(postRow(r.post));
              else note.textContent = refusedText(r.code);
            });
          },
          { small: true },
        ),
        btn(t('common.cancel'), `post-cancel-${p.id}`, () => form.replaceWith(row), { small: true }),
      ),
    );
    row.replaceWith(form);
    field.focus();
  };
  const postRow = (p: ThreadPost): HTMLElement => {
    const note = h('div', { class: 'jd-amber jd-thread-note', tid: `post-note-${p.id}` });
    if (p.own && p.waiting) note.textContent = t('thread.checking');
    else if (p.own && p.state === 'hidden') note.textContent = t('thread.down', { reason: reasonText(p.reason) });
    const when = utcDateTime(new Date(p.createdAt).toISOString());
    const actions: HTMLElement[] = [];
    const row: HTMLElement = h(
      'div',
      { class: 'jd-thread-post', tid: `post-${p.id}` },
      h('div', { class: 'jd-dim jd-thread-meta' }, `${p.author} · ${when}${p.edited ? ` · ${t('thread.edited')}` : ''}`),
      h('div', { class: 'jd-thread-words', tid: `post-body-${p.id}` }, p.body),
      note,
      h('div', { class: 'jd-thread-actions' }, ...actions),
    );
    const bar = row.lastElementChild as HTMLElement;
    const add = (b: HTMLElement) => bar.append(b);
    if (p.hash) {
      const hash = p.hash;
      add(
        btn(
          t('thread.watch'),
          `post-watch-${p.id}`,
          () => {
            void fetchVerifiedReplay(verifierUrl, hash).then(
              (r) => playVerifiedReplay(scene, r),
              () => (note.textContent = t('thread.refused.failed')),
            );
          },
          { small: true },
        ),
      );
    }
    if (p.own) {
      if (p.editable) add(btn(t('thread.change'), `post-change-${p.id}`, () => editor(p, row), { small: true }));
      if (p.state !== 'hidden' || p.waiting) add(btn(t('thread.takeBack'), `post-take-back-${p.id}`, () => takeBack(p, row), { small: true }));
    } else {
      add(btn(t('thread.report'), `post-report-${p.id}`, () => report(p, note, row), { small: true }));
      if (!p.friend && loadLinked()) {
        const friend: HTMLButtonElement = btn(
          t('friends.add'),
          `post-friend-${p.id}`,
          () => {
            friend.disabled = true;
            void askFriend(verifierUrl, { postId: p.id }).then((r) => {
              friend.textContent = r === 'asked' ? t('friends.asked') : r === 'no-name' ? t('friends.needName') : t('thread.refused.failed');
            });
          },
          { small: true },
        ) as HTMLButtonElement;
        add(friend);
      }
    }
    return row;
  };

  const composer = (view: ThreadView) => {
    if (view.locked) {
      foot.replaceChildren(h('div', { class: 'jd-dim', tid: 'thread-write-state' }, t('thread.locked')));
      return;
    }
    if (view.write !== 'ok') {
      const words =
        view.write === 'not-linked'
          ? t('thread.signIn')
          : view.write === 'no-name'
            ? t('thread.noName')
            : view.write === 'banned'
              ? t('thread.banned')
              : t('thread.muted', { until: utcDateTime(new Date(view.until ?? 0).toISOString()) });
      foot.replaceChildren(
        h('div', { class: 'jd-dim', tid: 'thread-write-state' }, words),
        view.write === 'not-linked'
          ? btn(t('thread.signInButton'), 'thread-sign-in', () => openEmailLink(scene, verifierUrl, () => refresh()), { small: true })
          : '',
      );
      return;
    }
    const field = h('textarea', { class: 'jd-words', tid: 'thread-field', ariaLabel: t('thread.write') });
    field.placeholder = t('thread.write');
    field.maxLength = POST_MAX;
    const count = h('span', { class: 'jd-dim', tid: 'thread-count' }, t('thread.count', { n: 0, max: POST_MAX }));
    field.addEventListener('input', () => (count.textContent = t('thread.count', { n: [...field.value].length, max: POST_MAX })));
    // a game's own talk has nothing to attach; a day's takes that day's game; the hub takes the latest
    const games = Object.entries(loadSubmissions());
    const latest = games.sort(([, a], [, b]) => b.verifiedAt.localeCompare(a.verifiedAt))[0]?.[1];
    const mine = view.run ? undefined : view.seed ? loadSubmissions()[view.seed] : latest;
    const attach = h('input', { type: 'checkbox', tid: 'thread-attach' });
    const status = h('div', { class: 'jd-amber jd-thread-note', tid: 'thread-status', role: 'status' });
    const send = btn(
      t('thread.send'),
      'thread-send',
      () => {
        send.disabled = true;
        void sendPost(verifierUrl, key, field.value, attach.checked && mine ? mine.replayHash : null).then((r) => {
          send.disabled = false;
          if (!r.ok) {
            status.textContent = refusedText(r.code);
            field.focus();
            return;
          }
          status.textContent = '';
          field.value = '';
          count.textContent = t('thread.count', { n: 0, max: POST_MAX });
          list.querySelector('[data-testid=thread-empty]')?.remove();
          list.append(postRow(r.post));
          list.scrollTop = list.scrollHeight;
          attach.checked = false;
          // the classifier takes a moment: read the thread once more so the note goes without anyone asking
          setTimeout(() => open && refresh(false), 3000);
        });
      },
      { small: true, variant: 'primary' },
    ) as HTMLButtonElement;
    foot.replaceChildren(
      field,
      h('div', { class: 'jd-thread-send' }, count, mine ? h('label', { class: 'jd-thread-attach' }, attach, t('thread.attach')) : '', send),
      status,
    );
  };

  /** `whole`: the first read draws the box too; a later one only the posts, so a half-written post is not lost. */
  function refresh(whole = true) {
    void loadThread(verifierUrl, key).then((view) => {
      if (!open || (!whole && list.querySelector('textarea'))) return; // a post being changed is not swept away
      if (view === 'gate') {
        list.textContent = t('thread.gate');
        return;
      }
      if (!view) {
        list.textContent = t('thread.noLoad');
        return;
      }
      if (view.run) head.textContent = t('thread.headRun', { player: view.run.player, score: money(view.run.score) });
      if (view.title) head.textContent = view.title;
      salBox.replaceChildren(
        ...[view.foreman.close, view.foreman.open]
          .filter((line): line is string => !!line)
          .map((line) => h('div', { class: 'jd-thread-sal' }, h('span', { class: 'jd-foreman-tag' }, t('foreman.name')), ` ${line}`)),
      );
      const rows = view.posts.map(postRow);
      const top = list.scrollTop;
      list.replaceChildren(...(rows.length ? rows : [h('div', { class: 'jd-dim', tid: 'thread-empty' }, t('thread.empty'))]));
      list.scrollTop = top;
      if (view.next !== null) {
        let next: number | null = view.next;
        const more: HTMLButtonElement = btn(
          t('thread.more'),
          'thread-more',
          () => {
            void loadThread(verifierUrl, key, next ?? 0).then((page) => {
              if (!page || page === 'gate') return;
              more.before(...page.posts.map(postRow));
              next = page.next;
              if (next === null) more.remove();
            });
          },
          { small: true },
        ) as HTMLButtonElement;
        list.append(more);
      }
      if (whole) composer(view);
    });
  }
  refresh();
}
