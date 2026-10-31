// Production roadmap 0.8.6 in Chromium: the legal pages are served next to the game, the Privacy & data panel opens from
// the title (the consent toggle's note) and from the results screen, "Download my data" saves the verifier's export and
// "Delete my data" makes the verifier and the device forget the player.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fixture, SHOTS } from './e2e/fixture.mjs';

const { apply, newRun } = await import('../game/src/sim/run.ts');
const { exportReplay } = await import('../game/src/sim/replay.ts');
const { dropOnLine } = await import('./e2e/line.ts');
const { RULES } = await import('../game/src/sim/rules.ts');
function finishedRun(seed) {
  const s = newRun(seed);
  for (let r = 1; r <= RULES.rounds; r++) {
    apply(s, { t: 'pick', i: s.offers.indexOf('crusher') >= 0 ? s.offers.indexOf('crusher') : 0 });
    if (r === 1) dropOnLine(s, 'crusher');
    apply(s, { t: 'run' });
    apply(s, { t: 'next' });
  }
  return s;
}

const f = await fixture({ verifier: true, verifierEnv: { DAILY_SECRET: 'legal-e2e-secret', VERIFIER_LOG: '0', BOT_PAR: '0' } });
after(() => f.close());
const page = await f.page({ acceptDownloads: true });
const { api, title, draft, mode, when, textMatches, noDialog } = page.jd;
const URL = f.url,
  VURL = f.vurl;
let token, daily, sub;

test('the legal pages are served next to the game: a heading, no script, a way back', async () => {
  for (const id of ['privacy', 'terms', 'guidelines']) {
    const r = await fetch(`${URL}/legal/${id}.html`);
    assert.equal(r.status, 200, `legal/${id}.html`);
    const html = await r.text();
    assert.match(html, /<h1>/);
    assert.doesNotMatch(html, /<script/i);
    assert.ok(html.includes('href="../"'), 'back to the game');
  }
  assert.equal((await fetch(`${URL}/legal.json`)).status, 200, 'the bundled source is served too');
});

test('the Privacy panel opens from the home footer with its three tabs', { timeout: 60000 }, async () => {
  await page.goto(f.gameUrl());
  await title();
  await page.getByTestId('more').click();
  await page.getByTestId('privacy').click();
  await page.waitForSelector('[data-testid=privacy-dialog]');
  assert.match(await page.getByTestId('legal-summary').textContent(), /no accounts, no e-mail sign-up, no cookies/);
  assert.match(await page.getByTestId('legal-meta').textContent(), /^Privacy notice · last changed \d{4}-\d{2}-\d{2}/);
  await page.getByTestId('legal-tab-terms').click();
  assert.match(await page.getByTestId('legal-meta').textContent(), /^Terms of play/);
  await page.getByTestId('legal-tab-guidelines').click();
  assert.match(await page.getByTestId('legal-meta').textContent(), /^Community guidelines/);
  assert.match(await page.getByTestId('legal-body').textContent(), /Found an exploit\?/);
  assert.match(await page.getByTestId('data-status').textContent(), /has a key but no claimed name/);
  await page.screenshot({ path: path.join(SHOTS, `legal-panel-${Date.now()}.png`) });
  await page.keyboard.press('Escape');
  await noDialog('privacy-dialog');
});

