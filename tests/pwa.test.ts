// Production roadmap 0.10.3: the web app's pure parts. The manifest is complete and its icons are real PNGs of the stated
// sizes; the service worker template renders with the shell list; the install offer waits for the second finished run,
// never shows inside an installed app, and stays quiet for two weeks after "Not now".
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { shouldOfferInstall, INSTALL_AFTER_RUNS, INSTALL_SNOOZE_DAYS } from '../game/src/render/pwa';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { renderServiceWorker, listFiles } = await import('../scripts/build-lib.mjs');

/** width and height from a PNG's IHDR chunk */
function pngSize(file: string): [number, number] {
  const b = fs.readFileSync(file);
  assert.equal(b.toString('latin1', 1, 4), 'PNG', `${file} is a PNG`);
  return [b.readUInt32BE(16), b.readUInt32BE(20)];
}

test('manifest: name, start url, standalone display, colours, 192 and 512 icons that exist at those sizes, one maskable', () => {
  const m = JSON.parse(fs.readFileSync(path.join(ROOT, 'game', 'public', 'manifest.webmanifest'), 'utf8'));
  assert.equal(m.name, 'Junkyard Draft');
  assert.ok(m.short_name.length <= 12, 'a short name fits under a home-screen icon');
  assert.equal(m.display, 'standalone');
  assert.equal(m.start_url, './');
  assert.equal(m.scope, './');
  assert.match(m.theme_color, /^#[0-9a-f]{6}$/);
  assert.match(m.background_color, /^#[0-9a-f]{6}$/);
  const sizes = new Set<string>();
  for (const icon of m.icons) {
    const file = path.join(ROOT, 'game', 'public', icon.src);
    assert.ok(fs.existsSync(file), `${icon.src} exists`);
    const [w, h] = pngSize(file);
    assert.equal(`${w}x${h}`, icon.sizes, `${icon.src} is ${icon.sizes}`);
    assert.equal(icon.type, 'image/png');
    sizes.add(`${icon.sizes}:${icon.purpose}`);
  }
  assert.ok(sizes.has('192x192:any') && sizes.has('512x512:any'), 'Chrome needs 192 and 512 any-purpose icons to offer installation');
  assert.ok(sizes.has('512x512:maskable'), 'a maskable icon for Android launchers');
  const html = fs.readFileSync(path.join(ROOT, 'game', 'index.html'), 'utf8');
  assert.match(html, /<link rel="manifest" href="\.\/manifest\.webmanifest" \/>/);
  assert.match(html, /<meta name="theme-color" content="#1a1612" \/>/);
  assert.match(html, /apple-touch-icon/);
});

test('service worker template: renders with the version and the shell list, refuses a list without the page', () => {
  const template = fs.readFileSync(path.join(ROOT, 'game', 'sw.js'), 'utf8');
  for (const ev of ['install', 'activate', 'fetch', 'message']) assert.ok(template.includes(`addEventListener('${ev}'`), `handles ${ev}`);
  assert.ok(template.includes("if (e.data === 'skip-waiting') self.skipWaiting();"), 'a new worker waits for the page to ask');
  assert.ok(template.includes('self.clients.claim()'), 'the first worker takes the page without a reload');
  assert.ok(template.includes('url.origin !== self.location.origin') && template.includes('return;'), 'other origins (our server) are never cached');
  const sw = renderServiceWorker(template, { version: '0.7.0+abc1234', precache: ['index.html', 'main-ABCDEFGH.js', 'art/tile.svg'] });
  assert.ok(sw.includes(`const VERSION = '0.7.0+abc1234';`));
  assert.ok(sw.includes(`const PRECACHE = ["index.html","main-ABCDEFGH.js","art/tile.svg"];`));
  assert.ok(!sw.includes("'__VERSION__'") && !sw.includes('= __PRECACHE__'), 'the placeholders in code are gone (the header comment may still name them)');
  assert.throws(() => renderServiceWorker(template, { version: 'x', precache: ['main.js'] }), /index\.html/);
  assert.throws(() => renderServiceWorker('nothing here', { version: 'x', precache: ['index.html'] }), /placeholders/);
  const files = listFiles(path.join(ROOT, 'game', 'public'));
  assert.ok(
    files.includes('manifest.webmanifest') && files.includes('icons/icon-192.png') && files.includes('policy.json'),
    `the shell list walks subfolders: ${files.length} files`,
  );
  assert.deepEqual(files, [...files].sort(), 'sorted, so two builds of the same tree write the same worker');
});

test('install offer: after the second run, not when installed or standalone, snoozed for two weeks, iOS guidance without a prompt', () => {
  const now = new Date('2026-10-30T12:00:00Z');
  const base = { runs: INSTALL_AFTER_RUNS, standalone: false, installed: false, dismissedAt: null, hasPrompt: true, ios: false, now };
  assert.equal(shouldOfferInstall(base), 'prompt');
  assert.equal(shouldOfferInstall({ ...base, runs: INSTALL_AFTER_RUNS - 1 }), null, 'not before the second finished run');
  assert.equal(shouldOfferInstall({ ...base, standalone: true }), null, 'never inside the installed app');
  assert.equal(shouldOfferInstall({ ...base, installed: true }), null);
  assert.equal(shouldOfferInstall({ ...base, dismissedAt: new Date(now.getTime() - 86_400_000).toISOString() }), null, 'quiet the day after "Not now"');
  assert.equal(
    shouldOfferInstall({ ...base, dismissedAt: new Date(now.getTime() - (INSTALL_SNOOZE_DAYS + 1) * 86_400_000).toISOString() }),
    'prompt',
    'asked again after the snooze',
  );
  assert.equal(shouldOfferInstall({ ...base, dismissedAt: 'not a date' }), 'prompt', 'a broken record does not silence the offer forever');
  assert.equal(shouldOfferInstall({ ...base, hasPrompt: false, ios: true }), 'ios', 'Safari has no prompt: guidance instead');
  assert.equal(shouldOfferInstall({ ...base, hasPrompt: false, ios: false }), null, 'no prompt and not iOS: nothing to offer yet');
});
