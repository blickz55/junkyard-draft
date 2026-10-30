// Production roadmap 0.9.1 in Chromium: the foreman's box on the title, in the draft, on the round-end banner and on the
// results; "lessons only" is persisted and respected (flavour gone, the teaching line in the draft stays).
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
let firstDraftLine = '';

test("the title: Sal's welcome under the tagline and the chatter button", { timeout: 60000 }, async () => {
  await page.goto(f.gameUrl());
  await title();
  await page.evaluate(() => {
    localStorage.setItem('jd.onboarded.v1', '1');
    localStorage.setItem('jd.player', 'Foreman Tester');
  });
  await page.reload();
  await title();
  const t0 = await foreman();
  assert.ok(t0 && t0.visible, "the foreman's box is on the title");
  assert.equal(t0.tag, 'SAL');
  assert.ok(t0.text.length > 10, `a welcome line: ${t0.text}`);
  assert.equal(await page.getByTestId('foreman-chatter').textContent(), 'Foreman: chatty');
});

test(
  "the draft: the first pick's teaching line, a refusal's line, the round-end banner, the second draft's bottleneck opener, the results line",
  { timeout: 90000 },
  async () => {
    await page.goto(f.gameUrl('scene=game&seed=foreman-yard'));
    await draft();
    await frames();
    const d1 = await foreman();
    assert.ok(d1 && d1.visible, 'the foreman speaks in the first draft');
    firstDraftLine = d1.text;
    await api('pick', 0);
    await frames();
    const st = await api('state');
    const part = st.bin[0];
    assert.equal(await api('act', { t: 'place', id: part.id, x: 2, y: 2, dir: 0 }), false, "the starter conveyor's cell is occupied");
    await frames();
    const dr = await foreman();
    assert.ok(dr && dr.visible && dr.text !== firstDraftLine, `a refusal gets its own line: ${dr.text}`);
    await api('run');
    await api('finishRun');
    await mode('summary');
    await frames();
    const banner = await page.getByTestId('foreman-banner').textContent();
    assert.match(banner, /^SAL · .{10,}/, `the round-end banner carries Sal's line: ${banner}`);
    await page.screenshot({ path: path.join(SHOTS, `foreman-summary-${Date.now()}.png`) });
    await api('next');
    await when(() => window.__jd.phase() === 'draft' && window.__jd.state().round === 2);
    await frames();
    const d2 = await foreman();
    assert.ok(d2 && d2.visible, 'the second draft opens with the bottleneck case');
    assert.notEqual(d2.text, firstDraftLine);
    // the results: offline, so the offline band
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
  },
);

test('lessons only: persisted, flavour gone on the title and the banner, the teaching line still in the draft', { timeout: 90000 }, async () => {
  await page.getByTestId('title').click();
  await title();
  await page.getByTestId('foreman-chatter').click();
  await when(() => document.querySelector('[data-testid=foreman-chatter]')?.textContent === 'Foreman: lessons only', null, 10000);
  assert.equal(JSON.parse(await page.evaluate(() => localStorage.getItem('jd.settings.v1'))).chatter, 'less', 'the setting is persisted');
  const quiet = await foreman();
  assert.ok(!quiet || !quiet.visible, 'no welcome under lessons only');
  await page.goto(f.gameUrl()); // a fresh load of the title (the page's URL still names the game scene from the run above)
  await title();
  assert.equal(await page.getByTestId('foreman-chatter').textContent(), 'Foreman: lessons only', 'survives a reload');
  const quiet2 = await foreman();
  assert.ok(!quiet2 || !quiet2.visible, 'still quiet after the reload');
  await page.goto(f.gameUrl('scene=game&seed=foreman-yard-2'));
  await draft();
  await frames();
  const teach = await foreman();
  assert.ok(teach && teach.visible, 'the first pick still teaches under lessons only');
  await api('pick', 0);
  await api('run');
  await api('finishRun');
  await mode('summary');
  assert.equal(await page.locator('[data-testid=foreman-banner]').count(), 0, 'no round-end flavour under lessons only');
  assert.deepEqual(page.errors, [], 'no page errors');
});
