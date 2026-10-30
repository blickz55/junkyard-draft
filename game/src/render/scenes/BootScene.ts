import { verifierUrl as resolveVerifierUrl } from '../config';
import Phaser from 'phaser';
import { generateTextures } from '../textures';
import { queueArt, buildArtAtlas } from '../atlas';
import { fetchChallenge } from '../challenge';
import { sanitizeSeed } from '../../sim/run';
import { audio } from '../audio';
import { IMPACTS, IMPACT_FILES } from '../samples';

/** Boot: load the authored SVG art, pack it into one atlas, generate anything missing procedurally, then start. */
export class BootScene extends Phaser.Scene {
  constructor() {
    super('Boot');
  }
  preload() {
    queueArt(this);
    for (const k of IMPACTS) this.load.binary(`sfx:${k}`, IMPACT_FILES[k]);
  }
  create() {
    buildArtAtlas(this);
    for (const k of IMPACTS) audio.samples.provide(k, this.cache.binary.has(`sfx:${k}`) ? (this.cache.binary.get(`sfx:${k}`) as ArrayBuffer) : null);
    generateTextures(this); // fills any key the atlas could not provide (and the tiny UI dots)
    const params = new URLSearchParams(location.search);
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
