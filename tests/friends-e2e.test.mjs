// Production roadmap 0.11.8 in Chromium, with stand-ins for the classifier and the mail service: a player adds someone from a recording,
// the other accepts in the inbox, the first sees the game in the feed and takes up Beat this, friends show on the chart of scores, one
// is added from the talk, and a block ends it all without a word to the other side.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fixture, SHOTS, until } from './e2e/fixture.mjs';
import { signIn, standIns } from './e2e/standins.mjs';

const stand = await standIns();
const f = await fixture({
  verifier: true,
  verifierEnv: { DAILY_SECRET: 'friends-e2e-secret', VERIFIER_LOG: '0', BOT_PAR: '0', MODERATION_TOKEN: 'e2e-token', POST_RATE_LIMIT: '1000', ...stand.env },
});
after(async () => {
  await f.close();
  await stand.close();
});

const { seed: DAILY } = await fetch(`${f.vurl}/daily?limit=1`).then((r) => r.json());
const sam = await f.page();
const ann = await f.page();
/** The refusals these tests ask for reach the console as failed requests. */
const unexpected = (page) => page.errors.filter((e) => !/status of 4(03|09|22) /.test(e));

async function claim(page, name) {
  const { token } = await page.evaluate(() => JSON.parse(localStorage.getItem('jd.identity.v1')));
  const res = await fetch(`${f.vurl}/identity`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ name }),
  });
  assert.equal(res.status, 200);
}
async function play(page, name, pick) {
  await page.goto(f.gameUrl(`scene=game&seed=${DAILY}`));
  await page.evaluate((n) => localStorage.setItem('jd.player', n), name);
  await page.jd.draft();
  for (let r = 1; r <= 6; r++) {
    await page.jd.api('pick', pick);
    await page.jd.api('run');
    await page.jd.api('finishRun');
    await page.jd.mode('summary');
    await page.jd.api('next');
  }
  await page.jd.results(10000);
  await page.getByTestId('submit').click();
  await page.jd.textMatches('status', /^Checked: /, 15000);
}
const home = async (page) => {
  await page.goto(f.gameUrl());
  await page.jd.title();
};
const openFriends = async (page) => {
  await home(page);
  await page.getByTestId('friends').click();
  await page.getByTestId('friends-dialog').waitFor();
};

test('a player adds someone from a recording, and the other accepts in the inbox', { timeout: 120000 }, async () => {
  await signIn(f, sam, stand.mails, 'sam@example.com');
  await claim(sam, 'Sam');
  await signIn(f, ann, stand.mails, 'ann@example.com');
  await claim(ann, 'Ann');
  await openFriends(ann);
  await ann.jd.textMatches('friends-body', /^Nobody here yet\./, 5000);
  await ann.getByTestId('friends-close').click();

  await play(sam, 'Sam', 0);
  await play(ann, 'Ann', 1);
  const row = (await ann.getByTestId('board-entry-0').textContent()).includes('Sam') ? 0 : 1;
  await ann.waitForSelector(`[data-testid=board-entry-${row}]:not([disabled])`, { timeout: 10000 });
  await ann.getByTestId(`board-entry-${row}`).click();
  await ann.jd.when(() => !!document.querySelector('[data-testid=replay-banner]'));
  await ann.getByTestId('add-friend').click();
  await ann.jd.textMatches('add-friend', /^Asked$/, 5000);

  await home(sam);
  await sam.getByTestId('inbox').click();
  await sam.getByTestId('inbox-friend-request').waitFor();
  assert.match(await sam.getByTestId('inbox-friend-request').textContent(), /^Ann#\w+ wants to be friends/);
  await sam.getByTestId('inbox-friend-request').getByText('Accept').click();
  await until(async () => (await sam.getByTestId('inbox-friend-request').getByText('Accept').count()) === 0, { what: 'the buttons to go', timeout: 5000 });
  await sam.getByTestId('inbox-close').click();
  assert.deepEqual(unexpected(ann), []);
  assert.deepEqual(unexpected(sam), []);
});

test('the feed shows the game of a friend, and Beat this takes it up in one tap', { timeout: 60000 }, async () => {
  await openFriends(ann);
  await ann.getByTestId('feed-run').waitFor();
  assert.match(await ann.getByTestId('feed-run').textContent(), /^Sam#\w+ scored \$\d+ on today's yard/);
  assert.match(await ann.getByTestId('friends-list').textContent(), /Sam#/);
  await ann.screenshot({ path: path.join(SHOTS, `friends-${Date.now()}.png`) });
  await ann.locator('[data-testid^=feed-beat-]').first().click();
  await ann.jd.draft();
  assert.equal(await ann.evaluate((seed) => window.__jd.state().seed === seed, DAILY), true, 'the same yard');
  assert.deepEqual(unexpected(ann), []);
});

test('friends show on the chart of scores', { timeout: 60000 }, async () => {
  await play(ann, 'Ann', 2);
  await ann.jd.textMatches('hist-friends', /^Friends on this yard: Sam#\w+ \$\d+$/, 10000);
});

test('someone is added from a post in the talk, and it reads the same whether or not they said yes', { timeout: 60000 }, async () => {
  await home(sam);
  await sam.getByTestId('talk').click();
  await sam.getByTestId('thread-field').fill('Morning all');
  await sam.getByTestId('thread-send').click();
  await sam.locator('.jd-thread-post', { hasText: 'Morning all' }).waitFor();
  await sam.getByTestId('thread-close').click();
  await home(ann);
  await ann.getByTestId('talk').click();
  const post = ann.locator('.jd-thread-post', { hasText: 'Morning all' });
  await post.waitFor();
  assert.equal(await post.getByText('Add friend').count(), 0, 'they are friends already');
  await ann.getByTestId('thread-close').click();
  assert.deepEqual(unexpected(ann), []);
});

test('a block from the panel ends it for both, quietly, and lifts again', { timeout: 60000 }, async () => {
  await openFriends(sam);
  await sam.locator('[data-testid^=friend-block-]').first().click();
  await sam.getByTestId('friends-blocked').waitFor();
  assert.equal(await sam.getByTestId('friends-list').count(), 0);
  await openFriends(ann);
  await ann.jd.textMatches('friends-body', /^Nobody here yet\./, 5000);
  await ann.getByTestId('friends-close').click();
  await ann.getByTestId('inbox').click();
  await ann.getByTestId('inbox-rows').waitFor();
  assert.doesNotMatch(await ann.getByTestId('inbox-rows').textContent(), /block/i, 'not a word');
  await ann.getByTestId('inbox-close').click();
  await ann.getByTestId('talk').click();
  await ann.getByTestId('thread-dialog').waitFor();
  await ann.jd.textMatches('thread-empty', /^Nobody has said anything yet/, 5000);
  await ann.getByTestId('thread-close').click();
  await openFriends(sam);
  await sam.locator('[data-testid^=friend-unblock-]').first().click();
  await sam.jd.textMatches('friends-body', /^Nobody here yet\./, 5000);
  assert.deepEqual(unexpected(sam), []);
});

test('the friends panel fits a phone', { timeout: 30000 }, async () => {
  await ann.setViewportSize({ width: 390, height: 844 });
  await openFriends(ann);
  const box = await ann.getByTestId('friends-dialog').boundingBox();
  assert.ok(box.x >= 0 && box.x + box.width <= 390, JSON.stringify(box));
  const over = await ann.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  assert.equal(over, 0);
});
