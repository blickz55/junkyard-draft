/**
 * Friends and what they have been up to (0.11.8). Someone is added from a game of theirs or a post, so there is nothing to search and
 * no list of players to browse. The feed takes in friends and crew mates; a game in it can be beaten in one tap. Removing and blocking
 * tell nobody. Loaded on first use (ui/panels.ts); a modal layer like the inbox.
 */
import type Phaser from 'phaser';
import { addStyle, btn, h, ui } from './dom';
import { withArt } from './opening';
import { openThread } from './ThreadPanel';
import { periodLabel, placeLine } from '../content/division';
import { money } from '../content/format';
import { t } from '../content/strings';
import '../content/strings-more';
import { yardLabel } from '../content/yard';
import { fetchChallenge } from '../render/challenge';
import {
  answerFriend,
  blockPlayer,
  loadFeed,
  loadFriends,
  removeFriend,
  unblockPlayer,
  type FeedItem,
  type FriendLists,
  type FriendRow,
} from '../render/friends';

const STYLE = `
#ui .jd-friends { width: min(94%, 36em); max-height: 92%; display: flex; flex-direction: column; gap: 0.5em; }
#ui .jd-friends-body { flex: 1 1 auto; min-height: 6em; overflow: auto; font-size: 0.875em; display: flex; flex-direction: column; gap: 0.75em; }
#ui .jd-friends-row { display: flex; align-items: center; gap: 0.5em; padding: 0.25em 0; border-top: 1px solid rgba(255, 255, 255, 0.08); }
#ui .jd-friends-row > :first-child { flex: 1 1 auto; min-width: 0; overflow-wrap: anywhere; }
#ui .jd-friends-row .jd-btn { flex: 0 0 auto; white-space: nowrap; }
`;

export function openFriends(scene: Phaser.Scene, verifierUrl: string): void {
  addStyle('jd-friends-style', STYLE);
  const prev = document.activeElement as HTMLElement | null;
  const close = () => {
    layer.remove();
    prev?.focus?.();
  };
  const body = h('div', { class: 'jd-friends-body', tid: 'friends-body' }, t('friends.loading'));
  const box = h(
    'div',
    { class: 'jd-dialog jd-panel jd-friends', role: 'dialog', ariaLabel: t('friends.head'), tid: 'friends-dialog' },
    h(
      'div',
      { class: 'jd-row jd-between' },
      h('div', { class: 'jd-head' }, t('friends.head')),
      btn(t('common.close'), 'friends-close', close, { small: true }),
    ),
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
    if (e.key === 'Escape') close();
  });
  ui.layer(scene, layer);
  (box.querySelector('[data-testid=friends-close]') as HTMLElement | null)?.focus();

  const act = (done: Promise<boolean>) => void done.then(refresh);
  const section = (title: string, tid: string, rows: HTMLElement[]): HTMLElement[] =>
    rows.length ? [h('div', { tid }, h('div', { class: 'jd-dim' }, title), ...rows)] : [];
  const person = (f: FriendRow, ...actions: HTMLElement[]) =>
    h('div', { class: 'jd-friends-row', tid: `friend-${f.handle}` }, h('span', {}, f.player), ...actions);
  const beatThis = (hash: string, id: number) =>
    btn(
      t('friends.beatThis'),
      `feed-beat-${id}`,
      () =>
        void fetchChallenge(verifierUrl, hash).then((c) => {
          if (c) withArt(scene, () => scene.scene.start('Game', { seed: c.seed, fresh: true, challenge: c }));
        }),
      { small: true },
    );
  const feedRow = (item: FeedItem) => {
    if (item.kind === 'run')
      return h(
        'div',
        { class: 'jd-friends-row', tid: 'feed-run' },
        h('span', {}, t('friends.feedRun', { player: item.player, score: money(item.score), yard: yardLabel(item.seed) })),
        beatThis(item.hash, item.id),
      );
    if (item.kind === 'post')
      return h(
        'div',
        { class: 'jd-friends-row', tid: 'feed-post' },
        h('span', {}, t('friends.feedPost', { player: item.player, words: item.excerpt })),
        btn(t('inbox.threadOpen'), `feed-read-${item.id}`, () => openThread(scene, verifierUrl, item.key), { small: true }),
      );
    return h(
      'div',
      { class: 'jd-friends-row', tid: 'feed-division' },
      h('span', {}, t('friends.feedDivision', { player: item.player, day: periodLabel(item.period), line: placeLine(item) })),
    );
  };
  const draw = (lists: FriendLists, feed: FeedItem[]) =>
    body.replaceChildren(
      ...section(
        t('friends.incoming'),
        'friends-incoming',
        lists.incoming.map((f) =>
          person(
            f,
            btn(t('friends.accept'), `friend-accept-${f.handle}`, () => act(answerFriend(verifierUrl, f.handle, true)), { small: true, variant: 'primary' }),
            btn(t('friends.decline'), `friend-decline-${f.handle}`, () => act(answerFriend(verifierUrl, f.handle, false)), { small: true }),
          ),
        ),
      ),
      ...section(t('friends.feed'), 'friends-feed', feed.map(feedRow)),
      ...section(
        t('friends.list'),
        'friends-list',
        lists.friends.map((f) =>
          person(
            f,
            btn(t('friends.remove'), `friend-remove-${f.handle}`, () => act(removeFriend(verifierUrl, f.handle)), { small: true }),
            btn(t('friends.block'), `friend-block-${f.handle}`, () => act(blockPlayer(verifierUrl, { handle: f.handle })), { small: true }),
          ),
        ),
      ),
      ...section(
        t('friends.sent'),
        'friends-sent',
        lists.sent.map((f) => person(f)),
      ),
      ...section(
        t('friends.blocked'),
        'friends-blocked',
        lists.blocked.map((f) =>
          person(
            f,
            btn(t('friends.unblock'), `friend-unblock-${f.handle}`, () => act(unblockPlayer(verifierUrl, f.handle)), { small: true }),
          ),
        ),
      ),
    );
  function refresh() {
    void Promise.all([loadFriends(verifierUrl), loadFeed(verifierUrl)]).then(([lists, feed]) => {
      if (!lists) {
        body.textContent = t('friends.noLoad');
        return;
      }
      const none = !lists.friends.length && !lists.incoming.length && !lists.sent.length && !lists.blocked.length && !feed?.length;
      if (none) body.textContent = t('friends.none');
      else draw(lists, feed ?? []);
    });
  }
  refresh();
}
