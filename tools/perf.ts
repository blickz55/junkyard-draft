/**
 * Frame-time and render-cost probe. Plays a strong autoplayer run (legal actions only, through the dev API)
 * up to its busiest final round, then samples requestAnimationFrame deltas while that round runs at the
 * chosen speed, plus the renderer's CPU time per frame (CDP Performance metrics), WebGL draw calls and
 * texture binds per frame, game-object and Text-object counts, and the JS heap.
 *
 * Reports, for each environment:
 *   frame p50 / p95 / max (ms, vsync-bound: 16.7 at 60 Hz), dropped frames (> 25 ms), cpuMsPerFrame and
 *   scriptMsPerFrame (CDP TaskDuration / ScriptDuration ÷ frames), drawsPerFrame, bindsPerFrame,
 *   maxObjects (display list peak), textObjectsCreated (scene.add.text calls during the run), heapMB.
 *
 *   node --import tsx tools/perf.ts [--url http://127.0.0.1:5173] [--seed auto-12] [--speed 4] [--throttle 4]
 *                                    [--device A|B|C|D] [--renderer webgl|canvas|both] [--skip-electron] [--json out.json]
 *
 * Default (no --device): Chromium at 1×, Chromium with CPU throttling (--throttle), and the packaged Electron
 * app (release/win-unpacked) when present. With --device, one Chromium sample per renderer on that preset:
 *   A  2017 ultrabook   1920×1080  DPR 1.5  no throttle
 *   B  4 GB Chromebook  1366×768   DPR 1    CPU ×6
 *   C  Steam Deck       1280×800   DPR 1    CPU ×2
 *   D  mid Android      915×412    DPR 2.6  CPU ×4
 * Start the dev server first (npm run dev). Diagnostic evidence only; docs/DOSSIER-v1.md §4 has the budgets.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, _electron as electron, type BrowserContextOptions, type CDPSession, type Page } from 'playwright';
import { Rng } from '../game/src/sim/rng';
import { playSeed } from './autoplay-lib';
import type { Action } from '../game/src/sim/run';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = (k: string, d: string) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };
const URL = opt('url', 'http://127.0.0.1:5173');
const SEED = opt('seed', 'auto-12');
const SPEED = Number(opt('speed', '4'));
const THROTTLE = Number(opt('throttle', '4'));
const JSON_OUT = opt('json', '');
const DEVICE = opt('device', '');
const RENDERER = opt('renderer', DEVICE ? 'both' : 'webgl');
const SKIP_ELECTRON = args.includes('--skip-electron') || !!DEVICE;
const BUDGET_MS = 16.7;
const DROPPED_MS = 25;
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface DevicePreset { width: number; height: number; dpr: number; throttle: number; note: string }
export const DEVICES: Record<string, DevicePreset> = {
  A: { width: 1920, height: 1080, dpr: 1.5, throttle: 1, note: '2017 ultrabook, Intel UHD 620' },
  B: { width: 1366, height: 768, dpr: 1, throttle: 6, note: '4 GB Chromebook, Celeron-class' },
  C: { width: 1280, height: 800, dpr: 1, throttle: 2, note: 'Steam Deck' },
  D: { width: 915, height: 412, dpr: 2.6, throttle: 4, note: 'mid-range Android, landscape' },
};

export interface Sample {
  label: string; renderer: string; frames: number; p50: number; p95: number; max: number; dropped: number;
  cpuMsPerFrame: number | null; scriptMsPerFrame: number | null; drawsPerFrame: number | null; bindsPerFrame: number | null;
  maxObjects: number; textObjectsCreated: number; heapMB: number | null;
  runMs: number; machines: number; peakItems: number; withinBudget: boolean;
}

const q = (sorted: number[], p: number) => sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];

// Browser-side code is passed as source text: tsx wraps inner functions with a `__name` helper that
// does not exist inside the page, so serialized function bodies would throw there.
const api = (page: Page, fn: string, ...a: unknown[]) => page.evaluate(`window.__jd[${JSON.stringify(fn)}](...${JSON.stringify(a)})`);

/** Installed before the game boots: counts WebGL draw calls and texture binds on every context. */
const GL_HOOK = `(() => {
  const w = window; w.__gl = { draws: 0, binds: 0 };
  const wrap = (proto) => {
    if (!proto) return;
    for (const name of ['drawElements', 'drawArrays']) { const o = proto[name]; proto[name] = function (...a) { w.__gl.draws++; return o.apply(this, a); }; }
    const b = proto.bindTexture; proto.bindTexture = function (...a) { w.__gl.binds++; return b.apply(this, a); };
  };
  wrap(w.WebGLRenderingContext && w.WebGLRenderingContext.prototype);
  wrap(w.WebGL2RenderingContext && w.WebGL2RenderingContext.prototype);
})()`;

