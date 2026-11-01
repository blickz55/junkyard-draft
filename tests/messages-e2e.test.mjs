// Production roadmap 0.11.9 in Chromium, with stand-ins for the classifier and the mail service: two friends talk, a message is
// refused by the filter, one is reported and reaches a person with what surrounds it, removed it shows as removed to both, and an
// appeal puts it back. The panel says who reads what, and fits a phone.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fixture, SHOTS } from './e2e/fixture.mjs';
import { signIn, standIns } from './e2e/standins.mjs';

const TOKEN = 'e2e-token';
const stand = await standIns();
const f = await fixture({
  verifier: true,
  verifierEnv: { DAILY_SECRET: 'messages-e2e-secret', VERIFIER_LOG: '0', BOT_PAR: '0', MODERATION_TOKEN: TOKEN, POST_RATE_LIMIT: '1000', ...stand.env },
});
after(async () => {
  await f.close();
  await stand.close();
});

const sam = await f.page();
const ann = await f.page();
const mod = await f.page({ bypassCSP: false });
const CLOSED_DAY = new Date(Date.now() - 5 * 86_400_000).toISOString().slice(0, 10);
/** The refusals these tests ask for reach the console as failed requests. */
const unexpected = (page) => page.errors.filter((e) => !/status of 4(03|09|22) /.test(e));

