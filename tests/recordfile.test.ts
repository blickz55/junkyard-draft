// A copy of the record as one file (render/recordfile.ts): the file format round-trips through the same validator the account copy
// uses; the device key never enters it; what a copy adds is counted as the record page says it; a device with no progress takes a
// copy's settings as a device joining an account does; a change of the record is heard once per write; and the desktop shell's file
// comes in, merges, and takes every later change back, through a stand-in bridge.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const store = new Map<string, string>();
(globalThis as unknown as { localStorage: Storage }).localStorage = {
  getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
  setItem: (k: string, v: string) => {
    store.set(k, String(v));
  },
  removeItem: (k: string) => {
    store.delete(k);
  },
  clear: () => store.clear(),
  key: (i: number) => [...store.keys()][i] ?? null,
  get length() {
    return store.size;
  },
} as Storage;
// the desktop part reads window.jdDesktop and listens for pagehide; a bare object stands in for the window here
const win: { jdDesktop?: { record?: { load(): Promise<unknown>; save(d: unknown): Promise<unknown> } }; listeners: Record<string, () => void> } = {
  listeners: {},
};
(globalThis as unknown as { window: unknown }).window = Object.assign(win, {
  addEventListener: (ev: string, fn: () => void) => {
    win.listeners[ev] = fn;
  },
});

const storage = await import('../game/src/render/storage');
const rf = await import('../game/src/render/recordfile');
const { mergeSync, sameProgress } = await import('../game/src/render/sync');
const { RULES_VERSION } = await import('../game/src/sim/types');
const require = createRequire(import.meta.url);
const shell = require('../desktop/record-file.cjs') as { PROGRESS_KEYS: string[]; RECORD_KEYS: string[]; cleanRecord: (d: unknown) => Record<string, unknown> };

const TOKEN = 'deadbeefdeadbeefdeadbeefdeadbeef';
/** A device with a key, a name, a crew and a sign-in: none of it is the record. */
function deviceWithSecrets() {
  store.clear();
  store.set('jd.identity.v1', JSON.stringify({ token: TOKEN, playerId: 'p'.repeat(64), name: 'Sam', tag: 'ab12' }));
  store.set('jd.linked.v1', 'true');
  store.set('jd.player', JSON.stringify('Sam'));
  store.set('jd.group.v1', JSON.stringify({ code: 'CREW-CODE' }));
}
const copy = (over: Partial<ReturnType<typeof storage.readSyncData>> = {}) => ({ ...storage.validateSync({})!, ...over });

test('the file: packed with a format and the game, it round-trips through the sync validator; what is not a record is refused', () => {
  deviceWithSecrets();
  storage.recordBest('yard-a', 500);
  storage.recordDayPlayed(new Date('2030-01-01T10:00:00Z'));
  storage.recordDailyDate('2030-01-01');
  storage.recordMedal('yard-a', 'bronze', 500, RULES_VERSION, new Date('2030-01-02T00:00:00Z'));
  storage.recordStars('yard-a', 2);
  storage.recordKinds(['crusher', 'crusher']);
  const packed = rf.packRecord(storage.readSyncData(), new Date('2030-01-03T04:05:06Z'));
  assert.equal(packed.format, rf.RECORD_FORMAT);
  assert.equal(packed.game, 'junkyard-draft');
  assert.equal(packed.savedAt, '2030-01-03T04:05:06.000Z');
  assert.equal(packed.rules, RULES_VERSION);
  const back = rf.unpackRecord(JSON.parse(JSON.stringify(packed)));
  assert.ok(back, 'a saved copy opens');
  assert.ok(sameProgress(back, storage.readSyncData()), 'and holds the same progress');
  assert.deepEqual(back.settings, packed.record.settings);
  assert.deepEqual(back.days, ['2030-01-01']);
  assert.equal(back.bests.bySeed['yard-a'].score, 500);
  assert.equal(back.medals[0].medal, 'bronze');
  assert.deepEqual(back.stars, { 'yard-a': 2 });
  assert.deepEqual(back.kinds, { crusher: 2 });
  for (const bad of [null, 'text', 42, [], {}, { format: 2, game: 'junkyard-draft', record: {} }, { format: 1, game: 'other', record: {} }, { format: 1 }])
    assert.equal(rf.unpackRecord(bad), null, JSON.stringify(bad));
  const partial = rf.unpackRecord({ format: 1, game: 'junkyard-draft', record: { days: ['2030-02-02', 7], bests: 'junk', stars: { a: 1, b: 'x' } } });
  assert.ok(partial);
  assert.deepEqual(partial.days, ['2030-02-02'], 'each part keeps what fits');
  assert.deepEqual(partial.stars, { a: 1 });
  assert.equal(partial.bests.runs, 0);
  assert.equal(rf.RECORD_FILE_NAME, 'junkyard-record.json');
});

