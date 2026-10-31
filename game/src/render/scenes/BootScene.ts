import { verifierUrl as resolveVerifierUrl } from '../config';
import Phaser from 'phaser';
import { generateTextures } from '../textures';
import { queueArt, buildArtAtlas, markArtReady } from '../atlas';
import { fetchChallenge } from '../challenge';
import { sanitizeSeed } from '../../sim/run';

/**
 * Boot: load the sprite sheet, cut it into the shared atlas, generate anything missing procedurally, then start. Home needs no
 * art and goes up at once beside this scene, so a slow line sees something to tap while the sheet arrives (the way into a game
 * waits for it, ui/opening.ts); a link straight into a game waits here.
 */
export class BootScene extends Phaser.Scene {
  private readonly params = new URLSearchParams(location.search);
  constructor() {
    super('Boot');
  }
  private get homeFirst(): boolean {
    return !this.params.get('challenge') && this.params.get('scene') !== 'game';
  }
  preload() {
    if (this.homeFirst) this.scene.launch('Title');
    queueArt(this);
  }
  create() {
    buildArtAtlas(this);
    generateTextures(this); // fills any key the atlas could not provide (and the tiny UI dots)
    markArtReady();
    if (this.homeFirst) {
      this.scene.stop();
      return;
    }
    const params = this.params;
    const challenge = params.get('challenge');
    if (challenge && /^[0-9a-f]{8,64}$/i.test(challenge)) {
      // PLAN-v4 0.7.1: a challenge link plays the challenger's seed with their earnings overlaid; unknown or offline → title
      const verifier = resolveVerifierUrl();
      void fetchChallenge(verifier, challenge.toLowerCase()).then((c) => {
        if (c) this.scene.start('Game', { seed: c.seed, fresh: true, challenge: c });
        else this.scene.start('Title');
      });
      return;
    }
    if (params.get('scene') === 'game') this.scene.start('Game', { seed: sanitizeSeed(params.get('seed'), 'dev'), fresh: true });
    else this.scene.start('Title');
  }
}
