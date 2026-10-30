// Production roadmap 0.10.4: push for the daily. A subscription round-trips through the verifier to a mock push endpoint
// with a VAPID-signed, encrypted request built by web-push; the message goes once a day per subscription at its UTC hour
// under a fake clock; a subscription the service reports gone is dropped; unsubscribe and DELETE /me remove rows; the
// routes validate; a verifier without keys answers 503; the store reloads its file.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { PushStore, validateSubscription, validateHour, generateVapidKeys, DAILY_MESSAGE, PUSH_TTL_SEC, MAX_FAILURES } from '../server/push';
import { createServer, Verifier } from '../server/verify';
import { localToUtcHour, urlBase64ToUint8Array } from '../game/src/render/push';

const b64url = (b: Buffer) => b.toString('base64url');
/** a browser-like client key pair: the uncompressed P-256 point and a 16-byte auth secret */
function clientKeys() {
  const kp = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const spki = kp.publicKey.export({ type: 'spki', format: 'der' }) as Buffer;
  return { p256dh: b64url(spki.subarray(spki.length - 65)), auth: b64url(crypto.randomBytes(16)) };
}
const listen = (s: http.Server) => new Promise<number>((r) => s.listen(0, '127.0.0.1', () => r((s.address() as AddressInfo).port)));
const at = (hour: number, day = '2026-11-01') => new Date(`${day}T${String(hour).padStart(2, '0')}:30:00Z`);

