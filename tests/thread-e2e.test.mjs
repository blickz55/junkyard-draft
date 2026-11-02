// Production roadmap 0.11.5 in Chromium, with stand-ins for the classifier and the mail service: the talk stays shut until a game is
// in, a player writes from the results, changes a post and takes one back, another reads, reports and answers, the first hears about
// it in the inbox, a post that comes down shows only to its author, a game can be attached and watched, a device that has not signed
// in is shown the way, and the whole thing fits a phone.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fixture, SHOTS, until } from './e2e/fixture.mjs';
import { signIn, standIns } from './e2e/standins.mjs';

const stand = await standIns();
const f = await fixture({
  verifier: true,
  verifierEnv: { DAILY_SECRET: 'thread-e2e-secret', VERIFIER_LOG: '0', BOT_PAR: '0', MODERATION_TOKEN: 'e2e-token', POST_RATE_LIMIT: '1000', ...stand.env },
});
after(async () => {
  await f.close();
  await stand.close();
});

const today = new Date().toISOString().slice(0, 10);
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
/** Six shifts of today's yard through the game, then the results. */
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
}
const submit = async (page) => {
  await page.getByTestId('submit').click();
  await page.jd.textMatches('status', /^Checked: /, 15000);
};
const openTalk = async (page) => {
  await page.goto(f.gameUrl());
  await page.jd.title();
  await page.getByTestId('talk').waitFor();
  await page.getByTestId('talk').click();
  await page.getByTestId('thread-dialog').waitFor();
};
const write = async (page, words) => {
  await page.getByTestId('thread-field').fill(words);
  await page.getByTestId('thread-send').click();
};
const row = (page, words) => page.locator('.jd-thread-post', { hasText: words });

test('the talk stays shut until a game is in, then opens from the results', { timeout: 120000 }, async () => {
  await signIn(f, sam, stand.mails, 'sam@example.com');
  await claim(sam, 'Sam');
  await openTalk(sam);
  await sam.jd.textMatches('thread-list', /^Finish a game on this yard and the talk opens\./, 5000);
  assert.equal(await sam.getByTestId('thread-field').count(), 0, 'nothing to write in');
  await sam.getByTestId('thread-close').click();

  await play(sam, 'Sam', 0);
  await submit(sam);
  await sam.getByTestId('results-talk').click();
  await sam.getByTestId('thread-dialog').waitFor();
  await sam.jd.textMatches('thread-empty', /^Nobody has said anything yet\./, 5000);
  assert.match(await sam.getByTestId('thread-sal').textContent(), /yard|Fresh/i, 'Sal opened the day');
  assert.deepEqual(unexpected(sam), []);
});

test(
  'a post shows at once to its author and the note goes when the classifier has read it; a refusal says why and keeps the words',
  { timeout: 60000 },
  async () => {
    await write(sam, 'see my site at example.com');
    await sam.jd.textMatches('thread-status', /^Links are not allowed here\./, 5000);
    assert.equal(await sam.getByTestId('thread-field').inputValue(), 'see my site at example.com', 'nothing lost');
    await write(sam, 'I built a thing with two presses');
    await row(sam, 'I built a thing').waitFor();
    assert.equal(await sam.getByTestId('thread-field').inputValue(), '');
    await until(async () => !/Checking/.test(await row(sam, 'I built a thing').textContent()), { what: 'the note to go', timeout: 10000 });
    assert.equal(await sam.getByTestId('thread-count').textContent(), '0 of 280');
    assert.deepEqual(unexpected(sam), []);
  },
);

