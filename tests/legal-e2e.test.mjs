// Production roadmap 0.8.6 in Chromium: the legal pages are served next to the game, the Privacy & data panel opens from
// the title (the consent toggle's note) and from the results screen, "Download my data" saves the verifier's export and
// "Delete my data" makes the verifier and the device forget the player. Own ports (5196 / 4497): the e2e files run in
// parallel under node --test.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
if (!process.env.PLAYWRIGHT_BROWSERS_PATH && fs.existsSync('/opt/pw-browsers')) process.env.PLAYWRIGHT_BROWSERS_PATH = '/opt/pw-browsers';
const { chromium } = await import('playwright');
const { apply, newRun } = await import('../game/src/sim/run.ts');
const { exportReplay } = await import('../game/src/sim/replay.ts');
const { RULES } = await import('../game/src/sim/rules.ts');
const PORT = 5196, VPORT = 4497;
const URL = `http://127.0.0.1:${PORT}`, VURL = `http://127.0.0.1:${VPORT}`;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const SHOTS = path.join(ROOT, '.control-room', 'screenshots');

async function waitServer() { for (let i = 0; i < 60; i++) { try { const r = await fetch(`${URL}/main.js`); if (r.ok) return; } catch {} await wait(500); } throw new Error('dev server did not start'); }
async function waitVerifier() { for (let i = 0; i < 60; i++) { try { const r = await fetch(`${VURL}/health`); if (r.ok) return; } catch {} await wait(500); } throw new Error('verifier did not start'); }
function finishedRun(seed) {
  const s = newRun(seed);
  for (let r = 1; r <= RULES.rounds; r++) { apply(s, { t: 'pick', i: s.offers.indexOf('crusher') >= 0 ? s.offers.indexOf('crusher') : 0 }); if (r === 1) { const conv = s.layout.machines.find((m) => m.x === 2 && m.y === 2); apply(s, { t: 'unplace', id: conv.id }); apply(s, { t: 'place', id: s.bin[0].id, x: 2, y: 2, dir: 0 }); } apply(s, { t: 'run' }); apply(s, { t: 'next' }); }
  return s;
}

