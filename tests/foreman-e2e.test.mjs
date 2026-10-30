// Production roadmap 0.9.1 in Chromium: the foreman's box on the title, in the draft, on the round-end banner and on the
// results; "lessons only" is persisted and respected (flavour gone, the teaching line in the draft stays). Own port (5191).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
if (!process.env.PLAYWRIGHT_BROWSERS_PATH && fs.existsSync('/opt/pw-browsers')) process.env.PLAYWRIGHT_BROWSERS_PATH = '/opt/pw-browsers';
const { chromium } = await import('playwright');
const PORT = 5191;
const URL = `http://127.0.0.1:${PORT}`;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const SHOTS = path.join(ROOT, '.control-room', 'screenshots');
async function waitServer() { for (let i = 0; i < 60; i++) { try { const r = await fetch(`${URL}/main.js`); if (r.ok) return; } catch {} await wait(500); } throw new Error('dev server did not start'); }

test('0.9.1 the foreman: title, draft, round end and results; lessons only persisted and respected', { timeout: 240000 }, async () => {
  const server = spawn(process.execPath, [path.join(ROOT, 'scripts/dev.mjs')], { env: { ...process.env, GAME_PORT: String(PORT) }, stdio: 'ignore' });
  let browser, page;
  const errors = [];
  const api = (fn, ...args) => page.evaluate(({ fn, args }) => window.__jd[fn](...args), { fn, args });
  const foreman = () => page.evaluate(() => { const el = document.querySelector('[data-testid=foreman]'); return el ? { visible: el.style.display !== 'none' && el.getBoundingClientRect().height > 0, tag: el.querySelector('.jd-foreman-tag')?.textContent, text: el.querySelector('.jd-foreman-text')?.textContent } : null; });
  try {
    browser = await chromium.launch();
    page = await browser.newPage({ viewport: { width: 1120, height: 700 }, bypassCSP: true });
    page.on('pageerror', (e) => errors.push(String(e)));
    page.on('console', (m) => { if (m.type() === 'error' && !/ERR_CONNECTION_REFUSED|ERR_UNSAFE_PORT/.test(m.text())) errors.push(m.text()); });
    await waitServer();
    await page.goto(`${URL}/?dev=1&verifier=http://127.0.0.1:9`);
    await page.waitForFunction(() => window.__jdGame && window.__jdGame.scene.isActive('Title'), null, { timeout: 15000 });
    await page.evaluate(() => { localStorage.setItem('jd.onboarded.v1', '1'); localStorage.setItem('jd.player', 'Foreman Tester'); });
    await page.reload();
    await page.waitForFunction(() => window.__jdGame && window.__jdGame.scene.isActive('Title'), null, { timeout: 15000 });
    // the title: Sal's welcome under the tagline
    const t0 = await foreman();
    assert.ok(t0 && t0.visible, 'the foreman\'s box is on the title'); assert.equal(t0.tag, 'SAL'); assert.ok(t0.text.length > 10, `a welcome line: ${t0.text}`);
    assert.equal(await page.getByTestId('foreman-chatter').textContent(), 'Foreman: chatty');
    // the draft: the first pick's teaching line, then a refusal's line, then after a round the bottleneck case
    await page.goto(`${URL}/?dev=1&scene=game&seed=foreman-yard&verifier=http://127.0.0.1:9`);
    await page.waitForFunction(() => !!window.__jd && window.__jd.phase() === 'draft', null, { timeout: 15000 });
    await wait(200);
    const d1 = await foreman(); assert.ok(d1 && d1.visible, 'the foreman speaks in the first draft'); const firstDraftLine = d1.text;
    await api('pick', 0); await wait(100);
    const st = await api('state'); const part = st.bin[0];
    assert.equal(await api('act', { t: 'place', id: part.id, x: 2, y: 2, dir: 0 }), false, 'the starter conveyor\'s cell is occupied');
    await wait(100);
    const dr = await foreman(); assert.ok(dr && dr.visible && dr.text !== firstDraftLine, `a refusal gets its own line: ${dr.text}`);
    await api('run'); await api('finishRun');
    await page.waitForFunction(() => window.__jd.mode() === 'summary');
    await wait(200);
    const banner = await page.getByTestId('foreman-banner').textContent();
    assert.match(banner, /^SAL · .{10,}/, `the round-end banner carries Sal's line: ${banner}`);
    await page.screenshot({ path: path.join(SHOTS, `foreman-summary-${Date.now()}.png`) });
    await api('next');
    await page.waitForFunction(() => window.__jd.phase() === 'draft' && window.__jd.state().round === 2);
    await wait(200);
    const d2 = await foreman(); assert.ok(d2 && d2.visible, 'the second draft opens with the bottleneck case'); assert.notEqual(d2.text, firstDraftLine);
    // the results: offline, so the offline band
    for (let r = 2; r <= 6; r++) { await api('pick', 0); await api('run'); await api('finishRun'); await page.waitForFunction(() => window.__jd.mode() === 'summary'); await api('next'); }
    await page.waitForFunction(() => window.__jdGame.scene.isActive('Results'), null, { timeout: 10000 });
    await page.waitForFunction(() => { const el = document.querySelector('[data-testid=foreman]'); return !!el && el.style.display !== 'none' && (el.querySelector('.jd-foreman-text')?.textContent || '').length > 10; }, null, { timeout: 15000 });
    const res = await foreman(); assert.ok(res.visible, `the results carry a line: ${res.text}`);
    await page.screenshot({ path: path.join(SHOTS, `foreman-results-${Date.now()}.png`) });
    // lessons only: persisted, flavour gone on the title, the teaching line still in the draft
    await page.getByTestId('title').click();
    await page.waitForFunction(() => window.__jdGame && window.__jdGame.scene.isActive('Title'), null, { timeout: 15000 });
    await page.getByTestId('foreman-chatter').click();
    await page.waitForFunction(() => document.querySelector('[data-testid=foreman-chatter]')?.textContent === 'Foreman: lessons only', null, { timeout: 10000 });
    assert.equal(JSON.parse(await page.evaluate(() => localStorage.getItem('jd.settings.v1'))).chatter, 'less', 'the setting is persisted');
    const quiet = await foreman(); assert.ok(!quiet || !quiet.visible, 'no welcome under lessons only');
    await page.goto(`${URL}/?dev=1&verifier=http://127.0.0.1:9`); // a fresh load of the title (the page's URL still names the game scene from the run above)
    await page.waitForFunction(() => window.__jdGame && window.__jdGame.scene.isActive('Title'), null, { timeout: 15000 });
    assert.equal(await page.getByTestId('foreman-chatter').textContent(), 'Foreman: lessons only', 'survives a reload');
    const quiet2 = await foreman(); assert.ok(!quiet2 || !quiet2.visible, 'still quiet after the reload');
    await page.goto(`${URL}/?dev=1&scene=game&seed=foreman-yard-2&verifier=http://127.0.0.1:9`);
    await page.waitForFunction(() => !!window.__jd && window.__jd.phase() === 'draft', null, { timeout: 15000 });
    await wait(200);
    const teach = await foreman(); assert.ok(teach && teach.visible, 'the first pick still teaches under lessons only');
    await api('pick', 0); await api('run'); await api('finishRun');
    await page.waitForFunction(() => window.__jd.mode() === 'summary');
    assert.equal(await page.locator('[data-testid=foreman-banner]').count(), 0, 'no round-end flavour under lessons only');
    assert.deepEqual(errors, [], 'no page errors');
  } finally {
    await browser?.close();
    server.kill();
    await wait(300);
  }
});
