// Production roadmap 0.11.1 in Chromium, with a stand-in for the mail service: a player signs in with email, a second device
// gets their name and progress, a new best on one device reaches the other, signing out reaches the other too, and a link does
// nothing until a person presses Sign in.
import { test, after } from 'node:test';
import { RULES_VERSION } from '../game/src/sim/types.ts';
import assert from 'node:assert/strict';
import http from 'node:http';
import { fixture, freePort } from './e2e/fixture.mjs';

const mails = [];
const stub = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    mails.push(JSON.parse(body));
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end('{"id":"stub"}');
  });
});
const STUB = await freePort();
await new Promise((r) => stub.listen(STUB, '127.0.0.1', r));

const f = await fixture({
  verifier: true,
  verifierEnv: {
    DAILY_SECRET: 'link-e2e-secret',
    VERIFIER_LOG: '0',
    BOT_PAR: '0',
    RESEND_API_KEY: 're_test',
    RESEND_API_URL: `http://127.0.0.1:${STUB}/emails`,
  },
});
after(async () => {
  await f.close();
  await new Promise((r) => stub.close(r));
});
const SEED = 'classic-link-yard';
const EMAIL = 'sam@example.com';
/** The refusals these tests ask for reach the console as failed requests. */
const unexpected = (page) => page.errors.filter((e) => !/status of 4(03|10) /.test(e));
const tokenFrom = (mail) => /#link=([\w-]+)/.exec(mail.text)[1];

