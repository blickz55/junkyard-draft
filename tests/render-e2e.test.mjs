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
const PORT = 5198;
const URL = `http://127.0.0.1:${PORT}`;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const CELL = 72, GX = 32, GY = 72, BIN_Y = 520;
const cell = (x, y) => ({ x: GX + x * CELL + CELL / 2, y: GY + y * CELL + CELL / 2 });

async function waitServer() { for (let i = 0; i < 60; i++) { try { const r = await fetch(`${URL}/main.js`); if (r.ok) return; } catch {} await wait(500); } throw new Error('dev server did not start'); }

test('renderer: HiDPI canvas, Canvas renderer, WebGL context loss', { timeout: 180000 }, async () => {
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
  } finally {
    if (browser) await browser.close();
    server.kill();
  }
});
