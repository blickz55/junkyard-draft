// Production roadmap 0.8.0, client hardening, against a real production build served from a non-loopback origin
// (Playwright routes https://game.example/* to a scratch dist/ built with VERIFIER_URL=https://verifier.example):
//  - `?verifier=https://evil.invalid` is ignored: no request and no CSP report names evil.invalid, the baked verifier is asked;
//  - the Content-Security-Policy is present and a full round plays under it with zero violations;
//  - a browser that refuses to store anything shows the "not saving your progress" banner and the run still plays.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { chromium, settle, ROOT, SHOTS } from './e2e/fixture.mjs';

const { buildDist } = await import('../scripts/build-lib.mjs');
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.wav': 'audio/wav',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};
const ORIGIN = 'https://game.example';
const VERIFIER = 'https://verifier.example';
const EVIL = 'https://evil.invalid';

test('hardened production build: ?verifier= ignored off loopback, CSP holds through a round, storage failure is announced', { timeout: 240000 }, async () => {
  const dist = fs.mkdtempSync(path.join(ROOT, 'tools', 'scratch-dist-'));
  const { size, bundle } = await buildDist({ root: ROOT, dist, verifierUrl: VERIFIER, reports: false });
  assert.ok(size > 100000, 'bundle built');
  assert.match(bundle, /^main-[A-Z0-9]{8}.js$/, 'the production bundle carries a content hash (0.8.5)');
  assert.ok(fs.existsSync(path.join(dist, bundle)));
  const html = fs.readFileSync(path.join(dist, 'index.html'), 'utf8');
  assert.ok(html.includes(`./${bundle}`), 'the page references the hashed bundle');
  const csp = /http-equiv="Content-Security-Policy" content="([^"]+)"/.exec(html)?.[1];
  assert.ok(csp, 'CSP meta present in the built page');
  assert.match(csp, /(^|; )script-src 'self'(;|$)/, 'scripts only from the page origin, no inline, no eval');
  assert.match(csp, /connect-src 'self' https:\/\/verifier\.example(;|$)/, 'connections only to the page and the baked verifier');
  assert.doesNotMatch(csp, /unsafe-eval/);
  assert.equal(JSON.parse(fs.readFileSync(path.join(dist, 'build.json'), 'utf8')).verifierUrl, VERIFIER);

  const browser = await chromium.launch();
  const hits = { evil: 0, verifier: 0 };
  const errors = [];
  /** A context whose game.example origin serves the scratch dist, with the attacker and the verifier stubbed. */
  async function context(initScript) {
    const ctx = await browser.newContext({ viewport: { width: 1120, height: 700 }, serviceWorkers: 'block' }); // 0.10.3: the routed origin is not a real server; the worker has its own e2e
    await ctx.route(`${ORIGIN}/**`, (route) => {
      const u = new URL(route.request().url());
      const rel = u.pathname === '/' ? 'index.html' : decodeURIComponent(u.pathname.slice(1));
      const file = path.join(dist, rel);
      if (!file.startsWith(dist) || !fs.existsSync(file) || !fs.statSync(file).isFile()) return route.fulfill({ status: 404, body: 'not found' });
      return route.fulfill({ status: 200, contentType: MIME[path.extname(file)] || 'application/octet-stream', body: fs.readFileSync(file) });
    });
    await ctx.route(`${EVIL}/**`, (route) => {
      hits.evil++;
      return route.abort();
    });
    await ctx.route(`${VERIFIER}/**`, (route) => {
      hits.verifier++;
      return route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ ok: false, error: 'test verifier is down' }) });
    });
    await ctx.addInitScript(() => {
      window.__cspViolations = [];
      document.addEventListener('securitypolicyviolation', (e) => window.__cspViolations.push(`${e.violatedDirective} ${e.blockedURI}`));
    });
    if (initScript) await ctx.addInitScript(initScript);
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push(String(e)));
    page.on('console', (m) => {
      if (m.type() === 'error' && !/Failed to load resource|503/.test(m.text())) errors.push(m.text());
    }); // the stub verifier answers 503 on purpose
    return { ctx, page };
  }
  const api = (page, fn, ...args) => page.evaluate(({ fn, args }) => window.__jd[fn](...args), { fn, args });
  async function playOneRound(page, seed) {
    await page.goto(`${ORIGIN}/?dev=1&scene=game&seed=${seed}&verifier=${EVIL}`);
    await page.waitForFunction(() => !!window.__jd && window.__jd.phase() === 'draft', null, { timeout: 30000 });
    const st0 = await api(page, 'state');
    await api(page, 'pick', st0.offers.indexOf('crusher'));
    const st = await api(page, 'state');
    const conv = st.layout.machines.find((m) => m.x === 2 && m.y === 2);
    assert.ok(await api(page, 'act', { t: 'unplace', id: conv.id }));
    assert.ok(await api(page, 'act', { t: 'place', id: st.bin.find((m) => m.kind === 'crusher').id, x: 2, y: 2, dir: 0 }));
    await api(page, 'run');
    await page.waitForFunction(() => window.__jd.mode() === 'running', null, { timeout: 10000 });
    await api(page, 'finishRun');
    await page.waitForFunction(() => window.__jd.mode() === 'summary', null, { timeout: 20000 });
    const rec = (await api(page, 'state')).rounds[0];
    assert.ok(rec.earned > 38, `crusher line earned ${rec.earned} > starter 38`);
  }
  try {
    // 1. the override is ignored on a hosted origin: the title asks the baked verifier, never the link's host
    const { ctx, page } = await context();
    await page.goto(`${ORIGIN}/?dev=1&verifier=${EVIL}`);
    await page.waitForFunction(() => window.__jdGame && window.__jdGame.scene.isActive('Title'), null, { timeout: 30000 });
    await page.waitForFunction(() => !!document.querySelector('[data-testid=daily-board]'), null, { timeout: 20000 });
    await settle(1500, "the title asked its verifier on load; a request to the link's host would have gone out by now too");
    assert.equal(hits.evil, 0, "no request reached the link's verifier");
    assert.ok(hits.verifier >= 1, `the baked verifier was asked (${hits.verifier} requests)`);
    assert.deepEqual(await page.evaluate(() => window.__cspViolations), [], 'no CSP violation on the title (a blocked evil.invalid fetch would show here too)');
    const pageCsp = await page.evaluate(() => document.querySelector('meta[http-equiv="Content-Security-Policy"]')?.getAttribute('content'));
    assert.equal(pageCsp, csp);
    // 2. a round under the policy
    await playOneRound(page, 'classic-csp-seed');
    assert.equal(hits.evil, 0);
    assert.deepEqual(await page.evaluate(() => window.__cspViolations), [], 'no CSP violation through draft, build, run and summary');
    fs.mkdirSync(SHOTS, { recursive: true });
    await page.screenshot({ path: path.join(SHOTS, 'e2e-hardening-csp-round.png') });
    await ctx.close();
    // 3. storage that refuses every write: the banner says so and the game still plays
    const broken = await context(() => {
      Storage.prototype.setItem = function () {
        throw new DOMException('the quota has been exceeded', 'QuotaExceededError');
      };
    });
    await broken.page.goto(`${ORIGIN}/?dev=1`);
    await broken.page.waitForFunction(() => window.__jdGame && window.__jdGame.scene.isActive('Title'), null, { timeout: 30000 });
    const banner = broken.page.getByTestId('banner-storage');
    await banner.waitFor({ state: 'visible', timeout: 10000 });
    assert.match(await banner.textContent(), /not saving your progress/i);
    await broken.page.screenshot({ path: path.join(SHOTS, 'e2e-hardening-storage-banner.png') });
    await playOneRound(broken.page, 'classic-quota-seed');
    assert.deepEqual(await broken.page.evaluate(() => window.__cspViolations), []);
    await broken.ctx.close();
    assert.deepEqual(errors, [], 'no page errors');
  } finally {
    await browser.close();
    fs.rmSync(dist, { recursive: true, force: true });
  }
});
