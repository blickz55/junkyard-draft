/**
 * A player's profile (0.11.13): their name, when they arrived, what they have won and their best games, opened from a post or a board.
 * A player can show only their name instead (Privacy & data). Loaded on first use (ui/panels.ts).
 */
import type Phaser from 'phaser';
import { alertText, btn, h, type Child } from './dom';
import { choiceDialog } from './choice';
import { withArt } from './opening';
import { trophyLine } from '../content/division';
import { money, utcMonth } from '../content/format';
import { t } from '../content/strings';
import '../content/strings-more';
import { lookName } from '../content/title';
import { yardLabel } from '../content/yard';
import { fetchChallenge } from '../render/challenge';
import { askFriend } from '../render/friends';
import { loadPlayerCard, type CardTarget, type PlayerCard } from '../render/playercard';

function games(scene: Phaser.Scene, verifierUrl: string, card: PlayerCard): Child[] {
  const best = card.best ?? [];
  if (!best.length) return [h('p', { class: 'jd-dim', tid: 'profile-none' }, t('profile.none'))];
  return best.map((game, i) => {
    const beat: HTMLButtonElement = btn(
      t('friends.beatThis'),
      `profile-beat-${i}`,
      () =>
        void fetchChallenge(verifierUrl, game.hash, undefined, game.seed).then((c) => {
          if (c) withArt(scene, () => scene.scene.start('Game', { seed: c.seed, fresh: true, challenge: c }));
          else beat.textContent = t('thread.refused.failed');
        }),
      { small: true },
    );
    return h('div', { class: 'jd-row jd-between', tid: 'profile-best' }, h('span', {}, `${money(game.score)} · ${yardLabel(game.seed)}`), beat);
  });
}

export async function openPlayerCard(scene: Phaser.Scene, verifierUrl: string, target: CardTarget): Promise<void> {
  const card = await loadPlayerCard(verifierUrl, target);
  if (!card) return void alertText(scene, t('common.cantOpenTitle'), t('common.cantOpen'));
  const lead: Child[] = [];
  if (card.private) lead.push(h('p', { class: 'jd-dim', tid: 'profile-private' }, t('profile.private')));
  else {
    if (card.hidden) lead.push(h('p', { class: 'jd-amber', tid: 'profile-own-hidden' }, t('profile.ownHidden')));
    if (lookName(card.badge)) lead.push(h('p', { tid: 'profile-badge' }, lookName(card.badge)));
    lead.push(h('p', { class: 'jd-dim', tid: 'profile-joined' }, t('profile.joined', { month: utcMonth(card.joined ?? '') })));
    const trophies = trophyLine(card.trophies ?? {});
    if (trophies) lead.push(h('p', { tid: 'profile-trophies' }, trophies));
    lead.push(...games(scene, verifierUrl, card));
  }
  if (card.friendable) {
    const friend: HTMLButtonElement = btn(
      t('friends.add'),
      'profile-friend',
      () => {
        friend.disabled = true;
        void askFriend(verifierUrl, target).then((r) => {
          friend.textContent = r === 'asked' ? t('friends.asked') : r === 'no-name' ? t('friends.needName') : t('thread.refused.failed');
        });
      },
      { small: true },
    );
    lead.push(friend);
  }
  choiceDialog(scene, {
    title: card.player,
    tid: 'profile-dialog',
    lead,
    choices: [{ label: t('common.close'), tid: 'profile-close', primary: true }],
    onDismiss: () => {},
  });
}
