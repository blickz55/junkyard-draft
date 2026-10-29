import Phaser from 'phaser';
import { generateTextures } from '../textures';
import { queueArt, buildArtAtlas } from '../atlas';
import { sanitizeSeed } from '../../sim/run';

/** Boot: load the authored SVG art, pack it into one atlas, generate anything missing procedurally, then start. */
export class BootScene extends Phaser.Scene {
  constructor() { super('Boot'); }
  preload() { queueArt(this); }
  create() {
    buildArtAtlas(this);
    generateTextures(this); // fills any key the atlas could not provide (and the tiny UI dots)
    const params = new URLSearchParams(location.search);
    if (params.get('scene') === 'game') this.scene.start('Game', { seed: sanitizeSeed(params.get('seed'), 'dev'), fresh: true });
    else this.scene.start('Title');
  }
}