const tokenOf = async (page) => (await page.evaluate(() => JSON.parse(localStorage.getItem('jd.identity.v1')))).token;
const api = async (token, p, body) => {
  const res = await fetch(`${f.vurl}${p}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return res.json();
};
const home = async (page) => {
  await page.goto(f.gameUrl());
  await page.jd.title();
};
const done = (text) => mod.waitForFunction((t) => document.querySelector('[data-testid=mod-status]').textContent === t, text);

test('friends write to each other; the panel says who reads it; the filter holds', { timeout: 120000 }, async () => {
  await signIn(f, sam, stand.mails, 'sam@example.com');
  await signIn(f, ann, stand.mails, 'ann@example.com');
  const samKey = await tokenOf(sam);
  const annKey = await tokenOf(ann);
  await api(samKey, '/identity', { name: 'Sam' });
  await api(annKey, '/identity', { name: 'Ann' });
  const { post } = await api(samKey, '/posts', { key: CLOSED_DAY, body: 'Hello from the yard' });
  await api(annKey, '/friends/request', { postId: post.id });
  const { incoming } = await api(samKey, '/friends');
  await api(samKey, '/friends/answer', { handle: incoming[0].handle, accept: true });

  await home(sam);
  await sam.getByTestId('friends').click();
  await sam.locator('[data-testid^=friend-message-]').first().click();
  await sam.getByTestId('messages-dialog').waitFor();
  await sam.jd.textMatches('messages-head', /^With Ann#\w+$/, 5000);
  assert.match(await sam.getByTestId('messages-private').textContent(), /Only the two of you read this, unless one of you reports a message\./);
  await sam.getByTestId('messages-field').fill('call me on 555-123-4567');
  await sam.getByTestId('messages-send').click();
  await sam.jd.textMatches('messages-status', /^Phone numbers are not allowed here\./, 5000);
  await sam.getByTestId('messages-field').fill('Good run this morning');
  await sam.getByTestId('messages-send').click();
  await sam.getByText('Good run this morning').waitFor();
  await sam.getByTestId('messages-field').fill('Something you would report');
  await sam.getByTestId('messages-send').click();
  await sam.getByText('Something you would report').waitFor();
  await sam.screenshot({ path: path.join(SHOTS, `messages-${Date.now()}.png`) });
  assert.deepEqual(unexpected(sam), []);
});

test('the other reads it from the inbox, answers, and reports one; only then does it reach a person, with what surrounds it', { timeout: 60000 }, async () => {
  await home(ann);
  await ann.getByTestId('inbox').click();
  await ann.getByTestId('inbox-message').waitFor();
  assert.match(await ann.getByTestId('inbox-message').textContent(), /^Sam#\w+ sent you a message/);
  await ann.getByTestId('inbox-message').getByText('Read').click();
  await ann.getByText('Good run this morning').waitFor();
  await ann.getByTestId('messages-field').fill('Thanks');
  await ann.getByTestId('messages-send').click();
  await ann.getByText('Thanks', { exact: true }).waitFor();

  const reported = ann.locator('.jd-message', { hasText: 'Something you would report' });
  await reported.getByText('Report', { exact: true }).click();
  await ann.getByTestId('report-message-dialog').waitFor();
  await ann.getByTestId('report-message-offensive').click();
  await reported.getByText('Reported. A person will look.').waitFor();
  assert.deepEqual(unexpected(ann), []);

  await mod.goto(`${f.vurl}/moderation/`);
  await mod.getByTestId('mod-key').fill(TOKEN);
  await mod.getByTestId('mod-enter').click();
  const card = mod.locator('[data-testid^=mod-message-]');
  await card.waitFor();
  const text = await card.textContent();
  assert.match(text, /Sam#\w+ to Ann#\w+/);
  assert.match(text, /reports: offensive × 1/);
  for (const words of ['Good run this morning', 'Something you would report', 'Thanks']) assert.ok(text.includes(words), words);
  await mod.screenshot({ path: path.join(SHOTS, `moderation-message-${Date.now()}.png`), fullPage: true });
});

test('a person removes it: both see it gone, the sender hears why, and an appeal puts it back', { timeout: 60000 }, async () => {
  await mod.locator('[data-testid^=mod-delete-m]').first().click();
  await done('Removed.');
  assert.match(await mod.getByTestId('mod-messages').textContent(), /No reported messages\./);

  await home(sam);
  await sam.getByTestId('inbox').click();
  await sam.getByTestId('inbox-moderation').first().waitFor();
  assert.match(await sam.getByTestId('inbox-rows').textContent(), /A person removed your message: "Something you would report"\./);
  await sam.locator('[data-testid^=inbox-appeal-]').first().click();
  await sam.getByTestId('appeal-field').fill('It was a joke between friends.');
  await sam.getByTestId('appeal-send').click();
  await sam.jd.textMatches('appeal-status', /^Sent\./, 5000);
  await sam.getByTestId('appeal-close').click();
  await sam.getByTestId('inbox-close').click();

  await home(ann);
  await ann.getByTestId('friends').click();
  await ann.locator('[data-testid^=friend-message-]').first().click();
  await ann.getByText('A person removed this message.').waitFor();
  assert.equal(await ann.getByText('Something you would report').count(), 0);
  await ann.getByTestId('messages-close').click();

  await mod.getByTestId('mod-refresh').click();
  await mod.locator('[data-testid^=mod-appeal-undo-]').click();
  await done('The decision is undone.');
  await ann.goto(f.gameUrl());
  await ann.jd.title();
  await ann.getByTestId('friends').click();
  await ann.locator('[data-testid^=friend-message-]').first().click();
  await ann.getByText('Something you would report').waitFor();
  assert.deepEqual(unexpected(ann), []);
  assert.deepEqual(unexpected(mod), []);
});

test('the conversation fits a phone', { timeout: 30000 }, async () => {
  await ann.setViewportSize({ width: 390, height: 844 });
  const box = await ann.getByTestId('messages-dialog').boundingBox();
  assert.ok(box.x >= 0 && box.x + box.width <= 390, JSON.stringify(box));
  assert.ok(box.y >= 0 && box.y + box.height <= 844, JSON.stringify(box));
  const send = await ann.getByTestId('messages-send').boundingBox();
  assert.ok(send.y + send.height <= 844, 'the button is reachable');
  await ann.screenshot({ path: path.join(SHOTS, `messages-phone-${Date.now()}.png`) });
});