test('push: subscribe, the daily message once a day per hour through web-push to a mock endpoint, 410 drops the row, unsubscribe and deletion', async () => {
  const hits: { headers: http.IncomingHttpHeaders; body: Buffer }[] = [];
  let answer = 201;
  const svc = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      hits.push({ headers: req.headers, body: Buffer.concat(chunks) });
      res.writeHead(answer);
      res.end();
    });
  });
  const svcPort = await listen(svc);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jd-push-'));
  const vapid = { ...(await generateVapidKeys()), subject: 'mailto:test@example.com' };
  const store = new PushStore(path.join(dir, 'push.json'), { vapid, log: null });
  assert.equal(store.enabled, true);
  const server = createServer(new Verifier(path.join(dir, 'board.json')), { push: store, writeRateLimit: null, log: null });
  const port = await listen(server);
  const base = `http://127.0.0.1:${port}`;
  const post = (p: string, body: unknown, headers: Record<string, string> = {}) =>
    fetch(`${base}${p}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
  try {
    const key = await (await fetch(`${base}/push/vapid`)).json();
    assert.equal(key.publicKey, vapid.publicKey, 'the client fetches the public key');
    assert.equal(urlBase64ToUint8Array(vapid.publicKey).length, 65, 'the key decodes to an uncompressed P-256 point');
    const keys = clientKeys();
    const endpoint = `http://127.0.0.1:${svcPort}/push/v1/abc`;
    const r1 = await post('/push/subscribe', { subscription: { endpoint, keys }, hourUtc: 9 });
    const j1 = await r1.json();
    assert.equal(r1.status, 200, JSON.stringify(j1));
    assert.deepEqual(j1, { ok: true, hourUtc: 9, subscriptions: 1 });
    // the same endpoint again changes the hour without a second row
    assert.equal((await (await post('/push/subscribe', { subscription: { endpoint, keys }, hourUtc: 7 })).json()).subscriptions, 1);
    await post('/push/subscribe', { subscription: { endpoint, keys }, hourUtc: 9 });
    // the clock: nothing at 08, one message at 09, none again that day, one the next day
    assert.deepEqual(await store.tick(at(8)), { sent: 0, removed: 0, failed: 0 });
    assert.deepEqual(await store.tick(at(9)), { sent: 1, removed: 0, failed: 0 });
    assert.equal(hits.length, 1, 'one request reached the push service');
    const h = hits[0];
    assert.match(String(h.headers.authorization), /^vapid t=[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+, k=/, 'VAPID: a signed JWT and the public key');
    assert.equal(h.headers['content-encoding'], 'aes128gcm');
    assert.equal(h.headers.ttl, String(PUSH_TTL_SEC));
    assert.ok(h.body.length > 100 && !h.body.includes(Buffer.from(DAILY_MESSAGE.body)), 'the body is encrypted for the browser');
    assert.deepEqual(await store.tick(at(9)), { sent: 0, removed: 0, failed: 0 }, 'the same hour again: already sent today');
    assert.deepEqual(await store.tick(at(10)), { sent: 0, removed: 0, failed: 0 }, 'another hour: not this subscription');
    assert.deepEqual(await store.tick(at(9, '2026-11-02')), { sent: 1, removed: 0, failed: 0 }, 'the next day: one more');
    assert.equal(hits.length, 2);
    assert.equal(store.list()[0].lastSentDay, '2026-11-02');
    // the service says the subscription is gone
    answer = 410;
    assert.deepEqual(await store.tick(at(9, '2026-11-03')), { sent: 0, removed: 1, failed: 1 });
    assert.equal(store.count, 0);
    assert.deepEqual(store.stats, { sent: 2, removed: 1, failed: 1 });
    // other failures: dropped after MAX_FAILURES days
    answer = 500;
    await post('/push/subscribe', { subscription: { endpoint, keys }, hourUtc: 9 });
    for (let d = 0; d < MAX_FAILURES - 1; d++) assert.deepEqual(await store.tick(at(9, `2026-11-1${d}`)), { sent: 0, removed: 0, failed: 1 });
    assert.deepEqual(await store.tick(at(9, '2026-11-19')), { sent: 0, removed: 1, failed: 1 }, `the ${MAX_FAILURES}th failure drops it`);
    answer = 201;
    // unsubscribe
    await post('/push/subscribe', { subscription: { endpoint, keys }, hourUtc: 9 });
    assert.deepEqual(await (await post('/push/unsubscribe', { endpoint })).json(), { ok: true, removed: true });
    assert.deepEqual(await (await post('/push/unsubscribe', { endpoint })).json(), { ok: true, removed: false });
    // a bearer ties the row to the player; DELETE /me removes it
    const token = 'c'.repeat(32);
    await post('/push/subscribe', { subscription: { endpoint, keys }, hourUtc: 9 }, { Authorization: `Bearer ${token}` });
    assert.equal(store.count, 1);
    assert.ok(store.list()[0].playerId, 'the row carries the player id');
    const del = await (await fetch(`${base}/me`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } })).json();
    assert.equal(del.pushSubscriptionsRemoved, 1);
    assert.equal(store.count, 0);
    // validation
    assert.equal((await post('/push/subscribe', { subscription: { endpoint, keys }, hourUtc: 24 })).status, 422);
    assert.equal(
      (await post('/push/subscribe', { subscription: { endpoint: 'http://push.example/x', keys }, hourUtc: 9 })).status,
      422,
      'http off the loopback',
    );
    assert.equal((await post('/push/subscribe', { subscription: { endpoint }, hourUtc: 9 })).status, 422, 'keys required');
    assert.equal((await post('/push/unsubscribe', {})).status, 400);
    // persistence
    await post('/push/subscribe', { subscription: { endpoint, keys }, hourUtc: 21 });
    const again = new PushStore(path.join(dir, 'push.json'), { vapid, log: null });
    assert.equal(again.count, 1);
    assert.equal(again.list()[0].hourUtc, 21);
    const health = await (await fetch(`${base}/health`)).json();
    assert.deepEqual(health.push, { enabled: true, subscriptions: 1, sent: 2, removed: 2, failed: MAX_FAILURES + 1 });
  } finally {
    server.close();
    svc.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('push disabled: without VAPID keys the routes answer 503 and the tick sends nothing; validation helpers', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jd-push-off-'));
  const store = new PushStore(path.join(dir, 'push.json'), { log: null });
  assert.equal(store.enabled, false);
  const server = createServer(new Verifier(path.join(dir, 'board.json')), { push: store, log: null });
  const port = await listen(server);
  try {
    assert.equal((await fetch(`http://127.0.0.1:${port}/push/vapid`)).status, 503);
    const r = await fetch(`http://127.0.0.1:${port}/push/subscribe`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    assert.equal(r.status, 503);
    assert.deepEqual(await store.tick(at(9)), { sent: 0, removed: 0, failed: 0 });
    const none = createServer(new Verifier(path.join(dir, 'b2.json')), { log: null });
    const p2 = await listen(none);
    assert.equal((await fetch(`http://127.0.0.1:${p2}/push/vapid`)).status, 503, 'no store at all: the same answer');
    none.close();
  } finally {
    server.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
  const keys = clientKeys();
  assert.equal(typeof validateSubscription({ endpoint: 'https://push.example/x', keys }), 'object');
  assert.match(validateSubscription({ endpoint: 'ftp://x', keys }) as string, /https/);
  assert.match(validateSubscription({ endpoint: 'https://push.example/x', keys: { p256dh: 'short', auth: keys.auth } }) as string, /p256dh/);
  assert.match(validateSubscription({ endpoint: 'https://push.example/x', keys: { p256dh: keys.p256dh, auth: 'not base64url!' } }) as string, /auth/);
  assert.match(validateSubscription(null) as string, /required/);
  assert.equal(validateHour(0), 0);
  assert.equal(validateHour(23), 23);
  assert.match(validateHour(24) as string, /0 to 23/);
  assert.match(validateHour('9') as string, /0 to 23/);
  // the client's hour conversion: 09:00 in UTC+2 (offset −120) is 07 UTC; 01:00 in UTC−5 (offset 300) is 06 UTC; a half-hour zone rounds down
  assert.equal(localToUtcHour(9, -120), 7);
  assert.equal(localToUtcHour(1, 300), 6);
  assert.equal(localToUtcHour(23, -90), 21);
  assert.equal(localToUtcHour(0, 0), 0);
});
