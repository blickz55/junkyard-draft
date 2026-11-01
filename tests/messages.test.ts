// Production roadmap 0.11.9: direct messages. Friends only; the same filter; nothing reads a message unless the player it was sent to
// reports it, and then it goes to a person with what was said around it; a person's decision can be appealed; a block ends the
// conversation for both; ninety days, then the words go; and both sides' rows go with DELETE /me.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { CommunityStore, MESSAGE_DAYS, MESSAGE_PAGE } from '../server/community';
import { MESSAGE_MAX, OWNER, Pipeline, TriageError, UNREAD, type Classifier } from '../server/moderation';
import { createServer, friendHandle, playerIdFromToken, Verifier } from '../server/verify';

const T0 = Date.parse('2030-03-12T10:00:00Z');
const DAY = 86_400_000;

async function rig(o: { classify?: Classifier | null } = {}) {
  let now = T0;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jd-messages-'));
  const verifier = new Verifier(path.join(dir, 'board.json'), { dailySecret: 'fixture-secret', auditFile: null });
  const community = new CommunityStore(path.join(dir, 'community.db'), { now: () => now });
  const reads: string[] = [];
  const classify: Classifier = async (body) => {
    reads.push(body);
    return { category: 'harassment', score: 70 };
  };
  const audit: Record<string, unknown>[] = [];
  const moderation = new Pipeline({
    store: community,
    classify: o.classify === undefined ? classify : o.classify,
    audit: (row) => audit.push(row),
    now: () => now,
    sweepMs: 0,
    logError: () => {},
  });
  const srv = createServer(verifier, { log: null, community, moderation, moderationToken: 'tok', now: () => now });
  await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${(srv.address() as AddressInfo).port}`;
  const call = async (method: string, p: string, bearer?: string, body?: unknown, mod?: string) => {
    const res = await fetch(`${base}${p}`, {
      method,
      headers: { 'Content-Type': 'application/json', ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}), ...(mod ? { 'X-Moderation-Token': mod } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: res.status, json: (await res.json()) as Record<string, never> };
  };
  const person = (letter: string, name: string) => {
    const token = letter.repeat(32);
    const id = playerIdFromToken(token)!;
    community.bindEmail(id, `hash-${letter}`);
    verifier.claim(id, name, new Date(now));
    return { token, id };
  };
  const befriend = (a: { id: string }, b: { id: string }) => {
    community.requestFriend(a.id, b.id);
    community.answerFriend(b.id, a.id, true);
  };
  return {
    call,
    verifier,
    community,
    moderation,
    person,
    befriend,
    reads,
    audit,
    tick: (ms: number) => (now += ms),
    close: async () => {
      moderation.close();
      await new Promise((r) => srv.close(r));
      community.close();
    },
  };
}
const send = (r: Awaited<ReturnType<typeof rig>>, from: { token: string; id: string }, to: { id: string }, body: string) =>
  r.call('POST', '/messages/send', from.token, { handle: friendHandle(from.id, to.id), body });
type Line = { id: number; mine: boolean; body: string; removed: boolean };
const lines = (j: Record<string, unknown>) => j.messages as unknown as Line[];

test('a non-friend cannot write; friends can, the other reads it, and nothing reads a message on its way', async () => {
  const r = await rig();
  const sam = r.person('a', 'Sam');
  const ann = r.person('b', 'Ann');
  assert.equal((await send(r, sam, ann, 'hello')).status, 403);
  r.community.requestFriend(sam.id, ann.id);
  assert.equal((await send(r, sam, ann, 'hello')).status, 403, 'a request is not a friendship');
  r.community.answerFriend(ann.id, sam.id, true);
  const out = await send(r, sam, ann, '  hello   there ');
  assert.equal(out.status, 200);
  await r.moderation.idle();
  assert.deepEqual(r.reads, [], 'no classifier, no person: a message is private');
  const line = ((await r.call('GET', '/me/inbox', ann.token)).json.items as unknown as { kind: string; payload: { player: string; handle: string } }[])[0];
  assert.equal(line.kind, 'message');
  assert.equal(line.payload.player, `Sam#${r.verifier.player(sam.id)!.tag}`);
  assert.ok(!JSON.stringify(line).includes(sam.id), 'no id in the line');
  const convo = await r.call('GET', `/messages/with?handle=${line.payload.handle}`, ann.token);
  assert.deepEqual(
    lines(convo.json).map((m) => [m.body, m.mine]),
    [['hello there', false]],
  );
  assert.equal(convo.json.friends, true);
  const list = (await r.call('GET', '/messages', sam.token)).json.conversations as unknown as { player: string; unread: number; last: Line }[];
  assert.deepEqual([list[0].player, list[0].unread, list[0].last.body], [`Ann#${r.verifier.player(ann.id)!.tag}`, 0, 'hello there']);
  await send(r, ann, sam, 'hi');
  assert.equal(((await r.call('GET', '/messages', sam.token)).json.conversations as unknown as { unread: number }[])[0].unread, 1);
  assert.equal(((await r.call('GET', '/messages', ann.token)).json.conversations as unknown as { unread: number }[])[0].unread, 0, 'she read it by opening it');
  assert.equal((await r.call('GET', `/messages/with?handle=${'0'.repeat(16)}`, ann.token)).status, 404);
  await r.close();
});

