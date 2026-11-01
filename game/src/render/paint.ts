/**
 * Paint (0.11.12). Every sprite key is an alias onto the shared atlas, so a coat of paint swaps the aliases of the machine frames, or the
 * yard's, for recoloured copies drawn on a canvas. That reads the same on both renderers, where Phaser's tint does nothing on Canvas, and
 * nothing else in the game has to know: the board, the shelf, the offers and the GIF all ask for the same keys. Materials are never painted,
 * and paint keeps each pixel's lightness, so a machine keeps its shape and a material its colour. Nothing in game/src/sim reads any of this.
 */
import Phaser from 'phaser';
import { cosmeticById, type Look } from '../content/cosmetics';
import { FRAMES } from './sheet';

const MACHINE_KEYS = Object.keys(FRAMES).filter((k) => k.startsWith('m-'));
const YARD_KEYS = ['ground', 'shelf'];
/** How much of the coat a pixel takes: enough to read, not enough to hide what is drawn. */
const STRENGTH = { skin: 0.55, yard: 0.4 };

type Tm = Phaser.Textures.TextureManager;
const plain = new Map<string, Phaser.Textures.Texture>();
const painted = new Map<string, Phaser.Textures.Texture>();
const worn: Pick<Look, 'yard' | 'skin'> = { yard: null, skin: null };

function coat(tm: Tm, key: string, colour: string, strength: number): Phaser.Textures.Texture | null {
  const frame = plain.get(key)!.get();
  const canvas = document.createElement('canvas');
  canvas.width = frame.cutWidth;
  canvas.height = frame.cutHeight;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  const sprite = () =>
    ctx.drawImage(frame.source.image as CanvasImageSource, frame.cutX, frame.cutY, frame.cutWidth, frame.cutHeight, 0, 0, frame.cutWidth, frame.cutHeight);
  sprite();
  ctx.globalCompositeOperation = 'color'; // the coat's hue on each pixel's own lightness
  ctx.globalAlpha = strength;
  ctx.fillStyle = colour;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.globalCompositeOperation = 'destination-in'; // and back to the sprite's own outline
  ctx.globalAlpha = 1;
  sprite();
  const source = tm.addCanvas(`${key}@${colour}`, canvas);
  if (!source) return null;
  // an alias under the same key, as the atlas makes them, so a size or a key read from a sprite stays what the rest of the game expects
  const alias = new Phaser.Textures.Texture(tm, key, [] as unknown as HTMLImageElement[], 0, 0);
  alias.source = source.source;
  alias.add('__BASE', 0, 0, 0, canvas.width, canvas.height);
  return alias;
}

function wear(tm: Tm, keys: readonly string[], id: string | null, strength: number) {
  const colour = id ? cosmeticById(id)?.colour : undefined;
  const list = tm.list as Record<string, Phaser.Textures.Texture>;
  for (const key of keys) {
    if (!tm.exists(key)) continue;
    if (!plain.has(key)) plain.set(key, tm.get(key));
    const name = `${key}@${colour}`;
    if (colour && !painted.has(name)) {
      const made = coat(tm, key, colour, strength);
      if (made) painted.set(name, made);
    }
    list[key] = (colour && painted.get(name)) || plain.get(key)!;
  }
}

/** Dress the textures for a scene about to start. A look with nothing on it puts the plain frames back. */
export function applyPaint(game: Phaser.Game, look: Pick<Look, 'yard' | 'skin'>): void {
  if (look.skin !== worn.skin) wear(game.textures, MACHINE_KEYS, look.skin, STRENGTH.skin);
  if (look.yard !== worn.yard) wear(game.textures, YARD_KEYS, look.yard, STRENGTH.yard);
  worn.skin = look.skin;
  worn.yard = look.yard;
}
