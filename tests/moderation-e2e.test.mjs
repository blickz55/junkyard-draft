// Production roadmap 0.11.2 in Chromium, with stand-ins for the classifier and the mail service: the queue page behind its key, the
// three bands and the classifier failing, every action a person can take, an appeal from the inbox in both directions, the owner's
// settings and the trusted role, and the monthly counts on the policy page.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import path from 'node:path';
import { fixture, freePort, until, SHOTS } from './e2e/fixture.mjs';

/** The Messages API as the verifier sees it: a word in the post picks the answer; "unreadable" is the classifier failing. */
const mails = [];
const stub = http.createServer((req, res) => {
  let raw = '';
  req.on('data', (c) => (raw += c));
  req.on('end', () => {
    const body = JSON.parse(raw);
    const send = (status, json) => {
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(json));
    };
    if (req.url === '/emails') {
      mails.push(body);
      return send(200, { id: 'stub' });
    }
    const words = body.messages[0].content;
    if (words.includes('unreadable')) return send(400, { type: 'error', error: { type: 'invalid_request_error', message: 'stand-in' } });
    const answer = words.includes('nasty')
      ? { category: 'hate', score: 95 }
      : words.includes('pushy')
        ? { category: 'spam', score: 55 }
        : { category: 'ok', score: 2 };
    send(200, {
      id: 'msg',
      type: 'message',
      role: 'assistant',
      content: [{ type: 'text', text: JSON.stringify(answer) }],
      stop_reason: 'end_turn',
      usage: { input_tokens: 700, output_tokens: 20 },
    });
  });
});
const STUB = await freePort();
await new Promise((r) => stub.listen(STUB, '127.0.0.1', r));

const TOKEN = 'e2e-moderation-token';
const f = await fixture({
  verifier: true,
  verifierEnv: {
    DAILY_SECRET: 'moderation-e2e-secret',
    VERIFIER_LOG: '0',
    BOT_PAR: '0',
    MODERATION_TOKEN: TOKEN,
    POST_RATE_LIMIT: '1000',
    ANTHROPIC_API_KEY: 'sk-test',
    ANTHROPIC_API_URL: `http://127.0.0.1:${STUB}/v1/messages`,
    RESEND_API_KEY: 're_test',
    RESEND_API_URL: `http://127.0.0.1:${STUB}/emails`,
  },
});
after(async () => {
  await f.close();
  await new Promise((r) => stub.close(r));
});

const CLOSED_DAY = new Date(Date.now() - 5 * 86_400_000).toISOString().slice(0, 10);
const author = await f.page();
const mod = await f.page({ bypassCSP: false });
/** The refusals these tests ask for reach the console as failed requests. */
const unexpected = (page) => page.errors.filter((e) => !/status of 4(01|03|09|22) /.test(e));