test('download my data: a JSON file with the entry and its recording, never the key', { timeout: 60000 }, async () => {
  // claim a name through the player dialog, then a verified run under that key (submitted from here with the page's own token)
  await page.getByTestId('settings').click();
  await page.getByTestId('player').click();
  await page.getByTestId('dialog-input').fill('Legal Tester');
  await page.getByTestId('dialog-ok').click();
  await textMatches('player', /^Legal Tester#/, 10000);
  await page.getByTestId('settings-close').click();
  await noDialog('settings-dialog');
  await page.jd.frames(3);
  token = await page.evaluate(() => JSON.parse(localStorage.getItem('jd.identity.v1')).token);
  daily = await f.verifier.json('/daily');
  sub = await f.verifier.json('/verify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ replay: exportReplay(finishedRun(daily.seed)), player: 'Legal Tester' }),
  });
  assert.equal(sub.ok, true, JSON.stringify(sub));
  assert.equal(sub.recorded, true);
  await page.getByTestId('more').click();
  await page.getByTestId('privacy').click();
  await page.waitForSelector('[data-testid=data-export]');
  assert.match(await page.getByTestId('data-status').textContent(), /^You are Legal Tester#/);
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByTestId('data-export').click()]);
  assert.match(dl.suggestedFilename(), /^junkyard-draft-my-data-\d{4}-\d{2}-\d{2}\.json$/);
  const exported = JSON.parse(fs.readFileSync(await dl.path(), 'utf8'));
  assert.equal(exported.ok, true);
  assert.equal(exported.player.name, 'Legal Tester');
  assert.equal(exported.entries.length, 1);
  assert.equal(exported.entries[0].replayHash, sub.entry.replayHash);
  assert.equal(exported.entries[0].storage, 'hot');
  assert.ok(exported.entries[0].replay && Array.isArray(exported.entries[0].replay.actions));
  assert.ok(!JSON.stringify(exported).includes(token), 'the device key is not in the export');
  await textMatches('data-status', /^Saved junkyard-draft-my-data-.*1 entry, 1 with a stored recording/, 5000);
});

test('delete my data: the confirmation, then the verifier forgets and the device gets a new key', { timeout: 60000 }, async () => {
  await page.getByTestId('data-delete').click();
  await page.waitForSelector('[data-testid=dialog-ok]');
  assert.match(await page.getByTestId('dialog').textContent(), /cannot be undone/);
  await page.getByTestId('dialog-ok').click();
  await when(() => document.querySelector('[data-testid=data-status]')?.dataset.deleted === '1', null, 10000);
  assert.match(
    await page.getByTestId('data-status').textContent(),
    /^Deleted\. 1 entry anonymised, 0 archived recordings dropped; this device has a new key and no name\./,
  );
  const after = await page.evaluate(() => JSON.parse(localStorage.getItem('jd.identity.v1')));
  assert.notEqual(after.token, token, 'a new device key');
  assert.equal(after.name, null);
  assert.equal(await page.evaluate(() => localStorage.getItem('jd.player')), null, 'the local name is gone');
  assert.equal((await fetch(`${VURL}/identity`, { headers: { Authorization: `Bearer ${token}` } })).status, 404, 'the old key knows no name');
  const board = await f.verifier.json(`/board?seed=${encodeURIComponent(daily.seed)}`);
  assert.equal(board.entries.length, 1);
  assert.equal(board.entries[0].player, 'deleted');
  assert.equal(board.entries[0].score, sub.score);
  assert.equal(board.entries[0].playerId, undefined);
  assert.equal((await fetch(`${VURL}/replay?hash=${sub.entry.replayHash}&seed=${encodeURIComponent(daily.seed)}`)).status, 404, 'the replay is gone');
  const again = await f.verifier.json('/me/export', { headers: { Authorization: `Bearer ${token}` } });
  assert.equal(again.player, null);
  assert.deepEqual(again.entries, []);
  await page.screenshot({ path: path.join(SHOTS, `legal-deleted-${Date.now()}.png`) });
  await page.keyboard.press('Escape');
  await noDialog('privacy-dialog');
  await textMatches('player-name', /^Choose a name$/, 10000);
});

test('the results screen carries the link too', { timeout: 90000 }, async () => {
  // a quick run through the dev hooks; a local name so the results screen does not prompt
  await page.evaluate(() => localStorage.setItem('jd.player', 'Legal Tester'));
  await page.goto(f.gameUrl('scene=game&seed=classic-legal-e2e-seed'));
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
  await page.waitForSelector('[data-testid=privacy]');
  await page.getByTestId('privacy').click();
  await page.waitForSelector('[data-testid=privacy-dialog]');
  assert.match(await page.getByTestId('legal-summary').textContent(), /no accounts/);
  await page.keyboard.press('Escape');
  await noDialog('privacy-dialog');
  assert.deepEqual(page.errors, [], 'no page errors');
});
