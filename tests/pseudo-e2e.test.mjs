// Production roadmap 0.9.0: the pseudo-locale (every letter accented, every string about 30 % longer) at 130 % text in
// Chromium: the title, the pick and build panels, a round summary and the results screen must keep every control inside
// the overlay with no horizontal overflow, and the accented text must really be what is on screen. Own port (5193).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
if (!process.env.PLAYWRIGHT_BROWSERS_PATH && fs.existsSync('/opt/pw-browsers')) process.env.PLAYWRIGHT_BROWSERS_PATH = '/opt/pw-browsers';
const { chromium } = await import('playwright');
const PORT = 5193;
const URL = `http://127.0.0.1:${PORT}`;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const SHOTS = path.join(ROOT, '.control-room', 'screenshots');

async function waitServer() { for (let i = 0; i < 60; i++) { try { const r = await fetch(`${URL}/main.js`); if (r.ok) return; } catch {} await wait(500); } throw new Error('dev server did not start'); }
/** Every [data-testid] inside the overlay, and the screen's horizontal overflow. */
const geometry = () => ({
  outside: [...document.querySelectorAll('#ui [data-testid]')].filter((el) => { const r = el.getBoundingClientRect(); const u = document.getElementById('ui').getBoundingClientRect(); return r.width > 0 && r.height > 0 && (r.left < u.left - 1 || r.right > u.right + 1 || r.top < u.top - 1 || r.bottom > u.bottom + 1); }).map((el) => el.dataset.testid),
  outsideX: [...document.querySelectorAll('#ui [data-testid]')].filter((el) => { const r = el.getBoundingClientRect(); const u = document.getElementById('ui').getBoundingClientRect(); return r.width > 0 && (r.left < u.left - 1 || r.right > u.right + 1); }).map((el) => el.dataset.testid),
  scrollX: (() => { const s = document.querySelector('#ui .jd-screen'); return s ? s.scrollWidth - s.clientWidth : 0; })(),
  text: document.getElementById('ui')?.innerText || '',
  textScale: getComputedStyle(document.getElementById('ui')).getPropertyValue('--text-scale').trim(),
});
const accented = (text) => /[áéíóúñçšžÁÉÍÓÚÑÇŠŽ]/.test(text) && !/\b(the|and|your|with)\b/.test(text.replace(/[^\x00-\x7F]/g, ''));

