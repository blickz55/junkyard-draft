// Production roadmap 0.11.13 in Chromium, with stand-ins for the classifier and the mail service: a board row, a comment on a game and a post
// in the hub all open the same profile; the switch in Privacy & data leaves only the name on all three, and tells the owner so; Beat this
// from a profile takes up the game and leaves nothing open behind it; and it all fits a phone.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fixture, SHOTS } from './e2e/fixture.mjs';
import { signIn, standIns } from './e2e/standins.mjs';

const stand = await standIns();
const f = await fixture({
  verifier: true,
  verifierEnv: {
    DAILY_SECRET: 'profile-e2e-secret',
    VERIFIER_LOG: '0',
    BOT_PAR: '0',
    MODERATION_TOKEN: 'e2e-token',
    POST_RATE_LIMIT: '1000',
    PLAYER_RATE_LIMIT: '1000',
    ...stand.env,
  },
});
after(async () => {
  await f.close();
  await stand.close();
});

const { seed: DAILY } = await fetch(`${f.vurl}/daily?limit=1`).then((r) => r.json());
const sam = await f.page();
const ann = await f.page();
const unexpected = (page) => page.errors.filter((e) => !/status of 4(03|09|22) /.test(e));
const tokenOf = (page) => page.evaluate(() => JSON.parse(localStorage.getItem('jd.identity.v1')).token);

