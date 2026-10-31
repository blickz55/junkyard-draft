// Production roadmap 0.10.3: the installable web app against a real production build on a real loopback server (a service
// worker needs a secure context and fetches of its own, which Playwright's request routing does not see). The worker
// installs and takes the page; the manifest and its icons are served; offline, the title loads from the cache, says it is
// offline, and a practice game plays to its results; a second "deploy" is noticed as a waiting worker that the game scene
// never shows and the title announces, and restarting with it rolls the cache over; the install offer appears after the
// second finished run when the browser offers a prompt, and "Not now" keeps it quiet.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { chromium, ROOT, SHOTS, until } from './e2e/fixture.mjs';

const { buildDist } = await import('../scripts/build-lib.mjs');
const { serveDir } = await import('../tools/static-lib.mjs');

// a mock verifier (0.10.4): no daily (the title stays in practice mode), the push routes record what the title sends
const pushCalls = [];
const mock = http.createServer((req, res) => {
  const cors = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
  };
  const json = (code, body) => {
    res.writeHead(code, { 'Content-Type': 'application/json', ...cors });
    res.end(JSON.stringify(body));
  };
  if (req.method === 'OPTIONS') {
    res.writeHead(204, cors);
    return res.end();
  }
  const p = new URL(req.url, 'http://x').pathname;
  if (p === '/health') return json(200, { ok: true, version: 'mock', rulesVersion: 3, protocol: 2 });
  if (p === '/push/vapid') return json(200, { ok: true, publicKey: Buffer.alloc(65, 4).toString('base64url') });
  if (p === '/push/subscribe' || p === '/push/unsubscribe') {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      pushCalls.push({ path: p, body: JSON.parse(body), auth: req.headers.authorization ?? null });
      json(200, p === '/push/subscribe' ? { ok: true, hourUtc: JSON.parse(body).hourUtc, subscriptions: 1 } : { ok: true, removed: true });
    });
    return;
  }
  return json(404, { ok: false, error: 'not here' });
});
await new Promise((r) => mock.listen(0, '127.0.0.1', r));
const MOCK = `http://127.0.0.1:${mock.address().port}`;
const distA = fs.mkdtempSync(path.join(ROOT, 'tools', 'scratch-dist-'));
const distB = fs.mkdtempSync(path.join(ROOT, 'tools', 'scratch-dist-'));
const built = await buildDist({ root: ROOT, dist: distA, verifierUrl: MOCK, reports: false });
// the second deploy: the same build with another worker version (a new commit changes the version string the same way)
fs.cpSync(distA, distB, { recursive: true });
fs.writeFileSync(
  path.join(distB, 'sw.js'),
  fs.readFileSync(path.join(distA, 'sw.js'), 'utf8').replace(/const VERSION = '[^']*';/, "const VERSION = 'second-deploy';"),
);
const srv = await serveDir(distA);
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
after(async () => {
  await browser.close().catch(() => {});
  await srv.close();
  mock.close();
  for (const d of [distA, distB]) fs.rmSync(d, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});
const api = (fn, ...args) => page.evaluate(({ fn, args }) => window.__jd[fn](...args), { fn, args });
const when = (fn, arg = null, timeout = 20000) => page.waitForFunction(fn, arg, { timeout });
const title = () => when(() => window.__jdGame && window.__jdGame.scene.isActive('Title') && !!document.querySelector('[data-testid=daily]'));
/** six rounds through the dev API on the current game scene */
const playOut = async () => {
  for (let r = 0; r < 6; r++) {
    await when(() => !!window.__jd && window.__jd.phase() === 'draft');
    await page.evaluate(() => {
      const j = window.__jd;
      j.pick(j.state().offers.length - 1);
      j.run();
    });
    await when(() => window.__jd.mode() === 'running');
    await api('finishRun');
    await when(() => window.__jd.mode() === 'summary');
    await api('next');
  }
  await when(() => window.__jdGame.scene.isActive('Results') && !!document.querySelector('[data-testid=headline]'));
};

test('the worker installs and takes the page; the manifest and the icons are served; the shell is cached', { timeout: 120000 }, async () => {
  await page.goto(`${srv.url}/?dev=1`);
  await title();
  await when(() => !!navigator.serviceWorker && !!navigator.serviceWorker.controller, null, 30000);
  const info = await page.evaluate(async () => {
    const reg = await navigator.serviceWorker.ready;
    const keys = await caches.keys();
    const cache = await caches.open(keys[0]);
    const m = await (await fetch('manifest.webmanifest')).json();
    const icons = await Promise.all(m.icons.map(async (i) => (await fetch(i.src)).ok));
    return {
      active: !!reg.active,
      scope: reg.scope,
      keys,
      cached: (await cache.keys()).length,
      manifestLink: document.querySelector('link[rel=manifest]')?.getAttribute('href'),
      name: m.name,
      icons,
    };
  });
  assert.ok(info.active, 'the worker is active');
  assert.equal(info.keys.length, 1, 'one shell cache');
  assert.match(info.keys[0], /^jd-shell-/);
  assert.ok(info.cached >= built.precache.length, `the shell is cached: ${info.cached} entries for ${built.precache.length} files`);
  assert.equal(info.manifestLink, './manifest.webmanifest');
  assert.equal(info.name, 'Junkyard Draft');
  assert.deepEqual(info.icons, [true, true, true], 'every icon the manifest names is served');
});

test('offline: the title loads from the cache and says so; a practice game plays from cache to its results', { timeout: 180000 }, async () => {
  await ctx.setOffline(true);
  await page.goto(`${srv.url}/?dev=1`);
  await title();
  await when(() => /practice/i.test(document.querySelector('[data-testid=daily-mode]')?.textContent || ''));
  await page.screenshot({ path: path.join(SHOTS, `pwa-offline-title-${Date.now()}.png`) });
  await page.goto(`${srv.url}/?dev=1&scene=game&seed=classic-pwa-offline`);
  await playOut();
  assert.match(await page.textContent('[data-testid=headline]'), /offline/i, 'the results say the game was offline (no board)');
  await page.screenshot({ path: path.join(SHOTS, `pwa-offline-results-${Date.now()}.png`) });
  assert.deepEqual(errors, [], 'no page errors offline');
});

test(
  'an update: the waiting worker is never announced in the game scene, the title announces it, restarting rolls the cache over',
  { timeout: 180000 },
  async () => {
    await ctx.setOffline(false);
    // mid-run: a new deploy appears while a game is on; the game scene shows nothing
    await page.goto(`${srv.url}/?dev=1&scene=game&seed=classic-pwa-update`);
    await when(() => !!window.__jd && window.__jd.phase() === 'draft');
    srv.setRoot(distB);
    await page.evaluate(async () => (await navigator.serviceWorker.getRegistration()).update());
    await when(async () => !!(await navigator.serviceWorker.getRegistration())?.waiting, null, 30000);
    assert.equal(await page.locator('[data-testid=update-ready]').count(), 0, 'nothing about the update in the game scene');
    await api('pick', 0);
    assert.equal(await page.locator('[data-testid=update-ready]').count(), 0, 'still nothing while building');
    // back on the title: the strip, then the restart
    await page.evaluate(() => document.querySelector('[data-testid=menu]').click());
    await page.evaluate(() => document.querySelector('[data-testid=menu-home]').click());
    await title();
    await when(() => !!document.querySelector('[data-testid=update-ready]'));
    await page.screenshot({ path: path.join(SHOTS, `pwa-update-ready-${Date.now()}.png`) });
    await page.evaluate(() => {
      window.__beforeRestart = true;
    });
    await page.getByTestId('update-restart').click();
    await when(() => !window.__beforeRestart, null, 30000); // the page reloaded under the new worker
    await when(() => !!window.__jd && window.__jd.phase() === 'draft', null, 30000); // the page carried the game URL, so it boots into a fresh game
    await until(async () => (await page.evaluate(() => caches.keys())).join() === 'jd-shell-second-deploy', {
      timeout: 20000,
      what: 'the old shell cache gone',
    });
    assert.deepEqual(errors, []);
  },
);

test('the install offer: not before the second finished run; then the prompt, Install calls it; Not now keeps it quiet', { timeout: 180000 }, async () => {
  const fakePrompt = () =>
    page.evaluate(() => {
      window.__prompted = 0;
      const e = new Event('beforeinstallprompt');
      e.prompt = () => {
        window.__prompted++;
        return Promise.resolve();
      };
      e.userChoice = Promise.resolve({ outcome: 'accepted' });
      window.dispatchEvent(e);
    });
  await page.evaluate(() => localStorage.removeItem('jd.install.v1'));
  // one finished run so far (the offline game); a prompt arrives: no offer yet
  await page.goto(`${srv.url}/?dev=1`);
  await title();
  await fakePrompt();
  await page.waitForTimeout(0);
  assert.equal(await page.locator('[data-testid=install-offer]').count(), 0, 'one run is too early');
  // the second finished run, then the title: the offer
  await page.goto(`${srv.url}/?dev=1&scene=game&seed=classic-pwa-second`);
  await playOut();
  await page.evaluate(() => document.querySelector('[data-testid=home]').click());
  await title();
  await fakePrompt();
  await when(() => !!document.querySelector('[data-testid=install-offer]'));
  await page.screenshot({ path: path.join(SHOTS, `pwa-install-offer-${Date.now()}.png`) });
  await page.getByTestId('install-later').click();
  await when(() => !document.querySelector('[data-testid=install-offer]'));
  await page.goto(`${srv.url}/?dev=1`);
  await title();
  await fakePrompt();
  await page.waitForTimeout(0);
  assert.equal(await page.locator('[data-testid=install-offer]').count(), 0, '"Not now" keeps the offer quiet');
  // the snooze over: Install calls the browser's prompt and records the installation
  await page.evaluate(() => localStorage.setItem('jd.install.v1', JSON.stringify({ dismissedAt: '2020-01-01T00:00:00Z' })));
  await page.goto(`${srv.url}/?dev=1`);
  await title();
  await fakePrompt();
  await when(() => !!document.querySelector('[data-testid=install-offer]'));
  await page.getByTestId('install').click();
  await when(() => window.__prompted === 1 && !document.querySelector('[data-testid=install-offer]'));
  assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('jd.install.v1')).installed), true);
  assert.deepEqual(errors, []);
});

