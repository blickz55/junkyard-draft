// Production roadmap 0.11.7, the rest: push per kind. A device hears only what it asked for, a few times a day at most, never at night, in words
// that say neither who nor what; the count survives a restart; a gone subscription drops; and a reply or a beaten score reaches it from the
// store, so no writer has to remember to ask, while every other kind of line stays in the inbox.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { CommunityStore } from '../server/community';
import { Pipeline, type Classifier } from '../server/moderation';
import { isQuiet, PushError, PushStore, SOCIAL_MESSAGES, SOCIAL_PER_DAY, validateOffset, validateSocial } from '../server/push';
import { createServer, playerIdFromToken, Verifier } from '../server/verify';

const NOON = new Date('2030-03-12T12:00:00Z');
const DAY = 86_400_000;
const keys = () => ({ p256dh: crypto.randomBytes(65).toString('base64url'), auth: crypto.randomBytes(16).toString('base64url') });
const vapid = { publicKey: 'public', privateKey: 'private', subject: 'mailto:test@example.com' };

function rig(now = () => NOON.getTime()) {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'jd-push-social-')), 'push.json');
  const sent: { endpoint: string; message: { body: string; tag: string } }[] = [];
  let failure: PushError | null = null;
  const store = new PushStore(file, {
    vapid,
    now,
    log: null,
    send: async (sub, payload) => {
      if (failure) throw failure;
      sent.push({ endpoint: sub.endpoint, message: JSON.parse(payload) });
    },
  });
  return { file, sent, store, fail: (e: PushError | null) => (failure = e) };
}

