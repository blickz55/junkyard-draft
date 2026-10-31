// Production roadmap 0.9.1 in Chromium: Sal on home, on the shift banner and on the results; quiet is persisted and respected.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fixture, SHOTS } from './e2e/fixture.mjs';

const f = await fixture();
after(() => f.close());
const page = await f.page();
const { api, frames, title, draft, mode, results, when } = page.jd;
const foreman = () =>
  page.evaluate(() => {
    const el = document.querySelector('[data-testid=foreman]');
    return el
      ? {
          visible: el.style.display !== 'none' && el.getBoundingClientRect().height > 0,
          tag: el.querySelector('.jd-foreman-tag')?.textContent,
          text: el.querySelector('.jd-foreman-text')?.textContent,
        }
      : null;
  });

const openSettings = async () => {
  await page.getByTestId('settings').click();
  await page.waitForSelector('[data-testid=settings-dialog]', { timeout: 5000 });
};
const closeSettings = async () => {
  await page.getByTestId('settings-close').click();
  await page.jd.noDialog('settings-dialog');
  await frames(3);
};

test("home: Sal's welcome beside the name, and the chatter button in Settings", { timeout: 60000 }, async () => {
  await page.goto(f.gameUrl());
  await title();
  await page.evaluate(() => {
    localStorage.setItem('jd.onboarded.v1', '1');
    localStorage.setItem('jd.player', 'Foreman Tester');
  });
  await page.reload();
  await title();
  const t0 = await foreman();
  assert.ok(t0 && t0.visible, "the foreman's box is on the home screen");
  assert.equal(t0.tag, 'SAL, THE FOREMAN');
  assert.ok(t0.text.length > 10, `a welcome line: ${t0.text}`);
  await openSettings();
  assert.equal(await page.getByTestId('foreman-chatter').textContent(), 'Chatty');
  await closeSettings();
});

test('the game: the coach speaks in the panel, Sal on the shift banner and on the results', { timeout: 90000 }, async () => {
  await page.goto(f.gameUrl('scene=game&seed=classic-foreman-yard'));
  await draft();
  await frames();
  assert.equal(await foreman(), null, 'no second voice in the panel: the coach card is the one instruction');
  await api('pick', 0);
  await api('run');
  await api('finishRun');
  await mode('summary');
  await frames();
  const banner = await page.getByTestId('foreman-banner').textContent();
  assert.match(banner, /^SAL: .{10,}/, `the shift banner carries Sal's line: ${banner}`);
  await page.screenshot({ path: path.join(SHOTS, `foreman-summary-${Date.now()}.png`) });
  await api('next');
  await when(() => window.__jd.phase() === 'draft' && window.__jd.state().round === 2);
  for (let r = 2; r <= 6; r++) {
    await api('pick', 0);
    await api('run');
    await api('finishRun');
    await mode('summary');
    await api('next');
  }
  await results(10000);
  await when(() => {
    const el = document.querySelector('[data-testid=foreman]');
    return !!el && el.style.display !== 'none' && (el.querySelector('.jd-foreman-text')?.textContent || '').length > 10;
  });
  const res = await foreman();
  assert.ok(res.visible, `the results carry a line: ${res.text}`);
  await page.screenshot({ path: path.join(SHOTS, `foreman-results-${Date.now()}.png`) });
});

test('quiet: persisted, gone from home, the banner and the results, the coach unaffected', { timeout: 90000 }, async () => {
  await page.getByTestId('home').click();
  await title();
  await openSettings();
  await page.getByTestId('foreman-chatter').click();
  await when(() => document.querySelector('[data-testid=foreman-chatter]')?.textContent === 'Quiet', null, 10000);
  assert.equal(JSON.parse(await page.evaluate(() => localStorage.getItem('jd.settings.v1'))).chatter, 'less', 'the setting is persisted');
  await closeSettings();
  await title();
  const quiet = await foreman();
  assert.ok(!quiet || !quiet.visible, 'no welcome when quiet');
  await page.goto(f.gameUrl()); // a fresh load of home (the page's URL still names the game scene from the run above)
  await title();
  const quiet2 = await foreman();
  assert.ok(!quiet2 || !quiet2.visible, 'still quiet after the reload');
  await page.goto(f.gameUrl('scene=game&seed=classic-foreman-yard-2'));
  await draft();
  await frames();
  assert.match(await api('hint'), /^Pick ONE part/, 'the coach still says what to do');
  await api('pick', 0);
  await api('run');
  await api('finishRun');
  await mode('summary');
  assert.equal(await page.locator('[data-testid=foreman-banner]').count(), 0, 'no banner flavour when quiet');
  assert.deepEqual(page.errors, [], 'no page errors');
});