const identity = () => author.evaluate(() => JSON.parse(localStorage.getItem('jd.identity.v1')));
async function post(body, expectStatus = 200) {
  const { token } = await identity();
  const res = await fetch(`${f.vurl}/posts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ key: CLOSED_DAY, body }),
  });
  const json = await res.json();
  assert.equal(res.status, expectStatus, JSON.stringify(json));
  return json;
}
const queue = async () => {
  const res = await fetch(`${f.vurl}/moderation/queue`, { headers: { 'X-Moderation-Token': TOKEN } });
  return res.json();
};
const itemOf = async (words) => until(async () => (await queue()).queue.find((q) => q.body === words), { what: `"${words}" in the queue`, timeout: 15000 });
const refresh = async () => {
  await mod.getByTestId('mod-refresh').click();
  await mod.waitForFunction(() => document.querySelector('[data-testid=mod-status]').textContent === 'Up to date.');
};
const done = (text) => mod.waitForFunction((t) => document.querySelector('[data-testid=mod-status]').textContent === t, text);

test('the queue page opens with the token and nothing else; it runs under its own strict policy', { timeout: 60000 }, async () => {
  assert.equal((await fetch(`${f.vurl}/health`).then((r) => r.json())).moderation, true);
  await mod.goto(`${f.vurl}/moderation/`);
  assert.equal(await mod.getByTestId('mod-queue').isVisible(), false);
  await mod.getByTestId('mod-key').fill('not the token');
  await mod.getByTestId('mod-enter').click();
  await mod.waitForFunction(() => /bad moderation token/.test(document.querySelector('[data-testid=mod-error]').textContent));
  await mod.getByTestId('mod-key').fill(TOKEN);
  await mod.keyboard.press('Enter');
  await mod.getByTestId('mod-queue').waitFor();
  assert.match(await mod.getByTestId('mod-summary').textContent(), /^0 waiting\. Target: every item within 72 hours\.$/);
  assert.equal(await mod.getByTestId('mod-off').isVisible(), false, 'the classifier is on');
  assert.deepEqual(unexpected(mod), []);
});

test('a player signs in, writes, and each post lands where its score says; the classifier failing lands in the queue', { timeout: 90000 }, async () => {
  await author.goto(f.gameUrl());
  await author.jd.title();
  await author.evaluate(() => localStorage.setItem('jd.onboarded.v1', '1'));
  await author.getByTestId('settings').click();
  await author.getByTestId('link-email').click();
  await author.getByTestId('link-email-field').fill('sam@example.com');
  await author.keyboard.press('Enter');
  await author.jd.textMatches('link-status', /^Check your email\./, 10000);
  await author.getByTestId('link-close').click();
  const link = /#link=([\w-]+)/.exec(mails.at(-1).text)[1];
  await author.goto('about:blank');
  await author.goto(`${f.gameUrl()}#link=${link}`);
  await author.jd.title();
  await author.getByTestId('link-confirm-yes').click();
  await author.getByTestId('dialog-ok').click();
  await author.jd.noDialog('dialog');
  await author.jd.title();
  const { token } = await identity();
  await fetch(`${f.vurl}/identity`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ name: 'Sam' }),
  });

  const fine = await post('fine run today');
  assert.equal(fine.post.state, 'hidden', 'down until the classifier answers');
  await post('see my site at example.com', 422);
  await post('pushy message one');
  await post('something nasty');
  await post('unreadable words');
  const unread = await itemOf('unreadable words');
  assert.equal(unread.state, 'queued');
  assert.equal(unread.triageCategory, 'unread');
  const nasty = await itemOf('something nasty');
  assert.equal(nasty.state, 'hidden');
  assert.equal(nasty.reasonCode, 'hate');
  const pushy = await itemOf('pushy message one');
  assert.equal(pushy.state, 'queued');
  const all = await queue();
  assert.equal(all.queue.length, 3, 'a clean post waits for nobody');
  assert.equal(all.usage.calls, 4);
  assert.equal(all.usage.failures, 1);

  await refresh();
  assert.match(await mod.getByTestId('mod-summary').textContent(), /^3 waiting, the oldest /);
  assert.equal(await mod.getByTestId(`mod-body-${nasty.id}`).textContent(), 'something nasty');
  assert.match(await mod.getByTestId(`mod-item-${unread.id}`).textContent(), /the classifier did not read this/);
  await mod.screenshot({ path: path.join(SHOTS, `moderation-queue-${Date.now()}.png`), fullPage: true });
  assert.deepEqual(unexpected(author), []);
});

test('a person acts: clear, hide with a reason and a note, put back, remove, mute, unmute, ban and unban', { timeout: 90000 }, async () => {
  const pushy = await itemOf('pushy message one');
  await mod.getByTestId(`mod-clear-${pushy.id}`).click();
  await done('Cleared.');
  assert.equal(await mod.getByTestId(`mod-item-${pushy.id}`).count(), 0);

  const unread = await itemOf('unreadable words');
  await mod.getByTestId(`mod-reason-${unread.id}`).selectOption('spam');
  await mod.getByTestId(`mod-note-${unread.id}`).fill('selling something');
  await mod.getByTestId(`mod-hide-${unread.id}`).click();
  await done('Hidden.');
  const hidden = (await queue()).recent[0];
  assert.deepEqual([hidden.action, hidden.reasonCode, hidden.note, hidden.by, hidden.undo], ['hide', 'spam', 'selling something', 'owner', 'unhide']);
  await mod.getByTestId(`mod-undo-${hidden.id}`).click();
  await done('Back up.');
  assert.equal((await queue()).recent[0].action, 'unhide');

  const nasty = await itemOf('something nasty');
  await mod.getByTestId(`mod-delete-${nasty.id}`).click();
  await done('Removed.');
  assert.equal((await queue()).queue.length, 0);

  // the player: a post to act from, each action closes the way to write and its undo opens it again
  await post('pushy message two');
  const second = await itemOf('pushy message two');
  await refresh();
  await mod.getByTestId(`mod-mute24-${second.id}`).click();
  await done('Muted for 24 hours.');
  assert.equal((await post('now muted', 403)).code, 'muted');
  await mod.getByTestId(`mod-undo-${(await queue()).recent[0].id}`).click();
  await done('Unmuted.');
  await post('can write again');
  await mod.getByTestId(`mod-mute7-${second.id}`).click();
  await done('Muted for 7 days.');
  assert.equal((await post('muted for a week', 403)).code, 'muted');
  await mod.getByTestId(`mod-undo-${(await queue()).recent[0].id}`).click();
  await done('Unmuted.');
  await mod.getByTestId(`mod-ban-${second.id}`).click();
  await done('Banned.');
  assert.equal((await post('banned now', 403)).code, 'banned');
  const ban = (await queue()).recent[0];
  assert.equal(ban.action, 'ban');
  await mod.getByTestId(`mod-undo-${ban.id}`).click();
  await done('Unbanned.');
  assert.deepEqual(unexpected(mod), []);
});

