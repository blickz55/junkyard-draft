// Renders the app icon (SVG below) to desktop/build/icon.png (512×512) with Playwright's Chromium,
// so the icon is reproducible from source and needs no image tooling. electron-builder derives the
// Windows .ico / macOS .icns from this PNG.
//   node tools/make-icon.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'desktop', 'build');
fs.mkdirSync(OUT, { recursive: true });

// Palette matches game/src/render/palette.ts: charcoal floor, amber accents, steel crusher jaws, ingot gold.
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2f2820"/><stop offset="1" stop-color="#1a1612"/></linearGradient>
    <linearGradient id="amber" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f5c542"/><stop offset="1" stop-color="#b8782a"/></linearGradient>
  </defs>
  <rect x="16" y="16" width="480" height="480" rx="96" fill="url(#bg)"/>
  <rect x="16" y="16" width="480" height="480" rx="96" fill="none" stroke="#f0a830" stroke-width="14"/>
  <!-- crusher jaws -->
  <rect x="96" y="150" width="320" height="212" rx="18" fill="#5a6670"/>
  <rect x="118" y="172" width="276" height="168" rx="10" fill="#2b2f33"/>
  <g fill="#8e9aa6">
    <polygon points="140,172 176,172 158,214"/><polygon points="196,172 232,172 214,214"/><polygon points="252,172 288,172 270,214"/><polygon points="308,172 344,172 326,214"/><polygon points="364,172 400,172 382,214"/>
    <polygon points="140,340 176,340 158,298"/><polygon points="196,340 232,340 214,298"/><polygon points="252,340 288,340 270,298"/><polygon points="308,340 344,340 326,298"/><polygon points="364,340 400,340 382,298"/>
  </g>
  <!-- ingot in the middle -->
  <rect x="196" y="236" width="120" height="44" rx="8" fill="url(#amber)" stroke="#9a7a1a" stroke-width="4"/>
  <rect x="208" y="244" width="60" height="10" rx="3" fill="#fff2b0" opacity="0.9"/>
  <!-- conveyor arrows -->
  <g fill="#f0a830">
    <polygon points="96,404 136,428 96,452"/><polygon points="156,404 196,428 156,452"/><polygon points="216,404 256,428 216,452"/><polygon points="276,404 316,428 276,452"/><polygon points="336,404 376,428 336,452"/>
  </g>
  <!-- bolts -->
  <g fill="#1a1612" opacity="0.6"><circle cx="112" cy="166" r="7"/><circle cx="400" cy="166" r="7"/><circle cx="112" cy="346" r="7"/><circle cx="400" cy="346" r="7"/></g>
</svg>`;
fs.writeFileSync(path.join(OUT, 'icon.svg'), svg);

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 512, height: 512 }, deviceScaleFactor: 1 });
await page.setContent(`<!doctype html><html><body style="margin:0;background:transparent">${svg}</body></html>`);
await page.screenshot({ path: path.join(OUT, 'icon.png'), omitBackground: true, clip: { x: 0, y: 0, width: 512, height: 512 } });
await browser.close();
console.log('wrote', path.join(OUT, 'icon.png'), fs.statSync(path.join(OUT, 'icon.png')).size, 'bytes');
