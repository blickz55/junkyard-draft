// Production roadmap 0.11.10 in Chromium, with stand-ins for the classifier and the mail service: Home leads to the community, a post in
// a category shows on the plain page, the days with a talk are listed, topics open once enough people are posting, a person closes a
// thread from the queue page and the game says so, and the panel fits a phone.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fixture, SHOTS } from './e2e/fixture.mjs';
import { signIn, standIns } from './e2e/standins.mjs';
import { CommunityStore } from '../server/community.ts';
import { HUB_V2_POSTERS } from '../game/src/content/hub.ts';

const TOKEN = 'e2e-token';
const stand = await standIns();
const f = await fixture({
  verifier: true,
  verifierEnv: { DAILY_SECRET: 'hub-e2e-secret', VERIFIER_LOG: '0', BOT_PAR: '0', MODERATION_TOKEN: TOKEN, POST_RATE_LIMIT: '1000', ...stand.env },
});
after(async () => {
  await f.close();
  await stand.close();
});

const sam = await f.page();
const mod = await f.page({ bypassCSP: false });
/** The refusals these tests ask for reach the console as failed requests. */
const unexpected = (page) => page.errors.filter((e) => !/status of 4(03|09|22) /.test(e));
const home = async (page) => {
  await page.goto(f.gameUrl());
  await page.jd.title();
};
const openHub = async () => {
  await home(sam);
  await sam.getByTestId('community').waitFor();
  await sam.getByTestId('community').click();
  await sam.getByTestId('hub-dialog').waitFor();
};
const row = (words) => sam.locator('.jd-thread-post', { hasText: words });

test(
  'Home leads to the community: the four categories, no way to start a topic yet, a post goes in and shows on the plain page',
  { timeout: 120000 },
  async () => {
    await signIn(f, sam, stand.mails, 'sam@example.com');
    const { token } = await sam.evaluate(() => JSON.parse(localStorage.getItem('jd.identity.v1')));
    await fetch(`${f.vurl}/identity`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ name: 'Sam' }),
    });
    await openHub();
    for (const words of ['Strategies', 'Show your yard', 'Help and bugs', 'Off-shift'])
      assert.ok((await sam.getByTestId('hub-body').textContent()).includes(words), words);
    assert.equal(await sam.getByTestId('hub-start-strategies').count(), 0, 'topics are not open yet');
    await sam.getByTestId('hub-open-strategies').click();
    await sam.jd.textMatches('thread-head', /^Strategies$/, 5000);
    await sam.getByTestId('thread-field').fill('Press before the dock, always');
    await sam.getByTestId('thread-send').click();
    await row('Press before the dock').waitFor();
    await sam.getByTestId('thread-close').click();
    await sam.getByTestId('hub-close').click();
    const page = await fetch(`${f.vurl}/community/hub/strategies`).then((r) => r.text());
    assert.ok(page.includes('Press before the dock, always'));
    assert.deepEqual(unexpected(sam), []);
  },
);

test('once enough people are posting a player can start a topic, and it reads like any other thread', { timeout: 60000 }, async () => {
  const store = new CommunityStore(path.join(f.verifier.dataDir, 'community.db'));
  const thread = store.threadFor('hub', 'hub:offshift', null, null, 'offshift');
  for (let i = 0; i < HUB_V2_POSTERS; i++) store.addPost(thread.id, `crowd-${i}`, `hello from ${i}`);
  store.close();
  await openHub();
  await sam.getByTestId('hub-start-help').click();
  await sam.getByTestId('topic-dialog').waitFor();
  await sam.getByTestId('topic-title').fill('see example.com');
  await sam.getByTestId('topic-body').fill('It will not open');
  await sam.getByTestId('topic-send').click();
  await sam.jd.textMatches('topic-status', /^Links are not allowed here\./, 5000);
  await sam.getByTestId('topic-title').fill('The dock stops at round 4');
  await sam.getByTestId('topic-body').fill('pushy question about my line');
  await sam.getByTestId('topic-send').click();
  await sam.getByTestId('thread-dialog').waitFor();
  await sam.jd.textMatches('thread-head', /^The dock stops at round 4$/, 5000);
  await row('pushy question').waitFor();
  await sam.getByTestId('thread-close').click();
  await sam.getByTestId('hub-close').click();
  assert.deepEqual(unexpected(sam), []);
});

test('a person closes a thread and pins it from the queue page; the game says it is closed', { timeout: 60000 }, async () => {
  await mod.goto(`${f.vurl}/moderation/`);
  await mod.getByTestId('mod-key').fill(TOKEN);
  await mod.getByTestId('mod-enter').click();
  await mod.locator('[data-testid^=mod-lock-]').first().click();
  await mod.waitForFunction(() => document.querySelector('[data-testid=mod-status]').textContent === 'Thread closed.');
  await mod.locator('[data-testid^=mod-pin-]').first().click();
  await mod.waitForFunction(() => document.querySelector('[data-testid=mod-status]').textContent === 'Pinned.');
  await openHub();
  await sam.getByText('📌', { exact: false }).waitFor();
  await sam.locator('[data-testid^=hub-read-]').first().click();
  await sam.jd.textMatches('thread-write-state', /^This thread is closed\.$/, 5000);
  assert.equal(await sam.getByTestId('thread-field').count(), 0);
  await sam.getByTestId('thread-close').click();
  assert.deepEqual(unexpected(mod), []);
});

test('the hub fits a phone', { timeout: 30000 }, async () => {
  await sam.setViewportSize({ width: 390, height: 844 });
  const box = await sam.getByTestId('hub-dialog').boundingBox();
  assert.ok(box.x >= 0 && box.x + box.width <= 390, JSON.stringify(box));
  assert.ok(box.y >= 0 && box.y + box.height <= 844, JSON.stringify(box));
  const over = await sam.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  assert.equal(over, 0);
  await sam.screenshot({ path: path.join(SHOTS, `hub-phone-${Date.now()}.png`) });
});