test(
  'the daily reminder (0.10.4): the hour picker and the button subscribe through the worker and tell our server the UTC hour; off again unsubscribes',
  { timeout: 120000 },
  async () => {
    // the browser's push machinery, stood in for: a subscription object the page can hand to our server
    await ctx.addInitScript(() => {
      const fake = {
        endpoint: 'https://push.example/sub/1',
        toJSON() {
          return { endpoint: this.endpoint, keys: { p256dh: 'B'.repeat(87), auth: 'A'.repeat(22) } };
        },
        unsubscribe: () => {
          window.__unsubscribed = (window.__unsubscribed || 0) + 1;
          return Promise.resolve(true);
        },
      };
      PushManager.prototype.subscribe = () => Promise.resolve(fake);
      PushManager.prototype.getSubscription = () => Promise.resolve(fake);
    });
    await page.goto(`${srv.url}/?dev=1`);
    await title();
    await page.getByTestId('more').click();
    await when(() => /^Remind me$/.test(document.querySelector('[data-testid=reminder]')?.textContent || ''));
    await page.getByTestId('reminder').click();
    await when(() => !!document.querySelector('[data-testid=reminder-dialog]'));
    await page.selectOption('[data-testid=push-hour]', '9');
    const offset = await page.evaluate(() => new Date().getTimezoneOffset());
    await page.getByTestId('push').click();
    await until(() => pushCalls.some((c) => c.path === '/push/subscribe'), { timeout: 15000, what: 'the subscription reaching our server' });
    const sub = pushCalls.find((c) => c.path === '/push/subscribe');
    assert.equal(sub.body.hourUtc, Math.floor(((((9 * 60 + offset) % 1440) + 1440) % 1440) / 60), 'the chosen local hour as a UTC hour');
    assert.equal(sub.body.subscription.endpoint, 'https://push.example/sub/1');
    assert.ok(sub.body.subscription.keys.p256dh && sub.body.subscription.keys.auth, "the browser's keys travel with it");
    await when(() => /Stop reminders/.test(document.querySelector('[data-testid=push]')?.textContent || ''));
    assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('jd.push.v1')).hourLocal), 9);
    assert.equal(await page.evaluate(() => document.querySelector('[data-testid=push-hour]').disabled), true, 'the hour is fixed while the reminder is on');
    await page.screenshot({ path: path.join(SHOTS, `pwa-reminder-${Date.now()}.png`) });
    await page.getByTestId('reminder-close').click();
    await when(() => !document.querySelector('[data-testid=reminder-dialog]'));
    // a reload keeps it; off again
    await page.goto(`${srv.url}/?dev=1`);
    await title();
    await page.getByTestId('more').click();
    await when(() => /^Reminder: /.test(document.querySelector('[data-testid=reminder]')?.textContent || ''));
    await page.getByTestId('reminder').click();
    await when(() => /Stop reminders/.test(document.querySelector('[data-testid=push]')?.textContent || ''));
    await page.getByTestId('push').click();
    await until(() => pushCalls.some((c) => c.path === '/push/unsubscribe'), { timeout: 15000, what: 'the unsubscribe reaching our server' });
    assert.equal(pushCalls.find((c) => c.path === '/push/unsubscribe').body.endpoint, 'https://push.example/sub/1');
    await when(() => /Remind me/.test(document.querySelector('[data-testid=push]')?.textContent || ''));
    assert.equal(await page.evaluate(() => window.__unsubscribed), 1, 'the browser subscription was released');
    assert.equal(await page.evaluate(() => localStorage.getItem('jd.push.v1')), 'null');
    await page.keyboard.press('Escape');
    await when(() => !document.querySelector('[data-testid=reminder-dialog]'));
    assert.deepEqual(errors, []);
  },
);

