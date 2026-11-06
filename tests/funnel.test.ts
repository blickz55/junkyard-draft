// The return (2026-11-06): next-day and seven-day return visits from app_start on the server's clock, over installs old enough to have had the chance.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventStore, type StoredEvent } from '../server/verify';

const id = (c: string) => c.repeat(32);
const row = (installId: string, name: StoredEvent['name'], receivedAt: string, props: StoredEvent['props'] = {}): StoredEvent => ({
  at: receivedAt,
  receivedAt,
  installId,
  ip: 'x',
  name,
  props,
});
const store = new EventStore('nowhere.jsonl');
const now = new Date('2026-11-20T12:00:00Z');

test('an install back at 00:05 UTC the next day counts; the same day again does not; a later day counts for seven days only', () => {
  const rows = [
    row(id('a'), 'app_start', '2026-11-01T23:50:00Z'),
    row(id('a'), 'app_start', '2026-11-02T00:05:00Z'),
    row(id('b'), 'app_start', '2026-11-01T09:00:00Z'),
    row(id('b'), 'app_start', '2026-11-01T21:00:00Z'),
    row(id('c'), 'app_start', '2026-11-01T09:00:00Z'),
    row(id('c'), 'app_start', '2026-11-05T09:00:00Z'),
    row(id('d'), 'app_start', '2026-11-01T09:00:00Z'),
    row(id('d'), 'app_start', '2026-11-12T09:00:00Z'),
  ];
  const r = store.returns(rows, now);
  assert.deepEqual([r.nextDay.eligible, r.nextDay.returned], [4, 1]);
  assert.deepEqual([r.sevenDay.eligible, r.sevenDay.returned], [4, 2], 'c within seven days, d not');
});

test('installs younger than the window are not in the denominator', () => {
  const rows = [
    row(id('a'), 'app_start', '2026-11-19T20:00:00Z'), // 16 hours ago: no chance yet
    row(id('b'), 'app_start', '2026-11-15T12:00:00Z'), // five days: a next-day chance, no seven-day chance yet
    row(id('b'), 'app_start', '2026-11-16T12:00:00Z'),
  ];
  const r = store.returns(rows, now);
  assert.deepEqual([r.nextDay.eligible, r.nextDay.returned], [1, 1]);
  assert.deepEqual([r.sevenDay.eligible, r.sevenDay.returned], [0, 0]);
});

test('the split by a game finished on day one sums to the total, and a watched recording is not a finished game', () => {
  const rows = [
    row(id('a'), 'app_start', '2026-11-01T09:00:00Z'),
    row(id('a'), 'game_complete', '2026-11-01T09:20:00Z', { mode: 'daily' }),
    row(id('a'), 'app_start', '2026-11-02T09:00:00Z'),
    row(id('b'), 'app_start', '2026-11-01T09:00:00Z'),
    row(id('b'), 'game_complete', '2026-11-01T09:20:00Z', { mode: 'replay' }),
    row(id('c'), 'app_start', '2026-11-01T09:00:00Z'),
    row(id('c'), 'game_complete', '2026-11-03T09:20:00Z', { mode: 'daily' }), // finished, but not on day one
    row(id('c'), 'app_start', '2026-11-03T09:00:00Z'),
  ];
  const r = store.returns(rows, now);
  assert.deepEqual(r.nextDay, { eligible: 3, returned: 1, finishedDayOne: { eligible: 1, returned: 1 }, notFinished: { eligible: 2, returned: 0 } });
  assert.equal(r.nextDay.finishedDayOne.eligible + r.nextDay.notFinished.eligible, r.nextDay.eligible);
  assert.deepEqual([r.sevenDay.returned, r.sevenDay.notFinished.returned], [2, 1]);
});

test('the funnel carries the return rows, and no rows read as zero everywhere', () => {
  const f = store.funnel([], now);
  assert.deepEqual(f.returns.nextDay, { eligible: 0, returned: 0, finishedDayOne: { eligible: 0, returned: 0 }, notFinished: { eligible: 0, returned: 0 } });
});
