// Production roadmap 0.9.0: the pseudo-locale (every letter accented, every string about 30 % longer) at 130 % text in
// Chromium: the title, the pick and build panels, a round summary and the results screen must keep every control inside
// the overlay with no horizontal overflow, and the accented text must really be what is on screen.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fixture, SHOTS } from './e2e/fixture.mjs';

const f = await fixture();
after(() => f.close());
const page = await f.page();
const { api, frames, title, draft, mode, when, textMatches } = page.jd;
/** Every [data-testid] inside the overlay, and the screen's horizontal overflow. */
const geometry = () => ({
  outside: [...document.querySelectorAll('#ui [data-testid]')].filter((el) => { const r = el.getBoundingClientRect(); const u = document.getElementById('ui').getBoundingClientRect(); const scrolls = !!el.closest('.jd-side'); return r.width > 0 && r.height > 0 && (r.left < u.left - 1 || r.right > u.right + 1 || (!scrolls && (r.top < u.top - 1 || r.bottom > u.bottom + 1))); }).map((el) => el.dataset.testid), // the side panel scrolls vertically by design
  outsideX: [...document.querySelectorAll('#ui [data-testid]')].filter((el) => { const r = el.getBoundingClientRect(); const u = document.getElementById('ui').getBoundingClientRect(); return r.width > 0 && (r.left < u.left - 1 || r.right > u.right + 1); }).map((el) => el.dataset.testid),
  scrollX: (() => { const s = document.querySelector('#ui .jd-screen'); return s ? s.scrollWidth - s.clientWidth : 0; })(),
  text: document.getElementById('ui')?.innerText || '',
  textScale: getComputedStyle(document.getElementById('ui')).getPropertyValue('--text-scale').trim(),
});
// eslint-disable-next-line no-control-regex -- the ASCII range is the point: everything outside it is the pseudo-locale's accent
const accented = (text) => /[áéíóúñçšžÁÉÍÓÚÑÇŠŽ]/.test(text) && !/\b(the|and|your|with)\b/.test(text.replace(/[^\x00-\x7F]/g, ''));
const pseudoUrl = (query = '') => `${f.url}/?dev=1&locale=pseudo&verifier=${f.vurl}${query ? `&${query}` : ''}`;

test('the title at 130 % in the pseudo-locale: accented, padded, every control inside, no horizontal overflow', { timeout: 60000 }, async () => {
  await page.goto(pseudoUrl());
  await title();
  await page.evaluate(() => { const s = JSON.parse(localStorage.getItem('jd.settings.v1') || '{}'); s.textScale = 1.3; localStorage.setItem('jd.settings.v1', JSON.stringify(s)); localStorage.setItem('jd.onboarded.v1', '1'); localStorage.setItem('jd.player', 'Pseudo Tester'); });
  await page.reload();
  await title();
  await when(() => /^practice/.test(document.querySelector('[data-testid=daily-mode]')?.textContent || '') || /≈/.test(document.querySelector('[data-testid=daily-board]')?.textContent || ''));
  await page.jd.overlaySynced(); await frames();
  const t = await page.evaluate(geometry);
  assert.equal(t.textScale, '1.3', 'text size 130 %');
  const dailyBtn = await page.getByTestId('daily').textContent();
  assert.doesNotMatch(dailyBtn, /[A-Za-z]/, `the daily button is accented: ${dailyBtn}`); assert.ok(dailyBtn.includes('≈'), 'and padded');
  assert.ok(accented(t.text), 'the title screen reads in the pseudo-locale');
  assert.deepEqual(t.outside, [], 'title: every control inside the overlay at 130 % with longer labels');
  assert.equal(t.scrollX, 0, 'title: no horizontal overflow');
  await page.screenshot({ path: path.join(SHOTS, `pseudo-title-${Date.now()}.png`) });
});

test('the pick and build panels and a round summary in the pseudo-locale stay inside the overlay', { timeout: 90000 }, async () => {
  await page.goto(pseudoUrl('scene=game&seed=pseudo-yard'));
  await draft(); await frames();
  const pick = await page.evaluate(geometry);
  assert.ok(accented(pick.text), 'the pick panel reads in the pseudo-locale'); assert.deepEqual(pick.outside, [], 'pick: inside the overlay');
  assert.doesNotMatch(await page.getByTestId('offer-0').textContent(), /[A-Za-z]{3,}/, 'the offer card is accented');
  await api('pick', 0); await frames();
  const build = await page.evaluate(geometry);
  assert.deepEqual(build.outside, [], 'build: inside the overlay'); assert.doesNotMatch(await page.getByTestId('run').textContent(), /[A-Za-z]{3,}/, 'the big button is accented');
  await page.screenshot({ path: path.join(SHOTS, `pseudo-build-${Date.now()}.png`) });
  await api('run'); await api('finishRun');
  await mode('summary'); await frames();
  const summary = await page.evaluate(geometry);
  assert.deepEqual(summary.outside, [], 'summary: inside the overlay');
  assert.doesNotMatch(await page.getByTestId('bottleneck').textContent(), /[A-Za-z]{3,}/, 'the bottleneck line is accented');
  assert.doesNotMatch(await page.getByTestId('next').textContent(), /[A-Za-z]{3,}/, 'the banner button is accented');
});

test('the results screen in the pseudo-locale: nothing sticks out left or right, the actions and the board head are accented', { timeout: 90000 }, async () => {
  for (let r = 2; r <= 6; r++) {
    await api('next');
    await when((rr) => window.__jd.phase() === 'draft' && window.__jd.state().round === rr, r);
    await api('pick', 0); await api('run'); await api('finishRun');
    await mode('summary');
  }
  await api('next');
  await page.jd.results(10000);
  await textMatches('status', /≈/);
  await frames();
  const results = await page.evaluate(geometry);
  assert.deepEqual(results.outsideX, [], 'results: nothing sticks out to the left or right (the screen scrolls vertically by design)');
  assert.equal(results.scrollX, 0, 'results: no horizontal overflow');
  assert.doesNotMatch(await page.getByTestId('retry').textContent(), /[A-Za-z]{3,}/, 'the primary action is accented');
  assert.doesNotMatch(await page.getByTestId('board-head').textContent(), /[A-Za-z]{3,}/, 'the board head is accented');
  await page.screenshot({ path: path.join(SHOTS, `pseudo-results-${Date.now()}.png`) });
  assert.deepEqual(page.errors, [], 'no page errors');
});
