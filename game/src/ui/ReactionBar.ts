/**
 * The eight reactions under a recording (0.11.3). Tap one to leave it, tap another to change it, tap it again to take it back.
 * Counts only: there is nothing to write and nothing to moderate. The bar loads its own counts, and stays empty when the server
 * cannot be reached; on the viewer's own run it shows the counts and offers nothing.
 */
import { REACTIONS, reactionLine, type ReactionCounts, type ReactionId } from '../content/reactions';
import { t, type StringKey } from '../content/strings';
import { loadReactions, sendReaction } from '../render/reactions';
import { h } from './dom';

export function reactionBar(verifierUrl: string, hash: string): HTMLElement {
  const box = h('div', { class: 'jd-reactions', tid: 'reactions' });
  let counts: ReactionCounts = {};
  let mine: ReactionId | null = null;
  const buttons = new Map<ReactionId, HTMLButtonElement>();
  const note = h('div', { class: 'jd-dim jd-reaction-note', tid: 'reaction-note' });
  const paint = () => {
    for (const [id, b] of buttons) {
      const n = counts[id] ?? 0;
      b.classList.toggle('on', mine === id);
      b.setAttribute('aria-pressed', String(mine === id));
      b.setAttribute('aria-label', t('reaction.aria', { label: t(`reaction.${id}` as StringKey), n }));
      b.lastElementChild!.textContent = n ? String(n) : '';
    }
  };
  const tap = async (id: ReactionId) => {
    const next = mine === id ? null : id;
    const r = await sendReaction(verifierUrl, hash, next);
    note.textContent = r ? '' : t('reaction.failed');
    if (!r) return;
    counts = r.reactions;
    mine = r.mine;
    paint();
  };
  void loadReactions(verifierUrl, hash).then((r) => {
    if (!r) return;
    counts = r.reactions;
    mine = r.mine;
    if (r.own) {
      box.append(h('div', { class: 'jd-dim', tid: 'reactions-own' }, reactionLine(counts, REACTIONS.length)));
      return;
    }
    const row = h('div', { class: 'jd-reaction-row', role: 'group', ariaLabel: t('reaction.head') });
    for (const { id, glyph } of REACTIONS) {
      const b = h(
        'button',
        { class: 'jd-reaction', tid: `react-${id}`, type: 'button', title: t(`reaction.${id}` as StringKey), onClick: () => void tap(id) },
        h('span', {}, glyph),
        h('span', {}),
      ) as HTMLButtonElement;
      buttons.set(id, b);
      row.append(b);
    }
    box.append(h('div', { class: 'jd-dim jd-reaction-head' }, t('reaction.head')), row, note);
    paint();
  });
  return box;
}