test('the device key, the name, the crew and the sign-in never enter the file; the shell and the game name the same keys', () => {
  deviceWithSecrets();
  storage.recordBest('yard-a', 500);
  const text = JSON.stringify(rf.packRecord(storage.readSyncData()));
  for (const secret of [TOKEN, 'p'.repeat(64), 'Sam', 'ab12', 'CREW-CODE', 'token', 'identity', 'linked', 'player'])
    assert.ok(!text.includes(secret), `no ${secret} in the file`);
  const record = rf.packRecord(storage.readSyncData()).record;
  assert.deepEqual(Object.keys(record), shell.PROGRESS_KEYS, "the shell's list of the record's keys is the game's SyncData, key for key");
  assert.deepEqual(Object.keys(rf.packRecord(record)), shell.RECORD_KEYS, "and the file's top-level keys");
  assert.deepEqual(shell.cleanRecord(rf.packRecord(record, new Date(0))), rf.packRecord(record, new Date(0)), 'so the shell drops nothing of a real record');
});

test('what a copy adds is counted as the record page says it: days, checked days, medals, bests, standings, other details', () => {
  const before = copy({
    bests: { overall: { score: 500, seed: 'a', at: '2030-01-01' }, bySeed: { a: { score: 500, at: '2030-01-01' } }, runs: 3 },
    days: ['2030-01-01'],
    dailies: ['2030-01-01'],
    medals: [{ seed: 'a', medal: 'bronze', score: 500, at: '2030-01-02T00:00:00.000Z' }],
    standings: [{ seed: 'a', at: '2030-01-01T00:00:00.000Z', score: 500, percentile: 40, n: 10, rank: 6 }],
    stars: { a: 1 },
  });
  const other = copy({
    bests: {
      overall: { score: 700, seed: 'b', at: '2030-01-03' },
      bySeed: { a: { score: 450, at: '2030-01-02' }, b: { score: 700, at: '2030-01-03' } },
      runs: 2,
    },
    days: ['2030-01-01', '2030-01-02', '2030-01-03'],
    dailies: ['2030-01-03'],
    medals: [{ seed: 'a', medal: 'silver', score: 600, at: '2030-01-05T00:00:00.000Z' }],
    standings: [
      { seed: 'a', at: '2030-01-01T00:00:00.000Z', score: 500, percentile: 40, n: 10, rank: 6 },
      { seed: 'b', at: '2030-01-03T00:00:00.000Z', score: 700, percentile: 80, n: 12, rank: 2 },
    ],
    stars: { a: 3 },
  });
  const a = rf.additions(before, mergeSync(before, other));
  assert.deepEqual(a, { days: 2, dailies: 1, medals: 1, bests: 1, standings: 1, other: true, any: true }, 'the lower best on a is not an addition; stars rose');
  assert.deepEqual(rf.additions(before, mergeSync(before, before)), { days: 0, dailies: 0, medals: 0, bests: 0, standings: 0, other: false, any: false });
  const onlyRuns = copy({ bests: { overall: null, bySeed: {}, runs: 9 } });
  const r = rf.additions(before, mergeSync(before, onlyRuns));
  assert.equal(r.any, true, 'a higher game count is a change');
  assert.equal(r.other, true, 'and shows as other details, since no count above moved');
  assert.equal(rf.hasProgress(copy()), false);
  assert.equal(rf.hasProgress(copy({ days: ['2030-01-01'] })), true);
  assert.equal(rf.hasProgress(copy({ settings: { volume: 0.1 } })), false, 'settings are not progress');
});

