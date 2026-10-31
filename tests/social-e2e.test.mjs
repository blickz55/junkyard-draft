// Production roadmap v0.11 in Chromium: reactions on a run (0.11.3). A second device watches a checked recording, leaves a
// reaction, changes it, takes it back and leaves another; the board row and the run's owner see the counts; a run's owner is
// offered no buttons on their own run. Divisions (0.11.11): the morning after, Home says where the day left you, the board opens,
// the result copies, Your record keeps the trophies (the server's side, the clock included, is in tests/community.test.ts).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { fixture, until } from './e2e/fixture.mjs';

const f = await fixture({ verifier: true, verifierEnv: { DAILY_SECRET: 'social-e2e-secret', VERIFIER_LOG: '0', BOT_PAR: '0' } });
after(() => f.close());
const SEED = 'classic-social-yard';

/** Six shifts on the same yard, always taking the card at `pick`, and the results. */
async function play(page, name, pick) {
  await page.goto(f.gameUrl(`scene=game&seed=${SEED}`));
  await page.jd.draft();
  await page.evaluate((n) => localStorage.setItem('jd.player', n), name);
  for (let r = 1; r <= 6; r++) {
    await page.jd.api('pick', pick);
    await page.jd.api('run');
    await page.jd.api('finishRun');
    await page.jd.mode('summary');
    await page.jd.api('next');
  }
  await page.jd.results(10000);
}
const submit = async (page) => {
  await page.getByTestId('submit').click();
  await page.jd.textMatches('status', /^Checked: /, 15000);
};
const rowOf = async (page, name) => {
  await page.getByTestId('board-entry-0').waitFor();
  return (await page.getByTestId('board-entry-0').textContent()).includes(name) ? 0 : 1;
};
const pressed = (page, id, state) =>
  page.jd.when(([i, s]) => document.querySelector(`[data-testid=react-${i}]`)?.getAttribute('aria-pressed') === s, [id, String(state)], 10000);

const owner = await f.page();
const fan = await f.page();
await play(owner, 'Owner Sam', 0);
await play(fan, 'Fan Lou', 1);

test('a recording takes one reaction per device: leave one, change it, take it back; the counts stay through the redraws', { timeout: 120000 }, async () => {
  await submit(owner);
  await submit(fan);
  const row = await rowOf(fan, 'Owner Sam');
  await fan.waitForSelector(`[data-testid=board-entry-${row}]:not([disabled])`, { timeout: 10000 });
  await fan.getByTestId(`board-entry-${row}`).click();
  await fan.jd.when(() => !!document.querySelector('[data-testid=replay-banner]'));
  await fan.jd.mode('running');
  await fan.getByTestId('react-fire').waitFor();
  assert.equal(await fan.locator('.jd-reaction').count(), 8, 'the eight, nothing to type');
  await pressed(fan, 'fire', false);
  await fan.getByTestId('react-fire').click();
  await pressed(fan, 'fire', true);
  assert.equal(await fan.getByTestId('react-fire').textContent(), '🔥1');
  assert.equal(await fan.getByTestId('react-fire').getAttribute('aria-label'), 'On fire, 1 so far');
  await fan.getByTestId('react-brain').click();
  await pressed(fan, 'brain', true);
  assert.equal(await fan.getByTestId('react-fire').textContent(), '🔥', 'one reaction per device: it moved');
  await fan.getByTestId('react-brain').click();
  await pressed(fan, 'brain', false);
  await fan.getByTestId('react-applause').click();
  await pressed(fan, 'applause', true);
  // through the shifts the panel redraws: the same bar, the same state. The test skips each shift it finds running, however many are left: on a slow machine the first can end by itself during the taps
  await until(
    () =>
      fan.evaluate(() => {
        if (window.__jdGame.scene.isActive('Results')) return true;
        if (window.__jd?.mode?.() === 'running') window.__jd.finishRun();
        return false;
      }),
    { timeout: 30000, what: 'the recording to reach its results' },
  );
  await fan.getByTestId('react-applause').waitFor();
  await pressed(fan, 'applause', true);
  assert.deepEqual(fan.errors, []);
});

