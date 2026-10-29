/**
 * Authored art pipeline (DOSSIER-v1 §2.3, 0.4.8). The art lives as SVG files under game/public/art (first exported from
 * the procedural generator by tools/export-svg.ts, editable in any vector tool from here). At boot every SVG is loaded,
 * packed into ONE canvas texture ('art'), and each texture key the scenes use (m-crusher, i-plate, belt-0, tile…) is
 * registered as an alias whose single frame points into that shared source, so no scene code changes and the whole
 * factory draws from one texture (fewer binds). Anything that fails to load is generated procedurally as before
 * (textures.ts skips keys that already exist), so a broken or missing file degrades to yesterday's look, never to a
 * blank. The atlas is rendered at ART_SCALE = min(DPR, 2) times the logical size (0.4.8b): the SVGs are rasterised at
 * that size and every packed frame is cut that large, so the WebGL batch samples sharp pixels on HiDPI screens; the
 * scenes keep their logical geometry by applying `baseScale(key)` (1 / ART_SCALE for packed keys, 1 for a procedural
 * fallback, which stays at 1x) through `fit()` / `setArt()` wherever an image is created, re-textured or scaled.
 */
import Phaser from 'phaser';
import { BELT_FRAMES, CELL } from './textures';
import { devEnabled } from './devapi';
import { DPR } from './dpr';

export const ART_TEXTURE = 'art';
/** Atlas pixels per logical pixel: the device pixel ratio, capped with it at 2. */
export const ART_SCALE = DPR;
const ITEM = 24;
export const ART: readonly { key: string; size: number }[] = [
  ...['tile', 'tile-ok', 'tile-bad', 'tile-sel', 'tile-cursor'].map((key) => ({ key, size: CELL })),
  ...['m-conveyor', 'm-hopper', 'm-crusher', 'm-crusher-1', 'm-furnace', 'm-press', 'm-press-1', 'm-press-2', 'm-splitter', 'm-dock', 'm-tuner'].map((key) => ({ key, size: CELL })),
  ...Array.from({ length: BELT_FRAMES }, (_, f) => ({ key: `belt-${f}`, size: CELL })),
  ...['i-scrap', 'i-shards', 'i-plate', 'i-ingot', 'i-slag'].map((key) => ({ key, size: ITEM })),
];
const PAD = 2;
const COLS = 6;

export interface ArtStatus { built: boolean; packed: string[]; missing: string[]; atlas: { width: number; height: number } | null; scale: number }
export const artStatus: ArtStatus = { built: false, packed: [], missing: [], atlas: null, scale: 1 };
const packedSet = new Set<string>();

/** Scale that draws a texture at its logical size: 1 / ART_SCALE for a packed frame, 1 for a procedural texture. */
export function baseScale(key: string): number { return packedSet.has(key) ? 1 / artStatus.scale : 1; }
/** Scale an image so its frame shows at logical size times `f`. */
export function fit<T extends Phaser.GameObjects.Image>(img: T, f = 1): T { img.setScale(baseScale(img.texture.key) * f); return img; }
/** Swap an image's texture and keep its logical size (times `f`). */
export function setArt<T extends Phaser.GameObjects.Image>(img: T, key: string, f = 1): T { img.setTexture(key); return fit(img, f); }

/** Queue every SVG in the Boot scene's preload. Load failures are recorded, not fatal. */
export function queueArt(scene: Phaser.Scene) {
  scene.load.on(Phaser.Loader.Events.FILE_LOAD_ERROR, (file: Phaser.Loader.File) => { const key = String(file.key).replace(/^art:/, ''); if (!artStatus.missing.includes(key)) artStatus.missing.push(key); });
  for (const a of ART) scene.load.svg(`art:${a.key}`, `art/${a.key}.svg`, { width: a.size * ART_SCALE, height: a.size * ART_SCALE });
}

/** Pack the loaded SVGs into one texture and alias every key onto it. Keys that did not load are left for the procedural generator. */
export function buildArtAtlas(scene: Phaser.Scene): ArtStatus {
  const tm = scene.textures;
  const loaded = ART.filter((a) => tm.exists(`art:${a.key}`));
  artStatus.missing = ART.filter((a) => !tm.exists(`art:${a.key}`)).map((a) => a.key);
  if (!loaded.length) { artStatus.built = false; publish(); return artStatus; }
  const k = ART_SCALE;
  const pitch = (CELL + PAD * 2) * k;
  const rows = Math.ceil(loaded.length / COLS);
  const canvas = document.createElement('canvas');
  canvas.width = COLS * pitch; canvas.height = rows * pitch;
  const ctx = canvas.getContext('2d');
  if (!ctx) { artStatus.built = false; artStatus.missing = ART.map((a) => a.key); publish(); return artStatus; }
  const placed: { key: string; x: number; y: number; size: number }[] = [];
  loaded.forEach((a, i) => {
    const x = (i % COLS) * pitch + PAD * k, y = Math.floor(i / COLS) * pitch + PAD * k;
    const src = tm.get(`art:${a.key}`).getSourceImage() as CanvasImageSource;
    ctx.drawImage(src, x, y, a.size * k, a.size * k);
    placed.push({ key: a.key, x, y, size: a.size * k });
  });
  if (tm.exists(ART_TEXTURE)) tm.remove(ART_TEXTURE);
  const atlas = tm.addCanvas(ART_TEXTURE, canvas);
  if (!atlas) { artStatus.built = false; artStatus.missing = ART.map((a) => a.key); publish(); return artStatus; }
  for (const p of placed) {
    atlas.add(p.key, 0, p.x, p.y, p.size, p.size);
    // alias: a Texture object under the scene-facing key whose only frame lives in the shared atlas source
    if (tm.exists(p.key)) tm.remove(p.key);
    const alias = new Phaser.Textures.Texture(tm, p.key, [] as unknown as HTMLImageElement[], 0, 0);
    alias.source = atlas.source;
    alias.add('__BASE', 0, p.x, p.y, p.size, p.size);
    (tm.list as Record<string, Phaser.Textures.Texture>)[p.key] = alias;
    tm.remove(`art:${p.key}`);
  }
  artStatus.built = true; artStatus.packed = placed.map((p) => p.key); artStatus.atlas = { width: canvas.width, height: canvas.height }; artStatus.scale = k;
  packedSet.clear(); for (const p of placed) packedSet.add(p.key);
  publish();
  return artStatus;
}

function publish() { if (devEnabled()) (window as unknown as { __jdArt?: ArtStatus }).__jdArt = artStatus; }

/** Frame-aware access to a texture's pixels for 2D-canvas consumers (clip export, audit sheet): the source image and the cut rectangle. */
export function artFrame(game: Phaser.Game, key: string): { image: CanvasImageSource; x: number; y: number; w: number; h: number } | null {
  try {
    const f = game.textures.getFrame(key);
    if (!f) return null;
    return { image: f.source.image as CanvasImageSource, x: f.cutX, y: f.cutY, w: f.cutWidth, h: f.cutHeight };
  } catch { return null; }
}
