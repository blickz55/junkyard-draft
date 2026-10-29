import Phaser from 'phaser';
import { BootScene } from './render/scenes/BootScene';
import { TitleScene } from './render/scenes/TitleScene';
import { GameScene } from './render/scenes/GameScene';
import { ResultsScene } from './render/scenes/ResultsScene';
import { W, H } from './render/layout';
import { P } from './render/palette';
import { devEnabled } from './render/devapi';

declare global {
  interface ImportMeta { env: { DEV: boolean; BUILD: string; VERIFIER_URL: string } }
}

// ?renderer=canvas forces the Canvas renderer (perf presets, weak GPUs); anything else keeps AUTO (WebGL when available).
const rendererParam = new URLSearchParams(location.search).get('renderer');
const game = new Phaser.Game({
  type: rendererParam === 'canvas' ? Phaser.CANVAS : Phaser.AUTO,
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

// Expose for dev tooling only (scene key lookups), behind the same gate as window.__jd; competitive authority never lives here.
if (devEnabled()) (window as unknown as { __jdGame?: Phaser.Game }).__jdGame = game;