test('the words: neither who nor what, and each kind tagged apart so they do not replace the daily', () => {
  for (const m of Object.values(SOCIAL_MESSAGES)) {
    assert.doesNotMatch(m.body, /\$|#|\d/, m.body);
    assert.notEqual(m.tag, 'jd-daily');
  }
});

test('night is by the clock of the device: from ten at night to eight in the morning, half-hour zones too', () => {
  const at = (h: number, m = 0) => new Date(Date.UTC(2030, 2, 12, h, m));
  assert.equal(isQuiet(0, at(21, 59)), false);
  assert.equal(isQuiet(0, at(22, 0)), true);
  assert.equal(isQuiet(0, at(7, 59)), true);
  assert.equal(isQuiet(0, at(8, 0)), false);
  assert.equal(isQuiet(300, at(12, 0)), true, 'New York: seven in the morning');
  assert.equal(isQuiet(300, at(13, 0)), false, 'eight');
  assert.equal(isQuiet(-330, at(16, 0)), false, 'Delhi, half past nine in the evening');
  assert.equal(isQuiet(-330, at(16, 30)), true, 'ten');
  assert.equal(isQuiet(-840, at(10, 0)), true, 'the far side of the date line: midnight');
});

test('a device hears only what it asked for, up to the cap, and the next day it starts again', async () => {
  const r = rig();
  const key = keys();
  r.store.subscribe({ endpoint: 'https://push.example/phone', keys: key, hourUtc: 9, playerId: 'ann' });
  r.store.subscribe({ endpoint: 'https://push.example/laptop', keys: key, hourUtc: 9, playerId: 'ann' });
  r.store.subscribe({ endpoint: 'https://push.example/sam', keys: key, hourUtc: 9, playerId: 'sam' });
  assert.equal(await r.store.social(['ann'], 'reply', NOON), 0, 'nothing until asked for');

  assert.equal(r.store.setSocial('https://push.example/phone', ['reply']), true);
  assert.equal(r.store.setSocial('https://push.example/nobody', ['reply']), false);
  assert.equal(await r.store.social(['ann'], 'challenge', NOON), 0, 'not the kind it asked for');
  assert.equal(await r.store.social(['sam'], 'reply', NOON), 0, 'not this player');
  assert.equal(await r.store.social(['ann'], 'reply', NOON), 1);
  assert.deepEqual(r.sent, [{ endpoint: 'https://push.example/phone', message: SOCIAL_MESSAGES.reply }], 'and not the other device');

  for (let i = 1; i < SOCIAL_PER_DAY; i++) assert.equal(await r.store.social(['ann'], 'reply', NOON), 1);
  assert.equal(await r.store.social(['ann'], 'reply', NOON), 0, 'the cap');
  assert.equal(r.sent.length, SOCIAL_PER_DAY);
  assert.equal(await r.store.social(['ann'], 'reply', new Date(NOON.getTime() + DAY)), 1, 'a new day');
});

test('a night stays quiet, and the daily is not touched by any of it', async () => {
  const r = rig();
  r.store.subscribe({ endpoint: 'https://push.example/a', keys: keys(), hourUtc: 3, playerId: 'ann', offsetMin: 300 });
  r.store.setSocial('https://push.example/a', ['challenge']);
  const threeUtc = new Date('2030-03-12T03:00:00Z'); // ten at night, a day before, by the clock of the device
  assert.equal(await r.store.social(['ann'], 'challenge', threeUtc), 0);
  assert.equal((await r.store.tick(threeUtc)).sent, 1, 'she chose that hour for the daily');
  assert.equal(r.sent[0].message.tag, 'jd-daily');
});

test('the count survives a restart on the next tick, an old file still loads, and a subscription kept through a new hour keeps its choices', async () => {
  const r = rig();
  r.store.subscribe({ endpoint: 'https://push.example/a', keys: keys(), hourUtc: 9, playerId: 'ann' });
  r.store.setSocial('https://push.example/a', ['reply', 'challenge']);
  for (let i = 0; i < SOCIAL_PER_DAY; i++) await r.store.social(['ann'], 'reply', NOON);
  await r.store.tick(NOON);
  const again = new PushStore(r.file, { vapid, now: () => NOON.getTime(), log: null, send: async () => {} });
  assert.equal(await again.social(['ann'], 'reply', NOON), 0, 'still at the cap');
  const moved = again.subscribe({ endpoint: 'https://push.example/a', keys: keys(), hourUtc: 10, playerId: 'ann' });
  assert.deepEqual(moved.social, ['reply', 'challenge']);
  assert.equal(moved.socialSent, SOCIAL_PER_DAY);

  const raw = JSON.parse(fs.readFileSync(r.file, 'utf8')) as { subscriptions: Record<string, unknown>[] };
  for (const row of raw.subscriptions) for (const k of ['social', 'offsetMin', 'socialDay', 'socialSent']) delete row[k];
  fs.writeFileSync(r.file, JSON.stringify(raw));
  const old = new PushStore(r.file, { vapid, log: null, send: async () => {} });
  assert.deepEqual(old.list()[0].social, [], 'a row from 0.10.4 reads as the daily alone');
  assert.equal(old.list()[0].offsetMin, 0);
});

test('a gone subscription drops here too, and a failure spends a place', async () => {
  const r = rig();
  r.store.subscribe({ endpoint: 'https://push.example/a', keys: keys(), hourUtc: 9, playerId: 'ann' });
  r.store.setSocial('https://push.example/a', ['reply']);
  r.fail(new PushError(500, 'try later'));
  assert.equal(await r.store.social(['ann'], 'reply', NOON), 0);
  assert.equal(r.store.stats.failed, 1);
  assert.equal(r.store.count, 1, 'one bad answer is not the end of it');
  r.fail(new PushError(410, 'gone'));
  assert.equal(await r.store.social(['ann'], 'reply', NOON), 0);
  assert.equal(r.store.count, 0);
  assert.equal(r.store.stats.removed, 1);
  await r.store.tick(NOON);
  assert.equal((JSON.parse(fs.readFileSync(r.file, 'utf8')) as { subscriptions: unknown[] }).subscriptions.length, 0);
});

test('the helpers: a choice must be a known kind, and a bad offset reads as UTC rather than refusing a reminder', () => {
  assert.deepEqual(validateSocial(['reply', 'reply', 'challenge']), ['reply', 'challenge']);
  assert.deepEqual(validateSocial([]), []);
  assert.equal(typeof validateSocial(['daily']), 'string');
  assert.equal(typeof validateSocial('reply'), 'string');
  assert.equal(validateOffset(300), 300);
  assert.equal(validateOffset(-840), -840);
  assert.equal(validateOffset(900), 0);
  assert.equal(validateOffset(1.5), 0);
  assert.equal(validateOffset('300'), 0);
});

test('through the server: a reply and a beaten score reach the device that asked, from the store, and nothing else does', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jd-push-server-'));
  const now = () => NOON.getTime();
  const verifier = new Verifier(path.join(dir, 'board.json'), { dailySecret: 'fixture-secret', auditFile: null });
  const community = new CommunityStore(path.join(dir, 'community.db'), { now });
  const classify: Classifier = async () => ({ category: 'ok', score: 1 });
  const moderation = new Pipeline({ store: community, classify, audit: () => {}, now, sweepMs: 0, logError: () => {} });
  const r = rig(now);
  const srv = createServer(verifier, { log: null, community, moderation, moderationToken: 'tok', now, postRateLimit: 1000, push: r.store });
  await new Promise<void>((done) => srv.listen(0, '127.0.0.1', done));
  const base = `http://127.0.0.1:${(srv.address() as AddressInfo).port}`;
  const call = async (p: string, bearer: string | null, body: unknown) => {
    const res = await fetch(`${base}${p}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}) },
      body: JSON.stringify(body),
    });
    return { status: res.status, json: (await res.json()) as Record<string, unknown> };
  };
  const person = (letter: string, name: string) => {
    const token = letter.repeat(32);
    const id = playerIdFromToken(token)!;
    community.bindEmail(id, `hash-${letter}`);
    verifier.claim(id, name, new Date(now()));
    return { token, id };
  };
  const ann = person('a', 'Ann');
  const sam = person('b', 'Sam');
  const endpoint = 'https://push.example/ann';
  const subscribed = await call('/push/subscribe', ann.token, { subscription: { endpoint, keys: keys() }, hourUtc: 9, offsetMin: 'nonsense' });
  assert.equal(subscribed.status, 200, JSON.stringify(subscribed.json));
  assert.equal(r.store.list()[0].offsetMin, 0);
  assert.equal((await call('/push/social', null, { endpoint: 'https://push.example/nobody', kinds: [] })).status, 404);
  assert.equal((await call('/push/social', null, { endpoint, kinds: ['everything'] })).status, 422);
  assert.deepEqual((await call('/push/social', null, { endpoint, kinds: ['reply', 'challenge'] })).json, { ok: true, kinds: ['reply', 'challenge'] });

  assert.equal((await call('/posts', ann.token, { key: 'hub:strategies', body: 'Press before the dock' })).status, 200);
  await moderation.idle();
  assert.equal((await call('/posts', sam.token, { key: 'hub:strategies', body: 'Crusher first' })).status, 200);
  await moderation.idle();
  await new Promise((done) => setTimeout(done, 20));
  assert.deepEqual(
    r.sent.map((s) => s.message.tag),
    ['jd-reply'],
    'someone wrote where she wrote',
  );

  community.notify(ann.id, 'challenge', { hash: 'h', seed: 's', score: 2, theirs: 1, by: sam.id });
  community.notify(ann.id, 'challenge', { hash: 'h', seed: 's', score: 2, theirs: 1, by: sam.id });
  community.notify(ann.id, 'reactions', { hash: 'h', count: 1 });
  community.notify(ann.id, 'division', { period: '2030-03-11' });
  await new Promise((done) => setTimeout(done, 20));
  assert.deepEqual(
    r.sent.map((s) => s.message.tag),
    ['jd-reply', 'jd-challenge'],
    'the same unread line once, and the other kinds stay in the inbox',
  );

  moderation.close();
  await new Promise((done) => srv.close(done));
  community.close();
});