test(
  'an appeal from the inbox: the filter holds, one try, and undoing the decision brings the post back; the answer lands in the inbox',
  { timeout: 90000 },
  async () => {
    await post('something nasty again');
    const item = await itemOf('something nasty again');
    await author.goto(f.gameUrl());
    await author.jd.title();
    await author.getByTestId('inbox').click();
    await author.getByTestId('inbox-dialog').waitFor();
    await author.getByTestId('inbox-moderation').first().waitFor();
    const lines = await author.getByTestId('inbox-rows').textContent();
    assert.match(lines, /Your post is down until a person has looked at it: "something nasty again"\. It attacked people for who they are\./);
    assert.match(lines, /A person removed your post: "something nasty"\./);
    assert.match(lines, /You can no longer write here\. Your scores are safe\./);
    assert.match(lines, /You can write here again\./);
    const button = author.locator('[data-testid^=inbox-appeal-]').first();
    await button.click();
    await author.getByTestId('appeal-dialog').waitFor();
    await author.getByTestId('appeal-send').click();
    await author.jd.textMatches('appeal-status', /^Write something first\./, 5000);
    await author.getByTestId('appeal-field').fill('see example.com');
    await author.getByTestId('appeal-send').click();
    await author.jd.textMatches('appeal-status', /^That cannot be sent/, 5000);
    await author.getByTestId('appeal-field').fill('It was about the furnace, honest.');
    await author.screenshot({ path: path.join(SHOTS, `moderation-appeal-${Date.now()}.png`) });
    await author.getByTestId('appeal-send').click();
    await author.jd.textMatches('appeal-status', /^Sent\. The answer will land in your inbox\./, 5000);
    assert.equal(
      (await button.count()) > 0 &&
        (await button.getAttribute('data-testid')) === (await author.locator('[data-testid^=inbox-appeal-]').first().getAttribute('data-testid')),
      true,
    );
    await author.getByTestId('appeal-close').click();

    await refresh();
    const appeal = (await queue()).appeals[0];
    assert.equal(appeal.body, 'something nasty again');
    assert.equal(await mod.getByTestId(`mod-appeal-body-${appeal.id}`).textContent(), 'It was about the furnace, honest.');
    await mod.getByTestId(`mod-appeal-undo-${appeal.id}`).click();
    await done('The decision is undone.');
    const after2 = await queue();
    assert.deepEqual(after2.appeals, []);
    assert.equal(
      after2.queue.find((q) => q.id === item.id),
      undefined,
      'a person has looked',
    );

    await author.goto(f.gameUrl());
    await author.jd.title();
    await author.getByTestId('inbox').click();
    await author.getByTestId('inbox-appeal').waitFor();
    assert.equal(
      await author.getByTestId('inbox-appeal').textContent(),
      `A person read your appeal and undid the decision.${await author.getByTestId('inbox-appeal').locator('.jd-inbox-day').textContent()}`,
    );
    await author.getByTestId('inbox-close').click();
    assert.deepEqual(unexpected(author), []);
  },
);

