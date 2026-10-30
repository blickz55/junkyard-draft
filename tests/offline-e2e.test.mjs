// Production roadmap 0.8.7 in Chromium: the offline scenario the roadmap names as acceptance. Run with no verifier, see the
// device's own history where the board would be and the saved-and-waiting submission; start the verifier, reload the
// title, see the verified result. Also: no developer copy on the player's screens and the grouped results actions with
// one primary. Own ports (5195 / 4496): the e2e files run in parallel under node --test.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
if (!process.env.PLAYWRIGHT_BROWSERS_PATH && fs.existsSync('/opt/pw-browsers')) process.env.PLAYWRIGHT_BROWSERS_PATH = '/opt/pw-browsers';
const { chromium } = await import('playwright');
const PORT = 5195, VPORT = 4496;
const URL = `http://127.0.0.1:${PORT}`, VURL = `http://127.0.0.1:${VPORT}`;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const SHOTS = path.join(ROOT, '.control-room', 'screenshots');

async function waitServer() { for (let i = 0; i < 60; i++) { try { const r = await fetch(`${URL}/main.js`); if (r.ok) return; } catch {} await wait(500); } throw new Error('dev server did not start'); }
async function waitVerifier() { for (let i = 0; i < 60; i++) { try { const r = await fetch(`${VURL}/health`); if (r.ok) return; } catch {} await wait(500); } throw new Error('verifier did not start'); }

