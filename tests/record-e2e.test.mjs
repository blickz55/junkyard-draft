// A copy of the record as one file, in Chromium (render/recordfile.ts): "Save a copy" on the record page downloads junkyard-record.json
// holding what the page shows and nothing of the device's key; "Open a copy" on another device merges it in, says what it added as a
// fact, shows the merged numbers at once and keeps what that device had; the same copy again adds nothing; a file that is not a
// record is refused in plain words. No server stands behind the fixture: the record page needs none.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fixture } from './e2e/fixture.mjs';

const { RULES_VERSION } = await import('../game/src/sim/types.ts');
const V = String(RULES_VERSION);
const f = await fixture();
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'jd-record-e2e-'));
after(async () => {
  await f.close();
  fs.rmSync(scratch, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
});

/** A device that has played: what the record page reads, under the current rules, written the way storage.ts keeps it. */
const seeded = (store) => {
  for (const [k, v] of Object.entries(store)) localStorage.setItem(k, typeof v === 'string' ? v : JSON.stringify(v));
};
const at = (day) => `${day}T12:00:00.000Z`;
const DEVICE_A = {
  'jd.onboarded.v1': '1',
  'jd.bests.v2': {
    byVersion: {
      [V]: {
        overall: { score: 900, seed: 'classic-copy-a', at: at('2030-01-02') },
        bySeed: { 'classic-copy-a': { score: 900, at: at('2030-01-02') } },
        runs: 2,
      },
    },
  },
  'jd.days.v1': ['2030-01-01', '2030-01-02'],
  'jd.dailystreak.v1': ['2030-01-01'],
  'jd.medals.v1': { byVersion: { [V]: [{ seed: 'daily-2030-01-01', medal: 'silver', score: 900, at: at('2030-01-02') }] } },
};
const DEVICE_B = {
  'jd.onboarded.v1': '1',
  'jd.bests.v2': {
    byVersion: {
      [V]: {
        overall: { score: 950, seed: 'classic-copy-a', at: at('2030-01-03') },
        bySeed: { 'classic-copy-a': { score: 950, at: at('2030-01-03') }, 'classic-copy-b': { score: 400, at: at('2030-01-02') } },
        runs: 3,
      },
    },
  },
  'jd.days.v1': ['2030-01-02', '2030-01-03'],
};
const openRecord = async (page) => {
  await page.getByTestId('record').click();
  await page.waitForSelector('[data-testid=record-dialog]', { timeout: 20000 });
};
const copyPath = path.join(scratch, 'junkyard-record.json');

test('Save a copy: the record page downloads junkyard-record.json with what the page shows and nothing of the device key', { timeout: 60000 }, async () => {
  const page = await f.page({ acceptDownloads: true }, { init: { fn: seeded, arg: DEVICE_A } });
  await page.goto(f.gameUrl());
  await page.jd.title();
  await openRecord(page);
  assert.match(await page.jd.text('record-days'), /2 days played/);
  assert.equal(await page.locator('[data-testid=record-copy] button').count(), 2, 'Save a copy and Open a copy, no server needed');
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByTestId('record-save').click()]);
  assert.equal(dl.suggestedFilename(), 'junkyard-record.json');
  const text = fs.readFileSync(await dl.path(), 'utf8');
  fs.writeFileSync(copyPath, text);
  const file = JSON.parse(text);
  assert.equal(file.format, 1);
  assert.equal(file.game, 'junkyard-draft');
  assert.equal(file.rules, RULES_VERSION);
  assert.match(file.savedAt, /^\d{4}-\d{2}-\d{2}T/);
  assert.deepEqual(Object.keys(file.record), ['settings', 'bests', 'stars', 'days', 'dailies', 'medals', 'standings', 'watched', 'kinds']);
  assert.deepEqual(file.record.days, ['2030-01-01', '2030-01-02']);
  assert.deepEqual(file.record.dailies, ['2030-01-01']);
  assert.equal(file.record.bests.bySeed['classic-copy-a'].score, 900);
  assert.equal(file.record.medals[0].medal, 'silver');
  const identity = await page.evaluate(() => JSON.parse(localStorage.getItem('jd.identity.v1') || 'null'));
  if (identity?.token) assert.ok(!text.includes(identity.token), 'the device key is not in the copy');
  assert.ok(!/token|identity|verified/i.test(text), 'no key, no identity, and nothing called verified');
  await page.jd.textMatches('record-status', /^Saved junkyard-record\.json\. Open it on another device/);
  await page.keyboard.press('Escape');
  await page.jd.noDialog('record-dialog');
  assert.deepEqual(page.errors, []);
  await page.ctx.close();
});

