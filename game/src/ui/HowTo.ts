/**
 * How to play, in five lines (docs/UX-STANDARD.md): the same words from the home screen and from the menu in a game, with a
 * way into the machine demos.
 */
import type Phaser from 'phaser';
import { h } from './dom';
import { choiceDialog } from './choice';
import type { TipsPanel } from './TipsPanel';
import { t } from '../content/strings';

export function openHowTo(scene: Phaser.Scene, tips: TipsPanel, onClose: () => void = () => {}) {
  const lines = [t('title.howto1'), t('title.howto2'), t('title.howto3'), t('title.howto4'), t('title.howto5')];
  choiceDialog(scene, {
    title: t('title.howto'),
    tid: 'howto-dialog',
    lead: [h('ol', { class: 'jd-howto' }, ...lines.map((line, i) => h('li', { tid: `howto-${i + 1}` }, line)))],
    choices: [
      { label: t('inspect.close'), tid: 'howto-close', primary: true, run: onClose },
      {
        label: t('title.tips'),
        tid: 'howto-tips',
        run: () => {
          tips.open();
          onClose();
        },
      },
    ],
    onDismiss: onClose,
  });
}
