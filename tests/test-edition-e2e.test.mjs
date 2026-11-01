// The tester build (scripts/build-test.mjs): the game with no game server behind it, for a paid playtest on a private link. A stranger
// must never read that they are offline, wait on a server that is not there, or be handed a link to an address nobody owns yet. What
// stands behind the link here is its real worker on a stand-in database: a tester who quits must leave a mark, and the survey must
// end in a code.
import { test, after, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';
import { NO_SERVER, buildTest } from '../scripts/build-test.mjs';
import { NO_SERVER as BAKED } from '../game/src/render/config.ts';
import worker from '../deploy/test-link/worker.ts';
import { summarize } from '../tools/playtest-lib.ts';
import { standInD1 } from './e2e/d1.ts';
import { walkLesson } from './e2e/lit-walk.mjs';

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
const PHONE = { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true };
const db = standInD1();
let server;
let url;
let browser;
/** While set, the store takes a batch at once and its answer waits: a phone on a slow network with a send under way. */
let slowAnswers = null;
/** Woken by every POST: a browser test waits for a condition and never sleeps. */
const waiting = new Set();
const arrived = async (done) => {
  while (!done()) await new Promise((r) => waiting.add(r));
};
const eventsOf = (install) => db.rows('SELECT install, name, props, at FROM events WHERE install = ? ORDER BY at', install);
const installOf = (page) => page.evaluate(() => JSON.parse(localStorage.getItem('jd.telemetry.v1')).installId);
const count = (s, label) => s.milestones.find((m) => m.label === label).testers;

before(async () => {
  await buildTest({ root: ROOT, dist });
  server = http.createServer(async (req, res) => {
    const p = new URL(req.url, 'http://x').pathname;
    if (req.method === 'POST') {
      const body = [];
      for await (const chunk of req) body.push(chunk);
      const env = { DB: db, ASSETS: { fetch: async () => new Response('not found', { status: 404 }) } };
      const answer = await worker.fetch(new Request(`http://x${p}`, { method: 'POST', body: Buffer.concat(body) }), env);
      const text = await answer.text();
      for (const wake of waiting) wake();
      waiting.clear();
      await slowAnswers;
      res.writeHead(answer.status, { 'Content-Type': 'application/json' });
      res.end(text);
      return;
    }
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
  const headers = fs.readFileSync(path.join(dist, '_headers'), 'utf8');
  assert.equal(headers.match(/^\/\*$/gm).length, 1, 'one page-wide rule: a second replaces the first on Cloudflare');
  assert.match(headers, /^\/\*\n {2}X-Robots-Tag: noindex\n {2}Content-Security-Policy: /m);
  assert.match(fs.readFileSync(path.join(dist, 'robots.txt'), 'utf8'), /Disallow: \//);
  assert.equal(fs.existsSync(path.join(dist, 'sw.js')), false);
  assert.equal(JSON.parse(fs.readFileSync(path.join(dist, 'build.json'), 'utf8')).verifierUrl, NO_SERVER);
  assert.deepEqual(
    JSON.parse(fs.readFileSync(path.join(dist, '_routes.json'), 'utf8')).include,
    ['/events', '/feedback'],
    'only these reach the worker: the game keeps its headers',
  );
  assert.match(fs.readFileSync(path.join(dist, '_worker.js'), 'utf8'), /INSERT OR IGNORE INTO events/);
});

test(
  'Home says what it is, has a yard at once, and offers nothing that needs a server; a game plays to the end, no game is sent and the store hears how far it got',
  { timeout: 90000 },
  async () => {
    const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
    const errors = [];
    const sent = [];
    const nowhere = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    page.on('request', (r) => {
      if (new URL(r.url()).hostname === new URL(NO_SERVER).hostname) nowhere.push(r.url());
    });
    page.on('request', (r) => {
      if (r.method() === 'POST' && new URL(r.url()).pathname === '/verify') sent.push(r.url());
    });
    await page.goto(url);
    await page.waitForSelector('[data-testid=job-goal]', { timeout: 5000 });
    assert.equal(
      await page.getByTestId('test-banner').textContent(),
      'Test version. The art and sound are not final. We record anonymous play data to see where people get stuck.',
    );
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
    assert.deepEqual(nowhere, [], 'nothing asks a server that is not there');
    assert.deepEqual(errors, [], 'no page errors');
    assert.equal(await page.getByTestId('feedback').textContent(), 'Give feedback (1 min)');
    const install = await installOf(page);
    await arrived(() => eventsOf(install).some((e) => e.name === 'game_complete'));
    const s = summarize(eventsOf(install), []);
    assert.equal(count(s, 'Started a real game'), 1);
    assert.equal(count(s, 'Finished a real game'), 1);
    assert.equal(count(s, 'Started lesson 1'), 0);
    await page.context().close();
  },
);

test('the lesson plays from Home in this build, and the job card comes first', { timeout: 30000 }, async () => {
  const page = await (await browser.newContext(PHONE)).newPage();
  await page.goto(url);
  await page.getByTestId('learn').click();
  await page.getByTestId('job-start').click();
  await page.waitForFunction(() => !document.querySelector('[data-testid=job-card]'));
  await page.waitForSelector('[data-testid=hint]');
  assert.match(await page.getByTestId('hint').textContent(), /^The belt has a gap\. Tap this Conveyor/);
  await page.context().close();
});

test('a tester who leaves in the middle of a lesson is on record at the step they left, even with a send still under way', { timeout: 30000 }, async () => {
  let answer;
  slowAnswers = new Promise((r) => (answer = r));
  const page = await (await browser.newContext(PHONE)).newPage();
  await page.goto(url);
  await page.getByTestId('learn').click();
  await page.getByTestId('job-start').click();
  await page.waitForSelector('[data-testid=hint]');
  const install = await installOf(page);
  await page.goto('about:blank');
  await arrived(() => eventsOf(install).some((e) => e.name === 'session_end'));
  slowAnswers = null;
  answer();
  const s = summarize(eventsOf(install), []);
  assert.equal(count(s, 'Started lesson 1'), 1);
  assert.deepEqual(s.stops, [{ where: 'Lesson 1, shift 1: place the conveyor', testers: 1 }]);
  await page.context().close();
});

test('the end of a lesson offers the survey, and closing it goes Home', { timeout: 90000 }, async () => {
  const page = await (await browser.newContext(PHONE)).newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(url);
  await page.getByTestId('learn').click();
  await walkLesson(page);
  await page.getByTestId('lesson-feedback').click();
  await page.waitForSelector('[data-testid=feedback-dialog]');
  await page.getByTestId('feedback-goal').focus();
  await page.keyboard.type('rqz 123');
  assert.equal(await page.getByTestId('feedback-goal').inputValue(), 'rqz 123', "keys typed here are words, not the game's shortcuts");
  await page.getByTestId('feedback-later').click();
  await page.waitForSelector('[data-testid=learn]');
  const install = await installOf(page);
  await arrived(() => eventsOf(install).some((e) => e.name === 'lesson_done'));
  const s = summarize(eventsOf(install), []);
  assert.equal(count(s, 'Finished lesson 1'), 1);
  assert.deepEqual(s.stops, [{ where: 'Finished lesson 1, then left', testers: 1 }]);
  assert.deepEqual(errors, [], 'no page errors');
  await page.context().close();
});

for (const device of [
  { name: 'phone', ctx: PHONE },
  { name: 'desk', ctx: { viewport: { width: 1280, height: 800 } } },
])
  test(`the survey on a ${device.name}: everything answered, a code back, and the same code on the way in again`, { timeout: 30000 }, async () => {
    const page = await (await browser.newContext(device.ctx)).newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    const tester = `pro-${device.name}`;
    await page.goto(`${url}?tester=${tester}`);
    await page.getByTestId('feedback').click();
    const box = page.getByTestId('feedback-dialog');
    await box.waitFor();
    assert.equal(await box.evaluate((e) => document.activeElement === e), true, 'no keyboard pops up over the questions');
    await page.getByTestId('feedback-send').click();
    assert.equal(await page.getByTestId('feedback-status').textContent(), 'Please answer every question.');

    await page.getByTestId('feedback-goal').fill('Make the money the job asks for');
    await page.getByTestId('feedback-worst').fill('Which way the belts go');
    for (const tid of ['feedback-clear-4', 'feedback-fun-3', 'feedback-back-yes', 'feedback-pay-maybe']) {
      await page.getByTestId(tid).scrollIntoViewIfNeeded();
      await page.getByTestId(tid).check();
    }
    const fits = await box.evaluate((e) => {
      const b = e.getBoundingClientRect();
      return b.left >= 0 && b.right <= innerWidth && b.top >= 0 && b.bottom <= innerHeight;
    });
    assert.equal(fits, true, 'the dialog stays on the screen and scrolls inside');

    await page.route('**/feedback', (r) => r.abort());
    await page.getByTestId('feedback-send').click();
    await page.waitForFunction(() => document.querySelector('[data-testid=feedback-status]').textContent === 'That did not go through. Try again.');
    assert.equal(await page.getByTestId('feedback-goal').inputValue(), 'Make the money the job asks for', 'nothing typed is lost');
    await page.unroute('**/feedback');

    await page.getByTestId('feedback-send').click();
    await page.getByTestId('feedback-code').waitFor();
    const code = await page.getByTestId('feedback-code').textContent();
    assert.match(code, /^[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    const [stored] = db.rows('SELECT * FROM feedback WHERE code = ?', code);
    assert.equal(stored.tester, tester);
    assert.equal(stored.install, await installOf(page));
    assert.deepEqual(JSON.parse(stored.answers), {
      goal: 'Make the money the job asks for',
      clear: 4,
      fun: 3,
      back: 'yes',
      worst: 'Which way the belts go',
      pay: 'maybe',
    });
    await page.getByTestId('feedback-close').click();
    await page.getByTestId('feedback').click();
    assert.equal(await page.getByTestId('feedback-code').textContent(), code, 'a device answers once and can always see its code again');
    assert.equal(await page.locator('[data-testid=feedback-goal]').count(), 0);
    assert.deepEqual(errors, [], 'no page errors');
    await page.context().close();
  });

test('the survey keeps the keyboard inside it and Esc leaves it', { timeout: 30000 }, async () => {
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
  await page.goto(url);
  await page.getByTestId('feedback').focus();
  await page.keyboard.press('Enter');
  await page.getByTestId('feedback-dialog').waitFor();
  const inside = () => page.evaluate(() => !!document.activeElement.closest('[data-testid=feedback-dialog]'));
  await page.keyboard.press('Shift+Tab');
  assert.equal(await inside(), true, 'backwards from the start goes round to the end');
  assert.equal(await page.evaluate(() => document.activeElement.dataset.testid), 'feedback-later');
  for (let i = 0; i < 26; i++) {
    await page.keyboard.press('Tab');
    assert.equal(await inside(), true, `tab ${i} stays inside`);
  }
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.querySelector('[data-testid=feedback-dialog]'));
  assert.equal(await page.evaluate(() => document.activeElement.dataset.testid), 'feedback', 'focus goes back to where it came from');
  await page.context().close();
});

test('Privacy in this build says what this build does, names no server and offers nothing that cannot work', { timeout: 30000 }, async () => {
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
  await page.goto(url);
  await page.getByTestId('settings').click();
  await page.getByTestId('settings-privacy').waitFor();
  assert.doesNotMatch(await page.evaluate(() => document.body.innerText), /Choose a name|Sign in with email/, 'a name and a sign-in both need a server');
  await page.getByTestId('settings-privacy').click();
  const words = await page.locator('.jd-dialog-label').textContent();
  assert.match(words, /anonymous play data/);
  assert.match(words, /kept only for this test, then deleted/);
  assert.doesNotMatch(await page.evaluate(() => document.body.innerText), /verify\.invalid/);
  assert.equal(await page.locator('[data-testid=data-export]').count(), 0);
  assert.equal(await page.locator('[data-testid=data-delete]').count(), 0);
  await page.context().close();
});
