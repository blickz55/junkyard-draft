// The tester build (scripts/build-test.mjs): the game with no server behind it, for a paid playtest on a private link. A stranger must
// never read that they are offline, wait on a server that is not there, or be handed a link to an address nobody owns yet.
import { test, after, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';
import { NO_SERVER, buildTest } from '../scripts/build-test.mjs';
import { NO_SERVER as BAKED } from '../game/src/render/config.ts';

const ROOT = path.resolve(import.meta.dirname, '..');
const dist = fs.mkdtempSync(path.join(os.tmpdir(), 'jd-test-edition-'));
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.json': 'application/json',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
};
let server;
let url;
let browser;

before(async () => {
  await buildTest({ root: ROOT, dist });
  server = http.createServer((req, res) => {
    const p = new URL(req.url, 'http://x').pathname;
    const f = path.join(dist, p === '/' ? 'index.html' : decodeURIComponent(p));
    if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) {
      res.writeHead(404);
      return res.end('not found');
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] ?? 'application/octet-stream' });
    fs.createReadStream(f).pipe(res);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  url = `http://127.0.0.1:${server.address().port}/`;
  browser = await chromium.launch();
});
after(async () => {
  await browser?.close();
  await new Promise((r) => server?.close(r));
  fs.rmSync(dist, { recursive: true, force: true });
});

test('the build: both sides agree on the address, search engines stay away, and no service worker can keep an old version', () => {
  assert.equal(NO_SERVER, BAKED);
  assert.match(fs.readFileSync(path.join(dist, '_headers'), 'utf8'), /\/\*\n {2}X-Robots-Tag: noindex\n$/);
  assert.match(fs.readFileSync(path.join(dist, 'robots.txt'), 'utf8'), /Disallow: \//);
  assert.equal(fs.existsSync(path.join(dist, 'sw.js')), false);
  assert.equal(JSON.parse(fs.readFileSync(path.join(dist, 'build.json'), 'utf8')).verifierUrl, NO_SERVER);
});

test(
  'Home says what it is, has a yard at once, and offers nothing that needs a server; a game plays to the end and sends nothing',
  { timeout: 90000 },
  async () => {
    const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
    const errors = [];
    const sent = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    page.on('request', (r) => {
      if (r.method() === 'POST' && new URL(r.url()).pathname === '/verify') sent.push(r.url());
    });
    await page.goto(url);
    await page.waitForSelector('[data-testid=job-goal]', { timeout: 5000 });
    assert.equal(await page.getByTestId('test-banner').textContent(), 'Test version. The art and sound are not final. Thanks for trying it.');
    assert.equal(await page.getByTestId('daily-board').textContent(), 'No leaderboard in this test version. Your scores stay on this device.');
    for (const tid of ['weekly', 'groups', 'more', 'player-name']) assert.equal(await page.locator(`[data-testid=${tid}]`).count(), 0, `${tid} needs a server`);
    await page.getByTestId('daily').click();
    await page.getByTestId('job-start').click();
    await page.waitForFunction(() => !document.querySelector('[data-testid=job-card]'));
    for (let r = 1; r <= 6; r++) {
      await page.getByTestId('offer-0').click();
      await page.waitForSelector('[data-testid=run]:not([disabled])');
      await page.getByTestId('run').click();
      await page.getByTestId('skip').click();
      await page.getByTestId('next').click();
    }
    await page.waitForSelector('[data-testid=retry]', { timeout: 30000 });
    const words = await page.evaluate(() => document.body.innerText);
    assert.doesNotMatch(words, /offline|online|connection|reconnect/i, 'nobody is told their connection is at fault');
    assert.match(words, /This test version has no leaderboard\. Your score stays on this device\./);
    for (const tid of ['submit', 'share', 'share-native', 'share-more'])
      assert.equal(await page.locator(`[data-testid=${tid}]`).count(), 0, `${tid} leads nowhere here`);
    assert.equal(await page.getByTestId('retry').evaluate((e) => e.classList.contains('jd-btn-primary')), true, 'playing again is the one thing to do');
    assert.deepEqual(sent, [], 'no game is sent anywhere');
    assert.deepEqual(errors, [], 'no page errors');
    await page.context().close();
  },
);

test('the lesson plays from Home in this build, and the job card comes first', { timeout: 30000 }, async () => {
  const page = await (await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })).newPage();
  await page.goto(url);
  await page.getByTestId('learn').click();
  await page.getByTestId('job-start').click();
  await page.waitForFunction(() => !document.querySelector('[data-testid=job-card]'));
  await page.waitForSelector('[data-testid=hint]');
  assert.match(await page.getByTestId('hint').textContent(), /^The belt has a gap\. Tap this Conveyor/);
  await page.context().close();
});