test('0.9.0 pseudo-locale at 130 %: title, pick, build, summary and results keep every control inside the overlay, and the labels are the accented, longer ones', { timeout: 240000 }, async () => {
  const server = spawn(process.execPath, [path.join(ROOT, 'scripts/dev.mjs')], { env: { ...process.env, GAME_PORT: String(PORT) }, stdio: 'ignore' });
  let browser, page;
  const errors = [];
  const api = (fn, ...args) => page.evaluate(({ fn, args }) => window.__jd[fn](...args), { fn, args });
  try {
    browser = await chromium.launch();
    page = await browser.newPage({ viewport: { width: 1120, height: 700 }, bypassCSP: true });
    page.on('pageerror', (e) => errors.push(String(e)));
    page.on('console', (m) => { if (m.type() === 'error' && !/ERR_CONNECTION_REFUSED|ERR_UNSAFE_PORT/.test(m.text())) errors.push(m.text()); });
    await waitServer();
    await page.goto(`${URL}/?dev=1&locale=pseudo&verifier=http://127.0.0.1:9`);
    await page.waitForFunction(() => window.__jdGame && window.__jdGame.scene.isActive('Title'), null, { timeout: 15000 });
    await page.evaluate(() => { const s = JSON.parse(localStorage.getItem('jd.settings.v1') || '{}'); s.textScale = 1.3; localStorage.setItem('jd.settings.v1', JSON.stringify(s)); localStorage.setItem('jd.onboarded.v1', '1'); localStorage.setItem('jd.player', 'Pseudo Tester'); });
    await page.reload();
    await page.waitForFunction(() => window.__jdGame && window.__jdGame.scene.isActive('Title'), null, { timeout: 15000 });
    await page.waitForFunction(() => /^practice/.test(document.querySelector('[data-testid=daily-mode]')?.textContent || '') || /≈/.test(document.querySelector('[data-testid=daily-board]')?.textContent || ''), null, { timeout: 15000 });
    await wait(300);
    // the title: the daily button reads in the pseudo-locale, the text scale is 130 %, nothing sticks out, no horizontal scroll
    const title = await page.evaluate(geometry);
    assert.equal(title.textScale, '1.3', 'text size 130 %');
    const dailyBtn = await page.getByTestId('daily').textContent();
    assert.doesNotMatch(dailyBtn, /[A-Za-z]/, `the daily button is accented: ${dailyBtn}`); assert.ok(dailyBtn.includes('≈'), 'and padded');
    assert.ok(accented(title.text), 'the title screen reads in the pseudo-locale');
    assert.deepEqual(title.outside, [], 'title: every control inside the overlay at 130 % with longer labels');
    assert.equal(title.scrollX, 0, 'title: no horizontal overflow');
    await page.screenshot({ path: path.join(SHOTS, `pseudo-title-${Date.now()}.png`) });
    // the game: pick, build, a round summary, through the dev hooks on an ordinary yard
    await page.goto(`${URL}/?dev=1&locale=pseudo&scene=game&seed=pseudo-yard&verifier=http://127.0.0.1:9`);
    await page.waitForFunction(() => !!window.__jd && window.__jd.phase() === 'draft', null, { timeout: 15000 });
    await wait(200);
    const pick = await page.evaluate(geometry);
    assert.ok(accented(pick.text), 'the pick panel reads in the pseudo-locale'); assert.deepEqual(pick.outside, [], 'pick: inside the overlay');
    assert.doesNotMatch(await page.getByTestId('offer-0').textContent(), /[A-Za-z]{3,}/, 'the offer card is accented');
    await api('pick', 0); await wait(200);
    const build = await page.evaluate(geometry);
    assert.deepEqual(build.outside, [], 'build: inside the overlay'); assert.doesNotMatch(await page.getByTestId('run').textContent(), /[A-Za-z]{3,}/, 'the big button is accented');
    await page.screenshot({ path: path.join(SHOTS, `pseudo-build-${Date.now()}.png`) });
    await api('run'); await api('finishRun');
    await page.waitForFunction(() => window.__jd.mode() === 'summary');
    await wait(300);
    const summary = await page.evaluate(geometry);
    assert.deepEqual(summary.outside, [], 'summary: inside the overlay');
    assert.doesNotMatch(await page.getByTestId('bottleneck').textContent(), /[A-Za-z]{3,}/, 'the bottleneck line is accented');
    assert.doesNotMatch(await page.getByTestId('next').textContent(), /[A-Za-z]{3,}/, 'the banner button is accented');
    for (let r = 2; r <= 6; r++) {
      await api('next');
      await page.waitForFunction((rr) => window.__jd.phase() === 'draft' && window.__jd.state().round === rr, r);
      await api('pick', 0); await api('run'); await api('finishRun');
      await page.waitForFunction(() => window.__jd.mode() === 'summary');
    }
    await api('next');
    await page.waitForFunction(() => window.__jdGame.scene.isActive('Results'), null, { timeout: 10000 });
    await page.waitForFunction(() => /≈/.test(document.querySelector('[data-testid=status]')?.textContent || ''), null, { timeout: 15000 });
    await wait(300);
    const results = await page.evaluate(geometry);
    assert.deepEqual(results.outsideX, [], 'results: nothing sticks out to the left or right (the screen scrolls vertically by design)');
    assert.equal(results.scrollX, 0, 'results: no horizontal overflow');
    assert.doesNotMatch(await page.getByTestId('retry').textContent(), /[A-Za-z]{3,}/, 'the primary action is accented');
    assert.doesNotMatch(await page.getByTestId('board-head').textContent(), /[A-Za-z]{3,}/, 'the board head is accented');
    await page.screenshot({ path: path.join(SHOTS, `pseudo-results-${Date.now()}.png`) });
    assert.deepEqual(errors, [], 'no page errors');
  } finally {
    await browser?.close();
    server.kill();
    await wait(300);
  }
});
