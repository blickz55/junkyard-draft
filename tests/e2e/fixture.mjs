// The browser tests' fixture (production roadmap 0.9.5): one dev server, and when asked one verifier, per test file on free
// ports; a shared Chromium; page helpers that wait for a condition instead of sleeping. The only sleeps in the browser tests
// live here: the pollers below, and `settle(ms, why)` for the rare check whose point is that time passes.
import { spawn } from 'node:child_process';
import net from 'node:net';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const SHOTS = path.join(ROOT, '.control-room', 'screenshots');
if (!process.env.PLAYWRIGHT_BROWSERS_PATH && fs.existsSync('/opt/pw-browsers')) process.env.PLAYWRIGHT_BROWSERS_PATH = '/opt/pw-browsers'; // sandbox only; elsewhere Playwright's default cache is used
export const { chromium, firefox, webkit } = await import('playwright');

/** The logical canvas: cell size and the grid's and shelf's origins (render/layout.ts), for pointer coordinates. */
export const CELL = 72,
  GX = 32,
  GY = 72,
  BIN_Y = 520;
export const cellCenter = (x, y) => ({ x: GX + x * CELL + CELL / 2, y: GY + y * CELL + CELL / 2 });
export const binSlotCenter = (i) => ({ x: GX + 12 + i * (CELL + 8) + CELL / 2, y: BIN_Y + 28 + CELL / 2 });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** A deliberate pause whose reason is part of the test (a toast that must outlive a timer, a rate bucket); never "let it settle". */
export async function settle(ms, why) {
  if (!why) throw new Error('settle(ms, why): say what the time is for');
  await sleep(ms);
}

/** Poll an async condition until it answers something truthy; the answer is returned. */
export async function until(fn, { timeout = 15000, every = 50, what = 'a condition' } = {}) {
  const t0 = Date.now();
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() - t0 > timeout) throw new Error(`timed out after ${timeout} ms waiting for ${what}`);
    await sleep(every);
  }
}
const ok = async (url) => {
  try {
    return (await fetch(url)).ok;
  } catch {
    return false;
  }
};

export function freePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.once('error', reject);
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });
}

/** The game's dev server (scripts/dev.mjs) on a free port, ready once /main.js answers. */
export async function startDevServer({ port } = {}) {
  port ??= await freePort();
  const url = `http://127.0.0.1:${port}`;
  const proc = spawn(process.execPath, [path.join(ROOT, 'scripts/dev.mjs')], { env: { ...process.env, GAME_PORT: String(port) }, stdio: 'ignore' });
  await until(() => ok(`${url}/main.js`), { timeout: 60000, every: 500, what: 'the dev server' });
  return { port, url, proc, stop: () => proc.kill('SIGTERM') };
}

/** The verifier (server/verify.ts) on a free port with a scratch data directory, generous read/write limits, ready once /health answers. */
export async function startVerifier({ port, env = {}, dataDir } = {}) {
  port ??= await freePort();
  dataDir ??= fs.mkdtempSync(path.join(ROOT, 'tools', 'scratch-'));
  const boardFile = path.join(dataDir, 'board.json');
  const url = `http://127.0.0.1:${port}`;
  const proc = spawn(process.execPath, ['--import', 'tsx', path.join(ROOT, 'server/verify.ts')], {
    env: { ...process.env, PORT: String(port), BOARD_FILE: boardFile, READ_RATE_LIMIT: '100000', WRITE_RATE_LIMIT: '100000', ...env },
    stdio: 'ignore',
  });
  await until(() => ok(`${url}/health`), { timeout: 60000, every: 300, what: 'the verifier' });
  const json = async (p, init) => (await fetch(`${url}${p}`, init)).json();
  return {
    port,
    url,
    proc,
    boardFile,
    dataDir,
    json,
    stop: () => {
      proc.kill('SIGTERM');
      fs.rmSync(dataDir, { recursive: true, force: true });
    },
  };
}

/**
 * One fixture per file: the dev server, optionally a verifier, a Chromium. `page()` opens a context and page with the test
 * viewport and collects page errors and console errors; `close()` stops everything (call it from `after`).
 */
export async function fixture({ verifier = false, verifierEnv = {}, browser: engine = chromium, launch = {} } = {}) {
  const [server, ver] = await Promise.all([startDevServer(), verifier ? startVerifier({ env: verifierEnv }) : null]);
  const browser = await engine.launch(launch);
  const pages = [];
  const f = {
    server,
    verifier: ver,
    browser,
    url: server.url,
    vurl: ver?.url ?? 'http://127.0.0.1:9', // port 9 (discard) answers nobody: the offline fallback
    /** A page in its own context, with `errors` collected, `ctx` (its context) and `jd` (the helpers below) (console errors that are connection refusals to port 9 are the offline fallback, not errors). */
    async page({ viewport = { width: 1120, height: 700 }, bypassCSP = true, ...ctxOpts } = {}, { init } = {}) {
      const context = await browser.newContext({ viewport, bypassCSP, ...ctxOpts });
      if (init) await context.addInitScript(init.fn ?? init, init.arg);
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', (e) => errors.push(String(e)));
      page.on('console', (m) => {
        if (m.type() === 'error' && !/ERR_CONNECTION_REFUSED|ERR_UNSAFE_PORT/.test(m.text())) errors.push(m.text());
      });
      pages.push(context);
      return Object.assign(page, { errors, ctx: context, jd: helpers(page) }); // never shadow a Playwright method (page.context(), page.title())
    },
    /** A game URL on this fixture: `/?dev=1&verifier=<vurl>` plus the given query. */
    gameUrl(query = '') {
      return `${server.url}/?dev=1&verifier=${f.vurl}${query ? `&${query}` : ''}`;
    },
    async close() {
      for (const c of pages.splice(0)) await c.close().catch(() => {});
      await browser.close().catch(() => {});
      server.stop();
      ver?.stop();
    },
  };
  return f;
}