test('taking a copy: nothing this device earned is lost, nothing is written for nothing, and a device with no progress takes the settings', () => {
  deviceWithSecrets();
  storage.updateSettings({ volume: 0.25 });
  const fresh = rf.takeRecord(copy({ settings: { volume: 0.9, chatter: 'less' }, days: ['2030-01-01'], bests: { overall: null, bySeed: {}, runs: 1 } }));
  assert.equal(fresh.days, 1);
  assert.equal(storage.loadSettings().volume, 0.9, 'a device with no progress takes the copy’s settings, as a device joining an account does');
  assert.equal(storage.loadSettings().chatter, 'less');
  assert.deepEqual(storage.loadDaysPlayed(), ['2030-01-01']);
  storage.recordBest('mine', 300);
  storage.updateSettings({ volume: 0.5 });
  let writes = 0;
  const stop = storage.onRecordChange(() => writes++);
  const again = rf.takeRecord(copy({ settings: { volume: 0.1 }, days: ['2030-01-01'], bests: { overall: null, bySeed: {}, runs: 1 } }));
  assert.equal(again.any, false, 'the same copy again adds nothing');
  assert.equal(writes, 0, 'and writes nothing');
  const more = rf.takeRecord(
    copy({
      settings: { volume: 0.1 },
      days: ['2030-01-02'],
      bests: { overall: { score: 200, seed: 'theirs', at: 't' }, bySeed: { theirs: { score: 200, at: 't' } }, runs: 1 },
    }),
  );
  assert.deepEqual([more.days, more.bests], [1, 1]);
  assert.ok(writes > 0, 'a copy that adds something is written');
  assert.equal(storage.loadSettings().volume, 0.5, 'a device with progress keeps its own settings');
  assert.equal(storage.loadBests().bySeed['mine'].score, 300, "this device's best is still here");
  assert.equal(storage.loadBests().bySeed['theirs'].score, 200);
  assert.deepEqual(storage.loadDaysPlayed(), ['2030-01-01', '2030-01-02']);
  stop();
});

test('a change of the record is heard once per write, and only for what the record holds', () => {
  store.clear();
  const heard: number[] = [];
  const stop = storage.onRecordChange(() => heard.push(1));
  storage.recordBest('yard-a', 100);
  const afterBest = heard.length;
  assert.ok(afterBest >= 1, 'a best is the record');
  storage.markTipRead('tip-1');
  storage.savePlayer('Sam');
  assert.equal(heard.length, afterBest, 'a tip read and a name are not');
  storage.recordDayPlayed();
  storage.recordStars('yard-a', 1);
  storage.recordKinds(['press']);
  storage.updateSettings({ muted: true });
  assert.equal(heard.length, afterBest + 4);
  stop();
  storage.recordBest('yard-b', 100);
  assert.equal(heard.length, afterBest + 4, 'stopped');
});

test('the desktop file: it comes in and merges once, the record goes back to it after a change, and a second call does nothing', async () => {
  deviceWithSecrets();
  storage.recordBest('mine', 300);
  const saved: unknown[] = [];
  const onDisk = rf.packRecord(copy({ days: ['2030-01-01'], medals: [{ seed: 'theirs', medal: 'gold', score: 900, at: '2030-01-02T00:00:00.000Z' }] }));
  let loads = 0;
  win.jdDesktop = {
    record: {
      load: async () => {
        loads++;
        return JSON.parse(JSON.stringify(onDisk));
      },
      save: async (d) => {
        saved.push(JSON.parse(JSON.stringify(d)));
        return true;
      },
    },
  };
  assert.equal(await rf.desktopRecordSync(), true, 'the file brought a day and a medal');
  assert.equal(loads, 1);
  assert.deepEqual(storage.loadDaysPlayed(), ['2030-01-01']);
  assert.equal(storage.loadMedals()[0].seed, 'theirs');
  assert.equal(storage.loadBests().bySeed['mine'].score, 300);
  assert.equal(saved.length, 1, 'what this device held beyond the file went to the file at once');
  const first = saved[0] as { record: { bests: { bySeed: Record<string, { score: number }> }; days: string[] } };
  assert.equal(first.record.bests.bySeed['mine'].score, 300);
  assert.deepEqual(first.record.days, ['2030-01-01']);
  assert.ok(!JSON.stringify(saved).includes(TOKEN), 'the key is not in what goes to the shell');
  storage.recordBest('later', 50);
  storage.recordDayPlayed(new Date('2030-02-02T10:00:00Z'));
  assert.equal(saved.length, 1, 'not yet: a run of writes is one save');
  await new Promise((r) => setTimeout(r, rf.SAVE_DELAY_MS + 100));
  assert.equal(saved.length, 2);
  assert.deepEqual((saved[1] as typeof first).record.days, ['2030-01-01', '2030-02-02']);
  storage.recordStars('later', 2);
  win.listeners.pagehide();
  assert.equal(saved.length, 3, 'leaving the page writes what is pending');
  win.listeners.pagehide();
  assert.equal(saved.length, 3, 'nothing changed, nothing written');
  assert.equal(await rf.desktopRecordSync(), false, 'once per page');
  assert.equal(loads, 1);
  delete win.jdDesktop;
});
