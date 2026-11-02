// Production roadmap 0.11.12 in Chromium, with stand-ins for the classifier and the mail service: medals earn paint and the inbox says so, the
// paint shop opens from there and from More, a game starts in what a player wears, a material is never painted, a recording plays in its
// author's paint and the next game in the player's own, the Canvas renderer draws it too, a title reaches Home, the board, a post and the
// profile, the sentence is on the results and the fairness page, and the shop fits a phone.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fixture, SHOTS, until } from './e2e/fixture.mjs';
import { signIn, standIns } from './e2e/standins.mjs';
import { CommunityStore } from '../server/community.ts';

const stand = await standIns();
const f = await fixture({
  verifier: true,
  verifierEnv: {
    DAILY_SECRET: 'paint-e2e-secret',
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
const auth = async (page) => ({ 'Content-Type': 'application/json', Authorization: `Bearer ${await tokenOf(page)}` });

async function claim(page, name) {
  const res = await fetch(`${f.vurl}/identity`, { method: 'POST', headers: await auth(page), body: JSON.stringify({ name }) });
  assert.equal(res.status, 200);
}
let games = 0;
async function play(page, name) {
  const pattern = ++games;
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
const home = async (page) => {
  await page.goto(f.gameUrl());
  await page.jd.title();
};
const art = (page, key) => page.evaluate((k) => window.__jd.art(k), key);
/** A fresh game in this page, without a reload: the textures carry over as they do for a player. */
const freshGame = async (page, seed) => {
  await page.evaluate((s) => window.__jdGame.scene.getScene('Game').scene.start('Game', { seed: s, fresh: true }), seed);
  await page.jd.draft();
};
/** Average colour of what the Canvas renderer drew. */
const drawn = (page) =>
  page.evaluate(() => {
    const canvas = document.querySelector('#game canvas');
    const { data } = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height);
    const sum = [0, 0, 0];
    for (let i = 0; i < data.length; i += 4) for (let c = 0; c < 3; c++) sum[c] += data[i + c];
    return sum.map((v) => v / (data.length / 4));
  });
let plainPress, annPress, annGround;

test('medals earn paint: the inbox says so, the shop opens from it, and what is worn sticks', { timeout: 180000 }, async () => {
  await signIn(f, sam, stand.mails, 'sam@example.com');
  await claim(sam, 'Sam');
  await signIn(f, ann, stand.mails, 'ann@example.com');
  await claim(ann, 'Ann');
  await play(sam, 'Sam');
  await play(ann, 'Ann');

  const annId = createHash('sha256')
    .update(await tokenOf(ann))
    .digest('hex');
  const store = new CommunityStore(path.join(f.verifier.dataDir, 'community.db'));
  for (const day of ['2026-01-01', '2026-01-02', '2026-01-03'])
    store.closeDay(
      day,
      Array.from({ length: 40 }, (_, i) => ({ playerId: i ? `crowd-${i}` : annId, score: 1000 - i })),
    );
  store.grantCosmetics(annId, ['yard-moss']); // what days would bring, on a machine that has seen one day
  store.close();

  await home(ann);
  const headers = await auth(ann);
  await until(
    async () => {
      const { items } = await fetch(`${f.vurl}/me/inbox`, { headers }).then((r) => r.json());
      return items.some((i) => i.kind === 'cosmetic');
    },
    { what: 'a line about the paint', timeout: 10000 },
  );
  await home(ann);
  await ann.getByTestId('inbox').click();
  const line = ann.locator('[data-testid^=inbox-paint-]').first();
  await line.waitFor();
  assert.match(await ann.getByTestId('inbox-rows').textContent(), /You earned Verdigris\./);
  await line.click();
  await ann.getByTestId('paint-dialog').waitFor();
  assert.match(await ann.getByTestId('paint-lead').textContent(), /None of it changes play/);
  assert.match(await ann.getByTestId('paint-locked-yard-dusk').textContent(), /^Dusk3 days of dailies: 1 so far$/);
  assert.match(await ann.getByTestId('paint-locked-title-sals-pick').textContent(), /10 gold medals: 3 so far$/);
  await ann.getByTestId('paint-use-skin-verdigris').click();
  await ann.jd.textMatches('paint-use-skin-verdigris', /^In use$/, 5000);
  await ann.getByTestId('paint-use-yard-moss').click();
  await ann.jd.textMatches('paint-use-yard-moss', /^In use$/, 5000);
  await ann.getByTestId('paint-use-title-podium').click();
  await ann.jd.textMatches('paint-use-title-podium', /^In use$/, 5000);
  await ann.getByTestId('paint-close').click();
  await ann.getByTestId('inbox-close').click();

  await home(ann);
  await ann.getByTestId('more').click();
  await ann.getByTestId('paint').click();
  await ann.jd.textMatches('paint-use-skin-verdigris', /^In use$/, 5000);
  assert.equal(await ann.getByTestId('paint-use-skin-verdigris').isDisabled(), true);
  await ann.getByTestId('paint-close').click();
  assert.deepEqual(unexpected(ann), []);
});

test('a game starts in what a player wears, and a material is never painted', { timeout: 60000 }, async () => {
  await sam.goto(f.gameUrl('scene=game&seed=paint-yard'));
  await sam.jd.draft();
  await ann.goto(f.gameUrl('scene=game&seed=paint-yard'));
  await ann.jd.draft();
  plainPress = await art(sam, 'm-press');
  annPress = await art(ann, 'm-press');
  annGround = await art(ann, 'ground');
  assert.notEqual(annPress, plainPress, 'the machines are painted');
  assert.notEqual(annGround, await art(sam, 'ground'), 'and the yard');
  assert.equal(await art(ann, 'i-scrap'), await art(sam, 'i-scrap'), 'a material keeps its colour');
  assert.deepEqual(await ann.evaluate(() => window.__jdGame.textures.get('m-press').key), 'm-press', 'the rest of the game reads the same key');
  await ann.screenshot({ path: path.join(SHOTS, `paint-game-${Date.now()}.png`) });
  assert.deepEqual(unexpected(ann), []);
});

test("a recording plays in its author's paint, and the next game in the player's own", { timeout: 120000 }, async () => {
  await play(ann, 'Ann');
  await play(sam, 'Sam');
  await sam.waitForSelector('[data-testid=board-entry-1]', { timeout: 10000 });
  const row = (await sam.getByTestId('board-entry-0').textContent()).includes('Ann') ? 0 : 1;
  assert.match(await sam.getByTestId(`board-entry-${row}`).textContent(), /Ann#\w+ · On the Podium/, 'the title is on the board');
  await sam.waitForSelector(`[data-testid=board-entry-${row}]:not([disabled])`, { timeout: 10000 });
  await sam.getByTestId(`board-entry-${row}`).click();
  await sam.jd.when(() => !!document.querySelector('[data-testid=replay-banner]'));
  await sam.jd.textMatches('hint', /^Watching: recording by Ann#\w+ · On the Podium \(\$[\d,]+\)\.$/, 5000);
  assert.equal(await art(sam, 'm-press'), annPress, "the author's machines");
  assert.equal(await art(sam, 'ground'), annGround, "and the author's yard");
  await sam.screenshot({ path: path.join(SHOTS, `paint-recording-${Date.now()}.png`) });

  await freshGame(sam, 'paint-yard');
  assert.equal(await art(sam, 'm-press'), plainPress, 'back in his own');
  assert.deepEqual(unexpected(sam), []);
});

test('the paint shows in what is drawn', { timeout: 60000 }, async () => {
  const plain = await f.page();
  await plain.goto(f.gameUrl('scene=game&seed=paint-yard'));
  await plain.jd.draft();
  await ann.goto(f.gameUrl('scene=game&seed=paint-yard'));
  await ann.jd.draft();
  assert.equal(await ann.evaluate(() => window.__jdGame.renderer.type), 1, 'Phaser.CANVAS');
  const [a, b] = [await drawn(ann), await drawn(plain)];
  const apart = a.reduce((n, v, i) => n + Math.abs(v - b[i]), 0);
  assert.ok(apart > 3, `the yard reads differently on screen: ${a} against ${b}`);
  await ann.screenshot({ path: path.join(SHOTS, `paint-canvas-${Date.now()}.png`) });
  assert.deepEqual(unexpected(ann), []);
});

test('a title reaches Home, a post and the profile', { timeout: 60000 }, async () => {
  const res = await fetch(`${f.vurl}/posts`, {
    method: 'POST',
    headers: await auth(ann),
    body: JSON.stringify({ key: 'hub:strategies', body: 'Press before the dock' }),
  });
  assert.equal(res.status, 200);
  const { id } = (await res.json()).post;
  await home(sam);
  await sam.jd.textMatches('daily-board', /Ann#\w+ · On the Podium/, 10000);
  await sam.getByTestId('community').waitFor();
  await sam.getByTestId('community').click();
  await sam.getByTestId('hub-open-strategies').click();
  await sam.getByTestId(`post-profile-${id}`).waitFor();
  assert.match(await sam.getByTestId(`post-profile-${id}`).textContent(), /^Ann#\w+ · On the Podium$/);
  await sam.getByTestId(`post-profile-${id}`).click();
  await sam.jd.textMatches('profile-badge', /^On the Podium$/, 5000);
  assert.deepEqual(unexpected(sam), []);
});

test('the sentence is on the results and on the fairness page', { timeout: 60000 }, async () => {
  await play(sam, 'Sam');
  assert.equal(await sam.getByTestId('results-paint-note').textContent(), 'Paint, titles and medals never change play: same offers, same rules, same score.');
  const policy = await fetch(`${f.url}/policy.json`).then((r) => r.json());
  assert.ok(policy.sections.some((s) => s.lines.some((l) => /Paint and titles .*never change an offer, a rule or a score\./.test(l))));
});

test('the shop fits a phone', { timeout: 60000 }, async () => {
  await ann.setViewportSize({ width: 390, height: 844 });
  await home(ann);
  await ann.getByTestId('more').click();
  await ann.getByTestId('paint').click();
  await ann.getByTestId('paint-dialog').waitFor();
  const box = await ann.getByTestId('paint-dialog').boundingBox();
  assert.ok(box.x >= 0 && box.x + box.width <= 390 && box.y >= 0 && box.y + box.height <= 844, JSON.stringify(box));
  assert.ok(await ann.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'no sideways scroll');
  await ann.screenshot({ path: path.join(SHOTS, `paint-shop-phone-${Date.now()}.png`) });
  await ann.getByTestId('paint-list').evaluate((e) => e.scrollTo(0, e.scrollHeight));
  await ann.screenshot({ path: path.join(SHOTS, `paint-shop-phone-end-${Date.now()}.png`) });
  await ann.getByTestId('paint-close').click();
  await ann.setViewportSize({ width: 1120, height: 700 });
});
