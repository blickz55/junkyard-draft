/**
 * The way into anything drawn from the sprite sheet. On a slow line Home is up before the sheet has arrived: a tap then shows
 * one line until it has, and goes on by itself.
 */
import type Phaser from 'phaser';
import { artIsReady, whenArt } from '../render/atlas';
import { t } from '../content/strings';
import { h, ui } from './dom';

export function withArt(scene: Phaser.Scene, fn: () => void) {
  if (artIsReady()) return fn();
  const note = h('div', { class: 'jd-modal jd-opening', tid: 'opening', role: 'status' }, t('home.opening'));
  ui.layer(scene, note);
  whenArt(() => {
    note.remove();
    fn();
  });
}