test('a second player reads it, reports it, answers; the first hears there is more and reads it from the inbox', { timeout: 120000 }, async () => {
  await signIn(f, ann, stand.mails, 'ann@example.com');
  await claim(ann, 'Ann');
  await play(ann, 'Ann', 1);
  await submit(ann);
  await openTalk(ann);
  await row(ann, 'I built a thing').waitFor();
  assert.match(await row(ann, 'I built a thing').textContent(), /Sam#/, 'under their name');
  assert.equal(await ann.getByTestId('thread-field').isVisible(), true);
  const post = row(ann, 'I built a thing');
  await post.getByText('Report').click();
  await ann.getByTestId('report-post-dialog').waitFor();
  await ann.getByTestId('report-post-spam').click();
  await post.getByText('Reported. A person will look.').waitFor();
  await write(ann, 'Two presses, nice. I went with one furnace');
  await row(ann, 'Two presses, nice').waitFor();
  await ann.getByTestId('thread-close').click();

  await sam.goto(f.gameUrl());
  await sam.jd.title();
  await sam.getByTestId('inbox').click();
  await sam.getByTestId('inbox-thread-reply').waitFor();
  await sam.getByTestId('inbox-thread-reply').getByText('Read').click();
  await sam.getByTestId('thread-dialog').waitFor();
  await row(sam, 'Two presses, nice').waitFor();
  assert.deepEqual(unexpected(ann), []);
});

test('a player changes a post, which reads as edited, and takes one back, which is gone', { timeout: 60000 }, async () => {
  const mine = row(sam, 'I built a thing');
  await mine.getByText('Change').click();
  const field = sam.locator('[data-testid^=post-edit-]').first();
  await field.fill('I built a thing with three presses');
  await sam.locator('[data-testid^=post-save-]').first().click();
  await row(sam, 'three presses').waitFor();
  assert.match(await row(sam, 'three presses').textContent(), /edited/);

  await write(sam, 'Never mind that last bit');
  const gone = row(sam, 'Never mind that last bit');
  await gone.waitFor();
  await gone.getByText('Take back').click();
  await sam.getByTestId('take-back-yes').click();
  await until(async () => (await gone.count()) === 0, { what: 'the post to go', timeout: 5000 });
  await sam.getByTestId('thread-close').click();
  await sam.goto(f.gameUrl());
  await sam.jd.title();
  await sam.getByTestId('talk').click();
  await row(sam, 'three presses').waitFor();
  assert.equal(await row(sam, 'Never mind that last bit').count(), 0, 'it stays gone');
  assert.deepEqual(unexpected(sam), []);
});

test('a post that comes down shows only to its author, with why; nobody else sees it, and it cannot be changed', { timeout: 60000 }, async () => {
  await write(sam, 'something nasty about you');
  await row(sam, 'something nasty').waitFor();
  await sam.getByTestId('thread-close').click();
  await sam.goto(f.gameUrl());
  await sam.jd.title();
  await sam.getByTestId('talk').click();
  const held = row(sam, 'something nasty');
  await until(async () => /Only you can see this until a person has looked at it\. It attacked people for who they are\./.test(await held.textContent()), {
    what: 'the note',
    timeout: 10000,
  });
  assert.equal(await held.getByText('Change').count(), 0);
  assert.equal(await held.getByText('Take back').count(), 0, 'a post under review stays as it is');
  await openTalk(ann);
  await row(ann, 'three presses').waitFor();
  assert.equal(await row(ann, 'something nasty').count(), 0);
});

test('a game can be attached, and another player watches it from the post', { timeout: 60000 }, async () => {
  await write(ann, 'Here is how I did it');
  await row(ann, 'Here is how I did it').waitFor();
  await sam.getByTestId('thread-attach').check();
  await write(sam, 'Watch this one');
  await row(sam, 'Watch this one').waitFor();
  assert.match(await row(sam, 'Watch this one').textContent(), /Watch/);
  await ann.getByTestId('thread-close').click();
  await openTalk(ann);
  const post = row(ann, 'Watch this one');
  await post.waitFor();
  await post.getByText('Watch', { exact: true }).click();
  await ann.jd.when(() => !!document.querySelector('[data-testid=replay-banner]'), undefined, 15000);
  assert.deepEqual(unexpected(ann), []);
});

test('a comment on a recording lands in the inbox of its owner, and the talk on a game shows on their results', { timeout: 60000 }, async () => {
  // Ann is watching Sam's game from the last test
  await ann.getByTestId('game-talk').click();
  await ann.getByTestId('thread-dialog').waitFor();
  await ann.jd.textMatches('thread-head', /^The talk on Sam#\w+'s \$[\d,]+$/, 5000);
  assert.equal(await ann.getByTestId('thread-attach').count(), 0, 'nothing to attach to a game');
  await write(ann, 'That press is clever');
  await row(ann, 'That press is clever').waitFor();
  assert.deepEqual(unexpected(ann), []);

  await sam.getByTestId('thread-close').click();
  await sam.goto(f.gameUrl());
  await sam.jd.title();
  await sam.getByTestId('inbox').click();
  const line = sam.getByTestId('inbox-thread-reply').filter({ hasText: 'New words on your' });
  await line.waitFor();
  assert.match(await line.textContent(), /New words on your \$[\d,]+ on today's yard/);
  await line.getByText('Read').click();
  await row(sam, 'That press is clever').waitFor();
  await sam.getByTestId('thread-close').click();
  await sam.getByTestId('inbox-close').click();
  assert.deepEqual(unexpected(sam), []);
});

test('a device with no email is shown the way in, and a closed day can be read with no game at all', { timeout: 60000 }, async () => {
  const guest = await f.page();
  await guest.goto(f.gameUrl());
  await guest.jd.title();
  await guest.getByTestId('talk').waitFor();
  assert.match(await guest.getByTestId('talk').textContent(), /^Today's talk \(\d+\)$/, 'with how much there is');
  await guest.getByTestId('talk').click();
  await guest.jd.textMatches('thread-list', /^Finish a game on this yard/, 5000);
  await guest.getByTestId('thread-close').click();
  await play(guest, 'Lou', 2);
  await submit(guest);
  await openTalk(guest);
  await row(guest, 'three presses').waitFor();
  assert.equal(await guest.getByTestId('thread-write-state').textContent(), 'Sign in with email to write here.');
  assert.equal(await guest.getByTestId('thread-field').count(), 0);
  await guest.getByTestId('thread-sign-in').click();
  await guest.getByTestId('link-dialog').waitFor();
  await guest.getByTestId('link-close').click();
  await guest.getByTestId('thread-close').click();

  const old = new Date(Date.now() - 5 * 86_400_000).toISOString().slice(0, 10);
  const open = await fetch(`${f.vurl}/community/day/${today}`).then((r) => r.text());
  assert.ok(open.includes('still open') && !open.includes('three presses'), 'an open day shows the web nothing of its talk');
  const closed = await fetch(`${f.vurl}/community/day/${old}`);
  assert.equal(closed.status, 200);
  assert.ok((await closed.text()).includes('Nobody put a game on this one'));
  assert.deepEqual(unexpected(guest), []);
});

test('the talk fits a phone: the box and the buttons stay on screen, nothing runs off the side', { timeout: 30000 }, async () => {
  await sam.setViewportSize({ width: 390, height: 844 });
  await sam.goto(f.gameUrl());
  await sam.jd.title();
  await sam.getByTestId('talk').click();
  await row(sam, 'three presses').waitFor();
  const box = await sam.getByTestId('thread-dialog').boundingBox();
  assert.ok(box.x >= 0 && box.x + box.width <= 390, JSON.stringify(box));
  assert.ok(box.y >= 0 && box.y + box.height <= 844, JSON.stringify(box));
  const send = await sam.getByTestId('thread-send').boundingBox();
  assert.ok(send.y + send.height <= 844, 'the button is reachable');
  await sam.screenshot({ path: path.join(SHOTS, `thread-phone-${Date.now()}.png`) });
});