test('the filter holds in a message, the limits answer, and with no classifier there are no messages', async () => {
  const r = await rig();
  const sam = r.person('a', 'Sam');
  const ann = r.person('b', 'Ann');
  r.befriend(sam, ann);
  for (const [body, code] of [
    ['call me on 555-123-4567', 'phone'],
    ['see example.com', 'link'],
    ['', 'empty'],
    ['x'.repeat(MESSAGE_MAX + 1), 'too-long'],
  ] as const) {
    const out = await send(r, sam, ann, body);
    assert.equal(out.status, 422, body.slice(0, 20));
    assert.equal(out.json.code, code);
  }
  assert.equal((await send(r, sam, ann, 'x'.repeat(MESSAGE_MAX))).status, 200);
  r.moderation.decidePlayer(OWNER, sam.id, 'mute-24h', 'spam', '');
  const muted = await send(r, sam, ann, 'muted now');
  assert.equal(muted.status, 403);
  assert.equal(muted.json.code, 'muted');
  await r.close();
  const off = await rig({ classify: null });
  const a = off.person('a', 'Sam');
  const b = off.person('b', 'Ann');
  off.befriend(a, b);
  const refused = await off.call('POST', '/messages/send', a.token, { handle: friendHandle(a.id, b.id), body: 'hello' });
  assert.equal(refused.status, 503);
  assert.equal((await off.call('GET', '/friends', a.token)).json.messages, false);
  await off.close();
});

test('a report surfaces the conversation to the queue: only the one it was sent to can report, and only now is it read', async () => {
  const r = await rig();
  const sam = r.person('a', 'Sam');
  const ann = r.person('b', 'Ann');
  r.befriend(sam, ann);
  await send(r, sam, ann, 'first');
  await send(r, ann, sam, 'second');
  const bad = await send(r, sam, ann, 'the bad one');
  await send(r, ann, sam, 'please stop');
  const id = (bad.json.message as unknown as Line).id;
  assert.equal((await r.call('POST', '/messages/report', sam.token, { id, reason: 'offensive' })).status, 404, 'not your own');
  assert.equal((await r.call('POST', '/messages/report', ann.token, { id, reason: 'made-up' })).status, 422);
  assert.deepEqual((await r.call('POST', '/messages/report', ann.token, { id, reason: 'offensive' })).json, { ok: true, duplicate: false });
  assert.deepEqual((await r.call('POST', '/messages/report', ann.token, { id, reason: 'offensive' })).json, { ok: true, duplicate: true });
  await r.moderation.idle();
  assert.deepEqual(r.reads, ['the bad one'], 'the classifier reads the reported words and no others');
  const queue = (await r.call('GET', '/moderation/queue', undefined, undefined, 'tok')).json;
  const [item] = queue.messages as unknown as {
    id: number;
    body: string;
    from: string;
    to: string;
    triageCategory: string;
    triageScore: number;
    reports: { reason: string; n: number }[];
    context: { body: string }[];
  }[];
  assert.equal(item.body, 'the bad one');
  assert.equal(item.from, `Sam#${r.verifier.player(sam.id)!.tag}`);
  assert.deepEqual([item.triageCategory, item.triageScore], ['harassment', 70]);
  assert.deepEqual(item.reports, [{ reason: 'offensive', n: 1 }]);
  assert.deepEqual(
    item.context.map((m) => m.body),
    ['first', 'second', 'the bad one', 'please stop'],
    'what was said around it',
  );
  await r.close();
});