async function play(page, pick = 0) {
  await page.goto(f.gameUrl(`scene=game&seed=${SEED}`));
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
const settings = async (page) => {
  await page.getByTestId('settings').click();
  await page.getByTestId('settings-dialog').waitFor();
};
const askForLink = async (page) => {
  const before = mails.length;
  await page.getByTestId('link-email').click();
  await page.getByTestId('link-email-field').fill(EMAIL);
  await page.keyboard.press('Enter');
  await page.jd.textMatches('link-status', /^Check your email\./, 10000);
  assert.equal(mails.length, before + 1);
  assert.deepEqual(mails[mails.length - 1].to, [EMAIL]);
  return tokenFrom(mails[mails.length - 1]);
};
const openLink = async (page, token) => {
  await page.goto('about:blank');
  await page.goto(`${f.gameUrl()}#link=${token}`);
  await page.jd.title();
  await page.getByTestId('link-confirm').waitFor();
};
const signIn = async (page, message) => {
  await page.getByTestId('link-confirm-yes').click();
  await page.jd.textMatches('dialog', message, 10000);
  await page.getByTestId('dialog-ok').click();
  await page.jd.noDialog('dialog');
  await page.jd.title();
};

const first = await f.page();
const second = await f.page();

test('signing in links the address: the link asks first, leaves the address bar, and works once', { timeout: 90000 }, async () => {
  await play(first);
  await first.evaluate(() => localStorage.setItem('jd.player', 'Sam'));
  await first.getByTestId('submit').click();
  await first.jd.textMatches('status', /^Checked: /, 15000);
  await first.getByTestId('home').click();
  await first.jd.title();
  await settings(first);
  assert.equal(await first.getByTestId('link-email').textContent(), 'Sign in with email');
  const token = await askForLink(first);
  await first.getByTestId('link-close').click();
  await openLink(first, token);
  assert.equal(new URL(first.url()).hash, '', 'the token is off the address bar');
  // a press is needed: leaving the dialog signs nobody in, and the link is still good
  await first.getByTestId('link-confirm-no').click();
  await first.jd.noDialog('link-confirm');
  assert.equal(await first.evaluate(() => localStorage.getItem('jd.linked.v1')), null);
  await openLink(first, token);
  await signIn(first, /You're signed in\. Your name and progress now follow you/);
  await settings(first);
  assert.equal(await first.getByTestId('link-email').textContent(), 'Signed in with email');
  await first.getByTestId('settings-close').click();
  await openLink(first, token);
  await first.getByTestId('link-confirm-yes').click();
  await first.jd.textMatches('dialog', /expired or was already used/, 10000);
  await first.getByTestId('dialog-ok').click();
  assert.deepEqual(unexpected(first), []);
});

test('a second device gets the name and the progress', { timeout: 60000 }, async () => {
  await second.goto(f.gameUrl());
  await second.jd.title();
  await second.evaluate(() => localStorage.setItem('jd.onboarded.v1', '1'));
  await settings(second);
  const token = await askForLink(second);
  await second.getByTestId('link-close').click();
  await openLink(second, token);
  await signIn(second, /Your name and progress are on this device now/);
  await second.jd.textMatches('player-name', /^Sam#/, 10000);
  const synced = await second.evaluate(
    (seed) => Object.keys(JSON.parse(localStorage.getItem('jd.bests.v2')).byVersion).length > 0 && localStorage.getItem('jd.bests.v2').includes(seed),
    SEED,
  );
  assert.equal(synced, true, "the first device's best is here");
  const label = await first.evaluate(() => JSON.parse(localStorage.getItem('jd.identity.v1')));
  const here = await second.evaluate(() => JSON.parse(localStorage.getItem('jd.identity.v1')));
  assert.equal(here.playerId, label.playerId, 'the same player');
  assert.notEqual(here.token, label.token, 'each device keeps its own key');
  await second.getByTestId('inbox').waitFor(); // this device never put a game on a board, but the account did
  assert.deepEqual(unexpected(second), []);
});

test('a better game on one device reaches the other; signing out on one reaches the other too', { timeout: 120000 }, async () => {
  const bestOf = (page) => page.evaluate(([seed, v]) => JSON.parse(localStorage.getItem('jd.bests.v2')).byVersion[v].bySeed[seed].score, [SEED, RULES_VERSION]);
  const runs = (page) => page.evaluate((v) => JSON.parse(localStorage.getItem('jd.bests.v2')).byVersion[v].runs, RULES_VERSION);
  const before = await runs(first);
  await second.evaluate((v) => {
    const all = JSON.parse(localStorage.getItem('jd.bests.v2'));
    all.byVersion[v].bySeed['from-the-phone'] = { score: 4321, at: new Date().toISOString() };
    all.byVersion[v].runs += 5;
    localStorage.setItem('jd.bests.v2', JSON.stringify(all));
  }, RULES_VERSION);
  await play(second, 1); // the results bring the account level
  await second.waitForResponse((r) => r.url().endsWith('/me/sync') && r.request().method() === 'POST', { timeout: 10000 }).catch(() => null);
  await first.goto(f.gameUrl());
  await first.jd.title();
  await first.jd.when(() => localStorage.getItem('jd.bests.v2').includes('from-the-phone'), null, 10000);
  await first.jd.title();
  assert.ok((await runs(first)) >= before + 5);
  assert.ok((await bestOf(first)) > 0);
  await second.getByTestId('home').click();
  await second.jd.title();
  await settings(second);
  await second.getByTestId('link-email').click();
  await second.getByTestId('link-unlink').click();
  await second.jd.textMatches('dialog', /gone from our server/, 10000);
  await second.getByTestId('dialog-ok').click();
  await second.jd.noDialog('dialog');
  assert.equal(await second.getByTestId('link-email').textContent(), 'Sign in with email');
  await second.getByTestId('settings-close').click();
  await first.goto(f.gameUrl());
  await first.jd.title();
  await first.jd.when(() => localStorage.getItem('jd.linked.v1') === 'false', null, 10000);
  assert.deepEqual([...unexpected(first), ...unexpected(second)], []);
});

test('an address that is not one says so, in words, and the keys still work', { timeout: 30000 }, async () => {
  const page = await f.page();
  await page.goto(f.gameUrl());
  await page.jd.title();
  await settings(page);
  await page.getByTestId('link-email').click();
  await page.getByTestId('link-email-field').fill('not an address');
  await page.getByTestId('link-send').click();
  await page.jd.textMatches('link-status', /doesn't look like an email address/, 5000);
  assert.equal(await page.getByTestId('link-send').isDisabled(), false, 'it can be corrected');
  await page.keyboard.press('Escape');
  await page.jd.noDialog('link-dialog');
});
