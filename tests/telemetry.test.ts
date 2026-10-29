// Opt-in funnel client (PLAN-v1 0.3.7): nothing leaves the device until consent; once-per-install events; no seeds.
import { test } from 'node:test';
import assert from 'node:assert/strict';

const store = new Map<string, string>();
(globalThis as unknown as { localStorage: Storage }).localStorage = {
  getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
  setItem: (k: string, v: string) => { store.set(k, String(v)); },
  removeItem: (k: string) => { store.delete(k); },
  clear: () => store.clear(),
  key: (i: number) => [...store.keys()][i] ?? null,
  get length() { return store.size; },
} as Storage;

const { telemetry } = await import('../game/src/render/telemetry');
const { validateEvent, validateBatch, EVENTS, ONCE_EVENTS } = await import('../game/src/telemetry/events');

test('telemetry: off by default — nothing is queued, stored or sent; on — install id, consent event, batches, dedup, no seeds; off again forgets everything', async () => {
  const sent: { url: string; body: { installId: string; consent: boolean; events: { name: string; props: Record<string, unknown> }[] } }[] = [];
  let accept = true;
  telemetry.configure({ url: () => 'http://verifier.test', sender: async (url, body) => { if (!accept) return false; sent.push({ url, body: JSON.parse(body) }); return true; } });
  assert.equal(telemetry.enabled, false);
  assert.equal(telemetry.track('app_start'), false, 'disabled: nothing is recorded');
  assert.equal(store.has('jd.telemetry.v1'), false, 'disabled: no install state exists');
  telemetry.setEnabled(true);
  assert.equal(telemetry.enabled, true);
  assert.match(store.get('jd.telemetry.v1') ?? '', /"installId":"[0-9a-f]{32}"/, 'a random install id is created on consent');
  await telemetry.flush();
  assert.equal(sent.length, 1); assert.equal(sent[0].url, 'http://verifier.test/events');
  assert.equal(sent[0].body.consent, true); assert.deepEqual(sent[0].body.events.map((e) => e.name), ['consent_set']);
  // once-per-install events are deduplicated locally; repeatable ones are not
  assert.equal(telemetry.track('first_run_start'), true); assert.equal(telemetry.track('first_run_start'), false);
  assert.equal(telemetry.track('round_complete', { n: 1 }), true); assert.equal(telemetry.track('round_complete', { n: 2 }), true);
  // a seed property is dropped before it is ever queued; unknown props too
  assert.equal(telemetry.track('game_complete', { mode: 'seed', seed: 'secret-layout-seed' }), false);
  assert.equal(telemetry.track('game_complete', { mode: 'seed', layout: 'x' } as never), false);
  assert.equal(telemetry.stats().dropped, 2);
  await telemetry.flush();
  const names = sent.flatMap((s) => s.body.events.map((e) => e.name));
  assert.deepEqual(names, ['consent_set', 'first_run_start', 'round_complete', 'round_complete']);
  assert.ok(!JSON.stringify(sent).includes('secret-layout-seed'));
  // a failed send keeps the queue for the next flush
  accept = false; telemetry.track('tip_opened', { id: 'press' });
  assert.equal(await telemetry.flush(), false); assert.equal(telemetry.stats().queued, 1);
  assert.match(store.get('jd.telemetry.v1') ?? '', /"pending":\[\{"name":"tip_opened"/, 'the unsent queue is persisted so a navigation cannot lose it');
  accept = true; assert.equal(await telemetry.flush(), true); assert.equal(telemetry.stats().queued, 0);
  assert.match(store.get('jd.telemetry.v1') ?? '', /"pending":\[\]/, 'sent events leave the persisted queue');
  // games: the second fresh start and dailies are counted
  telemetry.gameStart('rust-bolt-1'); telemetry.gameStart('daily-2026-10-29');
  await telemetry.flush();
  const tail = sent.flatMap((s) => s.body.events.map((e) => e.name)).slice(-2);
  assert.deepEqual(tail, ['second_game_start', 'daily_start']);
  // opting out deletes the install state and silences tracking
  telemetry.setEnabled(false);
  assert.equal(telemetry.enabled, false); assert.equal(store.has('jd.telemetry.v1'), false);
  assert.equal(telemetry.track('app_start'), false);
  assert.equal(telemetry.stats().queued, 0);
});

test('telemetry vocabulary: every once-event is in the list; validateBatch enforces consent, id shape and bounds', () => {
  for (const n of ONCE_EVENTS) assert.ok(n in EVENTS, n);
  assert.match(validateBatch({ installId: 'a'.repeat(32), events: [{ name: 'app_start', at: new Date().toISOString() }] }) as string, /no consent/);
  assert.match(validateBatch({ installId: 'nope', consent: true, events: [{ name: 'app_start', at: new Date().toISOString() }] }) as string, /installId/);
  assert.match(validateBatch({ installId: 'a'.repeat(32), consent: true, events: [] }) as string, /non-empty/);
  assert.match(validateEvent({ name: 'app_start' }) as string, /timestamp/);
  assert.match(validateEvent({ name: 'daily_start', props: { seed: 'daily-2026-10-29', x: 1 }, at: new Date().toISOString() }) as string, /property x/, 'a daily label is allowed as a seed value, other keys still must be in the vocabulary');
  const ok = validateEvent({ name: 'first_place_rejected', props: { reason: 'occupied' }, at: new Date().toISOString() });
  assert.equal(typeof ok, 'object');
});