/** Replays legal actions through the dev API; the last round is left in the build phase, ready to run. */
async function driveToLastRound(page: Page, actions: Action[]) {
  await page.waitForFunction("!!window.__jd && window.__jd.phase() === 'draft'", null, { timeout: 20000 });
  const lastRun = actions.map((a) => a.t).lastIndexOf('run');
  for (const a of actions.slice(0, lastRun)) {
    if (a.t === 'run') { await api(page, 'run'); await api(page, 'finishRun'); await page.waitForFunction("window.__jd.mode() === 'summary'"); }
    else if (a.t === 'next') { await api(page, 'next'); }
    else { const ok = await api(page, 'act', a); if (!ok) throw new Error('action rejected: ' + JSON.stringify(a)); }
  }
}

const SAMPLER = `((speed) => {
  const w = window;
  const s = w.__jdGame.scene.getScene('Game');
  // count Text objects created during the run (each one rasterises a canvas and uploads a texture)
  if (!s.add.__counted) { const orig = s.add.text; s.add.text = function (...a) { w.__texts++; return orig.apply(this, a); }; s.add.__counted = true; }
  w.__texts = 0;
  w.__jd.run();
  const b = document.querySelector('[data-testid=speed-' + speed + ']'); if (b) b.click();
  w.__frames = []; w.__peakItems = 0; w.__maxObjects = 0;
  w.__gl0 = { draws: w.__gl ? w.__gl.draws : 0, binds: w.__gl ? w.__gl.binds : 0 };
  let last = performance.now();
  const loop = (t) => {
    w.__frames.push(t - last); last = t;
    const sim = s.sim; if (sim) w.__peakItems = Math.max(w.__peakItems, sim.items.length);
    w.__maxObjects = Math.max(w.__maxObjects, s.children.list.length);
    if (w.__jd.mode() === 'running') requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
})`;

const RESULT = `({
  frames: window.__frames.slice(3), peakItems: window.__peakItems, maxObjects: window.__maxObjects, texts: window.__texts,
  draws: window.__gl ? window.__gl.draws - window.__gl0.draws : null, binds: window.__gl ? window.__gl.binds - window.__gl0.binds : null,
  heapMB: performance.memory ? +(performance.memory.usedJSHeapSize / 1048576).toFixed(1) : null,
  renderer: window.__jdGame.renderer.type === 2 ? 'webgl' : 'canvas',
})`;

async function metrics(cdp: CDPSession | null): Promise<{ task: number; script: number } | null> {
  if (!cdp) return null;
  try {
    const { metrics } = await cdp.send('Performance.getMetrics');
    const get = (n: string) => metrics.find((m) => m.name === n)?.value ?? 0;
    return { task: get('TaskDuration'), script: get('ScriptDuration') };
  } catch { return null; }
}

async function measure(page: Page, cdp: CDPSession | null, label: string, actions: Action[]): Promise<Sample> {
  await driveToLastRound(page, actions);
  const machines = (await page.evaluate('window.__jd.state().layout.machines.length')) as number;
  await wait(300);
  const m0 = await metrics(cdp);
  await page.evaluate(`${SAMPLER}(${SPEED})`);
  const t0 = Date.now();
  await page.waitForFunction("window.__jd.mode() === 'summary'", null, { timeout: 120000 });
  const runMs = Date.now() - t0;
  const m1 = await metrics(cdp);
  const r = (await page.evaluate(RESULT)) as { frames: number[]; peakItems: number; maxObjects: number; texts: number; draws: number | null; binds: number | null; heapMB: number | null; renderer: string };
  const n = r.frames.length;
  const sorted = r.frames.slice().sort((a, b) => a - b);
  const cpu = m0 && m1 ? +(((m1.task - m0.task) * 1000) / n).toFixed(2) : null;
  const script = m0 && m1 ? +(((m1.script - m0.script) * 1000) / n).toFixed(2) : null;
  const dropped = r.frames.filter((f) => f > DROPPED_MS).length;
  return {
    label, renderer: r.renderer, frames: n, p50: +q(sorted, 0.5).toFixed(2), p95: +q(sorted, 0.95).toFixed(2), max: +sorted[sorted.length - 1].toFixed(2), dropped,
    cpuMsPerFrame: cpu, scriptMsPerFrame: script,
    drawsPerFrame: r.renderer === 'webgl' && r.draws != null ? +(r.draws / n).toFixed(1) : null,
    bindsPerFrame: r.renderer === 'webgl' && r.binds != null ? +(r.binds / n).toFixed(1) : null,
    maxObjects: r.maxObjects, textObjectsCreated: r.texts, heapMB: r.heapMB,
    runMs, machines, peakItems: r.peakItems, withinBudget: dropped === 0 && (cpu == null || cpu <= BUDGET_MS),
  };
}