test('0.8.6 legal minimum in the browser: pages served, the panel from title and results, download and delete my data', { timeout: 240000 }, async () => {
  const server = spawn(process.execPath, [path.join(ROOT, 'scripts/dev.mjs')], { env: { ...process.env, GAME_PORT: String(PORT) }, stdio: 'ignore' });
  const boardFile = path.join(fs.mkdtempSync(path.join(ROOT, 'tools', 'scratch-legal-')), 'board.json');
  const verifier = spawn(process.execPath, ['--import', 'tsx', path.join(ROOT, 'server/verify.ts')], { env: { ...process.env, PORT: String(VPORT), BOARD_FILE: boardFile, DAILY_SECRET: 'legal-e2e-secret', VERIFIER_LOG: '0', BOT_PAR: '0' }, stdio: 'ignore' });
  let browser, page;
  const errors = [];
  const api = (fn, ...args) => page.evaluate(({ fn, args }) => window.__jd[fn](...args), { fn, args });
  try {
    browser = await chromium.launch();
    page = await browser.newPage({ viewport: { width: 1120, height: 700 }, bypassCSP: true, acceptDownloads: true });
    page.on('pageerror', (e) => errors.push(String(e)));
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    await Promise.all([waitServer(), waitVerifier()]);

    // every legal page is served next to the game: a heading, no script, a way back
    for (const id of ['privacy', 'terms', 'guidelines']) {
      const r = await fetch(`${URL}/legal/${id}.html`); assert.equal(r.status, 200, `legal/${id}.html`);
      const html = await r.text(); assert.match(html, /<h1>/); assert.doesNotMatch(html, /<script/i); assert.ok(html.includes('href="../"'), 'back to the game');
    }
    assert.equal((await fetch(`${URL}/legal.json`)).status, 200, 'the bundled source is served too');

    await page.goto(`${URL}/?dev=1&verifier=${VURL}`);
    await page.waitForFunction(() => window.__jdGame && window.__jdGame.scene.isActive('Title'), null, { timeout: 15000 });
    // the link sits in the consent toggle's note on the title; the panel opens on the privacy notice with the three tabs
    assert.equal(await page.evaluate(() => document.querySelector('[data-testid=telemetry-note]')?.contains(document.querySelector('[data-testid=privacy]'))), true, 'the privacy link is part of the statistics note');
    await page.getByTestId('privacy').click();
    await page.waitForSelector('[data-testid=privacy-dialog]');
    assert.match(await page.getByTestId('legal-summary').textContent(), /no accounts, no e-mail sign-up, no cookies/);
    assert.match(await page.getByTestId('legal-meta').textContent(), /^Privacy notice · last changed \d{4}-\d{2}-\d{2}/);
    await page.getByTestId('legal-tab-terms').click(); assert.match(await page.getByTestId('legal-meta').textContent(), /^Terms of play/);
    await page.getByTestId('legal-tab-guidelines').click(); assert.match(await page.getByTestId('legal-meta').textContent(), /^Community guidelines/);
    assert.match(await page.getByTestId('legal-body').textContent(), /Found an exploit\?/);
    assert.match(await page.getByTestId('data-status').textContent(), /has a key but no claimed name/);
    await page.screenshot({ path: path.join(SHOTS, `legal-panel-${Date.now()}.png`) });
    await page.keyboard.press('Escape');
    assert.equal(await page.evaluate(() => !!document.querySelector('[data-testid=privacy-dialog]')), false, 'Esc closes the panel');

    // claim a name through the player dialog, then a verified run under that key (submitted from here with the page's own token)
    await page.getByTestId('player').click();
    await page.getByTestId('dialog-input').fill('Legal Tester'); await page.getByTestId('dialog-ok').click();
    await page.waitForFunction(() => /^Player: Legal Tester#/.test(document.querySelector('[data-testid=player]')?.textContent || ''), null, { timeout: 10000 });
    const token = await page.evaluate(() => JSON.parse(localStorage.getItem('jd.identity.v1')).token);
    const daily = await (await fetch(`${VURL}/daily`)).json();
    const sub = await (await fetch(`${VURL}/verify`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ replay: exportReplay(finishedRun(daily.seed)), player: 'Legal Tester' }) })).json();
    assert.equal(sub.ok, true, JSON.stringify(sub)); assert.equal(sub.recorded, true);

    // download my data: a JSON file with the entry and its replay, never the key
    await page.getByTestId('privacy').click(); await page.waitForSelector('[data-testid=data-export]');
    assert.match(await page.getByTestId('data-status').textContent(), /^You are Legal Tester#/);
    const [dl] = await Promise.all([page.waitForEvent('download'), page.getByTestId('data-export').click()]);
    assert.match(dl.suggestedFilename(), /^junkyard-draft-my-data-\d{4}-\d{2}-\d{2}\.json$/);
    const exported = JSON.parse(fs.readFileSync(await dl.path(), 'utf8'));
    assert.equal(exported.ok, true); assert.equal(exported.player.name, 'Legal Tester');
    assert.equal(exported.entries.length, 1); assert.equal(exported.entries[0].replayHash, sub.entry.replayHash); assert.equal(exported.entries[0].storage, 'hot'); assert.ok(exported.entries[0].replay && Array.isArray(exported.entries[0].replay.actions));
    assert.ok(!JSON.stringify(exported).includes(token), 'the device key is not in the export');
    await page.waitForFunction(() => /^Saved junkyard-draft-my-data-.*1 entry, 1 with a stored replay/.test(document.querySelector('[data-testid=data-status]')?.textContent || ''), null, { timeout: 5000 });

    // delete my data: the confirmation, then the verifier forgets and the device gets a new key
    await page.getByTestId('data-delete').click();
    await page.waitForSelector('[data-testid=dialog-ok]');
    assert.match(await page.getByTestId('dialog').textContent(), /cannot be undone/);
    await page.getByTestId('dialog-ok').click();
    await page.waitForFunction(() => document.querySelector('[data-testid=data-status]')?.dataset.deleted === '1', null, { timeout: 10000 });
    assert.match(await page.getByTestId('data-status').textContent(), /^Deleted\. 1 entry anonymised, 0 archived replays dropped; this device has a new key and no name\./);
    const after = await page.evaluate(() => JSON.parse(localStorage.getItem('jd.identity.v1')));
    assert.notEqual(after.token, token, 'a new device key'); assert.equal(after.name, null);
    assert.equal(await page.evaluate(() => localStorage.getItem('jd.player')), null, 'the local name is gone');
    assert.equal((await fetch(`${VURL}/identity`, { headers: { Authorization: `Bearer ${token}` } })).status, 404, 'the old key knows no name');
    const board = await (await fetch(`${VURL}/board?seed=${encodeURIComponent(daily.seed)}`)).json();
    assert.equal(board.entries.length, 1); assert.equal(board.entries[0].player, 'deleted'); assert.equal(board.entries[0].score, sub.score); assert.equal(board.entries[0].playerId, undefined);
    assert.equal((await fetch(`${VURL}/replay?hash=${sub.entry.replayHash}&seed=${encodeURIComponent(daily.seed)}`)).status, 404, 'the replay is gone');
    const again = await (await fetch(`${VURL}/me/export`, { headers: { Authorization: `Bearer ${token}` } })).json();
    assert.equal(again.player, null); assert.deepEqual(again.entries, []);
    await page.screenshot({ path: path.join(SHOTS, `legal-deleted-${Date.now()}.png`) });
    await page.keyboard.press('Escape');
    assert.equal(await page.getByTestId('player').textContent(), 'Set player name…', 'the title shows no player after the deletion');

    // the results screen carries the link too (a quick run through the dev hooks; a local name so the results screen does not prompt)
    await page.evaluate(() => localStorage.setItem('jd.player', 'Legal Tester'));
    await page.goto(`${URL}/?dev=1&scene=game&seed=legal-e2e-seed&verifier=${VURL}`);
    await page.waitForFunction(() => !!window.__jd && window.__jd.phase() === 'draft', null, { timeout: 15000 });
    for (let r = 1; r <= 6; r++) {
      await page.waitForFunction((rr) => window.__jd.phase() === 'draft' && window.__jd.state().round === rr, r);
      await api('pick', 0); await api('run'); await api('finishRun');
      await page.waitForFunction(() => window.__jd.mode() === 'summary');
      await api('next');
    }
    await page.waitForFunction(() => window.__jdGame.scene.isActive('Results'), null, { timeout: 10000 });
    await page.waitForSelector('[data-testid=privacy]');
    await page.getByTestId('privacy').click(); await page.waitForSelector('[data-testid=privacy-dialog]');
    assert.match(await page.getByTestId('legal-summary').textContent(), /no accounts/);
    await page.keyboard.press('Escape');
    assert.deepEqual(errors, [], 'no page errors');
  } finally {
    await browser?.close();
    server.kill(); verifier.kill();
    await wait(300);
    try { fs.rmSync(path.dirname(boardFile), { recursive: true, force: true }); } catch {}
  }
});