/** Page helpers: the dev API, scene and mode waits, frame waits (a DOM change the game makes synchronously is visible after a frame or two). */
export function helpers(page) {
  const h = {
    /** window.__jd[fn](...args) */
    api: (fn, ...args) => page.evaluate(({ fn, args }) => window.__jd[fn](...args), { fn, args }),
    /** n animation frames in the page: the game's synchronous reaction to an input has been drawn */
    frames: (n = 2) =>
      page.evaluate(
        (k) =>
          new Promise((r) => {
            const step = () => (k-- > 0 ? requestAnimationFrame(step) : r());
            step();
          }),
        n,
      ),
    /** waitForFunction with the usual budget */
    when: (fn, arg = null, timeout = 15000) => page.waitForFunction(fn, arg, { timeout }),
    title: (timeout = 15000) => page.waitForFunction(() => window.__jdGame && window.__jdGame.scene.isActive('Title'), null, { timeout }),
    draft: (timeout = 15000) => page.waitForFunction(() => !!window.__jd && window.__jd.phase() === 'draft', null, { timeout }),
    results: (timeout = 15000) =>
      page.waitForFunction(() => window.__jdGame && window.__jdGame.scene.isActive('Results') && !!document.querySelector('[data-testid=status]'), null, {
        timeout,
      }),
    mode: (m, timeout = 15000) => page.waitForFunction((mm) => !!window.__jd && window.__jd.mode() === mm, m, { timeout }),
    /** the draft of a given round, or the results screen when the run is over */
    draftRound: (r, timeout = 15000) =>
      page.waitForFunction(
        (rr) =>
          (!!window.__jd && window.__jd.phase() === 'draft' && window.__jd.state().round === rr) ||
          (window.__jdGame && window.__jdGame.scene.isActive('Results')),
        r,
        { timeout },
      ),
    /** the live sim reached a tick */
    tick: (n, timeout = 30000) => page.waitForFunction((t) => !!window.__jd && window.__jd.stall().tick >= t, n, { timeout }),
    /** an element's text matches */
    textMatches: (tid, re, timeout = 15000) =>
      page.waitForFunction(
        ({ tid, src, flags }) => new RegExp(src, flags).test(document.querySelector(`[data-testid=${tid}]`)?.textContent || ''),
        { tid, src: re.source, flags: re.flags },
        { timeout },
      ),
    text: (tid) => page.evaluate((t) => document.querySelector(`[data-testid=${t}]`)?.textContent ?? null, tid),
    /** the DOM overlay covers the FIT-scaled canvas and its scale variable matches (after a resize or a scene restart) */
    overlaySynced: (timeout = 8000) =>
      page.waitForFunction(
        () => {
          const ui = document.getElementById('ui'),
            c = document.querySelector('canvas');
          if (!ui || !c) return false;
          const u = ui.getBoundingClientRect(),
            r = c.getBoundingClientRect();
          if (!r.width) return false;
          const k = parseFloat(getComputedStyle(ui).getPropertyValue('--k'));
          return (
            Math.abs(u.left - r.left) < 1 &&
            Math.abs(u.top - r.top) < 1 &&
            Math.abs(u.width - r.width) < 1 &&
            Math.abs(u.height - r.height) < 1 &&
            Math.abs(k - r.width / 1120) < 0.01
          );
        },
        null,
        { timeout },
      ),
    /** no tween is playing in the Game scene: a dropped or rotated machine has settled into its cell (Phaser's hit test misses a sprite that is still gliding) */
    settled: (timeout = 3000) =>
      page.waitForFunction(
        () => {
          const g = window.__jdGame;
          const sc = g && g.scene.getScene('Game');
          return !sc || !sc.scene.isActive() || sc.tweens.getTweens().every((t) => !t.isPlaying());
        },
        null,
        { timeout },
      ),
    /** a real pointer drag from one canvas point to another; the drop's effect is visible once the view has settled */
    drag: async (from, to) => {
      await page.mouse.move(from.x, from.y);
      await page.mouse.down();
      await page.mouse.move(from.x + 10, from.y + 10, { steps: 3 });
      await page.mouse.move(to.x, to.y, { steps: 12 });
      await page.mouse.up();
      await h.frames(2);
      await h.settled();
    },
    /** a copy button was pressed: without a clipboard (headless) the select-and-copy dialog opens (review F04): close it like a player would; with one, the button said Copied! */
    dismissCopyDialog: async () => {
      await page.waitForFunction(
        () => !!document.querySelector('[data-testid=dialog]') || [...document.querySelectorAll('button')].some((b) => b.textContent === 'Copied!'),
        null,
        { timeout: 5000 },
      );
      if (await page.locator('[data-testid=dialog]').count()) {
        await page.getByTestId('dialog-ok').click();
        await page.waitForSelector('[data-testid=dialog]', { state: 'detached', timeout: 5000 });
      }
    },
    /** the dialog is gone */
    noDialog: (tid = 'dialog', timeout = 5000) => page.waitForSelector(`[data-testid=${tid}]`, { state: 'detached', timeout }),
  };
  return h;
}
