/**
 * Frame-time budget probe. Plays a strong autoplayer run (legal actions only, through the dev API)
 * up to its busiest final round, then samples requestAnimationFrame deltas while that round runs at
 * the chosen speed, plus the renderer's CPU time per frame (CDP Performance metrics: TaskDuration).
 * Reports, for each environment:
 *   frame p50 / p95 / max (ms, vsync-bound: 16.7 at 60 Hz, 4.2 at 240 Hz), dropped frames (> 25 ms,
 *   i.e. a missed 60 Hz vsync), and cpuMsPerFrame (main-thread busy time ÷ frames; the budget is 16.7).
 *   - Chromium (Playwright, headless) against a dev server
 *   - Chromium with CDP CPU throttling (default 4×)
 *   - the packaged Electron app (release/win-unpacked) when present; needs JD_DEV_API=1 support in main.cjs
 *
 *   node --import tsx tools/perf.ts [--url http://127.0.0.1:5173] [--seed auto-12] [--speed 4] [--throttle 4]
 *                                    [--skip-electron] [--json out.json]
 * Start the dev server first (npm run dev). Diagnostic evidence only.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, _electron as electron, type CDPSession, type Page } from 'playwright';
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
const SKIP_ELECTRON = args.includes('--skip-electron');
const BUDGET_MS = 16.7;
const DROPPED_MS = 25;
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface Sample {
  label: string; frames: number; p50: number; p95: number; max: number; dropped: number;
  cpuMsPerFrame: number | null; scriptMsPerFrame: number | null; runMs: number; machines: number; peakItems: number; withinBudget: boolean;
}

const q = (sorted: number[], p: number) => sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];

// Browser-side code is passed as source text: tsx wraps inner functions with a `__name` helper that
// does not exist inside the page, so serialized function bodies would throw there.
const api = (page: Page, fn: string, ...a: unknown[]) => page.evaluate(`window.__jd[${JSON.stringify(fn)}](...${JSON.stringify(a)})`);

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
  w.__jd.run();
  const btn = w.__jdGame.scene.getScene('Game').side.getByName('speed-' + speed); if (btn) btn.emit('pointerdown');
  w.__frames = []; w.__peakItems = 0;
  let last = performance.now();
  const loop = (t) => {
    w.__frames.push(t - last); last = t;
    const sim = w.__jdGame.scene.getScene('Game').sim; if (sim) w.__peakItems = Math.max(w.__peakItems, sim.items.length);
    if (w.__jd.mode() === 'running') requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
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
  const { frames, peakItems } = (await page.evaluate('({ frames: window.__frames.slice(3), peakItems: window.__peakItems })')) as { frames: number[]; peakItems: number };
  const sorted = frames.slice().sort((a, b) => a - b);
  const cpu = m0 && m1 ? +(((m1.task - m0.task) * 1000) / frames.length).toFixed(2) : null;
  const script = m0 && m1 ? +(((m1.script - m0.script) * 1000) / frames.length).toFixed(2) : null;
  const p95 = +q(sorted, 0.95).toFixed(2);
  const dropped = frames.filter((f) => f > DROPPED_MS).length;
  return { label, frames: frames.length, p50: +q(sorted, 0.5).toFixed(2), p95, max: +sorted[sorted.length - 1].toFixed(2), dropped, cpuMsPerFrame: cpu, scriptMsPerFrame: script, runMs, machines, peakItems, withinBudget: dropped === 0 && (cpu == null || cpu <= BUDGET_MS) };
}

const t0 = Date.now();
const { report, actions } = playSeed(SEED, new Rng(`${SEED}:search`), 120);
console.error(`autoplayer: seed ${SEED} score $${report.score}, picks ${report.picks.join(',')} (${Date.now() - t0} ms)`);
const samples: Sample[] = [];

const browser = await chromium.launch();
for (const throttle of [1, THROTTLE]) {
  const context = await browser.newContext({ viewport: { width: 1120, height: 700 } });
  const page = await context.newPage();
  page.on('pageerror', (e) => console.error('PAGEERROR', String(e)));
  const cdp = await context.newCDPSession(page);
  await cdp.send('Performance.enable');
  if (throttle > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: throttle });
  await page.goto(`${URL}/?dev=1&scene=game&seed=${encodeURIComponent(SEED)}`);
  samples.push(await measure(page, cdp, throttle > 1 ? `chromium cpu×${throttle} @${SPEED}×` : `chromium @${SPEED}×`, actions));
  console.error('sampled', samples[samples.length - 1].label);
  await context.close();
}
await browser.close();

const exe = path.join(ROOT, 'release', 'win-unpacked', 'Junkyard Draft.exe');
if (!SKIP_ELECTRON && fs.existsSync(exe)) {
  const app = await electron.launch({ executablePath: exe, env: { ...process.env, JD_DEV_API: '1' } as Record<string, string> });
  const page = await app.firstWindow();
  page.on('pageerror', (e) => console.error('PAGEERROR(electron)', String(e)));
  await page.waitForLoadState('domcontentloaded');
  // the shell opens on the title; reload the same file with the game-scene query (dev=1 comes from JD_DEV_API)
  await page.evaluate(`location.search = '?dev=1&scene=game&seed=${encodeURIComponent(SEED)}'`);
  await wait(800);
  let cdp: CDPSession | null = null;
  try { cdp = await app.context().newCDPSession(page); await cdp.send('Performance.enable'); } catch { cdp = null; }
  samples.push(await measure(page, cdp, `electron packaged @${SPEED}×`, actions));
  console.error('sampled', samples[samples.length - 1].label);
  await app.close();
} else if (!SKIP_ELECTRON) console.error('packaged app not found; run npm run desktop:pack (skipping electron)');

const out = { seed: SEED, score: report.score, picks: report.picks, speed: SPEED, budgetMs: BUDGET_MS, droppedMs: DROPPED_MS, samples, allWithinBudget: samples.every((s) => s.withinBudget), at: new Date().toISOString() };
console.log(JSON.stringify(out, null, 1));
if (JSON_OUT) fs.writeFileSync(JSON_OUT, JSON.stringify(out, null, 1) + '\n');
