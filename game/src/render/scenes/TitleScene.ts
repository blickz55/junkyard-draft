import Phaser from 'phaser';
import { fitScreen, viewport } from '../viewport';
import { fit } from '../atlas';
import { TipsPanel } from '../../ui/TipsPanel';
import { P } from '../palette';
import { CELL } from '../textures';
import { prefs } from '../prefs';
import { mountTitle } from '../../ui/TitleScreen';
import { ui } from '../../ui/dom';

/** Title: the canvas draws the decorative belt and hosts the tips panel; the screen itself is DOM (ui/TitleScreen.ts). */
export class TitleScene extends Phaser.Scene {
  private tips!: TipsPanel;
  private beltTiles: Phaser.GameObjects.Image[] = [];
  constructor() {
    super('Title');
  }

  create() {
    this.cameras.main.setBackgroundColor(P.bg);
    fitScreen(this);
    // decorative belt along the bottom edge, as wide as the container (0.10.0: the canvas has no fixed width)
    this.beltTiles = [];
    const scrapBelt = this.add.group();
    for (let i = 0; i < 6; i++) scrapBelt.add(fit(this.add.image(-40 + i * 200, 0, ['i-scrap', 'i-shards', 'i-ingot'][i % 3]), 1.4).setAlpha(0.6));
    const layoutBelt = () => {
      const y = viewport.height - 36;
      const n = viewport.height >= 520 ? Math.ceil(viewport.width / CELL) + 1 : 0; // a short landscape screen has no room to spare for decoration
      while (this.beltTiles.length < n)
        this.beltTiles.push(
          fit(this.add.image(0, 0, 'm-conveyor'))
            .setAlpha(0.25)
            .setDepth(-1),
        );
      this.beltTiles.forEach((img, i) => img.setPosition(i * CELL + CELL / 2, y).setVisible(i < n));
      scrapBelt.getChildren().forEach((c) => (c as Phaser.GameObjects.Image).setY(y).setVisible(n > 0));
    };
    layoutBelt();
    const off = viewport.on(layoutBelt);
    if (!prefs.reducedMotion)
      this.time.addEvent({
        delay: 16,
        loop: true,
        callback: () =>
          scrapBelt.getChildren().forEach((c) => {
            const img = c as Phaser.GameObjects.Image;
            img.x += 1.2;
            if (img.x > viewport.width + 40) img.x = -40;
          }),
      });
    // the tips panel is Phaser (it animates real textures); the DOM screen hides while it is open
    this.tips = new TipsPanel(this);
    this.input.keyboard?.on('keydown-ESC', () => this.tips.close());
    mountTitle(this, this.tips);
    this.events.once('shutdown', () => {
      off();
      this.tips.close();
      ui.unmount();
    });
  }
}
