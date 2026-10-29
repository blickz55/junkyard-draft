import Phaser from 'phaser';
import { applyDpr } from '../dpr';
import { TipsPanel } from '../TipsPanel';
import { P } from '../palette';
import { W, H } from '../layout';
import { prefs } from '../prefs';
import { mountTitle } from '../../ui/TitleScreen';
import { ui } from '../../ui/dom';

/** Title: the canvas draws the decorative belt and hosts the tips panel; the screen itself is DOM (ui/TitleScreen.ts). */
export class TitleScene extends Phaser.Scene {
  private tips!: TipsPanel;
  constructor() { super('Title'); }

  create() {
    this.cameras.main.setBackgroundColor(P.bg);
    applyDpr(this);
    // decorative belt
    for (let i = 0; i < 16; i++) this.add.image(i * 72 + 36, H - 36, 'm-conveyor').setAlpha(0.25);
    const scrapBelt = this.add.group();
    for (let i = 0; i < 6; i++) scrapBelt.add(this.add.image(-40 + i * 200, H - 36, ['i-scrap', 'i-shards', 'i-ingot'][i % 3]).setScale(1.4).setAlpha(0.6));
    if (!prefs.reducedMotion) this.time.addEvent({ delay: 16, loop: true, callback: () => scrapBelt.getChildren().forEach((c) => { const img = c as Phaser.GameObjects.Image; img.x += 1.2; if (img.x > W + 40) img.x = -40; }) });
    // the tips panel is Phaser (it animates real textures); the DOM screen hides while it is open
    this.tips = new TipsPanel(this, () => ui.setHidden(false));
    this.input.keyboard?.on('keydown-ESC', () => this.tips.close());
    mountTitle(this, this.tips);
    this.events.once('shutdown', () => { this.tips.close(); ui.unmount(); });
  }
}
