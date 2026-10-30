// Renderer e2e in Chromium (DOSSIER-v1 0.3.10): HiDPI canvas with correct pointer mapping, the Canvas renderer
// completing a round, and WebGL context loss + restore leaving the run untouched and the grid redrawn.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
if (!process.env.PLAYWRIGHT_BROWSERS_PATH && fs.existsSync('/opt/pw-browsers')) process.env.PLAYWRIGHT_BROWSERS_PATH = '/opt/pw-browsers';
const { chromium } = await import('playwright');
const { draftOffers, TUTORIAL_SEED } = await import('../game/src/sim/run.ts');
const { RULES_VERSION } = await import('../game/src/sim/types.ts');
const PORT = 5198;
const URL = `http://127.0.0.1:${PORT}`;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const CELL = 72, GX = 32, GY = 72, BIN_Y = 520;
const cell = (x, y) => ({ x: GX + x * CELL + CELL / 2, y: GY + y * CELL + CELL / 2 });

async function waitServer() { for (let i = 0; i < 60; i++) { try { const r = await fetch(`${URL}/main.js`); if (r.ok) return; } catch {} await wait(500); } throw new Error('dev server did not start'); }

test('renderer, run HUD, tips and tutorial: HiDPI canvas, Canvas renderer, WebGL context loss, stall marker, tips badge, tutorial seed', { timeout: 300000 }, async () => {
  const server = spawn(process.execPath, [path.join(ROOT, 'scripts/dev.mjs')], { env: { ...process.env, GAME_PORT: String(PORT) }, stdio: 'ignore' });
  let browser;
  try {
    browser = await chromium.launch();
    await waitServer();
    const open = async (query, ctxOpts = {}) => {
      const context = await browser.newContext({ viewport: { width: 1120, height: 700 }, ...ctxOpts });
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', (e) => errors.push(String(e)));
      await page.goto(`${URL}/?dev=1&scene=game&${query}`);
      await page.waitForFunction(() => !!window.__jd && window.__jd.phase() === 'draft', null, { timeout: 15000 });
      const api = (fn, ...args) => page.evaluate(({ fn, args }) => window.__jd[fn](...args), { fn, args });
      return { context, page, api, errors };
    };
    const drag = async (page, from, to) => { await page.mouse.move(from.x, from.y); await page.mouse.down(); await page.mouse.move(from.x + 10, from.y + 10, { steps: 3 }); await page.mouse.move(to.x, to.y, { steps: 12 }); await wait(80); await page.mouse.up(); await wait(120); };

    // 1) hidpi_canvas_keeps_logical_coordinates: at deviceScaleFactor 2 the backing store is 2240x1400, text renders at
    //    resolution 2, and a real pointer drag still lands on the logical cell it was dropped on
    {
      const { context, page, api, errors } = await open('seed=render-dpr', { deviceScaleFactor: 2 });
      const dims = await page.evaluate(() => { const c = document.querySelector('canvas'); const g = window.__jdGame; return { w: c.width, h: c.height, dpr: window.devicePixelRatio, zoom: g.scene.getScene('Game').cameras.main.zoom, textRes: g.scene.getScene('Game').children.list.find((o) => o.type === 'Text')?.style.resolution }; });
      assert.deepEqual({ w: dims.w, h: dims.h, zoom: dims.zoom, textRes: dims.textRes }, { w: 2240, h: 1400, zoom: 2, textRes: 2 }, `hidpi: ${JSON.stringify(dims)}`);
      await api('pick', 0);
      const st = await api('state');
      const part = st.bin[0];
      assert.ok(part, 'a part is in the bin');
      await drag(page, { x: GX + 12 + CELL / 2, y: BIN_Y + 28 + CELL / 2 }, cell(5, 4));
      const placed = (await api('state')).layout.machines.find((m) => m.id === part.id);
      assert.ok(placed && placed.x === 5 && placed.y === 4, `pointer drop maps to the logical cell under a zoomed camera: ${JSON.stringify(placed)}`);
      assert.deepEqual(errors, [], 'no page errors at DPR 2');
      await context.close();
    }

    // 2) canvas_renderer_completes_a_round: ?renderer=canvas boots the Canvas renderer and a round runs to its summary
    {
      const { context, page, api, errors } = await open('seed=render-canvas&renderer=canvas');
      assert.equal(await page.evaluate(() => window.__jdGame.renderer.type), 1, 'Phaser.CANVAS renderer selected');
      await api('pick', 0);
      await api('run');
      await wait(400);
      await api('finishRun');
      await page.waitForFunction(() => window.__jd.mode() === 'summary', null, { timeout: 15000 });
      assert.equal((await api('state')).rounds.length, 1, 'one round recorded under the Canvas renderer');
      assert.deepEqual(errors, [], 'no page errors under the Canvas renderer');
      await context.close();
    }

    // 3) webgl_context_loss_keeps_the_run: losing and restoring the context mid-build leaves the authoritative state
    //    untouched and the grid redrawn with live textures
    {
      const { context, page, api, errors } = await open('seed=render-loss');
      assert.equal(await page.evaluate(() => window.__jdGame.renderer.type), 2, 'WebGL renderer in use');
      await api('pick', 0);
      const before = await api('state');
      const lost = await page.evaluate(() => { const c = document.querySelector('canvas'); const gl = c.getContext('webgl2') || c.getContext('webgl'); const ext = gl.getExtension('WEBGL_lose_context'); if (!ext) return 'no-ext'; window.__loseExt = ext; ext.loseContext(); return 'lost'; });
      assert.equal(lost, 'lost', 'WEBGL_lose_context available');
      await wait(400);
      assert.equal(await page.evaluate(() => window.__jdGame.renderer.contextLost), true, 'renderer saw the loss');
      await page.evaluate(() => window.__loseExt.restoreContext());
      await page.waitForFunction(() => window.__jdGame.renderer.contextLost === false, null, { timeout: 10000 });
      await wait(600);
      const after = await api('state');
      assert.deepEqual(after, before, 'run state unchanged by the context loss');
      const tex = await page.evaluate(() => { const g = window.__jdGame; const t = g.textures.get('m-crusher'); const img = g.scene.getScene('Game').children.list.flatMap((o) => (o.list ? o.list : [o])).find((o) => o.texture && o.texture.key === 'm-conveyor'); return { gl: !!t.source[0].glTexture, visible: !!img && img.visible && img.active }; });
      assert.deepEqual(tex, { gl: true, visible: true }, 'textures re-uploaded and the grid is drawn after restore');
      // the scene still works: place the part and run a round
      await api('act', { t: 'place', id: before.bin[0].id, x: 5, y: 4, dir: 0 });
      await api('run'); await api('finishRun');
      await page.waitForFunction(() => window.__jd.mode() === 'summary', null, { timeout: 15000 });
      assert.deepEqual(errors.filter((e) => !/context/i.test(e)), [], 'no page errors after the restore');
      await context.close();
    }
    // 4) stall_marker_names_the_blocking_cell (PLAN-v1 0.3.5): a head-on conveyor jams the line; within 10 ticks the HUD
    //    says what is stalled and where, the live total stays at $0, and the marker sits on the first blocking cell
    {
      const { context, page, api, errors } = await open('seed=stall-seed');
      await api('pick', 0);
      const st = await api('state');
      const conv = st.layout.machines.find((m) => m.x === 3 && m.y === 2);
      assert.equal(conv?.kind, 'conveyor');
      assert.ok(await api('act', { t: 'rotate', id: conv.id })); assert.ok(await api('act', { t: 'rotate', id: conv.id })); // now facing west: head-on to the line
      await api('run');
      await page.getByTestId('speed-4').click();
      const seen = await page.waitForFunction(() => { const s = window.__jd.stall(); return s.text ? s : false; }, null, { timeout: 15000 });
      const stall = await seen.jsonValue();
      assert.match(stall.text, /^Stalled: [A-Za-z ]+ at \d,\d is (waiting|blocked) — nothing shipped for 8 s$/, stall.text);
      assert.ok(stall.flaggedAt > 0 && stall.flaggedAt <= 10, `flagged by tick ${stall.flaggedAt} (read at tick ${stall.tick})`); // the flag tick, not the poll's: at 4x on a loaded CI runner the sim advances several ticks per frame
      assert.ok([2 * 8 + 1, 2 * 8 + 2].includes(stall.cell), `first blocking cell is the hopper (1,2) or the conveyor in front of the head-on belt (2,2): got ${stall.cell}`);
      const hud = await page.evaluate(() => ({ score: document.querySelector('[data-testid=hud-score]')?.textContent, mark: !!window.__jdGame.scene.getScene('Game').children.getByName('stall-mark')?.visible }));
      assert.deepEqual(hud, { score: '$0', mark: true }, 'nothing shipped and the marker is visible');
      await api('finishRun');
      await page.waitForFunction(() => window.__jd.mode() === 'summary', null, { timeout: 15000 });
      assert.equal((await api('stall')).text, '', 'the marker clears when the round ends');
      assert.deepEqual(errors, [], 'no page errors');
      await context.close();
    }
    // 5) first_draft_suggests_its_tip_once (PLAN-v1 0.3.6): drafting a press for the first time badges the Tips button;
    //    opening marks the tip read, its live demo ships a plate, Esc closes, and after a reload the badge is gone
    {
      let seed = ''; for (let i = 0; i < 500 && !seed; i++) if (draftOffers(`tips-${i}`, 1).includes('press')) seed = `tips-${i}`;
      assert.ok(seed, 'found a seed whose round-1 offers include a press');
      const { context, page, api, errors } = await open(`seed=${seed}`);
      const btnText = () => page.evaluate(() => document.querySelector('[data-testid=tips]')?.textContent ?? null);
      assert.equal(await btnText(), 'Tips', 'no badge before any draft');
      assert.equal((await api('tips')).suggested, null);
      const idx = (await api('state')).offers.indexOf('press');
      await api('pick', idx);
      assert.equal((await api('tips')).suggested, 'press', 'the first press draft suggests the press tip');
      assert.equal(await btnText(), 'Tips ●', 'the Tips button carries a badge');
      await api('openTips');
      let t = await api('tips');
      assert.deepEqual({ open: t.open, current: t.current, readHasPress: t.read.includes('press'), suggested: t.suggested }, { open: true, current: 'press', readHasPress: true, suggested: null }, 'opening shows and marks the suggested tip');
      const demo = await page.waitForFunction(() => { const d = window.__jd.tips().demo; return d && d.shipped.plate >= 1 ? d : false; }, null, { timeout: 20000 });
      const d = await demo.jsonValue();
      assert.equal(d.tip, 'press'); assert.ok(d.shipped.plate >= 1, `the live demo pressed a plate by tick ${d.tick}`);
      // the panel is DOM (0.4.12): dialog, nav button marked read and active, the watch line reports the demo, the demo canvas has pixels
      const dom = await page.evaluate(() => { const q = (t) => document.querySelector(`[data-testid=${t}]`); const c = q('tips-demo'); const px = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let lit = 0; for (let i = 0; i < px.length; i += 4) if (px[i + 3] > 0 && (px[i] + px[i + 1] + px[i + 2]) > 60) lit++; return { dialog: q('tips-panel')?.getAttribute('role'), press: q('tip-press')?.textContent, active: q('tip-press')?.classList.contains('jd-active'), watch: q('tips-watch')?.textContent, canvas: [c.width, c.height], lit, hidden: document.getElementById('ui').classList.contains('jd-hidden') }; });
      assert.equal(dom.dialog, 'dialog'); assert.equal(dom.press, 'A press needs two shards for one plate', 'read: no badge dot'); assert.equal(dom.active, true);
      assert.match(dom.watch, /shipped: .*plate/); assert.ok(dom.canvas[0] > 0 && dom.canvas[0] % 108 === 0 && dom.canvas[1] % 108 === 0, `demo canvas is whole 54 px cells at 2x backing: ${dom.canvas}`); assert.ok(dom.lit > 1000, `the demo canvas is drawn (${dom.lit} lit pixels)`);
      assert.equal(dom.hidden, false, 'the DOM screen is not hidden behind the panel any more');
      assert.equal(await api('hint'), await api('hint'), 'sanity'); // tips never touch the hint strip: it still shows the build hint
      assert.doesNotMatch(await api('hint'), /press needs two shards/i, 'the tip text did not leak into the hint strip');
      await page.keyboard.press('Escape'); await wait(150);
      t = await api('tips'); assert.equal(t.open, false, 'Esc closes the panel');
      assert.equal(await btnText(), 'Tips', 'badge gone once read');
      await page.reload();
      await page.waitForFunction(() => !!window.__jd && window.__jd.phase() === 'draft', null, { timeout: 15000 });
      await api('pick', idx);
      assert.equal((await api('tips')).suggested, null, 'a read tip is never suggested again');
      assert.equal(await btnText(), 'Tips');
      assert.deepEqual(errors, [], 'no page errors');
      await context.close();
      // 5c) keyboard_ownership (review F05): Enter on a focused offer activates it; Tab from a focused button moves DOM
    //     focus instead of taking a bin part; Space with Tips open does not start the run; Esc first blurs a focused control
    {
      const { context, page, api, errors } = await open('seed=kbd-own');
      await page.focus('[data-testid=offer-1]');
      await page.keyboard.press('Enter'); await wait(150);
      const after = await api('state');
      assert.equal(after.phase, 'build', 'Enter on the focused offer picked it');
      assert.equal(after.bin.length, 1);
      await page.focus('[data-testid=tips]');
      await page.keyboard.press('Tab'); await wait(100);
      const focusNow = await page.evaluate(() => document.activeElement && document.activeElement.dataset.testid);
      assert.notEqual(focusNow, 'tips', 'Tab moved DOM focus');
      assert.equal((await api('cursor')).held, null, 'Tab did not take a bin part while a button had focus');
      await page.evaluate(() => document.activeElement.blur());
      await api('openTips');
      assert.equal(await page.evaluate(() => document.activeElement && document.activeElement.dataset.testid), 'tips-close', 'Tips opened with focus on its Close button');
      await page.keyboard.press('Tab'); await wait(100);
      const inDialog = await page.evaluate(() => !!document.activeElement?.closest('[data-testid=tips-panel]'));
      assert.equal(inDialog, true, 'Tab stays inside the dialog');
      assert.equal((await api('cursor')).held, null, 'Tab inside Tips did not take a bin part');
      await page.keyboard.press('ArrowRight'); await page.keyboard.press('Space'); await wait(200);
      assert.equal(await api('mode'), 'build', 'arrows and Space with Tips open did not touch the run');
      assert.equal((await api('tips')).open, true, 'Space on a focused tip button is the button\'s own click, not a run start');
      await page.keyboard.press('Escape'); await wait(150);
      assert.equal((await api('tips')).open, false);
      await page.keyboard.press('Space'); await wait(300);
      assert.equal(await api('mode'), 'running', 'with nothing focused and no dialog, Space starts the run');
      assert.deepEqual(errors, [], 'no page errors');
      await context.close();
    }
    // 5d) dom_dialogs (review F04): custom seed, player name and replay import use DOM dialogs (window.prompt does not exist in Electron)
    {
      const context = await browser.newContext({ viewport: { width: 1120, height: 700 } });
      const page = await context.newPage();
      await page.addInitScript(() => { window.prompt = () => { throw new Error('prompt() is not supported.'); }; window.alert = () => { throw new Error('alert() is not supported.'); }; });
      const errors = []; page.on('pageerror', (e) => errors.push(String(e)));
      await page.goto(`${URL}/?dev=1&verifier=http://127.0.0.1:9`); // nothing listens on port 9: the daily must fall back to practice (PLAN-v3 0.6.1)
      await page.waitForFunction(() => window.__jdGame && window.__jdGame.scene.isActive('Title'), null, { timeout: 15000 });
      await page.waitForFunction(() => /^practice \(unranked\): offline$/.test(document.querySelector('[data-testid=daily-mode]')?.textContent || ''), null, { timeout: 10000 });
      assert.match(await page.getByTestId('daily-seed').textContent(), /^yard daily-\d{4}-\d{2}-\d{2}$/, 'the practice yard is the plain date');
      await page.getByTestId('player').click();
      await page.getByTestId('dialog-input').fill('Kbd Tester');
      await page.keyboard.press('Enter'); await wait(100);
      assert.equal(await page.getByTestId('player').textContent(), 'Player: Kbd Tester');
      assert.equal(await page.evaluate(() => localStorage.getItem('jd.player')), 'Kbd Tester');
      await page.getByTestId('player').click();
      await page.keyboard.press('Escape'); await wait(100);
      assert.equal(await page.evaluate(() => !!document.querySelector('[data-testid=dialog]')), false, 'Esc cancels');
      assert.equal(await page.getByTestId('player').textContent(), 'Player: Kbd Tester', 'cancel keeps the name');
      // policy panel (PLAN-v3 0.6.5): generated from the code, names the rules version and the tie rule, Esc closes
      await page.getByTestId('policy').click(); await wait(100);
      assert.match(await page.getByTestId('policy-headline').textContent(), new RegExp(`^Rules version ${RULES_VERSION} · verifier protocol \\d+$`));
      assert.match(await page.getByTestId('policy-tie').textContent(), /^Tie-break: Equal scores: fewer machines in round 6 first/);
      assert.ok((await page.getByTestId('policy-body').textContent()).includes('48 h from 00:00 UTC'), 'the daily window comes from the verifier constant');
      await page.keyboard.press('Escape'); await wait(100);
      assert.equal(await page.evaluate(() => !!document.querySelector('[data-testid=policy-dialog]')), false, 'Esc closes the policy panel');
      // identity_recovery (PLAN-v3 0.6.0): the recovery code shown here restores the same device token in a fresh browser context
      const identityBefore = JSON.parse(await page.evaluate(() => localStorage.getItem('jd.identity.v1')));
      assert.match(identityBefore.token, /^[0-9a-f]{32}$/, 'a device token exists after the first use of the player dialog');
      await page.getByTestId('player').click();
      await page.getByTestId('dialog-recovery').click(); await wait(100);
      const code = await page.getByTestId('dialog-input').inputValue();
      assert.match(code, /^[0-9A-Z]{5}(-[0-9A-Z]{5}){3}-[0-9A-Z]{6}$/, `recovery code in base32 groups: ${code}`);
      await page.getByTestId('dialog-ok').click(); await wait(100);
      {
        const fresh = await browser.newContext({ viewport: { width: 1120, height: 700 } });
        const p2 = await fresh.newPage();
        await p2.goto(`${URL}/?dev=1`);
        await p2.waitForFunction(() => window.__jdGame && window.__jdGame.scene.isActive('Title'), null, { timeout: 15000 });
        assert.equal(await p2.getByTestId('player').textContent(), 'Set player name…', 'a fresh context has no name');
        await p2.getByTestId('player').click();
        await p2.getByTestId('dialog-restore').click(); await wait(100);
        await p2.getByTestId('dialog-input').fill(code.toLowerCase().replace(/-/g, ' '));
        await p2.keyboard.press('Enter'); await wait(300);
        const restored = JSON.parse(await p2.evaluate(() => localStorage.getItem('jd.identity.v1')));
        assert.equal(restored.token, identityBefore.token, 'the restored device token equals the original (case, spaces and dashes ignored)');
        assert.match(await p2.getByTestId('player-note').textContent(), /^Restored your key/, 'no server here, so the name is fetched later');
        await fresh.close();
      }
      await page.getByTestId('import').click();
      await page.getByTestId('dialog-input').fill('{"not":"a replay"}');
      await page.getByTestId('dialog-ok').click(); await wait(150);
      assert.match(await page.evaluate(() => document.querySelector('[data-testid=dialog]')?.textContent ?? ''), /Could not read the recording/, 'a bad paste is explained in a dialog');
      await page.getByTestId('dialog-ok').click(); await wait(100);
      await page.getByTestId('custom').click();
      await page.getByTestId('dialog-input').fill('dialog-seed');
      await page.getByTestId('dialog-ok').click();
      await page.waitForFunction(() => !!window.__jd && window.__jd.phase() === 'draft', null, { timeout: 15000 });
      assert.equal((await page.evaluate(() => window.__jd.state())).seed, 'dialog-seed');
      assert.deepEqual(errors, [], 'no page errors without window.prompt');
      await context.close();
    }
    // 5e) records_partitioned_by_rules_version (PLAN-v2 0.5.0): a pre-0.5.0 profile migrates on the title and the legacy key goes;
    //     bests under another version show as a collapsed archived block, and the 130 % title still fits with it
    {
      const context = await browser.newContext({ viewport: { width: 1120, height: 700 } });
      const page = await context.newPage();
      await page.addInitScript(() => { try { localStorage.setItem('jd.bests.v1', JSON.stringify({ overall: { score: 912, seed: 'old-seed', at: 't' }, bySeed: { 'old-seed': { score: 912, at: 't' } }, runs: 3 })); } catch {} });
      await page.goto(`${URL}/?dev=1`);
      await page.waitForFunction(() => window.__jdGame && window.__jdGame.scene.isActive('Title'), null, { timeout: 15000 });
      const migrated = await page.evaluate(() => ({ legacy: localStorage.getItem('jd.bests.v1'), v2: JSON.parse(localStorage.getItem('jd.bests.v2') || 'null'), text: document.querySelector('#ui')?.textContent || '' }));
      assert.equal(migrated.legacy, null, 'legacy key removed');
      assert.equal(migrated.v2?.byVersion?.['2']?.overall?.score, 912, 'migrated into the rules-2 slot whatever version runs');
      if (RULES_VERSION === 2) { assert.match(migrated.text, /Best score: \$912/); assert.equal(await page.locator('[data-testid^=archived-bests-]').count(), 0, 'nothing archived while rules 2 are current'); }
      else { assert.match(migrated.text, /No finished games yet/); assert.match(migrated.text, /Under older rules \(v2\)/); assert.match(migrated.text, /\$912/, 'the migrated v2 best is archived, not the headline, under newer rules'); }
      await context.close();
      const c2 = await browser.newContext({ viewport: { width: 1120, height: 700 } });
      const p2 = await c2.newPage();
      await p2.addInitScript((v) => { try {
        localStorage.setItem('jd.bests.v2', JSON.stringify({ byVersion: { [v]: { overall: { score: 1500, seed: 'now', at: 't' }, bySeed: {}, runs: 2 }, '1': { overall: { score: 300, seed: 'then', at: 't' }, bySeed: {}, runs: 4 } } }));
        localStorage.setItem('jd.settings.v1', JSON.stringify({ volume: 0.7, muted: false, reducedMotion: false, textScale: 1.3, renderQuality: 'auto', telemetry: false }));
      } catch {} }, String(RULES_VERSION));
      await p2.goto(`${URL}/?dev=1`);
      await p2.waitForFunction(() => window.__jdGame && window.__jdGame.scene.isActive('Title'), null, { timeout: 15000 });
      const arch = await p2.evaluate(() => { const d = document.querySelector('[data-testid=archived-bests-1]'); const sc = document.querySelector('#ui .jd-screen'); return { present: !!d, open: d?.open, text: d?.textContent, scrollH: sc?.scrollHeight, clientH: sc?.clientHeight, headline: document.querySelector('#ui')?.textContent?.includes('Best score: $1500') }; });
      assert.equal(arch.present, true); assert.equal(arch.open, false, 'collapsed by default'); assert.match(arch.text ?? '', /Under older rules \(v1\)/); assert.match(arch.text ?? '', /\$300/); assert.equal(arch.headline, true, 'the current version is the headline');
      assert.ok(arch.scrollH <= arch.clientH + 1, `the title still fits at 130 % with the archived block (${arch.scrollH} vs ${arch.clientH})`);
      await c2.close();
    }
    // 5b) tips_panel_fits_at_130 (0.4.12): from the title at 130 % text, the dialog needs no scrolling and every control stays inside the overlay
      const cBig = await browser.newContext({ viewport: { width: 1120, height: 700 } });
      const pBig = await cBig.newPage();
      await pBig.addInitScript(() => { try { localStorage.setItem('jd.settings.v1', JSON.stringify({ volume: 0.7, muted: false, reducedMotion: false, textScale: 1.3, renderQuality: 'auto', telemetry: false })); } catch {} });
      await pBig.goto(`${URL}/?dev=1`);
      await pBig.waitForFunction(() => window.__jdGame && window.__jdGame.scene.isActive('Title'), null, { timeout: 15000 });
      await pBig.getByTestId('tips').click();
      await pBig.getByTestId('tip-splitter').click();
      await wait(150);
      const fit = await pBig.evaluate(() => { const box = document.querySelector('[data-testid=tips-panel]'); const ui = document.getElementById('ui').getBoundingClientRect(); const outside = [...box.querySelectorAll('[data-testid]')].filter((el) => { const r = el.getBoundingClientRect(); return !(r.left >= ui.left - 1 && r.right <= ui.right + 1 && r.top >= ui.top - 1 && r.bottom <= ui.bottom + 1); }).map((el) => el.dataset.testid); return { scrollH: box.scrollHeight, clientH: box.clientHeight, outside, textScale: getComputedStyle(document.getElementById('ui')).getPropertyValue('--text-scale').trim() }; });
      assert.equal(fit.textScale, '1.3');
      assert.ok(fit.scrollH <= fit.clientH + 1, `the tips dialog does not scroll at 130 % (${fit.scrollH} vs ${fit.clientH})`);
      assert.deepEqual(fit.outside, [], 'every tips control stays inside the overlay at 130 %');
      await pBig.keyboard.press('Escape'); await wait(100);
      assert.equal(await pBig.evaluate(() => !!document.querySelector('[data-testid=tips-panel]')), false, 'Esc closes the DOM dialog from the title');
      await cBig.close();
    }
    // 6) tutorial_seed_teaches_one_rule_per_round (PLAN-v1 0.3.4): a fresh profile sees Learn first; the scripted lesson reaches
    //    round 4 in <= 40 actions with the hint strip as the only guidance surface; finishing round 3 marks the profile onboarded
    {
      const context = await browser.newContext({ viewport: { width: 1120, height: 700 } });
      const page = await context.newPage();
      const errors = []; page.on('pageerror', (e) => errors.push(String(e)));
      await page.goto(`${URL}/?dev=1`);
      await page.waitForFunction(() => window.__jdGame && window.__jdGame.scene.isActive('Title'), null, { timeout: 15000 });
      const learn = await page.evaluate(() => { const b = document.querySelector('[data-testid=learn]'); return { text: b?.textContent, amber: !!b && b.classList.contains('jd-btn-primary') }; });
      assert.deepEqual(learn, { text: 'Learn to play (3 min)', amber: true }, 'a fresh profile gets the lesson as the highlighted secondary action');
      await page.goto(`${URL}/?dev=1&scene=game&seed=${TUTORIAL_SEED}`);
      await page.waitForFunction(() => !!window.__jd && window.__jd.phase() === 'draft', null, { timeout: 15000 });
      const api = (fn, ...args) => page.evaluate(({ fn, args }) => window.__jd[fn](...args), { fn, args });
      const act = async (a) => { assert.equal(await api('act', a), true, `action accepted: ${JSON.stringify(a)}`); };
      const hint = () => api('hint');
      const at = async (x, y) => (await api('state')).layout.machines.find((m) => m.x === x && m.y === y);
      const binKind = async (k) => (await api('state')).bin.find((m) => m.kind === k);
      let st = await api('state');
      assert.deepEqual(st.offers, ['crusher']); assert.equal(st.bin.length, 3, 'three spare conveyors in the bin');
      assert.match(await hint(), /Pick the CRUSHER/);
      // round 1: crusher replaces the conveyor after the hopper
      await api('pick', 0); assert.match(await hint(), /Make room/);
      await act({ t: 'unplace', id: (await at(2, 2)).id });
      await act({ t: 'place', id: (await binKind('crusher')).id, x: 2, y: 2, dir: 1 });
      assert.match(await hint(), /only takes items from behind/, 'a misoriented crusher is explained');
      await act({ t: 'rotate', id: (await at(2, 2)).id }); await act({ t: 'rotate', id: (await at(2, 2)).id }); await act({ t: 'rotate', id: (await at(2, 2)).id });
      assert.match(await hint(), /Good: the hopper feeds the crusher/);
      await api('run'); await api('finishRun'); await page.waitForFunction(() => window.__jd.mode() === 'summary');
      await api('next'); await page.waitForFunction(() => window.__jd.phase() === 'draft');
      // round 2: furnace after the crusher, dock moved right
      st = await api('state'); assert.deepEqual(st.offers, ['furnace']); assert.match(await hint(), /FURNACE/);
      await api('pick', 0); assert.match(await hint(), /Move the dock/);
      const dock = await at(5, 2); await act({ t: 'unplace', id: dock.id }); await act({ t: 'place', id: dock.id, x: 6, y: 2, dir: 0 });
      await act({ t: 'place', id: (await binKind('furnace')).id, x: 5, y: 2, dir: 0 });
      assert.match(await hint(), /Shards reach the furnace/);
      await api('run'); await api('finishRun'); await page.waitForFunction(() => window.__jd.mode() === 'summary');
      assert.ok((await api('state')).rounds[1].shipped.ingot >= 1, 'round 2 shipped ingots');
      await api('next'); await page.waitForFunction(() => window.__jd.phase() === 'draft');
      // round 3: splitter after the crusher, both branches merged back by side-loading, spare sold
      st = await api('state'); assert.deepEqual(st.offers, ['splitter']);
      await api('pick', 0); assert.match(await hint(), /Replace the conveyor after the crusher/);
      await act({ t: 'unplace', id: (await at(3, 2)).id });
      await act({ t: 'place', id: (await binKind('splitter')).id, x: 3, y: 2, dir: 0 });
      assert.match(await hint(), /Not flowing yet/);
      const convs = (await api('state')).bin.filter((m) => m.kind === 'conveyor');
      assert.equal(convs.length, 5, 'three spares plus the two replaced conveyors');
      await act({ t: 'place', id: convs[0].id, x: 3, y: 1, dir: 0 }); await act({ t: 'place', id: convs[1].id, x: 4, y: 1, dir: 1 });
      await act({ t: 'place', id: convs[2].id, x: 3, y: 3, dir: 0 }); await act({ t: 'place', id: convs[3].id, x: 4, y: 3, dir: 3 });
      assert.match(await hint(), /ingots flow/, 'the real simulation confirms the merge');
      await act({ t: 'sell', id: convs[4].id });
      await api('run'); await api('finishRun'); await page.waitForFunction(() => window.__jd.mode() === 'summary');
      await api('next'); await page.waitForFunction(() => window.__jd.phase() === 'draft');
      st = await api('state');
      assert.equal(st.round, 4); assert.equal(st.offers.length, 3, 'round 4 is an ordinary draft');
      assert.ok(st.actions <= 40, `reached round 4 in ${st.actions} actions`);
      assert.match(await hint(), /ordinary pick/);
      assert.equal(await page.evaluate(() => localStorage.getItem('jd.onboarded.v1')), '1', 'finishing the lesson marks the profile onboarded');
      assert.equal((await api('tips')).open, false, 'no modal or panel interrupted the lesson');
      await page.goto(`${URL}/?dev=1`);
      await page.waitForFunction(() => window.__jdGame && window.__jdGame.scene.isActive('Title'), null, { timeout: 15000 });
      assert.equal(await page.getByTestId('learn').textContent(), 'Learn (3 min)', 'afterwards the lesson stays offered, unhighlighted');
      assert.deepEqual(errors, [], 'no page errors');
      await context.close();
    }
    // 7) dom_overlay_tracks_the_canvas (DOSSIER-v1 0.4.0): at 1280x800 and 1920x1080 the DOM title covers exactly the
    //    FIT-scaled canvas and no control leaves it; the results screen does the same
    for (const vp of [{ width: 1280, height: 800 }, { width: 1920, height: 1080 }]) {
      const context = await browser.newContext({ viewport: vp });
      const page = await context.newPage();
      await page.goto(`${URL}/?dev=1`);
      await page.waitForFunction(() => window.__jdGame && window.__jdGame.scene.isActive('Title') && document.querySelector('#ui .jd-screen'), null, { timeout: 15000 });
      await wait(300);
      const geo = await page.evaluate(() => { const c = document.querySelector('canvas').getBoundingClientRect(); const u = document.getElementById('ui').getBoundingClientRect(); const s = document.querySelector('#ui .jd-screen'); const outside = [...document.querySelectorAll('#ui [data-testid]')].filter((el) => { const r = el.getBoundingClientRect(); return r.left < u.left - 1 || r.right > u.right + 1 || r.top < u.top - 1 || r.bottom > u.bottom + 1; }).map((el) => el.dataset.testid); return { dx: Math.abs(c.left - u.left) + Math.abs(c.top - u.top), dw: Math.abs(c.width - u.width) + Math.abs(c.height - u.height), k: getComputedStyle(document.getElementById('ui')).getPropertyValue('--k').trim(), outside, scroll: s.scrollHeight - s.clientHeight }; });
      assert.ok(geo.dx < 1.5 && geo.dw < 1.5, `overlay matches the canvas at ${vp.width}x${vp.height}: ${JSON.stringify(geo)}`);
      assert.ok(Math.abs(Number(geo.k) - Math.min(vp.width / 1120, vp.height / 700)) < 0.01, `--k follows the FIT scale (${geo.k})`);
      assert.deepEqual(geo.outside, [], 'no title control leaves the overlay');
      assert.ok(geo.scroll <= 1, 'the title does not scroll');
      await context.close();
    }
    // 7b) reduced_audio_one_sound_per_tick (DOSSIER-v1 0.4.9): with reduced audio on, no tick ever asks for more than one sound;
    //     the bus controls persist their levels
    {
      const context = await browser.newContext({ viewport: { width: 1120, height: 700 } });
      const page = await context.newPage();
      await page.addInitScript(() => { try { localStorage.setItem('jd.settings.v1', JSON.stringify({ volume: 0.7, muted: false, reducedMotion: false, textScale: 1, renderQuality: 'auto', telemetry: false, buses: { ui: 1, factory: 0.4, music: 1 }, reducedAudio: true })); } catch {} });
      await page.goto(`${URL}/?dev=1&scene=game&seed=auto-12`);
      await page.waitForFunction(() => !!window.__jd && window.__jd.phase() === 'draft', null, { timeout: 15000 });
      const api = (fn, ...args) => page.evaluate(({ fn, args }) => window.__jd[fn](...args), { fn, args });
      await api('pick', 0); await api('run');
      await page.getByTestId('speed-4').click();
      await page.waitForFunction(() => window.__jd.mode() === 'summary', null, { timeout: 30000 });
      const a = await api('audio');
      assert.equal(a.reducedAudio, true); assert.equal(a.buses.factory, 0.4, 'bus levels load from settings');
      assert.ok(a.ticks >= 80 && a.maxPerTick <= 1 && a.chords === 0, `reduced audio: ${JSON.stringify(a)}`);
      assert.deepEqual([a.hum.on, a.hum.starts], [false, 0], 'reduced audio never starts the hum');
      assert.equal(a.samples.played, 0, 'reduced audio is synth-only: no impact samples');
      await context.close();
      const c2 = await browser.newContext({ viewport: { width: 1120, height: 700 } });
      const p2 = await c2.newPage();
      await p2.goto(`${URL}/?dev=1`);
      await p2.waitForFunction(() => window.__jdGame && window.__jdGame.scene.isActive('Title'), null, { timeout: 15000 });
      await p2.getByTestId('audio-buses').locator('summary').click();
      await p2.getByTestId('bus-music').fill('0.25');
      await p2.getByTestId('reduced-audio').click();
      const saved = JSON.parse(await p2.evaluate(() => localStorage.getItem('jd.settings.v1')));
      assert.equal(saved.buses.music, 0.25); assert.equal(saved.reducedAudio, true);
      assert.equal(await p2.getByTestId('reduced-audio').textContent(), 'Reduced audio: On');
      await c2.close();
    }
    // 7e) reroll_button (rules v3, PLAN-v2 0.5.4): disabled while unaffordable in round 1, buys new offers once in round 2 for the cost, then disables
    {
      const { context, page, api, errors } = await open('seed=reroll-e2e');
      assert.equal(await page.evaluate(() => document.querySelector('[data-testid=reroll]')?.disabled), true, 'round 1: nothing earned yet, so no reroll');
      assert.match(await page.evaluate(() => document.querySelector('[data-testid=reroll-note]')?.textContent ?? ''), /cost/);
      const st0 = await api('state'); await api('pick', Math.max(0, st0.offers.indexOf('crusher')));
      const st1 = await api('state'); const old = st1.layout.machines.find((m) => m.x === 2 && m.y === 2); const pick = st1.bin[st1.bin.length - 1];
      await api('act', { t: 'unplace', id: old.id }); await api('act', { t: 'place', id: pick.id, x: 2, y: 2, dir: 0 });
      await api('run'); await api('finishRun');
      await page.waitForFunction(() => window.__jd.mode() === 'summary', null, { timeout: 15000 });
      await api('next'); await wait(200);
      const before = await api('state');
      assert.equal(before.phase, 'draft'); assert.ok(before.score >= 40, `a crusher round affords a reroll (${before.score})`);
      assert.equal(await page.evaluate(() => document.querySelector('[data-testid=reroll]')?.disabled), false, 'affordable: enabled');
      await page.getByTestId('reroll').click(); await wait(200);
      const after = await api('state');
      assert.equal(after.score, before.score - 40, 'the cost left the score'); assert.equal(after.rerolls, 1); assert.notDeepEqual(after.offers, before.offers, 'new offers on the cards');
      assert.equal(await page.evaluate(() => document.querySelector('[data-testid=hud-score]')?.textContent), `$${after.score}`, 'the HUD shows the deducted score');
      assert.equal(await page.evaluate(() => document.querySelector('[data-testid=reroll]')?.disabled), true, 'once per round');
      assert.match(await page.evaluate(() => document.querySelector('[data-testid=reroll-note]')?.textContent ?? ''), /once per round/);
      assert.deepEqual(errors, [], 'no page errors');
      await context.close();
    }
    // 7d) impact_samples_under_the_synth (DOSSIER-v1 0.4.13): both WAVs load through the boot loader, decode once a context
    //     exists, and the dock clink plays during a normal round; a blocked file falls back to synth-only without errors
    {
      const { context, page, api, errors } = await open('seed=auto-12');
      await api('pick', 0); await api('run');
      await page.getByTestId('speed-4').click();
      await page.waitForFunction(() => window.__jd.mode() === 'summary', null, { timeout: 30000 });
      const s = (await api('audio')).samples;
      assert.deepEqual({ loaded: s.loaded, missing: s.missing, failed: s.failed }, { loaded: 2, missing: [], failed: [] }, JSON.stringify(s));
      assert.ok(s.played >= 1, `the clink played with the ships (${s.played})`);
      assert.deepEqual(errors, [], 'no page errors');
      await context.close();
      const c2 = await browser.newContext({ viewport: { width: 1120, height: 700 } });
      const p2 = await c2.newPage();
      const errs2 = []; p2.on('pageerror', (e) => errs2.push(String(e)));
      await p2.route('**/sfx/press.wav', (route) => route.fulfill({ status: 404, body: 'gone' }));
      await p2.goto(`${URL}/?dev=1&scene=game&seed=auto-12`);
      await p2.waitForFunction(() => !!window.__jd && window.__jd.phase() === 'draft', null, { timeout: 15000 });
      await p2.evaluate(() => { window.__jd.pick(0); window.__jd.run(); });
      await p2.getByTestId('speed-4').click();
      await p2.waitForFunction(() => window.__jd.mode() === 'summary', null, { timeout: 30000 });
      const s2 = await p2.evaluate(() => window.__jd.audio().samples);
      assert.deepEqual({ loaded: s2.loaded, missing: s2.missing }, { loaded: 1, missing: ['press'] }, JSON.stringify(s2));
      assert.ok(s2.played >= 1, 'the ship clink still plays when the press file is missing');
      assert.deepEqual(errs2, [], 'a missing sample is not an error');
      await c2.close();
    }
    // 7c) throughput_hum_follows_the_line (DOSSIER-v1 0.4.10): no music during build; the drone starts at run on the round's
    //     root, detunes while the head-on belt jams with its cutoff inside 300 Hz – 2 kHz, and stops at the summary
    {
      const { context, page, api, errors } = await open('seed=stall-seed');
      assert.equal((await api('audio')).hum.on, false, 'no music during build');
      await api('pick', 0);
      const st = await api('state');
      const conv = st.layout.machines.find((m) => m.x === 3 && m.y === 2);
      assert.ok(await api('act', { t: 'rotate', id: conv.id })); assert.ok(await api('act', { t: 'rotate', id: conv.id }));
      await api('run');
      const started = await (await page.waitForFunction(() => { const h = window.__jd.audio().hum; return h.on ? h : false; }, null, { timeout: 5000 })).jsonValue();
      assert.ok(started.root > 130 && started.root < 132, `round 1 root is C3: ${started.root}`);
      await page.getByTestId('speed-4').click();
      const jammed = await (await page.waitForFunction(() => { const h = window.__jd.audio().hum; return h.detuned ? h : false; }, null, { timeout: 15000 })).jsonValue();
      assert.ok(jammed.on && jammed.freq > jammed.root && jammed.cutoff >= 300 && jammed.cutoff <= 2000, `a jam detunes the drone: ${JSON.stringify(jammed)}`);
      await api('finishRun');
      await page.waitForFunction(() => window.__jd.mode() === 'summary', null, { timeout: 15000 });
      const after = (await api('audio')).hum;
      assert.deepEqual([after.on, after.starts], [false, 1], 'the hum stops at the summary');
      assert.deepEqual(errors, [], 'no page errors');
      await context.close();
    }
    // 8) art_atlas_aliases_every_key (DOSSIER-v1 0.4.8): the SVG set loads, packs into one texture, every scene key is an
    //    alias into it, the texture-key snapshot is unchanged, and a missing file falls back to the procedural generator
    {
      const context = await browser.newContext({ viewport: { width: 1120, height: 700 } });
      const page = await context.newPage();
      const errors = []; page.on('pageerror', (e) => errors.push(String(e)));
      await page.goto(`${URL}/?dev=1&scene=game&seed=atlas-seed`);
      await page.waitForFunction(() => !!window.__jd && window.__jd.phase() === 'draft', null, { timeout: 15000 });
      const art = await page.evaluate(() => { const tm = window.__jdGame.textures; const keys = ['tile', 'tile-ok', 'tile-bad', 'tile-sel', 'tile-cursor', 'm-conveyor', 'm-hopper', 'm-crusher', 'm-crusher-1', 'm-furnace', 'm-press', 'm-press-1', 'm-press-2', 'm-splitter', 'm-dock', 'm-tuner', 'belt-0', 'belt-1', 'belt-2', 'belt-3', 'belt-4', 'belt-5', 'belt-6', 'belt-7', 'i-scrap', 'i-shards', 'i-plate', 'i-ingot', 'i-slag', 'dot', 'px']; const atlasSrc = tm.get('art').source[0]; return { status: window.__jdArt, allExist: keys.every((k) => tm.exists(k)), shared: keys.filter((k) => k !== 'dot' && k !== 'px').every((k) => tm.get(k).source[0] === atlasSrc), crusherCut: (() => { const f = tm.getFrame('m-crusher'); return [f.cutWidth, f.cutHeight]; })(), plateCut: (() => { const f = tm.getFrame('i-plate'); return [f.cutWidth, f.cutHeight]; })(), base64: tm.getBase64('m-crusher').slice(0, 22) }; });
      assert.deepEqual({ built: art.status.built, packed: art.status.packed.length, missing: art.status.missing, allExist: art.allExist, shared: art.shared, crusherCut: art.crusherCut, plateCut: art.plateCut }, { built: true, packed: 29, missing: [], allExist: true, shared: true, crusherCut: [72, 72], plateCut: [24, 24] }, JSON.stringify(art));
      assert.equal(art.base64, 'data:image/png;base64,', 'frame-aware base64 export still works for the DOM');
      assert.deepEqual(errors, [], 'no page errors with the atlas');
      await context.close();
      // fallback: block one SVG; the key still exists (generated) and the rest still pack
      const c2 = await browser.newContext({ viewport: { width: 1120, height: 700 } });
      const p2 = await c2.newPage();
      await p2.route('**/art/m-press.svg', (route) => route.fulfill({ status: 404, body: 'gone' }));
      await p2.goto(`${URL}/?dev=1&scene=game&seed=atlas-seed`);
      await p2.waitForFunction(() => !!window.__jd && window.__jd.phase() === 'draft', null, { timeout: 15000 });
      const fb = await p2.evaluate(() => ({ status: window.__jdArt, pressExists: window.__jdGame.textures.exists('m-press'), pressShared: window.__jdGame.textures.get('m-press').source[0] === window.__jdGame.textures.get('art').source[0] }));
      assert.deepEqual({ built: fb.status.built, packed: fb.status.packed.length, missing: fb.status.missing, pressExists: fb.pressExists, pressShared: fb.pressShared }, { built: true, packed: 28, missing: ['m-press'], pressExists: true, pressShared: false }, JSON.stringify(fb));
      await c2.close();
      // 8b) hidpi_atlas_keeps_logical_size (DOSSIER-v1 0.4.8b): at ?dpr=2 the atlas is twice the 1x snapshot and every packed
      //     frame is cut at 2x, yet machines, items and tiles display at their logical 72 / 24 px; a procedural fallback stays 1x
      const c3 = await browser.newContext({ viewport: { width: 1120, height: 700 }, deviceScaleFactor: 2 });
      const p3 = await c3.newPage();
      await p3.route('**/art/m-dock.svg', (route) => route.fulfill({ status: 404, body: 'gone' }));
      await p3.goto(`${URL}/?dev=1&scene=game&seed=atlas-seed&dpr=2`);
      await p3.waitForFunction(() => !!window.__jd && window.__jd.phase() === 'draft', null, { timeout: 15000 });
      await p3.evaluate(() => window.__jd.pick(0));
      const hi = await p3.evaluate(() => {
        const g = window.__jdGame; const tm = g.textures; const scene = g.scene.getScene('Game');
        const imgs = []; const walk = (list) => { for (const o of list) { if (o.type === 'Image') imgs.push(o); if (o.list) walk(o.list); } }; walk(scene.children.list);
        const by = (prefix) => imgs.find((o) => o.texture.key.startsWith(prefix));
        const m = by('m-'); const tile = by('tile');
        const dock = tm.exists('m-dock') ? tm.getFrame('m-dock') : null;
        return { status: window.__jdArt, crusherCut: [tm.getFrame('m-crusher').cutWidth, tm.getFrame('m-crusher').cutHeight], plateCut: tm.getFrame('i-plate').cutWidth,
          machine: m && [m.texture.key, m.displayWidth, m.displayHeight], tile: tile && [tile.displayWidth, tile.displayHeight], dockCut: dock && dock.cutWidth, dockShared: tm.get('m-dock').source[0] === tm.get('art').source[0] };
      });
      assert.deepEqual({ built: hi.status.built, scale: hi.status.scale, packed: hi.status.packed.length, atlas: hi.status.atlas, crusherCut: hi.crusherCut, plateCut: hi.plateCut, machine: hi.machine && hi.machine.slice(1), tile: hi.tile, dockCut: hi.dockCut, dockShared: hi.dockShared },
        { built: true, scale: 2, packed: 28, atlas: { width: art.status.atlas.width * 2, height: art.status.atlas.height * 2 }, crusherCut: [144, 144], plateCut: 48, machine: [72, 72], tile: [72, 72], dockCut: 72, dockShared: false }, JSON.stringify(hi));
      assert.ok(hi.machine && hi.machine[0].startsWith('m-'), 'a machine sprite is on screen');
      await c3.close();
    }
  } finally {
    if (browser) await browser.close();
    server.kill();
  }
});
