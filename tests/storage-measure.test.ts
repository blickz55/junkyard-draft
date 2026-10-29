import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { synthesise, measure, TRIGGER } from '../tools/storage-measure';
import { loadBoard, DEFAULT_MAX_ENTRIES_PER_SEED, DEFAULT_REPLAYS_PER_SEED } from '../server/verify';

test('storage measurement (PLAN-v3 0.6.7): the synthetic board has the post-retention shape, survives loadBoard, and the tool measures the real commit path quickly', () => {
  const b = synthesise(7, 3);
  assert.equal(b.entries.length, 21); assert.equal(Object.keys(b.replays!).length, 21); assert.equal(Object.keys(b.players!).length, 7); assert.equal(Object.keys(b.dailies!).length, 3); assert.equal(Object.keys(b.pars!).length, 3);
  assert.ok(b.entries.every((e) => e.playerId && e.replayHash.length === 64 && e.player.includes('#')));
  assert.ok(Object.values(b.dailies!).every((d) => d.frozenAt && d.medals && d.medals.n === 7), 'frozen days carry medals from the synthetic scores');
  const big = synthesise(2500, 2);
  assert.equal(big.entries.length, 2 * DEFAULT_MAX_ENTRIES_PER_SEED, 'entries per seed are capped like the verifier would'); assert.equal(Object.keys(big.replays!).length, 2 * DEFAULT_REPLAYS_PER_SEED, 'replays per seed too');
  const loaded = loadBoard(JSON.stringify(b));
  assert.equal(loaded.entries.length, 21); assert.equal(Object.keys(loaded.replays!).length, 21); assert.equal(Object.keys(loaded.players!).length, 7); assert.equal(Object.keys(loaded.dailies!).length, 3);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jd-storage-test-'));
  try {
    const s = measure(20, 2, dir);
    assert.equal(s.entries, 40); assert.ok(s.bytes > 10_000 && s.mb >= 0); assert.ok(s.commitMs.samples.length === 7 && s.commitMs.median >= 0 && s.loadMs >= 0 && s.boardReadMs >= 0 && s.archiveMs >= 0);
    assert.equal(s.overTrigger, false, 'a tiny board is far from the trigger');
    assert.equal(fs.readdirSync(dir).length, 0, 'the tool cleans up its file');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  assert.deepEqual(TRIGGER, { bytes: 5 * 1024 * 1024, commitMs: 50 });
  // the committed baseline is what the README quotes
  const baseline = JSON.parse(fs.readFileSync('docs/baselines/0.6/storage.json', 'utf8')) as { scenarios: { players: number; mb: number; commitMs: { median: number }; overTrigger: boolean }[]; anyOverTrigger: boolean };
  assert.deepEqual(baseline.scenarios.map((x) => x.players), [100, 1000, 10000]);
  assert.equal(baseline.anyOverTrigger, baseline.scenarios.some((x) => x.overTrigger));
});