test('0.8.7 offline scenario: run, see the saved-and-waiting state, bring the verifier up, reload, see the verified result', { timeout: 240000 }, async () => {
  const server = spawn(process.execPath, [path.join(ROOT, 'scripts/dev.mjs')], { env: { ...process.env, GAME_PORT: String(PORT) }, stdio: 'ignore' });
  const boardFile = path.join(fs.mkdtempSync(path.join(ROOT, 'tools', 'scratch-offline-')), 'board.json');
  let verifier = null;
  let browser, page;
  const errors = [];
  const api = (fn, ...args) => page.evaluate(({ fn, args }) => window.__jd[fn](...args), { fn, args });
  const playToResults = async (seed) => {
    await page.goto(`${URL}/?dev=1&scene=game&seed=${seed}&verifier=${VURL}`);
    await page.waitForFunction(() => !!window.__jd && window.__jd.phase() === 'draft', null, { timeout: 15000 });
    for (let r = 1; r <= 6; r++) {
      await page.waitForFunction((rr) => window.__jd.phase() === 'draft' && window.__jd.state().round === rr, r);
      await api('pick', 0); await api('run'); await api('finishRun');
      await page.waitForFunction(() => window.__jd.mode() === 'summary');
      await api('next');
    }
    await page.waitForFunction(() => window.__jdGame.scene.isActive('Results'), null, { timeout: 10000 });
    await page.waitForSelector('[data-testid=status]');
  };
  const noDevCopy = async (where) => { const text = await page.evaluate(() => document.getElementById('ui')?.innerText || ''); assert.doesNotMatch(text, /npm|localhost|127\.0\.0\.1|local verifier/i, `${where}: no developer copy on the screen`); };
  try {
    browser = await chromium.launch();
    page = await browser.newPage({ viewport: { width: 1120, height: 700 }, bypassCSP: true });
    page.on('pageerror', (e) => errors.push(String(e)));
    page.on('console', (m) => { if (m.type() === 'error' && !/ERR_CONNECTION_REFUSED/.test(m.text())) errors.push(m.text()); }); // the offline phase refuses connections by design
    await waitServer();
    // 1. the title with no verifier: the practice seed, plain words
    await page.goto(`${URL}/?dev=1&verifier=${VURL}`);
    await page.waitForFunction(() => window.__jdGame && window.__jdGame.scene.isActive('Title'), null, { timeout: 15000 });
    await page.evaluate(() => localStorage.setItem('jd.player', 'Offline Pat'));
    await page.waitForFunction(() => /^Offline: today's board is unavailable/.test(document.querySelector('[data-testid=daily-board]')?.textContent || ''), null, { timeout: 15000 });
    assert.match(await page.getByTestId('daily-mode').textContent(), /^practice \(unranked\): offline$/);
    assert.equal(await page.locator('[data-testid=pending-note]').count(), 0, 'nothing is waiting yet');
    await noDevCopy('title offline');
    // 2. a first run offline: the board panel holds the device's history, with this run marked
    await playToResults('offline-e2e-seed');
    const status = () => page.evaluate(() => document.querySelector('[data-testid=status]')?.textContent || '');
    await page.waitForFunction(() => /^Offline: your game is saved on this device/.test(document.querySelector('[data-testid=status]')?.textContent || ''), null, { timeout: 15000 });
    assert.equal(await page.getByTestId('board-head').textContent(), 'Your games on this yard · this device');
    assert.equal(await page.getByTestId('headline').textContent(), 'Game complete · offline', 'the card\'s headline says offline (0.9.2)');
    assert.equal(await page.getByTestId('delta-best').textContent(), 'your first game on this yard');
    assert.match(await page.getByTestId('history-0').textContent(), /^1\. \$\d+  this game$/);
    assert.match(await page.getByTestId('history-note').textContent(), /^1 game of yours on this yard, this device only\./);
    const score1 = Number((await page.getByTestId('score').textContent()).replace('$', ''));
    // the grouped actions: three labelled rows and exactly one primary button
    const groups = await page.evaluate(() => ['actions-play', 'actions-share', 'actions-watch'].map((id) => { const g = document.querySelector(`[data-testid=${id}]`); return g ? { label: g.querySelector('.jd-actions-label')?.textContent, buttons: [...g.querySelectorAll('button')].map((b) => b.dataset.testid) } : null; }));
    assert.deepEqual(groups.map((g) => g && g.label), ['Play', 'Share', 'Watch']);
    assert.deepEqual(groups[0].buttons, ['retry', 'newseed', 'daily', 'title']); assert.deepEqual(groups[1].buttons, ['submit', 'share', 'share-detailed', 'share-card', 'challenge-link']); assert.deepEqual(groups[2].buttons, ['export-clip', 'export-gif', 'export', 'download']);
    assert.equal(await page.evaluate(() => document.querySelectorAll('#ui .jd-btn-primary').length), 1, 'one primary action on the results screen');
    assert.equal(await page.evaluate(() => document.querySelector('#ui .jd-btn-primary')?.dataset.testid), 'retry');
    await noDevCopy('results offline');
    // 3. submit while offline: saved and waiting
    await page.getByTestId('submit').click();
    await page.waitForFunction(() => /^Offline: your game is saved on this device and waits for a connection/.test(document.querySelector('[data-testid=status]')?.textContent || ''), null, { timeout: 15000 });
    assert.equal(await page.getByTestId('submit').textContent(), 'Saved · waiting for a connection'); assert.equal(await page.getByTestId('submit').isDisabled(), true);
    const pending = await page.evaluate(() => JSON.parse(localStorage.getItem('jd.pending.v1') || '[]'));
    assert.equal(pending.length, 1); assert.equal(pending[0].seed, 'offline-e2e-seed'); assert.equal(pending[0].player, 'Offline Pat'); assert.equal(pending[0].replay.claimedScore, score1);
    await page.screenshot({ path: path.join(SHOTS, `offline-results-${Date.now()}.png`) });
    // 4. a second run on the same seed while still offline: the history lists both, the older one by date
    await playToResults('offline-e2e-seed');
    await page.waitForFunction(() => /^Offline: your game is saved/.test(document.querySelector('[data-testid=status]')?.textContent || ''), null, { timeout: 15000 });
    assert.match(await page.getByTestId('history-note').textContent(), /^2 games of yours on this yard/);
    const rows = await page.evaluate(() => [0, 1].map((i) => document.querySelector(`[data-testid=history-${i}]`)?.textContent));
    assert.ok(rows.some((r) => /this game$/.test(r)) && rows.some((r) => /\d{4}-\d{2}-\d{2}$/.test(r)), `one row is this game, the other dated: ${rows.join(' | ')}`);
    // 5. the title while offline says a run is waiting
    await page.getByTestId('title').click();
    await page.waitForSelector('[data-testid=pending-note]');
    await page.waitForFunction(() => /^Still offline; your saved game on offline-e2e-seed is kept/.test(document.querySelector('[data-testid=pending-note]')?.textContent || ''), null, { timeout: 15000 });
    // 6. the verifier comes up; a reload of the title submits the saved run and says so
    verifier = spawn(process.execPath, ['--import', 'tsx', path.join(ROOT, 'server/verify.ts')], { env: { ...process.env, PORT: String(VPORT), BOARD_FILE: boardFile, DAILY_SECRET: 'offline-e2e-secret', VERIFIER_LOG: '0', BOT_PAR: '0' }, stdio: 'ignore' });
    await waitVerifier();
    await page.goto(`${URL}/?dev=1&verifier=${VURL}`);
    await page.waitForFunction(() => window.__jdGame && window.__jdGame.scene.isActive('Title'), null, { timeout: 15000 });
    await page.waitForFunction(() => /^Your saved game on offline-e2e-seed is checked: \$\d+ · #1 of 1 as Offline Pat\.$/.test(document.querySelector('[data-testid=pending-note]')?.textContent || ''), null, { timeout: 20000 });
    assert.match(await page.getByTestId('pending-note').textContent(), new RegExp(`\\$${score1} · #1 of 1`), 'the saved first run (the one submitted) is the verified one');
    assert.equal(await page.evaluate(() => localStorage.getItem('jd.pending.v1')), null, 'nothing waits any more');
    const subs = await page.evaluate(() => JSON.parse(localStorage.getItem('jd.submissions.v2')));
    const mine = Object.values(subs.byVersion)[0]['offline-e2e-seed']; assert.equal(mine.score, score1); assert.equal(mine.player, 'Offline Pat');
    const board = await (await fetch(`${VURL}/board?seed=offline-e2e-seed`)).json();
    assert.equal(board.entries.length, 1); assert.equal(board.entries[0].score, score1); assert.equal(board.entries[0].player, 'Offline Pat');
    await page.waitForFunction(() => !/^Offline|Checking/.test(document.querySelector('[data-testid=daily-board]')?.textContent || ''), null, { timeout: 15000 });
    await noDevCopy('title online');
    await page.screenshot({ path: path.join(SHOTS, `offline-verified-${Date.now()}.png`) });
    // 7. online results: the board is back with the verified entry, the status says so in plain words
    await playToResults('offline-e2e-seed');
    await page.waitForFunction(() => /^Online\./.test(document.querySelector('[data-testid=status]')?.textContent || ''), null, { timeout: 15000 });
    assert.equal(await page.getByTestId('board-head').textContent(), 'Checked board · this yard');
    assert.match(await page.getByTestId('board-entry-0').textContent(), /^1\. \$\d+  Offline Pat/);
    assert.equal(await page.getByTestId('submit').textContent(), 'Submit to be checked');
    await noDevCopy('results online');
    assert.deepEqual(errors, [], 'no page errors');
  } finally {
    await browser?.close();
    server.kill(); verifier?.kill();
    await wait(300);
    try { fs.rmSync(path.dirname(boardFile), { recursive: true, force: true }); } catch {}
  }
});
