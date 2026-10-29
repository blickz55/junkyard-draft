import Phaser from 'phaser';
import { BootScene } from './render/scenes/BootScene';
import { TitleScene } from './render/scenes/TitleScene';
import { GameScene } from './render/scenes/GameScene';
import { ResultsScene } from './render/scenes/ResultsScene';
import { W, H } from './render/layout';
import { P } from './render/palette';
import { devEnabled } from './render/devapi';
import { DPR } from './render/dpr';
import { telemetry } from './render/telemetry';

declare global {
  interface ImportMeta { env: { DEV: boolean; BUILD: string; VERIFIER_URL: string } }
}

// ?renderer=canvas forces the Canvas renderer (perf presets, weak GPUs); anything else keeps AUTO (WebGL when available).
const rendererParam = new URLSearchParams(location.search).get('renderer');
// HiDPI: the canvas is DPR times the logical size and every scene's camera zooms the logical space onto it (render/dpr.ts).
// Text objects rasterise their own canvas, so they need the same resolution or they would be upscaled and blurry:
// inject it once here instead of at every add.text call site.
if (DPR !== 1) {
  const proto = Phaser.GameObjects.TextStyle.prototype as unknown as { setStyle: (style: unknown, updateText?: boolean, setDefaults?: boolean) => unknown };
  const orig = proto.setStyle;
  proto.setStyle = function (style, updateText, setDefaults) {
    const s = style && typeof style === 'object' && (style as { resolution?: number }).resolution == null ? { ...(style as object), resolution: DPR } : style;
    return orig.call(this, s, updateText, setDefaults);
  };
}
const game = new Phaser.Game({
  type: rendererParam === 'canvas' ? Phaser.CANVAS : Phaser.AUTO,
  parent: 'game',
  width: W * DPR,
  height: H * DPR,
  backgroundColor: P.bg,
  scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
  render: { antialias: true, pixelArt: false, roundPixels: false },
  fps: { target: 60, forceSetTimeOut: false },
  scene: [BootScene, TitleScene, GameScene, ResultsScene],
  input: { mouse: { preventDefaultWheel: false } },
});

// opt-in funnel events go to the same verifier the boards use; nothing is sent unless the player turned it on
telemetry.configure({ url: () => new URLSearchParams(location.search).get('verifier') || import.meta.env.VERIFIER_URL });
telemetry.init();

// Expose for dev tooling only (scene key lookups), behind the same gate as window.__jd; competitive authority never lives here.
if (devEnabled()) (window as unknown as { __jdGame?: Phaser.Game }).__jdGame = game;