test('an appeal the other way: the decision stands, and the player hears that too', { timeout: 60000 }, async () => {
  await post('something nasty once more');
  await itemOf('something nasty once more');
  const { items } = await fetch(`${f.vurl}/me/inbox`, { headers: { Authorization: `Bearer ${(await identity()).token}` } }).then((r) => r.json());
  const line = items.find((i) => i.kind === 'moderation' && i.payload.appealable);
  const { token } = await identity();
  const sent = await fetch(`${f.vurl}/me/appeal`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ action: line.payload.action, body: 'Please look at this again.' }),
  });
  assert.equal(sent.status, 200);
  await refresh();
  await mod.getByTestId(`mod-appeal-keep-${line.payload.action}`).click();
  await done('The decision stands.');
  await author.goto(f.gameUrl());
  await author.jd.title();
  await author.getByTestId('inbox').click();
  await author.getByTestId('inbox-appeal').first().waitFor();
  assert.match(await author.getByTestId('inbox-rows').textContent(), /A person read your appeal\. The decision stands\./);
  await author.getByTestId('inbox-close').click();
});

test('the owner sets the numbers and names a trusted moderator, who signs in with their key and has no owner powers', { timeout: 60000 }, async () => {
  await mod.getByTestId('mod-set-hideAt').fill('70');
  await mod.getByTestId('mod-set-awayHideAt').fill('55');
  await mod.getByTestId('mod-save').click();
  await done('Saved.');
  assert.equal((await queue()).settings.hideAt, 70);
  await mod.getByTestId('mod-set-queueAt').fill('99');
  await mod.getByTestId('mod-save').click();
  await mod.waitForFunction(() => /^Not done: /.test(document.querySelector('[data-testid=mod-status]').textContent));
  assert.match(await mod.getByTestId('mod-usage').textContent(), /classifier calls/);

  // a second player signs in with their own address and is given the role
  const token = 'c'.repeat(32);
  const call = (p, body) =>
    fetch(`${f.vurl}${p}`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify(body) });
  assert.equal((await call('/link/start', { email: 'ann@example.com' })).status, 200);
  const signedIn = await (await call('/link/verify', { token: /#link=([\w-]+)/.exec(mails.at(-1).text)[1] })).json();
  const playerId = signedIn.playerId;
  await mod.getByTestId('mod-grant-id').fill(playerId);
  await mod.getByTestId('mod-grant').click();
  await done('Role granted.');
  assert.deepEqual(
    (await queue()).trusted.map((m) => m.id),
    [playerId],
  );

  await post('pushy message three');
  const item = await itemOf('pushy message three');
  const helper = await f.page({ bypassCSP: false });
  await helper.goto(`${f.vurl}/moderation/`);
  await helper.getByTestId('mod-key').fill(token);
  await helper.getByTestId('mod-enter').click();
  await helper.getByTestId('mod-queue').waitFor();
  assert.equal(await helper.locator('#owner').isVisible(), false, 'the settings are the owner`s');
  assert.equal(await helper.getByTestId(`mod-item-${item.id}`).isVisible(), true);
  assert.equal(await helper.getByTestId(`mod-ban-${item.id}`).count(), 0, 'and so is a ban');
  await helper.getByTestId(`mod-clear-${item.id}`).click();
  await helper.waitForFunction(() => document.querySelector('[data-testid=mod-status]').textContent === 'Cleared.');

  await mod.getByTestId('mod-refresh').click();
  await mod.getByTestId(`mod-untrust-${playerId}`).click();
  await done('Role taken back.');
  assert.deepEqual(unexpected(helper), []);
});

test('the queue page reads on a phone: nothing runs off the side', { timeout: 30000 }, async () => {
  await post('pushy message four');
  await itemOf('pushy message four');
  await mod.setViewportSize({ width: 390, height: 844 });
  await refresh();
  const over = await mod.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  assert.equal(over, 0, 'no sideways scroll');
  await mod.screenshot({ path: path.join(SHOTS, `moderation-queue-phone-${Date.now()}.png`) });
});

test('the fairness page shows the month and the target, from the server', { timeout: 30000 }, async () => {
  await author.goto(f.gameUrl());
  await author.jd.title();
  await author.getByTestId('more').click();
  await author.getByTestId('policy').click();
  await author.getByTestId('policy-dialog').waitFor();
  await author.jd.textMatches('policy-counts', /Moderation, month by month/, 5000);
  const counts = await author.getByTestId('policy-counts').textContent();
  assert.match(counts, /A person reviews everything flagged within 72 hours\. Over the last 30 days half took under [\d.]+ hours\./);
  assert.match(
    await author.getByTestId('policy-month').first().textContent(),
    /^\d{4}-\d{2}: \d+ posts, \d+ hidden, \d+ removed, \d+ appeals, 1 decisions kept, 1 undone$/,
  );
  await author.getByTestId('policy-close').click();
  assert.deepEqual(unexpected(author), []);
});