test('the board shows the counts; the owner sees them on the results, and no buttons on a recording of their own run', { timeout: 120000 }, async () => {
  const board = await (await fetch(`${f.vurl}/board?seed=${SEED}`)).json();
  assert.deepEqual(board.entries.find((e) => e.player.startsWith('Owner Sam')).reactions, { applause: 1 });
  assert.equal(board.entries.find((e) => e.player.startsWith('Fan Lou')).reactions, undefined, 'a run nobody reacted to carries no field');
  await owner.getByTestId('home').click();
  await owner.jd.title();
  await play(owner, 'Owner Sam', 0); // the same game: the device knows it for the checked one
  await owner.jd.textMatches('results-social', /^1 reaction 👏 1 · watched 1 time by 1 player$/, 15000);
  const row = await rowOf(owner, 'Owner Sam');
  assert.match(await owner.getByTestId(`board-entry-${row}`).textContent(), /👏 1/);
  await owner.waitForSelector(`[data-testid=board-entry-${row}]:not([disabled])`, { timeout: 10000 });
  await owner.getByTestId(`board-entry-${row}`).click();
  await owner.jd.when(() => !!document.querySelector('[data-testid=replay-banner]'));
  await owner.getByTestId('reactions-own').waitFor();
  assert.equal(await owner.locator('.jd-reaction').count(), 0, 'nothing to press on your own run');
  assert.equal(await owner.getByTestId('reactions-own').textContent(), '👏 1');
  const hash = board.entries.find((e) => e.player.startsWith('Owner Sam')).replayHash;
  assert.deepEqual((await (await fetch(`${f.vurl}/entry?hash=${hash}`)).json()).seen, { times: 1, players: 1 }, 'watching your own game is not being watched');
  await owner.getByTestId('stop').click();
  await owner.jd.title(); // Stop goes back where the recording was opened from, or Home
  await owner.getByTestId('record').click();
  await owner.jd.textMatches('record-watched', /watched 1 time by 1 player/);
  assert.deepEqual(owner.errors, []);
});

test('the morning after: Home says where the day left you, the board is a tap away, Your record keeps the trophies', { timeout: 60000 }, async () => {
  const yesterday = new Date(Date.now() - 2 * 86_400_000).toISOString().slice(0, 10);
  const placement = { period: yesterday, division: 1, name: 'foundry-2', place: 3, size: 24, score: 412, medal: 'bronze' };
  const page = await f.page(
    {},
    { init: { fn: () => localStorage.setItem('jd.submissions.v2', JSON.stringify({ byVersion: { 4: { x: { replayHash: 'h', score: 1 } } } })) } },
  );
  await page.route('**/me/divisions*', (r) =>
    r.fulfill({ json: { ok: true, divisions: [placement], trophies: { 'medal-bronze': 2, 'medal-gold': 1, 'top-division': 1 } } }),
  );
  await page.route('**/division?*', (r) =>
    r.fulfill({
      json: {
        ok: true,
        name: 'foundry-2',
        rows: [
          { place: 1, score: 600, medal: 'gold', player: 'Ana#AAAA', you: false },
          { place: 2, score: 500, medal: 'silver', player: 'Bo#BBBB', you: false },
          { place: 3, score: 412, medal: 'bronze', player: 'You#CCCC', you: true },
          { place: 4, score: 300, medal: null, player: 'deleted', you: false },
        ],
      },
    }),
  );
  await page.goto(f.gameUrl());
  await page.jd.title();
  await page.jd.textMatches('division-line', /: #3 of 24 in Foundry 2 🥉/, 10000);
  await page.getByTestId('division-open').click();
  await page.getByTestId('division-dialog').waitFor();
  await page.jd.textMatches('division-you', /^#3You#CCCC\$412 🥉$/, 10000);
  assert.match(await page.getByTestId('division-head').textContent(), /^Foundry 2 · /);
  assert.equal(await page.locator('.jd-division-row').count(), 4);
  await page.getByTestId('division-close').click();
  await page.jd.noDialog('division-dialog');
  await page.getByTestId('record').click();
  await page.jd.textMatches('record-trophies', /1 gold · 2 bronze · 1 day in the top division/);
  assert.deepEqual(page.errors, []);
});

test('an old placement stays off Home, and so does a device that never put a game on a board', { timeout: 60000 }, async () => {
  const stale = await f.page(
    {},
    { init: { fn: () => localStorage.setItem('jd.submissions.v2', JSON.stringify({ byVersion: { 4: { x: { replayHash: 'h', score: 1 } } } })) } },
  );
  await stale.route('**/me/divisions*', (r) =>
    r.fulfill({
      json: { ok: true, divisions: [{ period: '2020-01-01', division: 0, name: 'table', place: 1, size: 3, score: 1, medal: 'gold' }], trophies: {} },
    }),
  );
  await stale.goto(f.gameUrl());
  await stale.jd.title();
  await stale.jd.frames(5);
  assert.equal(await stale.getByTestId('division-open').count(), 0);
  const fresh = await f.page();
  let asked = 0;
  await fresh.route('**/me/divisions*', (r) => {
    asked++;
    return r.fulfill({ json: { ok: true, divisions: [], trophies: {} } });
  });
  await fresh.goto(f.gameUrl());
  await fresh.jd.title();
  await fresh.jd.frames(5);
  assert.equal(asked, 0, 'nothing to ask');
});
