#!/usr/bin/env node
// Capture screenshots with Playwright (Chromium) and register them with the Control Room.
// Usage: node tools/playwright-shots.mjs <url> <name> [--task T1] [--note "..."] [--wait 1500] [--width 1280] [--height 800] [--click selector] [--full]
import path from 'node:path';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SHOTS = path.join(ROOT, '.control-room', 'screenshots');
const [url, name, ...rest] = process.argv.slice(2);
if (!url || !name) {
  console.error('usage: playwright-shots.mjs <url> <name> [--task T] [--note N] [--wait ms] [--full]');
  process.exit(1);
}
const opt = {};
for (let i = 0; i < rest.length; i++) if (rest[i].startsWith('--')) opt[rest[i].slice(2)] = rest[i + 1] && !rest[i + 1].startsWith('--') ? rest[++i] : 'true';

fs.mkdirSync(SHOTS, { recursive: true });
const file = path.join(SHOTS, `${name}-${new Date().toISOString().replace(/[:.]/g, '-')}.png`);
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: Number(opt.width || 1280), height: Number(opt.height || 800) }, bypassCSP: true }); // a screenshot tool, not the CSP test (0.8.0)
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text());
});
await page.goto(url, { waitUntil: 'load' });
await page.waitForTimeout(Number(opt.wait || 1500));
if (opt.click) {
  await page.click(opt.click);
  await page.waitForTimeout(800);
}
await page.screenshot({ path: file, fullPage: opt.full === 'true' });
await browser.close();
const rel = path.relative(ROOT, file);
execFileSync(
  'node',
  [path.join(ROOT, 'control-room/emit.mjs'), 'screenshot', '--path', rel, ...(opt.task ? ['--task', opt.task] : []), ...(opt.note ? ['--note', opt.note] : [])],
  { stdio: 'inherit' },
);
console.log(`saved ${rel}${errors.length ? `\npage errors (${errors.length}):\n` + errors.slice(0, 10).join('\n') : '\nno page errors'}`);
