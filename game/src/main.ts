import Phaser from 'phaser';
import { BootScene } from './render/scenes/BootScene';
import { TitleScene } from './render/scenes/TitleScene';
import { GameScene } from './render/scenes/GameScene';
import { ResultsScene } from './render/scenes/ResultsScene';
import { W, H } from './render/layout';
import { P } from './render/palette';

declare global {
  interface ImportMeta { env: { DEV: boolean; BUILD: string } }
}

const game = new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'game',
  width: W,
  height: H,
  backgroundColor: P.bg,
  scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
  render: { antialias: true, pixelArt: false, roundPixels: false },
  fps: { target: 60, forceSetTimeOut: false },
  scene: [BootScene, TitleScene, GameScene, ResultsScene],
  input: { mouse: { preventDefaultWheel: false } },
});

// Expose for dev tooling only (scene key lookups); competitive authority never lives here.
(window as unknown as { __jdGame?: Phaser.Game }).__jdGame = game;
