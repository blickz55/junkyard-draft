// Packaged-app smoke test: launches release/win-unpacked/Junkyard Draft.exe (from `npm run desktop:pack`
// or `desktop:dist`) with JD_DEV_API=1, jumps to the game scene, plays one round through the dev API and
// checks the result screen is reached with no page errors. Skips when no packaged build exists.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const EXE = path.join(ROOT, 'release', 'win-unpacked', 'Junkyard Draft.exe');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

test('packaged desktop app: launches, plays a round, no page errors', { skip: !fs.existsSync(EXE) && 'no packaged build (npm run desktop:pack)', timeout: 90000 }, async () => {
  const { _electron: electron } = await import('playwright');
  const app = await electron.launch({ executablePath: EXE, env: { ...process.env, JD_DEV_API: '1' } });
  const errors = [];
  try {
    const page = await app.firstWindow();
    page.on('pageerror', (e) => errors.push(String(e)));
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    await page.waitForLoadState('domcontentloaded');
    assert.equal(await page.title(), 'Junkyard Draft');
    // the packaged shell exposes window.jdDesktop from the preload; the dev API comes from ?dev=1 (JD_DEV_API)
    const platform = await page.evaluate('window.jdDesktop && window.jdDesktop.platform');
    assert.equal(platform, process.platform, 'preload bridge present');
    await page.evaluate("location.search = '?dev=1&scene=game&seed=smoke-seed'");
    await page.waitForFunction("!!window.__jd && window.__jd.phase() === 'draft'", null, { timeout: 20000 });
    const api = (fn, ...a) => page.evaluate(`window.__jd[${JSON.stringify(fn)}](...${JSON.stringify(a)})`);
    const st0 = await api('state');
    assert.equal(st0.round, 1);
    await api('pick', st0.offers.indexOf('crusher'));
    const st = await api('state');
    const conv = st.layout.machines.find((m) => m.x === 2 && m.y === 2);
    assert.ok(await api('act', { t: 'unplace', id: conv.id }));
    assert.ok(await api('act', { t: 'place', id: st.bin.find((m) => m.kind === 'crusher').id, x: 2, y: 2, dir: 0 }));
    await api('run');
    await wait(600); // let a few animated ticks render in the real window
    await api('finishRun');
    await page.waitForFunction("window.__jd.mode() === 'summary'", null, { timeout: 15000 });
    const rec = (await api('state')).rounds[0];
    assert.ok(rec.earned > 38, `crusher line earned ${rec.earned} > starter 38`);
    assert.ok(rec.shipped.shards > 0);
    const bounds = await (await app.firstWindow()).evaluate('({ w: innerWidth, h: innerHeight })');
    assert.ok(bounds.w >= 900 && bounds.h >= 560, `window ${bounds.w}x${bounds.h} respects the minimum size`);
    assert.deepEqual(errors, [], 'no page errors in the packaged app');
  } finally {
    await app.close();
  }
});
