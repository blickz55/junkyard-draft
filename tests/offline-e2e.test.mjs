// Production roadmap 0.8.7 in Chromium: the offline scenario the roadmap names as acceptance. Run with no verifier, see the
// device's own history where the board would be and the saved-and-waiting submission; start the verifier, reload the
// title, see the verified result. Also: no developer copy on the player's screens and the grouped results actions with
// one primary. The verifier's port is picked before it exists, so the game talks to a closed port first.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fixture, freePort, startVerifier, SHOTS } from './e2e/fixture.mjs';

const f = await fixture();
const VPORT = await freePort();
const VURL = `http://127.0.0.1:${VPORT}`;
let verifier = null;
after(async () => {
  await verifier?.stop();
  await f.close();
});
const page = await f.page();
const { api, title, draft, mode, when, textMatches } = page.jd;
const playToResults = async (seed) => {
  await page.goto(`${f.url}/?dev=1&scene=game&seed=${seed}&verifier=${VURL}`);
  await draft();
  for (let r = 1; r <= 6; r++) {
    await when((rr) => window.__jd.phase() === 'draft' && window.__jd.state().round === rr, r);
    await api('pick', 0);
    await api('run');
    await api('finishRun');
    await mode('summary');
    await api('next');
  }
  await page.jd.results(10000);
};
const noDevCopy = async (where) => {
  const text = await page.evaluate(() => document.getElementById('ui')?.innerText || '');
  assert.doesNotMatch(text, /npm|localhost|127\.0\.0\.1|local verifier/i, `${where}: no developer copy on the screen`);
};
let score1 = 0;