test(
  'the share sheet (0.10.6): on a phone the Share button hands the sheet the text with the link and the card as a picture; the GIF is the final layout under 4 MB',
  { timeout: 180000 },
  async () => {
    await ctx.addInitScript(() => {
      navigator.canShare = () => true;
      navigator.share = async (d) => {
        window.__shared = { title: d.title, text: d.text, files: (d.files || []).map((f) => ({ name: f.name, type: f.type, size: f.size })) };
      };
    });
    await page.goto(`${srv.url}/?dev=1&scene=game&seed=classic-pwa-share`);
    await playOut();
    await when(() => !!document.querySelector('[data-testid=share-native]'));
    await page.getByTestId('share-native').click();
    await when(() => !!window.__shared, null, 30000);
    const shared = await page.evaluate(() => window.__shared);
    assert.match(shared.title, /junkyard draft/i);
    assert.match(shared.text, /https?:\/\/\S+/, 'the text carries the link');
    assert.match(shared.text, /[░▒▓█]{6}/, 'the spoiler-free grid');
    assert.equal(shared.files.length, 1, 'the card travels as a picture');
    assert.match(shared.files[0].name, /^junkyard-classic-pwa-share-\$\d+-card\.png$/);
    assert.equal(shared.files[0].type, 'image/png');
    assert.ok(shared.files[0].size > 10_000, `the card has bytes (${shared.files[0].size})`);
    const gif = await page.evaluate(() =>
      window.__jdGame.scene
        .getScene('Results')
        .exportGif()
        .then((g) => ({ ...g })),
    );
    assert.equal(gif.round, 6, 'the final layout');
    assert.ok(gif.size <= 4 * 1024 * 1024, `the GIF is under 4 MB (${gif.size})`);
    assert.match(gif.strip, /classic-pwa-share · \$\d+$/, 'an unchecked run: yard and score, no hash');
    assert.deepEqual(errors, []);
  },
);