test(
  'Open a copy: another device merges it in, says what was added, shows it at once, and keeps its own; the same copy again adds nothing',
  { timeout: 60000 },
  async () => {
    const page = await f.page({}, { init: { fn: seeded, arg: DEVICE_B } });
    await page.goto(f.gameUrl());
    await page.jd.title();
    await openRecord(page);
    assert.match(await page.jd.text('record-days'), /2 days played/);
    assert.match(await page.jd.text('record-medals'), /No medal yet/);
    const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.getByTestId('record-open').click()]);
    await chooser.setFiles(copyPath);
    await page.jd.textMatches('record-status', /^1 day, 1 checked day and 1 medal added\.$/);
    assert.match(await page.jd.text('record-days'), /3 days played · first 1 Jan 2030, last 3 Jan 2030/, 'the page shows the merged record without reopening');
    assert.match(await page.jd.text('record-days'), /1 checked day/);
    assert.match(await page.jd.text('record-medals'), /Silver · the yard of 1 January · \$900/);
    assert.match(await page.jd.text('record-bests'), /Best \$950 on yard classic-copy-a/, "this device's higher best on the same yard stays");
    assert.match(await page.jd.text('record-bests'), /2 yards played · 3 games/);
    const stored = await page.evaluate(() => ({
      days: JSON.parse(localStorage.getItem('jd.days.v1')),
      dailies: JSON.parse(localStorage.getItem('jd.dailystreak.v1')),
      bests: JSON.parse(localStorage.getItem('jd.bests.v2')),
    }));
    assert.deepEqual(stored.days, ['2030-01-01', '2030-01-02', '2030-01-03']);
    assert.deepEqual(stored.dailies, ['2030-01-01']);
    assert.equal(stored.bests.byVersion[V].bySeed['classic-copy-b'].score, 400, 'nothing this device earned is lost');
    assert.equal(stored.bests.byVersion[V].runs, 3);
    // the same copy again: nothing to add, and nothing changes
    await page.setInputFiles('[data-testid=record-file]', copyPath);
    await page.jd.textMatches('record-status', /^Nothing new to add: everything in that copy is already here\.$/);
    assert.match(await page.jd.text('record-days'), /3 days played/);
    // Esc closes it; Home is redrawn because the record changed, and the record link is still there
    await page.keyboard.press('Escape');
    await page.jd.noDialog('record-dialog');
    await page.jd.title();
    await page.waitForSelector('[data-testid=record]', { timeout: 10000 });
    assert.deepEqual(page.errors, []);
    await page.ctx.close();
  },
);

test('a file that is not a copy of a record is refused in plain words, and the record stays as it was', { timeout: 60000 }, async () => {
  const page = await f.page({}, { init: { fn: seeded, arg: DEVICE_B } });
  await page.goto(f.gameUrl());
  await page.jd.title();
  await openRecord(page);
  const notJson = path.join(scratch, 'notes.txt');
  fs.writeFileSync(notJson, 'not json at all');
  await page.setInputFiles('[data-testid=record-file]', notJson);
  await page.jd.textMatches('record-status', /^Couldn't read that file\.$/);
  const recording = path.join(scratch, 'recording.json');
  fs.writeFileSync(recording, JSON.stringify({ format: 1, seed: 'classic-copy-a', actions: [] }));
  await page.setInputFiles('[data-testid=record-file]', recording);
  await page.jd.textMatches('record-status', /^That file isn't a saved copy of a record\.$/);
  const other = path.join(scratch, 'other-game.json');
  fs.writeFileSync(other, JSON.stringify({ format: 1, game: 'other', record: { days: ['2031-01-01'] } }));
  await page.setInputFiles('[data-testid=record-file]', other);
  await page.jd.textMatches('record-status', /^That file isn't a saved copy of a record\.$/);
  assert.match(await page.jd.text('record-days'), /2 days played/, 'nothing was taken from any of them');
  assert.deepEqual(await page.evaluate(() => JSON.parse(localStorage.getItem('jd.days.v1'))), ['2030-01-02', '2030-01-03']);
  assert.deepEqual(page.errors, []);
  await page.ctx.close();
});
