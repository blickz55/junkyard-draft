/**
 * Render-cost probe (companion to perf.ts): WebGL draw calls per frame, texture binds, game objects, JS heap,
 * boot time to the dev API, during the busiest round at 4x on the autoplayer's best seed layout.
 * Run: node --import tsx tools/render-probe.ts [--url http://127.0.0.1:5173] [--seed auto-12]
 */
import { chromium, type Page } from 'playwright';
import { Rng } from '../game/src/sim/rng';
import { playSeed } from '../tools/autoplay-lib';
import type { Action } from '../game/src/sim/run';

const args = process.argv.slice(2);
const opt = (k: string, d: string) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };
const URL = opt('url', 'http://127.0.0.1:5173');
const SEED = opt('seed', 'auto-12');
const api = (page: Page, fn: string, ...a: unknown[]) => page.evaluate(`window.__jd[${JSON.stringify(fn)}](...${JSON.stringify(a)})`);

const { report, actions } = playSeed(SEED, new Rng(`${SEED}:search`), 120);
console.error(`autoplayer seed ${SEED} score $${report.score}`);

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1120, height: 700 } });
const page = await context.newPage();
page.on('pageerror', (e) => console.error('PAGEERROR', String(e)));

// hook WebGL draw calls before the game boots
await page.addInitScript(`(() => {
  const w = window; w.__gl = { draws: 0, binds: 0, frames: 0 };
  const wrap = (proto) => {
    if (!proto) return;
    for (const name of ['drawElements', 'drawArrays']) { const o = proto[name]; proto[name] = function (...a) { w.__gl.draws++; return o.apply(this, a); }; }
    const b = proto.bindTexture; proto.bindTexture = function (...a) { w.__gl.binds++; return b.apply(this, a); };
  };
  wrap(w.WebGLRenderingContext && w.WebGLRenderingContext.prototype);
  wrap(w.WebGL2RenderingContext && w.WebGL2RenderingContext.prototype);
  w.__t0 = performance.now();
})()`);

// 1) boot: time until the dev API exists on the title, and texture count
const tBoot0 = Date.now();
await page.goto(`${URL}/?dev=1`);
await page.waitForFunction("!!window.__jdGame && window.__jdGame.scene.isActive('Title')", null, { timeout: 20000 });
const boot = await page.evaluate(`({ msToDevApi: Math.round(performance.now() - window.__t0), domContentLoaded: Math.round(performance.timing.domContentLoadedEventEnd - performance.timing.navigationStart), textures: Object.keys(window.__jdGame.textures.list).length, renderer: window.__jdGame.renderer.type === 2 ? 'webgl' : 'canvas', heapMB: performance.memory ? +(performance.memory.usedJSHeapSize / 1048576).toFixed(1) : null })`);
console.error('boot', JSON.stringify(boot), 'wall', Date.now() - tBoot0);

// 2) title scene steady-state draw calls per frame
const countFrames = async (frames = 60) => page.evaluate(`new Promise((res) => { const w = window; const d0 = w.__gl.draws, b0 = w.__gl.binds; let n = 0; const loop = () => { if (++n >= ${frames}) res({ drawsPerFrame: +((w.__gl.draws - d0) / n).toFixed(1), bindsPerFrame: +((w.__gl.binds - b0) / n).toFixed(1) }); else requestAnimationFrame(loop); }; requestAnimationFrame(loop); })`);
const title = await countFrames();
console.error('title', JSON.stringify(title));

// 3) game scene: drive to the last round, count objects, then measure during the run at 4x
await page.goto(`${URL}/?dev=1&scene=game&seed=${encodeURIComponent(SEED)}`);
await page.waitForFunction("!!window.__jd && window.__jd.phase() === 'draft'", null, { timeout: 20000 });
const lastRun = actions.map((a: Action) => a.t).lastIndexOf('run');
for (const a of actions.slice(0, lastRun)) {
  if (a.t === 'run') { await api(page, 'run'); await api(page, 'finishRun'); await page.waitForFunction("window.__jd.mode() === 'summary'"); }
  else if (a.t === 'next') await api(page, 'next');
  else { const ok = await api(page, 'act', a); if (!ok) throw new Error('rejected ' + JSON.stringify(a)); }
}
const build = await page.evaluate(`(() => { const s = window.__jdGame.scene.getScene('Game'); const list = s.children.list; const by = {}; for (const o of list) by[o.type] = (by[o.type] || 0) + 1; return { objects: list.length, byType: by, machines: window.__jd.state().layout.machines.length, heapMB: performance.memory ? +(performance.memory.usedJSHeapSize / 1048576).toFixed(1) : null }; })()`);
console.error('build phase', JSON.stringify(build));
const buildDraws = await countFrames();
console.error('build draws', JSON.stringify(buildDraws));

await page.evaluate(`(() => { const w = window; w.__jd.run(); const btn = w.__jdGame.scene.getScene('Game').side.getByName('speed-4'); if (btn) btn.emit('pointerdown'); w.__run = { frames: 0, draws: w.__gl.draws, binds: w.__gl.binds, maxObjects: 0, maxItems: 0, texts: 0 }; const s = w.__jdGame.scene.getScene('Game'); const loop = () => { w.__run.frames++; w.__run.maxObjects = Math.max(w.__run.maxObjects, s.children.list.length); if (s.sim) w.__run.maxItems = Math.max(w.__run.maxItems, s.sim.items.length); if (w.__jd.mode() === 'running') requestAnimationFrame(loop); }; requestAnimationFrame(loop); })()`);
await page.waitForFunction("window.__jd.mode() === 'summary'", null, { timeout: 120000 });
const run = await page.evaluate(`(() => { const w = window; const r = w.__run; return { frames: r.frames, drawsPerFrame: +((w.__gl.draws - r.draws) / r.frames).toFixed(1), bindsPerFrame: +((w.__gl.binds - r.binds) / r.frames).toFixed(1), maxObjects: r.maxObjects, maxItems: r.maxItems, heapMB: performance.memory ? +(performance.memory.usedJSHeapSize / 1048576).toFixed(1) : null }; })()`);
console.error('run 4x', JSON.stringify(run));

// 4) summary screen objects
const summary = await page.evaluate(`(() => { const s = window.__jdGame.scene.getScene('Game'); const by = {}; for (const o of s.children.list) by[o.type] = (by[o.type] || 0) + 1; return { objects: s.children.list.length, byType: by }; })()`);
console.log(JSON.stringify({ seed: SEED, boot, title, build, buildDraws, run, summary }, null, 1));
await browser.close();
