import Phaser from 'phaser';
import { BootScene } from './render/scenes/BootScene';
import { TitleScene } from './render/scenes/TitleScene';
import { GameScene } from './render/scenes/GameScene';
import { ResultsScene } from './render/scenes/ResultsScene';
import { viewport, containerSize } from './render/viewport';
import { P } from './render/palette';
import { devEnabled } from './render/devapi';
import { DPR } from './render/dpr';
import { telemetry } from './render/telemetry';
import { verifierUrl as resolveVerifierUrl } from './render/config';
import { installErrorLog } from './render/errlog';
import { onStorageFailure } from './render/storage';
import { showBanner } from './ui/banner';
import { pwa } from './render/pwa';

// production roadmap 0.8.0: keep the last ten uncaught errors on the device for the title's "Copy diagnostics" button,
// and say so the moment storage refuses a write instead of losing saves, bests and the name silently
installErrorLog();
onStorageFailure(() =>
  showBanner('storage', 'This browser is not saving your progress. Runs still play, but saves, bests and your name will be gone after a reload.'),
);

declare global {
  interface ImportMeta {
    env: { DEV: boolean; BUILD: string; VERIFIER_URL: string };
  }
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
// production roadmap 0.10.0: the canvas sizes to its container. Scale.NONE with zoom 1 / DPR keeps the backing store at
// DPR × the CSS size; render/viewport.ts resizes the game when the container changes and the scenes fit their cameras.
const container = document.getElementById('game') ?? document.body;
const initial = containerSize(container);
const game = new Phaser.Game({
  type: rendererParam === 'canvas' ? Phaser.CANVAS : Phaser.AUTO,
  parent: 'game',
  width: Math.round(initial.w * DPR),
  height: Math.round(initial.h * DPR),
  backgroundColor: P.bg,
  scale: { mode: Phaser.Scale.NONE, zoom: 1 / DPR, autoCenter: Phaser.Scale.NO_CENTER },
  render: { antialias: true, pixelArt: false, roundPixels: false },
  fps: { target: 60, forceSetTimeOut: false },
  scene: [BootScene, TitleScene, GameScene, ResultsScene],
  input: { mouse: { preventDefaultWheel: false } },
});
viewport.attach(game, container);
pwa.register(import.meta.env.DEV); // 0.10.3: the service worker in production (the dev server serves none), the install prompt's capture

// opt-in funnel events go to the same verifier the boards use; nothing is sent unless the player turned it on
telemetry.configure({ url: () => resolveVerifierUrl() });
telemetry.init();

// Expose for dev tooling only (scene key lookups), behind the same gate as window.__jd; competitive authority never lives here.
if (devEnabled()) (window as unknown as { __jdGame?: Phaser.Game }).__jdGame = game;