async function claim(page, name) {
  const res = await fetch(`${f.vurl}/identity`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${await tokenOf(page)}` },
    body: JSON.stringify({ name }),
  });
  assert.equal(res.status, 200);
}
let games = 0;
async function play(page, name) {
  const pattern = ++games; // each game a different one: identical games are one run
  await page.goto(f.gameUrl(`scene=game&seed=${DAILY}`));
  await page.evaluate((n) => localStorage.setItem('jd.player', n), name);
  await page.jd.draft();
  for (let r = 1; r <= 6; r++) {
    await page.jd.api('pick', (pattern >> (r - 1)) & 1);
    await page.jd.api('run');
    await page.jd.api('finishRun');
    await page.jd.mode('summary');
    await page.jd.api('next');
  }
  await page.jd.results(10000);
  await page.getByTestId('submit').click();
  await page.jd.textMatches('status', /^Checked: /, 15000);
}
const post = async (page, key, body) => {
  const res = await fetch(`${f.vurl}/posts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${await tokenOf(page)}` },
    body: JSON.stringify({ key, body }),
  });
  assert.equal(res.status, 200);
  return (await res.json()).post.id;
};
const home = async (page) => {
  await page.goto(f.gameUrl());
  await page.jd.title();
};
/** Sam's row of the board for Ann's game: the order depends on who scored more. */
const annRow = async () => ((await sam.getByTestId('board-entry-0').textContent()).includes('Ann') ? 0 : 1);
const closeProfile = async () => {
  await sam.getByTestId('profile-close').click();
  await sam.jd.when(() => !document.querySelector('[data-testid=profile-dialog]'));
};
const openHubPost = async (id) => {
  await home(sam);
  await sam.getByTestId('community').waitFor();
  await sam.getByTestId('community').click();
  await sam.getByTestId('hub-open-strategies').click();
  await sam.getByTestId(`post-profile-${id}`).click();
  await sam.getByTestId('profile-dialog').waitFor();
};
/** The board comes with the results of a game. */
const openBoard = async () => {
  await play(sam, 'Sam');
  await sam.waitForSelector('[data-testid=board-entry-1]', { timeout: 10000 });
};
const openComment = async (id) => {
  await openBoard();
  const row = await annRow();
  await sam.waitForSelector(`[data-testid=board-entry-${row}]:not([disabled])`, { timeout: 10000 });
  await sam.getByTestId(`board-entry-${row}`).click();
  await sam.jd.when(() => !!document.querySelector('[data-testid=replay-banner]'));
  await sam.getByTestId('game-talk').click();
  await sam.getByTestId(`post-profile-${id}`).click();
  await sam.getByTestId('profile-dialog').waitFor();
};
let hash, hubPost, comment;

test('a board row, a comment and a post in the hub all open the same profile', { timeout: 180000 }, async () => {
  await signIn(f, sam, stand.mails, 'sam@example.com');
  await claim(sam, 'Sam');
  await signIn(f, ann, stand.mails, 'ann@example.com');
  await claim(ann, 'Ann');
  await play(ann, 'Ann');
  await openBoard();
  hash = (await fetch(`${f.vurl}/daily?limit=5`).then((r) => r.json())).entries.find((e) => e.player.startsWith('Ann')).replayHash;
  hubPost = await post(ann, 'hub:strategies', 'Press before the dock');
  comment = await post(ann, hash, 'A good one');

  const row = await annRow();
  await sam.getByTestId(`profile-${row}`).click();
  await sam.getByTestId('profile-dialog').waitFor();
  const dialog = await sam.getByTestId('profile-dialog').textContent();
  assert.match(dialog, /Ann#\w+/);
  assert.match(await sam.getByTestId('profile-joined').textContent(), /^Here since \w+ \d{4}$/);
  assert.equal(await sam.getByTestId('profile-best').count(), 1);
  assert.match(await sam.getByTestId('profile-best').textContent(), /^\$[\d,]+ · /);
  await sam.getByTestId('profile-friend').waitFor();
  await sam.screenshot({ path: path.join(SHOTS, `profile-${Date.now()}.png`) });
  await closeProfile();

  await openHubPost(hubPost);
  assert.match(await sam.getByTestId('profile-dialog').textContent(), /Ann#\w+/);
  assert.equal(await sam.getByTestId('profile-best').count(), 1);
  await closeProfile();
  await sam.getByTestId('thread-dialog').waitFor();

  await openComment(comment);
  assert.match(await sam.getByTestId('profile-dialog').textContent(), /Ann#\w+/);
  assert.equal(await sam.getByTestId('profile-best').count(), 1);
  await closeProfile();
  assert.deepEqual(unexpected(sam), []);
});

test('the switch leaves only the name on all three, and tells its owner', { timeout: 180000 }, async () => {
  const openPrivacy = async () => {
    await home(ann);
    await ann.getByTestId('more').click();
    await ann.getByTestId('privacy').click();
    await ann.getByTestId('privacy-profile').waitFor();
  };
  await openPrivacy();
  assert.equal(await ann.getByTestId('privacy-profile').textContent(), 'Show my profile: On');
  await ann.getByTestId('privacy-profile').click();
  await ann.jd.textMatches('privacy-profile', /^Show my profile: Off$/, 5000);
  await openPrivacy();
  assert.equal(await ann.getByTestId('privacy-profile').textContent(), 'Show my profile: Off', 'the server keeps it');

  const nameOnly = async () => {
    await sam.getByTestId('profile-private').waitFor();
    assert.match(await sam.getByTestId('profile-dialog').textContent(), /Ann#\w+/);
    assert.equal(await sam.getByTestId('profile-private').textContent(), 'This player shows only their name.');
    for (const part of ['profile-joined', 'profile-best', 'profile-trophies', 'profile-none']) assert.equal(await sam.getByTestId(part).count(), 0, part);
  };
  await openBoard();
  await sam.getByTestId(`profile-${await annRow()}`).click();
  await nameOnly();
  await sam.screenshot({ path: path.join(SHOTS, `profile-private-${Date.now()}.png`) });
  await closeProfile();
  await openHubPost(hubPost);
  await nameOnly();
  await closeProfile();
  await openComment(comment);
  await nameOnly();
  await closeProfile();

  await play(ann, 'Ann');
  await ann.waitForSelector('[data-testid=board-entry-1]', { timeout: 10000 });
  const own = (await ann.getByTestId('board-entry-0').textContent()).includes('Ann') ? 0 : 1;
  await ann.getByTestId(`profile-${own}`).click();
  await ann.getByTestId('profile-own-hidden').waitFor();
  assert.equal(await ann.getByTestId('profile-own-hidden').textContent(), 'Other players see only your name.');
  assert.equal(await ann.getByTestId('profile-best').count(), 1, 'the owner sees their own');

  await openPrivacy();
  await ann.getByTestId('privacy-profile').click();
  await ann.jd.textMatches('privacy-profile', /^Show my profile: On$/, 5000);
  assert.deepEqual(unexpected(ann), []);
  assert.deepEqual(unexpected(sam), []);
});

test('Beat this from a profile takes up the game and leaves nothing open behind it', { timeout: 60000 }, async () => {
  await openHubPost(hubPost);
  await sam.getByTestId('profile-beat-0').click();
  await sam.jd.draft();
  assert.equal(await sam.evaluate((seed) => window.__jd.state().seed === seed, DAILY), true, 'the same yard');
  for (const dialog of ['profile-dialog', 'thread-dialog', 'hub-dialog']) assert.equal(await sam.getByTestId(dialog).count(), 0, dialog);
  assert.deepEqual(unexpected(sam), []);
});

test('on a phone the row keeps its buttons on screen and the profile fits', { timeout: 120000 }, async () => {
  await sam.setViewportSize({ width: 360, height: 780 });
  await openBoard();
  const row = await annRow();
  // the longest name a board can hold, on the narrowest phone
  await sam.evaluate((i) => {
    document.querySelector(`[data-testid=board-entry-${i}]`).textContent = `1. $99999 ${'W'.repeat(32)}#WWWW ★★★ ▶`;
  }, row);
  const box = await sam.getByTestId(`profile-${row}`).boundingBox();
  assert.ok(box && box.x + box.width <= 360, `the button is on screen: ${JSON.stringify(box)}`);
  assert.ok(await sam.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'no sideways scroll');
  await sam.screenshot({ path: path.join(SHOTS, `profile-board-phone-${Date.now()}.png`), fullPage: true });
  await sam.getByTestId(`profile-${row}`).click();
  await sam.getByTestId('profile-dialog').waitFor();
  const dialog = await sam.getByTestId('profile-dialog').boundingBox();
  assert.ok(dialog.x >= 0 && dialog.x + dialog.width <= 360, 'the profile fits');
  await sam.screenshot({ path: path.join(SHOTS, `profile-phone-${Date.now()}.png`) });
  await closeProfile();
  await sam.setViewportSize({ width: 1120, height: 700 });

  // a real touch screen: the name in a post is a target a thumb can hit
  const phone = await f.page({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  await home(phone);
  await phone.getByTestId('community').waitFor();
  await phone.getByTestId('community').click();
  await phone.getByTestId('hub-open-strategies').click();
  await phone.getByTestId(`post-profile-${hubPost}`).waitFor();
  const name = await phone.getByTestId(`post-profile-${hubPost}`).boundingBox();
  assert.ok(name.height >= 44, `a thumb can hit it: ${JSON.stringify(name)}`);
  await phone.screenshot({ path: path.join(SHOTS, `profile-thread-phone-${Date.now()}.png`) });
  await phone.getByTestId(`post-profile-${hubPost}`).tap();
  await phone.getByTestId('profile-dialog').waitFor();
});
