// Renders the web app icons (production roadmap 0.10.3) from desktop/build/icon.svg with Playwright's Chromium, so they are
// reproducible from source: game/public/icons/icon-192.png, icon-512.png (the SVG as is: it has its own rounded tile) and
// icon-maskable-512.png (the artwork at 80 % on the tile colour, inside the maskable safe zone). electron-builder keeps
// using desktop/build/icon.png (tools/make-icon.mjs).
//   node tools/make-icons.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'game', 'public', 'icons');
fs.mkdirSync(OUT, { recursive: true });
const svg = fs.readFileSync(path.join(ROOT, 'desktop', 'build', 'icon.svg'), 'utf8');

const browser = await chromium.launch();
const render = async (file, size, html, background) => {
  const page = await browser.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 });
  await page.setContent(`<!doctype html><html><body style="margin:0;background:${background}">${html}</body></html>`);
  await page.screenshot({ path: path.join(OUT, file), omitBackground: background === 'transparent', clip: { x: 0, y: 0, width: size, height: size } });
  await page.close();
  console.log('wrote', path.join('game', 'public', 'icons', file), fs.statSync(path.join(OUT, file)).size, 'bytes');
};
const scaled = (size) => svg.replace(/width="512" height="512"/, `width="${size}" height="${size}"`);
await render('icon-192.png', 192, scaled(192), 'transparent');
await render('icon-512.png', 512, scaled(512), 'transparent');
await render(
  'icon-maskable-512.png',
  512,
  `<div style="width:512px;height:512px;display:flex;align-items:center;justify-content:center">${scaled(410)}</div>`,
  '#1a1612',
);
await browser.close();
