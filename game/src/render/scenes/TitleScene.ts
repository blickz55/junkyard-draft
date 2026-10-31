import Phaser from 'phaser';
import { fitScreen } from '../viewport';
import { TipsPanel } from '../../ui/TipsPanel';
import { mountTitle } from '../../ui/TitleScreen';
import { ui } from '../../ui/dom';

/** Home: the canvas only hosts the tips panel; the screen itself is DOM (ui/TitleScreen.ts). */
export class TitleScene extends Phaser.Scene {
  private tips!: TipsPanel;
  constructor() {
    super('Title');
  }

  create() {
    fitScreen(this);
    // the tips panel is Phaser (it animates real textures); the DOM screen hides while it is open
    this.tips = new TipsPanel(this);
    this.input.keyboard?.on('keydown-ESC', () => this.tips.close());
    mountTitle(this, this.tips);
    this.events.once('shutdown', () => {
      this.tips.close();
      ui.unmount();
    });
  }
}