test('the classifier failing leaves the report in front of a person, and a person clears or removes it; removed, it shows as removed to both and can be appealed', async () => {
  const r = await rig({
    classify: async () => {
      throw new TriageError('no answer: status 529');
    },
  });
  const sam = r.person('a', 'Sam');
  const ann = r.person('b', 'Ann');
  const mod = r.person('c', 'Mod');
  r.community.setTrusted(mod.id, true);
  r.befriend(sam, ann);
  const fine = await send(r, sam, ann, 'a joke between friends');
  const fineId = (fine.json.message as unknown as Line).id;
  await r.call('POST', '/messages/report', ann.token, { id: fineId, reason: 'other' });
  await r.moderation.idle();
  assert.equal(r.community.reportedMessages()[0].triageCategory, UNREAD);
  assert.ok(r.moderation.decideMessage(OWNER, fineId, 'clear', null, 'nothing here').ok);
  assert.deepEqual(r.community.reportedMessages(), []);
  assert.equal(lines((await r.call('GET', `/messages/with?handle=${friendHandle(ann.id, sam.id)}`, ann.token)).json)[0].removed, false);

  const bad = await send(r, sam, ann, 'something awful');
  const id = (bad.json.message as unknown as Line).id;
  await r.call('POST', '/messages/report', ann.token, { id, reason: 'offensive' });
  await r.moderation.idle();
  const self = r.moderation.decideMessage(sam.id, id, 'clear', null, '');
  assert.equal(!self.ok && self.code, 'yourself');
  assert.equal(r.moderation.decideMessage(OWNER, id, 'nonsense', 'hate', '').ok, false);
  assert.equal(r.moderation.decideMessage(OWNER, id, 'delete', 'made-up', '').ok, false);
  assert.equal(r.moderation.decideMessage(OWNER, id + 99, 'delete', 'hate', '').ok, false);
  assert.ok((await r.call('POST', '/moderation/message', undefined, { id, action: 'delete', code: 'hate', note: 'as reported' }, mod.token)).json.ok);
  const view = lines((await r.call('GET', `/messages/with?handle=${friendHandle(sam.id, ann.id)}`, sam.token)).json).at(-1)!;
  assert.deepEqual([view.removed, view.body], [true, ''], 'the words are gone from both screens');
  const line = r.community.inbox(sam.id).items[0];
  assert.deepEqual([line.kind, line.payload.what, line.payload.code], ['moderation', 'message-delete', 'hate']);
  const action = line.payload.action as number;
  assert.equal(r.moderation.canAppeal(r.community.action(action), sam.id), true);
  assert.deepEqual(r.moderation.appeal(sam.id, action, 'it was a joke'), { ok: true });
  assert.ok(r.moderation.answerAppeal(OWNER, action, 'overturned', '').ok);
  assert.equal(lines((await r.call('GET', `/messages/with?handle=${friendHandle(sam.id, ann.id)}`, sam.token)).json).at(-1)!.body, 'something awful');
  assert.equal(r.moderation.canAppeal(r.community.action(action), sam.id), false);
  assert.deepEqual(
    r.audit.map((a) => a.action),
    ['report-message', 'message-clear', 'report-message', 'message-delete', 'appeal', 'appeal-overturned'],
  );
  await r.close();
});

