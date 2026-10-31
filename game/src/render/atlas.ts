/**
 * The art (docs/ART.md, DOSSIER-v1 §2.3). tools/make-art.mjs renders every frame into one sprite sheet at 144 px a cell,
 * game/public/art/sheet.webp, and writes where each frame sits to render/sheet.ts. The sheet loads once behind Home (one request
 * where there used to be 34; Home is DOM and comes up without it, see whenArt) and each texture key the scenes use (m-crusher, i-plate, belt-0, tile…) is registered as an alias
 * whose single frame points into that shared source, so no scene code changes and the whole factory draws from one texture.
 * If the sheet does not load, every key is generated procedurally as before (textures.ts skips keys that already exist): a
 * broken file degrades to yesterday's look, never to a blank. The atlas holds ART_SCALE = min(DPR, 2) atlas pixels per logical
 * pixel: at 2 the sheet is the atlas, on a lower ratio a scaled copy is (see makeAtlas). The scenes keep their logical geometry by applying `baseScale(key)` (1 / ART_SCALE for packed keys, 1 for a procedural fallback,
 * which stays at 1x) through `fit()` / `setArt()` wherever an image is created, re-textured or scaled.
 */
import Phaser from 'phaser';
import { devEnabled } from './devapi';
import { DPR } from './dpr';
import { FRAMES, SHEET_H, SHEET_SCALE, SHEET_W } from './sheet';

export const ART_TEXTURE = 'art';
const SHEET_KEY = 'art:sheet';
/** Atlas pixels per logical pixel: the device pixel ratio, capped with it at 2. */
export const ART_SCALE = DPR;

export interface ArtStatus {
  built: boolean;
  packed: string[];
  missing: string[];
  atlas: { width: number; height: number } | null;
  scale: number;
}
export const artStatus: ArtStatus = { built: false, packed: [], missing: [], atlas: null, scale: 1 };
const packedSet = new Set<string>();

/** Scale that draws a texture at its logical size: 1 / ART_SCALE for a packed frame, 1 for a procedural texture. */
export function baseScale(key: string): number {
  return packedSet.has(key) ? 1 / artStatus.scale : 1;
}
/** Scale an image so its frame shows at logical size times `f`. */
export function fit<T extends Phaser.GameObjects.Image>(img: T, f = 1): T {
  img.setScale(baseScale(img.texture.key) * f);
  return img;
}
/** Swap an image's texture and keep its logical size (times `f`). */
export function setArt<T extends Phaser.GameObjects.Image>(img: T, key: string, f = 1): T {
  img.setTexture(key);
  return fit(img, f);
}

let artIn = false;
const waiting: (() => void)[] = [];
export const artIsReady = () => artIn;
/** Runs `fn` once the textures exist: at once on any later call, after the sheet on the first screen of a slow line. */
export function whenArt(fn: () => void) {
  if (artIn) fn();
  else waiting.push(fn);
}
/** Boot calls this when every texture key exists, from the sheet or from the procedural generator. */
export function markArtReady() {
  artIn = true;
  for (const fn of waiting.splice(0)) fn();
}

/**
 * Queue the sheet in the Boot scene's preload; a failed load only means the procedural look. It loads as an image element. The desktop app keeps the blob route: a file:// image would taint the canvases.
 */
export function queueArt(scene: Phaser.Scene) {
  if (location.protocol !== 'file:') scene.load.imageLoadType = 'HTMLImageElement';
  scene.load.image(SHEET_KEY, 'art/sheet.webp');
}

/** Turn the loaded sheet into the shared atlas and alias every key onto it. Without a sheet every key is left to the procedural generator. */
export function buildArtAtlas(scene: Phaser.Scene): ArtStatus {
  void document.fonts?.load('700 12px Inter').catch(() => {}); // the canvas labels draw once: have the face ready, after the sheet so it never competes with it
  const tm = scene.textures;
  const keys = Object.keys(FRAMES);
  const k = ART_SCALE / SHEET_SCALE;
  const atlas = tm.exists(SHEET_KEY) ? makeAtlas(tm, k, scene.game.renderer.type === Phaser.WEBGL) : null;
  if (!atlas) {
    artStatus.built = false;
    artStatus.missing = keys;
    publish();
    return artStatus;
  }
  const placed = keys.map((key) => {
    const [x, y, w, h] = FRAMES[key];
    return { key, x: Math.round(x * k), y: Math.round(y * k), w: Math.round(w * k), h: Math.round(h * k) };
  });
  for (const p of placed) {
    atlas.add(p.key, 0, p.x, p.y, p.w, p.h);
    // alias: a Texture object under the scene-facing key whose only frame lives in the shared atlas source
    if (tm.exists(p.key)) tm.remove(p.key);
    const alias = new Phaser.Textures.Texture(tm, p.key, [] as unknown as HTMLImageElement[], 0, 0);
    alias.source = atlas.source;
    alias.add('__BASE', 0, p.x, p.y, p.w, p.h);
    (tm.list as Record<string, Phaser.Textures.Texture>)[p.key] = alias;
  }
  artStatus.built = true;
  artStatus.packed = keys;
  artStatus.missing = [];
  artStatus.atlas = { width: Math.round(SHEET_W * k), height: Math.round(SHEET_H * k) };
  artStatus.scale = ART_SCALE;
  packedSet.clear();
  for (const key of keys) packedSet.add(key);
  publish();
  return artStatus;
}

/**
 * At full size under WebGL the sheet is the atlas. Elsewhere a canvas is: scaled on a lower pixel ratio, so a frame stays a 1:1 blit, and at full size on the Canvas
 * renderer too, which draws from a canvas faster than from a decoded image (preset D's p95: 50 ms from the image, 33 from a canvas).
 */
function makeAtlas(tm: Phaser.Textures.TextureManager, k: number, webgl: boolean): Phaser.Textures.Texture | null {
  if (tm.exists(ART_TEXTURE)) tm.remove(ART_TEXTURE);
  if (k === 1 && webgl) return tm.renameTexture(SHEET_KEY, ART_TEXTURE) ? tm.get(ART_TEXTURE) : null;
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(SHEET_W * k);
  canvas.height = Math.round(SHEET_H * k);
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(tm.get(SHEET_KEY).getSourceImage() as CanvasImageSource, 0, 0, canvas.width, canvas.height);
  tm.remove(SHEET_KEY);
  return tm.addCanvas(ART_TEXTURE, canvas);
}

function publish() {
  if (devEnabled()) (window as unknown as { __jdArt?: ArtStatus }).__jdArt = artStatus;
}

/** Frame-aware access to a texture's pixels for 2D-canvas consumers (clip export, audit sheet): the source image and the cut rectangle. */
export function artFrame(game: Phaser.Game, key: string): { image: CanvasImageSource; x: number; y: number; w: number; h: number } | null {
  try {
    const f = game.textures.getFrame(key);
    if (!f) return null;
    return { image: f.source.image as CanvasImageSource, x: f.cutX, y: f.cutY, w: f.cutWidth, h: f.cutHeight };
  } catch {
    return null;
  }
}
