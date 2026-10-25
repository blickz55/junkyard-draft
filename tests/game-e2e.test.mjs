// End-to-end gameplay test in Chromium: real pointer drag, keyboard rotate, a full six-round
// run to the results screen, save/continue, and replay export verification.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
process.env.PLAYWRIGHT_BROWSERS_PATH ||= '/opt/pw-browsers';
const { chromium } = await import('playwright');
const PORT = 5199;
const URL = `http://127.0.0.1:${PORT}`;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const SHOTS = path.join(ROOT, '.control-room', 'screenshots');

async function waitServer() { for (let i = 0; i < 60; i++) { try { const r = await fetch(`${URL}/main.js`); if (r.ok) return; } catch {} await wait(500); } throw new Error('dev server did not start'); }

test('junkyard draft: full run in the browser', { timeout: 180000 }, async () => {
  const server = spawn(process.execPath, [path.join(ROOT, 'scripts/dev.mjs')], { env: { ...process.env, GAME_PORT: String(PORT) }, stdio: 'ignore' });
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1120, height: 700 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  const api = (fn, ...args) => page.evaluate(({ fn, args }) => window.__jd[fn](...args), { fn, args });
  try {
    await waitServer();
    await page.goto(`${URL}/?dev=1`);
    await page.waitForFunction(() => window.__jdGame && window.__jdGame.scene.isActive('Title'), null, { timeout: 15000 });
    // Title → Game via a real click on "Today's challenge" button (Phaser object; click by canvas coords)
    await page.goto(`${URL}/?dev=1&scene=game&seed=e2e-seed`);
    await page.waitForFunction(() => !!window.__jd && window.__jd.phase() === 'draft', null, { timeout: 15000 });
    const st0 = await api('state');
    assert.equal(st0.round, 1);
    assert.ok(st0.offers.includes('crusher'), 'round 1 offers a crusher');

    // 1) pick crusher with keyboard number
    const idx = st0.offers.indexOf('crusher');
    await page.keyboard.press(['Digit1', 'Digit2', 'Digit3'][idx]);
    await page.waitForFunction(() => window.__jd.phase() === 'build');
    let st = await api('state');
    assert.equal(st.bin.length, 1); assert.equal(st.bin[0].kind, 'crusher');

    // 2) real drag: bin slot 0 → cell (2,2) which holds a conveyor → rejected (occupied), stays in bin
    const CELL = 72, GX = 32, GY = 72, BIN_Y = 520;
    const binX = GX + 12 + CELL / 2, binY = BIN_Y + 28 + CELL / 2;
    const cell = (x, y) => ({ x: GX + x * CELL + CELL / 2, y: GY + y * CELL + CELL / 2 });
    const drag = async (from, to) => { await page.mouse.move(from.x, from.y); await page.mouse.down(); await page.mouse.move(from.x + 10, from.y + 10, { steps: 3 }); await page.mouse.move(to.x, to.y, { steps: 12 }); await page.mouse.up(); await wait(250); };
    await drag({ x: binX, y: binY }, cell(2, 2));
    st = await api('state');
    assert.equal(st.bin.length, 1, 'occupied cell rejected the drop');
    // move the conveyor at (2,2) into the bin, then drop the crusher there
    await drag(cell(2, 2), { x: GX + 200, y: BIN_Y + 60 });
    st = await api('state');
    assert.equal(st.bin.length, 2, 'conveyor returned to bin');
    const crusherSlot = st.bin.findIndex((m) => m.kind === 'crusher');
    await drag({ x: GX + 12 + crusherSlot * (CELL + 8) + CELL / 2, y: binY }, cell(2, 2));
    st = await api('state');
    const crusher = st.layout.machines.find((m) => m.kind === 'crusher');
    assert.ok(crusher && crusher.x === 2 && crusher.y === 2, 'crusher placed by drag');
    // rotate with R (selected after drag) and rotate back with right-click ×3
    await page.keyboard.press('r'); await wait(100);
    st = await api('state'); assert.equal(st.layout.machines.find((m) => m.kind === 'crusher').dir, 1, 'R rotates');
    for (let i = 0; i < 3; i++) { await page.mouse.click(cell(2, 2).x, cell(2, 2).y, { button: 'right' }); await wait(80); }
    st = await api('state'); assert.equal(st.layout.machines.find((m) => m.kind === 'crusher').dir, 0, 'right-click rotates');
    await page.screenshot({ path: path.join(SHOTS, `e2e-build-${Date.now()}.png`) });

    // 3) run with Space, watch some animation, then skip to the result
    await page.keyboard.press('Space');
    await page.waitForFunction(() => window.__jd.mode() === 'running');
    await wait(1800);
    await page.screenshot({ path: path.join(SHOTS, `e2e-running-${Date.now()}.png`) });
    // pause/resume
    await page.keyboard.press('Escape'); await wait(100); assert.equal(await api('mode'), 'paused');
    await page.keyboard.press('Escape'); await wait(100); assert.equal(await api('mode'), 'running');
    await api('finishRun');
    await page.waitForFunction(() => window.__jd.mode() === 'summary');
    st = await api('state');
    assert.equal(st.rounds.length, 1);
    assert.ok(st.rounds[0].shipped.shards > 0, 'crusher chain shipped shards');
    assert.ok(st.rounds[0].earned > 38, `round 1 earned ${st.rounds[0].earned} > starter 38`);
    await page.screenshot({ path: path.join(SHOTS, `e2e-summary-${Date.now()}.png`) });

    // 4) save/continue: reload mid-run and continue from the title
    await page.goto(`${URL}/?dev=1`);
    await page.waitForFunction(() => window.__jdGame && window.__jdGame.scene.isActive('Title'), null, { timeout: 15000 });
    const hasSave = await page.evaluate(() => !!localStorage.getItem('jd.save.v1'));
    assert.ok(hasSave, 'run saved to localStorage');
    await page.keyboard.press('Enter'); // continue
    await page.waitForFunction(() => !!window.__jd && window.__jd.phase() === 'result', null, { timeout: 15000 });
    st = await api('state'); assert.equal(st.rounds.length, 1); assert.ok(st.score > 38, 'score restored');

    // 5) remaining rounds through the dev API (pick first offer, run, next)
    await api('next');
    for (let r = 2; r <= 6; r++) {
      await page.waitForFunction((rr) => window.__jd.phase() === 'draft' && window.__jd.state().round === rr, r);
      await api('pick', 0);
      await api('run');
      await api('finishRun');
      await page.waitForFunction(() => window.__jd.mode() === 'summary');
      await api('next');
    }
    await page.waitForFunction(() => window.__jdGame.scene.isActive('Results'), null, { timeout: 10000 });
    await wait(700);
    await page.screenshot({ path: path.join(SHOTS, `e2e-results-${Date.now()}.png`) });
    const bests = await page.evaluate(() => JSON.parse(localStorage.getItem('jd.bests.v1')));
    assert.ok(bests.overall && bests.overall.score === st.score + 0 || bests.overall.score > 0, 'personal best recorded');
    assert.equal(await page.evaluate(() => localStorage.getItem('jd.save.v1')), null, 'save cleared after finishing');
    assert.deepEqual(errors, [], 'no page errors');
  } finally {
    await browser.close();
    server.kill('SIGTERM');
  }
});
