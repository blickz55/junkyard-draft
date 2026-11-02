/**
 * Tints drawn once on a canvas (Goal 12: the game runs on the Canvas renderer only, where Phaser's tint does nothing, and dropping
 * WebGL took about 35 KiB off a first visit). Multiply, as a WebGL tint does, kept to the sprite's own outline, cached under the
 * texture's key and the colour, and sized like the frame it came from, so `fit` scales it the same way.
 */
import type Phaser from 'phaser';
import { isPacked, markPacked } from './atlas';

/** The key of `key` tinted `colour`; the key itself when white or when there is nothing to draw from. */
export function tinted(scene: Phaser.Scene, key: string, colour: number): string {
  if (colour === 0xffffff) return key;
  const hex = colour.toString(16).padStart(6, '0');
  const name = `${key}#${hex}`;
  const tm = scene.textures;
  if (tm.exists(name)) return name;
  if (!tm.exists(key)) return key;
  const frame = tm.getFrame(key);
  const image = frame?.source?.image as CanvasImageSource | undefined;
  if (!frame || !image) return key;
  const canvas = document.createElement('canvas');
  canvas.width = frame.cutWidth;
  canvas.height = frame.cutHeight;
  const ctx = canvas.getContext('2d');
  if (!ctx) return key;
  const draw = () => ctx.drawImage(image, frame.cutX, frame.cutY, frame.cutWidth, frame.cutHeight, 0, 0, frame.cutWidth, frame.cutHeight);
  draw();
  ctx.globalCompositeOperation = 'multiply';
  ctx.fillStyle = `#${hex}`;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.globalCompositeOperation = 'destination-in'; // back to the sprite's own outline
  draw();
  if (!tm.addCanvas(name, canvas)) return key;
  if (isPacked(key)) markPacked(name);
  return name;
}
