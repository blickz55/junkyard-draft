/**
 * The community hub in the game (0.11.10): the four categories, the topics in them once there are any, and the days with a talk. Every
 * thread opens in the same panel as the day's talk. Loaded on first use (ui/panels.ts); a modal layer like the inbox.
 */
import type Phaser from 'phaser';
import { addStyle, btn, h, ui } from './dom';
import { choiceDialog } from './choice';
import { openThread, refusedText } from './ThreadPanel';
import { periodLabel } from '../content/division';
import { categoryKey, TOPIC_TITLE_MAX, type HubCategory } from '../content/hub';
import { categoryLead, categoryName, sal } from '../content/sal-posts';
import { t } from '../content/strings';
import '../content/strings-more';
import { POST_MAX } from '../identity/identity';
import { loadHub, startTopic } from '../render/hub';

const STYLE = `
#ui .jd-hub { width: min(94%, 36em); max-height: 92%; display: flex; flex-direction: column; gap: 0.5em; }
#ui .jd-hub-body { flex: 1 1 auto; min-height: 6em; overflow: auto; font-size: 0.875em; display: flex; flex-direction: column; gap: 0.25em; }
#ui .jd-hub-row { display: flex; align-items: center; gap: 0.5em; padding: 0.3em 0; border-top: 1px solid rgba(255, 255, 255, 0.08); }
#ui .jd-hub-row > :first-child { flex: 1 1 auto; min-width: 0; overflow-wrap: anywhere; }
#ui .jd-hub-row .jd-btn { flex: 0 0 auto; white-space: nowrap; }
#ui .jd-hub-topic { padding-left: 1em; }
`;

export function openHub(scene: Phaser.Scene, verifierUrl: string): void {
  addStyle('jd-hub-style', STYLE);
  const prev = document.activeElement as HTMLElement | null;
  const close = () => {
    layer.remove();
    prev?.focus?.();
  };
  const body = h('div', { class: 'jd-hub-body', tid: 'hub-body' }, t('hub.loading'));
  const box = h(
    'div',
    { class: 'jd-dialog jd-panel jd-hub', role: 'dialog', ariaLabel: sal('sal.hub'), tid: 'hub-dialog' },
    h('div', { class: 'jd-row jd-between' }, h('div', { class: 'jd-head' }, sal('sal.hub')), btn(t('common.close'), 'hub-close', close, { small: true })),
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
  (box.querySelector('[data-testid=hub-close]') as HTMLElement | null)?.focus();

  const count = (n: number) => sal('sal.hub.posts', { n });
  const newTopic = (category: HubCategory) => {
    const title = h('input', { type: 'text', tid: 'topic-title', ariaLabel: t('hub.topicTitle') });
    title.placeholder = t('hub.topicTitle');
    title.maxLength = TOPIC_TITLE_MAX;
    const words = h('textarea', { class: 'jd-words', tid: 'topic-body', ariaLabel: t('thread.write') });
    words.placeholder = t('thread.write');
    words.maxLength = POST_MAX;
    const status = h('p', { class: 'jd-amber', tid: 'topic-status', role: 'status' });
    const stop = choiceDialog(scene, {
      title: t('hub.topicHead', { category: categoryName(category) }),
      tid: 'topic-dialog',
      lead: [title, words, status],
      choices: [
        {
          label: t('thread.send'),
          tid: 'topic-send',
          primary: true,
          keepOpen: true,
          run: (button) => {
            button.disabled = true;
            void startTopic(verifierUrl, category, title.value, words.value).then((r) => {
              button.disabled = false;
              if (!r.ok) {
                status.textContent = refusedText(r.code);
                return;
              }
              stop();
              refresh();
              openThread(scene, verifierUrl, r.key);
            });
          },
        },
        { label: t('common.cancel'), tid: 'topic-cancel' },
      ],
      onDismiss: () => {},
    });
    for (const field of [title, words]) field.addEventListener('keydown', (e) => e.stopPropagation());
    title.focus();
  };
  function refresh() {
    void loadHub(verifierUrl).then((hub) => {
      if (!hub) {
        body.textContent = t('hub.noLoad');
        return;
      }
      body.replaceChildren(
        ...hub.categories.flatMap((c) => [
          h(
            'div',
            { class: 'jd-hub-row', tid: `hub-${c.key}` },
            h('div', {}, h('div', {}, categoryName(c.key)), h('div', { class: 'jd-dim' }, `${categoryLead(c.key)} ${count(c.posts)}`)),
            btn(t('inbox.threadOpen'), `hub-open-${c.key}`, () => openThread(scene, verifierUrl, categoryKey(c.key)), { small: true }),
            ...(hub.open ? [btn(t('hub.startTopic'), `hub-start-${c.key}`, () => newTopic(c.key), { small: true })] : []),
          ),
          ...c.topics.map((topic) =>
            h(
              'div',
              { class: 'jd-hub-row jd-hub-topic', tid: `hub-topic-${topic.key.slice('topic:'.length)}` },
              h('div', {}, `${topic.pinned ? '📌 ' : ''}${topic.title}`, h('span', { class: 'jd-dim' }, ` ${count(topic.posts)}`)),
              btn(t('inbox.threadOpen'), `hub-read-${topic.key.slice('topic:'.length)}`, () => openThread(scene, verifierUrl, topic.key), { small: true }),
            ),
          ),
        ]),
        ...(hub.days.length ? [h('div', { class: 'jd-dim', style: 'margin-top:0.5em' }, sal('sal.hub.days'))] : []),
        ...hub.days.map((d) =>
          h(
            'div',
            { class: 'jd-hub-row', tid: `hub-day-${d.key}` },
            h('div', {}, `${periodLabel(d.key)}`, h('span', { class: 'jd-dim' }, ` ${count(d.posts)}`)),
            btn(t('inbox.threadOpen'), `hub-day-open-${d.key}`, () => openThread(scene, verifierUrl, d.key), { small: true }),
          ),
        ),
      );
    });
  }
  refresh();
}
