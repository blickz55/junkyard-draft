/**
 * Replay the procedural texture drawings in game/src/render/textures.ts into SVG files (DOSSIER-v1 §2.3, 0.4.8).
 * The generator draws through Phaser's Graphics API; this gives it a recorder with the same method surface that
 * emits SVG shapes instead, so the first authored art set is a lossless copy of what the game drew yesterday and
 * can be edited in any vector tool from here. Output: game/public/art/<key>.svg (served at /art/<key>.svg).
 *
 *   node --import tsx tools/export-svg.ts [--out game/public/art]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateTextures } from '../game/src/render/textures';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const outDir = path.resolve(ROOT, args.includes('--out') ? args[args.indexOf('--out') + 1] : 'game/public/art');

const hex = (c: number) => `#${c.toString(16).padStart(6, '0')}`;
const num = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/\.?0+$/, ''));

/** Minimal stand-in for Phaser.GameObjects.Graphics that records SVG. Only the calls textures.ts makes. */
class SvgGraphics {
  shapes: string[] = [];
  private fill = { color: 0, alpha: 1 };
  private line = { width: 1, color: 0, alpha: 1 };
  private path: string[] = [];
  private fillAttr() { return `fill="${hex(this.fill.color)}"${this.fill.alpha < 1 ? ` fill-opacity="${num(this.fill.alpha)}"` : ''}`; }
  private strokeAttr() { return `fill="none" stroke="${hex(this.line.color)}" stroke-width="${num(this.line.width)}"${this.line.alpha < 1 ? ` stroke-opacity="${num(this.line.alpha)}"` : ''}`; }
  clear() { this.shapes = []; this.path = []; return this; }
  fillStyle(color: number, alpha = 1) { this.fill = { color, alpha }; return this; }
  lineStyle(width: number, color: number, alpha = 1) { this.line = { width, color, alpha }; return this; }
  fillRect(x: number, y: number, w: number, h: number) { this.shapes.push(`<rect x="${num(x)}" y="${num(y)}" width="${num(w)}" height="${num(h)}" ${this.fillAttr()}/>`); return this; }
  fillRoundedRect(x: number, y: number, w: number, h: number, r = 0) { this.shapes.push(`<rect x="${num(x)}" y="${num(y)}" width="${num(w)}" height="${num(h)}" rx="${num(r)}" ${this.fillAttr()}/>`); return this; }
  strokeRect(x: number, y: number, w: number, h: number) { this.shapes.push(`<rect x="${num(x)}" y="${num(y)}" width="${num(w)}" height="${num(h)}" ${this.strokeAttr()}/>`); return this; }
  strokeRoundedRect(x: number, y: number, w: number, h: number, r = 0) { this.shapes.push(`<rect x="${num(x)}" y="${num(y)}" width="${num(w)}" height="${num(h)}" rx="${num(r)}" ${this.strokeAttr()}/>`); return this; }
  fillCircle(x: number, y: number, r: number) { this.shapes.push(`<circle cx="${num(x)}" cy="${num(y)}" r="${num(r)}" ${this.fillAttr()}/>`); return this; }
  fillTriangle(x0: number, y0: number, x1: number, y1: number, x2: number, y2: number) { this.shapes.push(`<polygon points="${num(x0)},${num(y0)} ${num(x1)},${num(y1)} ${num(x2)},${num(y2)}" ${this.fillAttr()}/>`); return this; }
  beginPath() { this.path = []; return this; }
  moveTo(x: number, y: number) { this.path.push(`M${num(x)} ${num(y)}`); return this; }
  lineTo(x: number, y: number) { this.path.push(`L${num(x)} ${num(y)}`); return this; }
  strokePath() { if (this.path.length) this.shapes.push(`<path d="${this.path.join(' ')}" ${this.strokeAttr()} stroke-linecap="round" stroke-linejoin="round"/>`); this.path = []; return this; }
  generateTexture(key: string, w: number, h: number) {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" shape-rendering="geometricPrecision">\n  ${this.shapes.join('\n  ')}\n</svg>\n`;
    fs.writeFileSync(path.join(outDir, `${key}.svg`), svg);
    written.push(key);
    return this;
  }
  destroy() { /* nothing to release */ }
}

const written: string[] = [];
fs.mkdirSync(outDir, { recursive: true });
const g = new SvgGraphics();
// a scene stand-in: no texture exists yet, so every key is drawn
const scene = { textures: { exists: () => false }, make: { graphics: () => g } };
generateTextures(scene as unknown as Parameters<typeof generateTextures>[0]);
console.log(`wrote ${written.length} SVG files to ${path.relative(ROOT, outDir)}: ${written.join(', ')}`);
