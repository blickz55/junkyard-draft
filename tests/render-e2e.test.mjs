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
      await page.evaluate(() => { const b = window.__jdGame.scene.getScene('Game').side.getByName('speed-4'); if (b) b.emit('pointerdown'); });
      const seen = await page.waitForFunction(() => { const s = window.__jd.stall(); return s.text ? s : false; }, null, { timeout: 15000 });
      const stall = await seen.jsonValue();
      assert.match(stall.text, /^Stalled: [A-Za-z ]+ at \d,\d is (waiting|blocked) — nothing shipped for 8 ticks$/, stall.text);
      assert.ok(stall.tick <= 10, `flagged by tick ${stall.tick}`);
      assert.ok([2 * 8 + 1, 2 * 8 + 2].includes(stall.cell), `first blocking cell is the hopper (1,2) or the conveyor in front of the head-on belt (2,2): got ${stall.cell}`);
      const hud = await page.evaluate(() => { const s = window.__jdGame.scene.getScene('Game'); return { score: s.children.list.find((o) => o.type === 'Text' && /^\$\d+$/.test(o.text))?.text, mark: !!s.children.getByName('stall-mark')?.visible }; });
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
      const btnText = () => page.evaluate(() => window.__jdGame.scene.getScene('Game').side.getByName('tips')?.label.text ?? null);
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
    }
    // 6) tutorial_seed_teaches_one_rule_per_round (PLAN-v1 0.3.4): a fresh profile sees Learn first; the scripted lesson reaches
    //    round 4 in <= 40 actions with the hint strip as the only guidance surface; finishing round 3 marks the profile onboarded
    {
      const context = await browser.newContext({ viewport: { width: 1120, height: 700 } });
      const page = await context.newPage();
      const errors = []; page.on('pageerror', (e) => errors.push(String(e)));
      await page.goto(`${URL}/?dev=1`);
      await page.waitForFunction(() => window.__jdGame && window.__jdGame.scene.isActive('Title'), null, { timeout: 15000 });
      const learn = await page.evaluate(() => { const b = window.__jdGame.scene.getScene('Title').children.getByName('learn'); return { text: b?.label.text, amber: b?.bg.fillColor === 0xf0a030 || b?.bg.fillColor === window.__jdGame.scene.getScene('Title').children.getByName('daily').bg.fillColor }; });
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
      assert.match(await hint(), /ordinary draft/);
      assert.equal(await page.evaluate(() => localStorage.getItem('jd.onboarded.v1')), '1', 'finishing the lesson marks the profile onboarded');
      assert.equal((await api('tips')).open, false, 'no modal or panel interrupted the lesson');
      await page.goto(`${URL}/?dev=1`);
      await page.waitForFunction(() => window.__jdGame && window.__jdGame.scene.isActive('Title'), null, { timeout: 15000 });
      assert.equal(await page.evaluate(() => window.__jdGame.scene.getScene('Title').children.getByName('learn')?.label.text), 'Learn (3 min)', 'afterwards the lesson stays offered, unhighlighted');
      assert.deepEqual(errors, [], 'no page errors');
      await context.close();
    }
  } finally {
    if (browser) await browser.close();
    server.kill();
  }
});
