import Phaser from 'phaser';
import { generateTextures } from '../textures';
import { sanitizeSeed } from '../../sim/run';

export class BootScene extends Phaser.Scene {
  constructor() { super('Boot'); }
  create() {
    generateTextures(this);
    const params = new URLSearchParams(location.search);
    if (params.get('scene') === 'game') this.scene.start('Game', { seed: sanitizeSeed(params.get('seed'), 'dev'), fresh: true });
    else this.scene.start('Title');
  }
}