test('offline title: the practice yard in plain words, nothing waiting', { timeout: 60000 }, async () => {
  await page.goto(`${f.url}/?dev=1&verifier=${VURL}`);
  await title();
  await page.evaluate(() => localStorage.setItem('jd.player', 'Offline Pat'));
  await textMatches('daily-board', /^You're offline, so this is a practice yard/);
  assert.match(await page.getByTestId('daily-mode').textContent(), /^practice: offline$/);
  assert.equal(await page.locator('[data-testid=pending-note]').count(), 0, 'nothing is waiting yet');
  await noDevCopy('title offline');
});

test(
  "a first run offline: the device's history where the board would be, the offline headline, the grouped actions with one primary",
  { timeout: 90000 },
  async () => {
    await playToResults('classic-offline-e2e-seed');
    await textMatches('status', /^You're offline\. Your game is saved here/);
    assert.equal(await page.getByTestId('board-head').textContent(), 'Your games on this yard');
    assert.equal(await page.getByTestId('headline').textContent(), "That's the game. You're offline.", "the card's headline says offline (0.9.2)");
    assert.equal(await page.getByTestId('delta-best').textContent(), 'your first game on this yard');
    assert.match(await page.getByTestId('history-0').textContent(), /^1\. \$\d+ {2}this game$/);
    assert.match(await page.getByTestId('history-note').textContent(), /^1 game of yours on this yard\./);
    score1 = Number((await page.getByTestId('score').textContent()).replace('$', ''));
    // the grouped actions: what to do next at the top, sharing below the board, exactly one primary button
    const groups = await page.evaluate(() =>
      ['actions-play', 'actions-share', 'actions-watch'].map((id) => {
        const g = document.querySelector(`[data-testid=${id}]`);
        return g ? { buttons: [...g.querySelectorAll('button')].map((b) => b.dataset.testid) } : null;
      }),
    );
    assert.deepEqual(groups[0].buttons, ['submit', 'retry', 'share', 'home']);
    assert.deepEqual(groups[1].buttons, ['share-detailed', 'share-card', 'challenge-link']);
    assert.deepEqual(groups[2].buttons, ['export-clip', 'export-gif', 'export', 'download']);
    assert.equal(await page.evaluate(() => document.querySelectorAll('#ui .jd-btn-primary').length), 1, 'one primary action on the results screen');
    assert.equal(await page.evaluate(() => document.querySelector('#ui .jd-btn-primary')?.dataset.testid), 'submit', 'the score goes on the board first');
    await noDevCopy('results offline');
  },
);

test('submit while offline: saved and waiting; a second run lists both; the title says a run is waiting', { timeout: 90000 }, async () => {
  await page.getByTestId('submit').click();
  await textMatches('status', /^You're offline, so your game is saved here/);
  assert.equal(await page.evaluate(() => document.querySelector('#ui .jd-btn-primary')?.dataset.testid), 'retry', 'then Play again takes over');
  assert.equal(await page.getByTestId('submit').textContent(), 'Saved · waiting for a connection');
  assert.equal(await page.getByTestId('submit').isDisabled(), true);
  const pending = await page.evaluate(() => JSON.parse(localStorage.getItem('jd.pending.v1') || '[]'));
  assert.equal(pending.length, 1);
  assert.equal(pending[0].seed, 'classic-offline-e2e-seed');
  assert.equal(pending[0].player, 'Offline Pat');
  assert.equal(pending[0].replay.claimedScore, score1);
  await page.screenshot({ path: path.join(SHOTS, `offline-results-${Date.now()}.png`) });
  // a second run on the same seed while still offline: the history lists both, the older one by date
  await playToResults('classic-offline-e2e-seed');
  await textMatches('status', /^You're offline\. Your game is saved here/);
  assert.match(await page.getByTestId('history-note').textContent(), /^2 games of yours on this yard/);
  const rows = await page.evaluate(() => [0, 1].map((i) => document.querySelector(`[data-testid=history-${i}]`)?.textContent));
  assert.ok(
    rows.some((r) => /this game$/.test(r)) && rows.some((r) => /\d{4}-\d{2}-\d{2}$/.test(r)),
    `one row is this game, the other dated: ${rows.join(' | ')}`,
  );
  // the title while offline says a run is waiting
  await page.getByTestId('home').click();
  await page.waitForSelector('[data-testid=pending-note]');
  await textMatches('pending-note', /^Still offline\. Your saved game on classic-offline-e2e-seed waits/);
});

test('the verifier comes up: a reload of the title submits the saved run and says so; online results show the checked board', { timeout: 120000 }, async () => {
  verifier = await startVerifier({ port: VPORT, env: { DAILY_SECRET: 'offline-e2e-secret', VERIFIER_LOG: '0', BOT_PAR: '0' } });
  await page.goto(`${f.url}/?dev=1&verifier=${VURL}`);
  await title();
  await textMatches('pending-note', /^Your saved game on classic-offline-e2e-seed is checked: \$\d+ · #1 of 1 as Offline Pat\.$/, 20000);
  assert.match(
    await page.getByTestId('pending-note').textContent(),
    new RegExp(`\\$${score1} · #1 of 1`),
    'the saved first run (the one submitted) is the verified one',
  );
  assert.equal(await page.evaluate(() => localStorage.getItem('jd.pending.v1')), null, 'nothing waits any more');
  const subs = await page.evaluate(() => JSON.parse(localStorage.getItem('jd.submissions.v2')));
  const mine = Object.values(subs.byVersion)[0]['classic-offline-e2e-seed'];
  assert.equal(mine.score, score1);
  assert.equal(mine.player, 'Offline Pat');
  const board = await verifier.json('/board?seed=classic-offline-e2e-seed');
  assert.equal(board.entries.length, 1);
  assert.equal(board.entries[0].score, score1);
  assert.equal(board.entries[0].player, 'Offline Pat');
  await when(() => !/^Offline|Checking/.test(document.querySelector('[data-testid=daily-board]')?.textContent || ''));
  await noDevCopy('title online');
  await page.screenshot({ path: path.join(SHOTS, `offline-verified-${Date.now()}.png`) });
  // online results: the board is back with the verified entry, the status says so in plain words
  await playToResults('classic-offline-e2e-seed');
  await textMatches('board-head', /^The board · this yard$/);
  assert.match(await page.getByTestId('board-entry-0').textContent(), /^1\. \$\d+ {2}Offline Pat/);
  assert.equal(await page.getByTestId('submit').textContent(), 'Put my score on the board');
  await noDevCopy('results online');
  assert.deepEqual(page.errors, [], 'no page errors');
});
