/**
 * First interactive on a slow-4G profile (production roadmap 0.10.2). Serves the production build in dist/ from a small
 * static server (gzip on the fly for text, as a CDN does), opens it in headless Chromium as a mid-range phone (412×915,
 * DPR 2.6, CPU ×4) behind Lighthouse's slow-4G network shape (1.6 Mbps down, 750 Kbps up, 150 ms round trip) and measures
 * the time from navigation to the title's first button being on the page with the Title scene running: the moment a player
 * can tap something. Reports the transfer too.
 *   node --import tsx tools/first-interactive.ts [--dist dist] [--budget 4000] [--runs 1] [--json out.json]
 * Exit 1 when the median run is over the budget (ms). Run `npm run build` first.
 */
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import { serveDir } from './static-lib.mjs';

const args = process.argv.slice(2);
const opt = (k: string, d: string) => {
  const i = args.indexOf(`--${k}`);
  return i >= 0 ? args[i + 1] : d;
};
const dist = path.resolve(opt('dist', 'dist'));
const budget = Number(opt('budget', '4000'));
const runs = Number(opt('runs', '1'));
const jsonOut = opt('json', '');

/** Lighthouse's "slow 4G" mobile profile */
export const SLOW_4G = { latency: 150, downloadThroughput: (1.6 * 1024 * 1024) / 8, uploadThroughput: (750 * 1024) / 8 };

export interface FirstInteractive {
  firstInteractiveMs: number;
  transferKiB: number;
  requests: number;
}
async function measureOnce(url: string): Promise<FirstInteractive> {
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({ viewport: { width: 412, height: 915 }, deviceScaleFactor: 2.6, isMobile: true, hasTouch: true });
    const page = await context.newPage();
    const cdp = await context.newCDPSession(page);
    await cdp.send('Network.enable');
    await cdp.send('Network.emulateNetworkConditions', { offline: false, ...SLOW_4G });
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
    let bytes = 0,
      requests = 0;
    cdp.on('Network.loadingFinished', (e: { encodedDataLength: number }) => {
      bytes += e.encodedDataLength;
      requests++;
    });
    await page.goto(`${url}/?dev=1`, { waitUntil: 'commit' }); // the dev API exposes the game object so the Title scene can be seen running
    // the clock is read in the page at the first frame the button is there, not after everything else has finished loading
    const seen = await page.waitForFunction(
      () => {
        const g = (window as unknown as { __jdGame?: { scene: { isActive(k: string): boolean } } }).__jdGame;
        return !!g && g.scene.isActive('Title') && !!document.querySelector('[data-testid=daily]') && performance.now();
      },
      null,
      { timeout: 60000 },
    );
    const firstInteractiveMs = Math.round((await seen.jsonValue()) as number);
    await page.waitForLoadState('load'); // so the transfer below is the whole first visit, the sheet included
    await context.close();
    return { firstInteractiveMs, transferKiB: Math.round(bytes / 1024), requests };
  } finally {
    await browser.close();
  }
}

const isMain = process.argv[1] && /first-interactive\.(ts|mjs|js)$/.test(process.argv[1]);
if (isMain) {
  if (!fs.existsSync(path.join(dist, 'build.json'))) {
    console.error(`no build at ${dist}; run npm run build first`);
    process.exit(2);
  }
  const server = await serveDir(dist);
  const url = server.url;
  const samples: FirstInteractive[] = [];
  for (let i = 0; i < runs; i++) samples.push(await measureOnce(url));
  await server.close();
  const sorted = samples.map((s) => s.firstInteractiveMs).sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  const ok = median <= budget;
  console.log(
    `${ok ? 'PASS' : 'FAIL'} first interactive ${median} ms (budget ${budget}) on slow 4G, CPU ×4, 412×915 @2.6: ${samples[0].transferKiB} KiB over ${samples[0].requests} requests${runs > 1 ? ` (runs: ${sorted.join(', ')})` : ''}`,
  );
  if (jsonOut) fs.writeFileSync(jsonOut, JSON.stringify({ profile: SLOW_4G, cpu: 4, budget, median, samples, ok, at: new Date().toISOString() }, null, 2));
  process.exit(ok ? 0 : 1);
}
