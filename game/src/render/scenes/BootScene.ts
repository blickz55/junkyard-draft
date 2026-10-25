import Phaser from 'phaser';
import { generateTextures } from '../textures';

export class BootScene extends Phaser.Scene {
  constructor() { super('Boot'); }
  create() {
    generateTextures(this);
    const params = new URLSearchParams(location.search);
    if (params.get('scene') === 'game') this.scene.start('Game', { seed: params.get('seed') || 'dev', fresh: true });
    else this.scene.start('Title');
  }
}
