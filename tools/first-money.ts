/**
 * Goal 12's third bar (docs/GOALS.md): money on screen within 60 s of landing, for a newcomer who reads. Serves the production build in
 * dist/ to the slow-4G phone of tools/first-interactive.ts with an empty profile, and plays the way a reader would: everything new on the
 * screen is read at a steady pace before anything is touched, a touch takes a moment, and only what the game lights is touched. Home's
 * "Learn to play", then the lesson, until the money on the top bar is more than $0. The shift plays at its own speed: nothing is skipped.
 *   node --import tsx tools/first-money.ts [--dist dist] [--wpm 250] [--tap 800] [--runs 3] [--budget 60000] [--json out.json]
 * Exit 1 when the median run is over the budget (ms). Run `npm run build` first.
 */
import fs from 'node:fs';
import path from 'node:path';
import { chromium, type Page } from 'playwright';
import { serveDir } from './static-lib.mjs';
import { SLOW_4G } from './first-interactive';

const args = process.argv.slice(2);
const opt = (k: string, d: string) => {
  const i = args.indexOf(`--${k}`);
  return i >= 0 ? args[i + 1] : d;
};
const dist = path.resolve(opt('dist', 'dist'));
const wpm = Number(opt('wpm', '250'));
const tapMs = Number(opt('tap', '800'));
const runs = Number(opt('runs', '3'));
const budget = Number(opt('budget', '60000'));
const jsonOut = opt('json', '');

const words = (s: string) => s.split(/\s+/).filter(Boolean).length;
const readMs = (s: string) => Math.round((words(s) / wpm) * 60_000);

/** What the reader has in front of them: an open dialog's words, else the coach's line; and what is lit to touch. */
function screen(page: Page) {
  return page.evaluate(() => {
    const modal = document.querySelector('.jd-modal');
    const primary = modal?.querySelector<HTMLElement>('.jd-btn-primary');
    if (modal && primary)
      return { text: modal.textContent ?? '', dialog: primary.dataset.testid ?? '', rings: [] as { x: number; y: number }[], buttons: [] as string[] };
    const rings = [...document.querySelectorAll('[data-spot]')].map((r) => {
      const b = r.getBoundingClientRect();
      return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
    });
    const buttons = [...document.querySelectorAll<HTMLElement>('.jd-spot')].map((b) => b.dataset.testid ?? '');
    return { text: document.querySelector('[data-testid=coach]')?.textContent ?? '', dialog: '', rings, buttons };
  });
}
const money = (page: Page) => page.evaluate(() => document.querySelector('[data-testid=hud-score]')?.textContent ?? '$0');

export interface FirstMoney {
  firstMoneyMs: number;
  /** what the reader spent reading, and touching, of that */
  readingMs: number;
  touches: number;
}
async function once(url: string): Promise<FirstMoney> {
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({ viewport: { width: 412, height: 915 }, deviceScaleFactor: 2.6, isMobile: true, hasTouch: true });
    const page = await context.newPage();
    const cdp = await context.newCDPSession(page);
    await cdp.send('Network.enable');
    await cdp.send('Network.emulateNetworkConditions', { offline: false, ...SLOW_4G });
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
    await page.goto(`${url}/?dev=1`, { waitUntil: 'commit' });
    let readingMs = 0;
    let touches = 0;
    const pause = async (ms: number) => {
      readingMs += ms;
      await page.waitForTimeout(ms);
    };
    // Home: the title, the line under it and the button, read before the first touch
    await page.getByTestId('learn').waitFor({ timeout: 60000 });
    const home = await page.evaluate(() => [...document.querySelectorAll('h1, .jd-home-hero, [data-testid=learn]')].map((e) => e.textContent).join(' '));
    await pause(readMs(home));
    await page.getByTestId('learn').tap();
    touches++;
    let seen = '';
    for (let step = 0; step < 40; step++) {
      if ((await money(page)) !== '$0') break;
      const s = await screen(page);
      const key = JSON.stringify(s);
      if (key === seen || (!s.dialog && !s.rings.length && !s.buttons.length)) {
        await page.waitForTimeout(50); // the shift is running, or the screen has not changed yet: watch
        continue;
      }
      seen = key;
      await pause(readMs(s.text) + tapMs);
      touches++;
      if (s.dialog) await page.getByTestId(s.dialog).tap();
      else if (s.rings.length) for (const r of s.rings) await page.touchscreen.tap(r.x, r.y);
      else await page.getByTestId(s.buttons[0]).tap();
    }
    await page.waitForFunction(() => (document.querySelector('[data-testid=hud-score]')?.textContent ?? '$0') !== '$0', null, { timeout: 60000 });
    const firstMoneyMs = Math.round(await page.evaluate(() => performance.now()));
    await context.close();
    return { firstMoneyMs, readingMs, touches };
  } finally {
    await browser.close();
  }
}

const isMain = process.argv[1] && /first-money\.(ts|mjs|js)$/.test(process.argv[1]);
if (isMain) {
  if (!fs.existsSync(path.join(dist, 'build.json'))) {
    console.error(`no build at ${dist}; run npm run build first`);
    process.exit(2);
  }
  const server = await serveDir(dist);
  const samples: FirstMoney[] = [];
  for (let i = 0; i < runs; i++) samples.push(await once(server.url));
  await server.close();
  const sorted = samples.map((s) => s.firstMoneyMs).sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  const ok = median <= budget;
  const mid = samples.find((s) => s.firstMoneyMs === median)!;
  console.log(
    `${ok ? 'PASS' : 'FAIL'} first money ${median} ms after landing (budget ${budget}) on slow 4G, CPU ×4, reading at ${wpm} words a minute and ${tapMs} ms a touch: ${mid.readingMs} ms of it reading and touching, ${mid.touches} touches${runs > 1 ? ` (runs: ${sorted.join(', ')})` : ''}`,
  );
  if (jsonOut) fs.writeFileSync(jsonOut, JSON.stringify({ wpm, tapMs, budget, median, samples, ok, at: new Date().toISOString() }, null, 2));
  process.exit(ok ? 0 : 1);
}