async function chromiumSample(label: string, actions: Action[], ctxOpts: BrowserContextOptions, throttle: number, renderer: string): Promise<Sample> {
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({ viewport: { width: 1120, height: 700 }, bypassCSP: true, ...ctxOpts }); // string predicates below are polled with an in-page eval that the page's CSP (0.8.0) blocks; the policy has its own e2e
    const page = await context.newPage();
    page.on('pageerror', (e) => console.error('PAGEERROR', String(e)));
    await page.addInitScript(GL_HOOK);
    const cdp = await context.newCDPSession(page);
    await cdp.send('Performance.enable');
    if (throttle > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: throttle });
    await page.goto(`${URL}/?dev=1&scene=game&seed=${encodeURIComponent(SEED)}&renderer=${renderer}`);
    const s = await measure(page, cdp, label, actions);
    console.error('sampled', s.label, `(${s.renderer})`);
    await context.close();
    return s;
  } finally { await browser.close(); }
}

const t0 = Date.now();
const { report, actions } = playSeed(SEED, new Rng(`${SEED}:search`), 120);
console.error(`autoplayer: seed ${SEED} score $${report.score}, picks ${report.picks.join(',')} (${Date.now() - t0} ms)`);
const samples: Sample[] = [];
const renderers = RENDERER === 'both' ? ['webgl', 'canvas'] : [RENDERER];

if (DEVICE) {
  const d = DEVICES[DEVICE]; if (!d) throw new Error(`unknown device preset ${DEVICE}; use ${Object.keys(DEVICES).join('|')}`);
  for (const r of renderers) samples.push(await chromiumSample(`device ${DEVICE} ${r} ${d.width}x${d.height}@${d.dpr} cpu×${d.throttle} @${SPEED}×`, actions, { viewport: { width: d.width, height: d.height }, deviceScaleFactor: d.dpr }, d.throttle, r));
} else {
  for (const throttle of [1, THROTTLE]) for (const r of renderers) samples.push(await chromiumSample(`chromium${throttle > 1 ? ` cpu×${throttle}` : ''}${r === 'canvas' ? ' canvas' : ''} @${SPEED}×`, actions, {}, throttle, r));
}

const exe = path.join(ROOT, 'release', 'win-unpacked', 'Junkyard Draft.exe');
if (!SKIP_ELECTRON && fs.existsSync(exe)) {
  const app = await electron.launch({ executablePath: exe, env: { ...process.env, JD_DEV_API: '1' } as Record<string, string> });
  const page = await app.firstWindow();
  page.on('pageerror', (e) => console.error('PAGEERROR(electron)', String(e)));
  await page.waitForLoadState('domcontentloaded');
  // the shell opens on the title; reload the same file with the game-scene query (dev=1 comes from JD_DEV_API)
  await page.evaluate(`location.search = '?dev=1&scene=game&seed=${encodeURIComponent(SEED)}'`);
  await wait(800);
  let cdp: CDPSession | null;
  try { cdp = await app.context().newCDPSession(page); await cdp.send('Performance.enable'); } catch { cdp = null; }
  samples.push(await measure(page, cdp, `electron packaged @${SPEED}×`, actions));
  console.error('sampled', samples[samples.length - 1].label);
  await app.close();
} else if (!SKIP_ELECTRON) console.error('packaged app not found; run npm run desktop:pack (skipping electron)');

const out = { seed: SEED, score: report.score, picks: report.picks, speed: SPEED, device: DEVICE || null, budgetMs: BUDGET_MS, droppedMs: DROPPED_MS, samples, allWithinBudget: samples.every((s) => s.withinBudget), at: new Date().toISOString() };
console.log(JSON.stringify(out, null, 1));
if (JSON_OUT) fs.writeFileSync(JSON_OUT, JSON.stringify(out, null, 1) + '\n');