test('a block ends the conversation for both, and a friend removed leaves it readable with no way to write', async () => {
  const r = await rig();
  const sam = r.person('a', 'Sam');
  const ann = r.person('b', 'Ann');
  r.befriend(sam, ann);
  await send(r, sam, ann, 'hello');
  r.community.removeFriend(sam.id, ann.id);
  const after = await r.call('GET', `/messages/with?handle=${friendHandle(sam.id, ann.id)}`, sam.token);
  assert.equal(after.status, 200);
  assert.equal(after.json.friends, false);
  assert.equal((await send(r, sam, ann, 'one more')).status, 403);
  r.befriend(sam, ann);
  r.community.block(ann.id, sam.id);
  assert.equal((await r.call('GET', `/messages/with?handle=${friendHandle(sam.id, ann.id)}`, sam.token)).status, 404);
  assert.equal((await r.call('GET', `/messages/with?handle=${friendHandle(ann.id, sam.id)}`, ann.token)).status, 404);
  assert.deepEqual((await r.call('GET', '/messages', sam.token)).json.conversations, []);
  assert.deepEqual((await r.call('GET', '/messages', ann.token)).json.conversations, []);
  assert.equal((await send(r, sam, ann, 'still there?')).status, 403);
  const inbox = (await r.call('GET', '/me/inbox', ann.token)).json.items as unknown as { kind: string }[];
  assert.ok(!inbox.some((i) => i.kind === 'message'), 'his line goes from her inbox too');
  await r.close();
});

test('ninety days and the words go, with any report on them; a page walks back from the newest', async () => {
  const r = await rig();
  const sam = r.person('a', 'Sam');
  const ann = r.person('b', 'Ann');
  const old = r.community.addMessage(sam.id, ann.id, 'an old one');
  r.moderation.reportMessage(ann.id, old.id, 'spam');
  await r.moderation.idle();
  r.tick(MESSAGE_DAYS * DAY - 1000);
  const recent = r.community.addMessage(sam.id, ann.id, 'a newer one');
  assert.equal(r.community.purgeExpiredMessages(), 0);
  r.tick(1000);
  assert.equal(r.community.purgeExpiredMessages(), 1);
  assert.equal(r.community.message(old.id), null);
  assert.deepEqual(r.community.reportedMessages(), [], 'a report goes with its message');
  assert.notEqual(r.community.message(recent.id), null);
  for (let i = 0; i < MESSAGE_PAGE + 5; i++) r.community.addMessage(ann.id, sam.id, `line ${i}`);
  const first = r.community.conversation(sam.id, ann.id);
  assert.equal(first.messages.length, MESSAGE_PAGE);
  assert.equal(first.messages.at(-1)!.body, `line ${MESSAGE_PAGE + 4}`, 'the newest, last');
  const second = r.community.conversation(sam.id, ann.id, first.next!);
  assert.equal(second.messages.length, 6);
  assert.equal(second.messages[0].body, 'a newer one');
  assert.equal(second.next, null);
  await r.close();
});

test('DELETE /me takes both sides of a conversation, and the export shows a player theirs', async () => {
  const r = await rig();
  const sam = r.person('a', 'Sam');
  const ann = r.person('b', 'Ann');
  r.befriend(sam, ann);
  await send(r, sam, ann, 'mine');
  await send(r, ann, sam, 'hers');
  const exported = (await r.call('GET', '/me/export', sam.token)).json.community as unknown as { messages: { body: string }[] };
  assert.deepEqual(exported.messages.map((m) => m.body).sort(), ['hers', 'mine']);
  assert.equal((await r.call('DELETE', '/me', sam.token)).status, 200);
  assert.deepEqual(r.community.conversations(ann.id), []);
  await r.close();
});
