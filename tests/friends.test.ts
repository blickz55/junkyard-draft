// Production roadmap 0.11.8: friends and the feed. A request, accepted or declined; both asking at once; removing; a block hides both
// ways and is never announced; the handle means something only to its viewer, so no player id leaves the server; the feed reads
// friends and crew, keeps the reveal gate, drops what came down, and stays bounded however much there is.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { ACTIVITY_PER_PLAYER, CommunityStore, FEED_MEMBERS, FEED_PAGE, MAX_FRIENDS } from '../server/community';
import { Pipeline, type Classifier } from '../server/moderation';
import { createServer, friendHandle, FRIEND_RATE_LIMIT, playerIdFromToken, Verifier } from '../server/verify';
import { apply, newRun } from '../game/src/sim/run';
import { encodeReplay, exportReplay } from '../game/src/sim/replay';
import { RULES } from '../game/src/sim/rules';

const T0 = Date.parse('2030-03-12T10:00:00Z');
const DAY = 86_400_000;
const OPEN_DAY = '2030-03-12';
const CLOSED_DAY = '2030-03-09';

function store() {
  let now = T0;
  const s = new CommunityStore(path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'jd-friends-')), 'community.db'), { now: () => now });
  return { s, tick: (ms: number) => (now += ms) };
}

test('a request and its answer: accepted makes two friends and tells the one who asked, declined says nothing to them', () => {
  const { s } = store();
  assert.equal(s.requestFriend('sam', 'ann'), 'sent');
  assert.equal(s.requestFriend('sam', 'ann'), 'sent', 'asking twice is asking once');
  assert.equal(s.inbox('ann').items.length, 1);
  assert.equal(s.relation('sam', 'ann'), 'requested');
  assert.equal(s.relation('ann', 'sam'), null);
  assert.equal(s.friendRows('ann')[0].incoming, true);
  assert.equal(s.answerFriend('cal', 'sam', true), false, 'there is no such request');
  assert.equal(s.answerFriend('ann', 'sam', true), true);
  assert.deepEqual(s.friendsOf('sam'), ['ann']);
  assert.deepEqual(s.friendsOf('ann'), ['sam']);
  assert.equal(s.inbox('sam').items[0].kind, 'friend-accepted');
  assert.equal(s.requestFriend('sam', 'ann'), 'friends');
  assert.equal(s.requestFriend('sam', 'cal'), 'sent');
  assert.equal(s.answerFriend('cal', 'sam', false), true);
  assert.equal(s.relation('sam', 'cal'), null, 'gone, and sam may ask again');
  assert.equal(s.inbox('sam').items.filter((i) => i.kind === 'friend-accepted').length, 1, 'no line for a decline');
});

test('both asking at once is a friendship, and removing it ends it for both', () => {
  const { s } = store();
  s.requestFriend('sam', 'ann');
  assert.equal(s.requestFriend('ann', 'sam'), 'friends');
  assert.deepEqual(s.friendsOf('sam'), ['ann']);
  s.removeFriend('ann', 'sam');
  assert.deepEqual(s.friendsOf('sam'), []);
  assert.deepEqual(s.friendsOf('ann'), []);
});

test('a block ends what was there, stays quiet, and only the one who blocked can lift it', () => {
  const { s } = store();
  s.requestFriend('sam', 'ann');
  s.answerFriend('ann', 'sam', true);
  s.block('ann', 'sam');
  assert.deepEqual(s.friendsOf('sam'), []);
  assert.deepEqual([...s.blockedWith('ann')], ['sam']);
  assert.deepEqual([...s.blockedWith('sam')], ['ann'], 'both ways');
  const lines = s.inbox('ann').items.length;
  assert.equal(s.requestFriend('sam', 'ann'), 'ignored');
  assert.equal(s.inbox('ann').items.length, lines, 'she hears nothing');
  assert.equal(s.requestFriend('ann', 'sam'), 'ignored', 'nor can the one who blocked ask without lifting it');
  s.unblock('sam', 'ann');
  assert.equal(s.relation('ann', 'sam'), 'blocked', 'sam cannot lift it');
  s.unblock('ann', 'sam');
  assert.equal(s.requestFriend('sam', 'ann'), 'sent');
});

test('there is a cap on friends and requests', () => {
  const { s } = store();
  for (let i = 0; i < MAX_FRIENDS; i++) assert.equal(s.requestFriend('sam', `p${i}`), 'sent');
  assert.equal(s.requestFriend('sam', 'one-too-many'), 'full');
  s.answerFriend('p0', 'sam', false);
  assert.equal(s.requestFriend('sam', 'one-too-many'), 'sent');
});

test('the feed: newest first, the same game once, a few dozen per player, and bounded by the players it reads', () => {
  const { s } = store();
  s.addActivity('sam', 'run', { seed: 'y', hash: 'h1', score: 1 });
  s.addActivity('ann', 'run', { seed: 'y', hash: 'h2', score: 2 });
  s.dropRunActivity('sam', 'y');
  s.addActivity('sam', 'run', { seed: 'y', hash: 'h3', score: 3 });
  assert.deepEqual(
    s.feed(['sam', 'ann']).map((a) => a.payload.hash),
    ['h3', 'h2'],
  );
  for (let i = 0; i < ACTIVITY_PER_PLAYER + 20; i++) s.addActivity('sam', 'run', { seed: `y${i}`, hash: `n${i}`, score: i });
  assert.equal(
    (s as unknown as { db: { prepare(q: string): { get(): { n: number } } } }).db.prepare("SELECT COUNT(*) AS n FROM activity WHERE player_id = 'sam'").get().n,
    ACTIVITY_PER_PLAYER,
  );
  assert.equal(s.feed(['sam']).length, FEED_PAGE);
  const many = Array.from({ length: FEED_MEMBERS + 100 }, (_, i) => `m${i}`);
  for (const id of many) s.addActivity(id, 'run', { seed: 'z', hash: id, score: 1 });
  const t0 = performance.now();
  const page = s.feed(many);
  assert.ok(performance.now() - t0 < 100, 'bounded');
  assert.equal(page.length, FEED_PAGE);
  assert.ok(
    page.every((a) => Number(a.playerId.slice(1)) < FEED_MEMBERS),
    'only the first players are read',
  );
});

async function rig() {
  let now = T0;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jd-friends-http-'));
  const verifier = new Verifier(path.join(dir, 'board.json'), { dailySecret: 'fixture-secret', auditFile: null });
  const community = new CommunityStore(path.join(dir, 'community.db'), { now: () => now });
  const classify: Classifier = async (body) => (body.includes('awful') ? { category: 'hate', score: 95 } : { category: 'ok', score: 1 });
  const moderation = new Pipeline({ store: community, classify, audit: () => {}, now: () => now, sweepMs: 0, logError: () => {} });
  const srv = createServer(verifier, { log: null, community, moderation, moderationToken: 'tok', now: () => now, postRateLimit: 1000 });
  await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${(srv.address() as AddressInfo).port}`;
  const call = async (method: string, p: string, bearer?: string, body?: unknown) => {
    const res = await fetch(`${base}${p}`, {
      method,
      headers: { 'Content-Type': 'application/json', ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: res.status, json: (await res.json()) as Record<string, never> };
  };
  const person = (letter: string, name: string, linked = true) => {
    const token = letter.repeat(32);
    const id = playerIdFromToken(token)!;
    if (linked) community.bindEmail(id, `hash-${letter}`);
    verifier.claim(id, name, new Date(now));
    return { token, id };
  };
  const play = async (token: string, seed: string, pick = 0) => {
    const s = newRun(seed);
    for (let r = 1; r <= RULES.rounds; r++) {
      apply(s, { t: 'pick', i: (pick >> (r - 1)) & 1 }); // each `pick` is a different game: identical games are one run
      apply(s, { t: 'run' });
      apply(s, { t: 'next' });
    }
    const out = await call('POST', '/verify', token, { replay: JSON.parse(encodeReplay(exportReplay(s, 'test'))) });
    assert.equal(out.status, 200, JSON.stringify(out.json));
    return (out.json as unknown as { entry: { replayHash: string; score: number } }).entry;
  };
  const today = verifier.periodRecord(OPEN_DAY, new Date(now))!.seed;
  return {
    call,
    verifier,
    community,
    moderation,
    person,
    play,
    today,
    tick: (ms: number) => (now += ms),
    close: async () => {
      moderation.close();
      await new Promise((r) => srv.close(r));
      community.close();
    },
  };
}
type Row = { handle: string; player: string; since: number };
const rowsOf = (j: Record<string, unknown>, k: string) => j[k] as Row[];
const friend = (r: Awaited<ReturnType<typeof rig>>, token: string) => r.call('GET', '/friends', token).then((o) => o.json);

test('a player is reached through a run or a post, and no player id ever leaves the server', async () => {
  const r = await rig();
  const sam = r.person('a', 'Sam');
  const ann = r.person('b', 'Ann');
  const entry = await r.play(ann.token, r.today);
  assert.equal((await r.call('GET', `/entry?hash=${entry.replayHash}`, sam.token)).json.friendable, true);
  assert.equal((await r.call('GET', `/entry?hash=${entry.replayHash}`, ann.token)).json.friendable, false, 'not yourself');
  assert.equal((await r.call('POST', '/friends/request', undefined, { hash: entry.replayHash })).status, 401);
  assert.equal((await r.call('POST', '/friends/request', sam.token, { hash: 'f'.repeat(64) })).status, 404);
  assert.equal((await r.call('POST', '/friends/request', ann.token, { hash: entry.replayHash })).status, 404, 'not yourself');
  assert.deepEqual((await r.call('POST', '/friends/request', sam.token, { hash: entry.replayHash })).json, { ok: true, result: 'sent' });
  assert.equal((await r.call('GET', `/entry?hash=${entry.replayHash}`, sam.token)).json.friendable, false, 'already asked');
  const inbox = await r.call('GET', '/me/inbox', ann.token);
  const raw = JSON.stringify(inbox.json);
  assert.ok(!raw.includes(sam.id), 'the inbox line holds no id');
  const line = (inbox.json.items as unknown as { kind: string; payload: { handle: string; player: string; pending: boolean } }[])[0];
  assert.equal(line.kind, 'friend-request');
  assert.equal(line.payload.player, `Sam#${r.verifier.player(sam.id)!.tag}`);
  assert.equal(line.payload.pending, true);
  assert.equal(line.payload.handle, friendHandle(ann.id, sam.id));
  assert.notEqual(friendHandle(ann.id, sam.id), friendHandle(sam.id, ann.id), 'a handle means something only to its viewer');
  assert.equal((await r.call('POST', '/friends/answer', ann.token, { handle: 'nonsense', accept: true })).status, 404);
  assert.equal((await r.call('POST', '/friends/answer', ann.token, { handle: line.payload.handle, accept: true })).status, 200);
  const list = await friend(r, ann.token);
  assert.deepEqual(
    rowsOf(list, 'friends').map((f) => f.player),
    [`Sam#${r.verifier.player(sam.id)!.tag}`],
  );
  assert.ok(!JSON.stringify(list).includes(sam.id));
  const after = await r.call('GET', '/me/inbox', ann.token);
  assert.equal(
    (after.json.items as unknown as { payload: { pending: boolean } }[]).at(-1)!.payload.pending,
    false,
    'a button that would do nothing is not offered',
  );
  await r.close();
});

test('asking needs an email on both sides and a name, and a block is never announced', async () => {
  const r = await rig();
  const sam = r.person('a', 'Sam');
  const ann = r.person('b', 'Ann');
  const lou = r.person('c', 'Lou', false);
  const annRun = await r.play(ann.token, r.today);
  const louRun = await r.play(lou.token, r.today, 1);
  const refused = await r.call('POST', '/friends/request', lou.token, { hash: annRun.replayHash });
  assert.equal(refused.status, 403);
  assert.equal(refused.json.code, 'not-linked');
  const unlinked = await r.call('POST', '/friends/request', sam.token, { hash: louRun.replayHash });
  assert.equal(unlinked.status, 422);
  assert.equal(unlinked.json.code, 'not-signed-in');
  assert.equal((await r.call('GET', `/entry?hash=${louRun.replayHash}`, sam.token)).json.friendable, false);
  assert.equal((await r.call('POST', '/friends/block', ann.token, { hash: (await r.play(sam.token, r.today, 2)).replayHash })).status, 200);
  const out = await r.call('POST', '/friends/request', sam.token, { hash: annRun.replayHash });
  assert.deepEqual(out.json, { ok: true, result: 'sent' }, 'it reads like any other request');
  assert.equal(rowsOf(await friend(r, ann.token), 'incoming').length, 0, 'and she never sees it');
  await r.close();
});

test('a block hides both ways: the thread, the feed and the histogram', async () => {
  const r = await rig();
  const sam = r.person('a', 'Sam');
  const ann = r.person('b', 'Ann');
  const cal = r.person('c', 'Cal');
  await r.play(sam.token, r.today);
  await r.play(ann.token, r.today, 1);
  await r.play(cal.token, r.today, 2);
  r.community.requestFriend(sam.id, ann.id);
  r.community.answerFriend(ann.id, sam.id, true);
  await r.call('POST', '/posts', sam.token, { key: CLOSED_DAY, body: 'from sam' });
  await r.call('POST', '/posts', ann.token, { key: CLOSED_DAY, body: 'from ann' });
  await r.moderation.idle();
  const thread = async (who: { token: string }) =>
    ((await r.call('GET', `/thread?key=${CLOSED_DAY}`, who.token)).json.posts as unknown as { body: string }[]).map((p) => p.body);
  const feed = async (who: { token: string }) =>
    ((await r.call('GET', '/feed', who.token)).json.items as unknown as { player: string }[]).map((i) => i.player.split('#')[0]);
  const hist = async (who: { token: string }) =>
    ((await r.call('GET', `/histogram?seed=${r.today}`, who.token)).json.friends as unknown as { player: string; score: number }[]).map(
      (f) => f.player.split('#')[0],
    );
  assert.deepEqual(await thread(sam), ['from sam', 'from ann']);
  assert.deepEqual(await feed(sam), ['Ann', 'Ann']);
  assert.deepEqual(await hist(sam), ['Ann']);
  r.community.block(ann.id, sam.id);
  assert.deepEqual(await thread(sam), ['from sam'], 'the one blocked no longer sees her');
  assert.deepEqual(await thread(ann), ['from ann'], 'nor she him');
  assert.deepEqual(await thread(cal), ['from sam', 'from ann'], 'everyone else sees both');
  assert.deepEqual(await feed(sam), []);
  assert.deepEqual(await hist(sam), []);
  await r.close();
});

test('the feed reads friends and crew, leaves out yourself, keeps the reveal gate, and drops what came down', async () => {
  const r = await rig();
  const sam = r.person('a', 'Sam');
  const ann = r.person('b', 'Ann');
  const cal = r.person('c', 'Cal');
  const lou = r.person('d', 'Lou');
  r.community.requestFriend(sam.id, ann.id);
  r.community.answerFriend(ann.id, sam.id, true);
  const crew = (await r.call('POST', '/groups', sam.token, { name: 'Night shift' })).json.group as unknown as { code: string };
  assert.equal((await r.call('POST', '/groups/join', cal.token, { code: crew.code })).status, 200);
  await r.play(sam.token, r.today);
  await r.play(ann.token, r.today, 1);
  await r.play(cal.token, r.today, 2);
  await r.play(lou.token, r.today, 3);
  const items = async () =>
    (await r.call('GET', '/feed', sam.token)).json.items as unknown as { kind: string; player: string; score?: number; excerpt?: string; hash?: string }[];
  assert.deepEqual((await items()).map((i) => i.player.split('#')[0]).sort(), ['Ann', 'Cal'], 'a friend and a crew mate, not a stranger, not me');
  assert.ok((await items()).every((i) => i.kind === 'run' && typeof i.score === 'number' && typeof i.hash === 'string'));
  assert.ok(!JSON.stringify(await items()).includes(ann.id));

  const lateDay = '2030-03-13';
  r.tick(DAY);
  const tomorrow = r.verifier.periodRecord(lateDay, new Date(T0 + DAY))!.seed;
  await r.play(ann.token, tomorrow, 1);
  await r.call('POST', '/posts', ann.token, { key: lateDay, body: 'how I built today' });
  await r.moderation.idle();
  assert.equal((await items()).filter((i) => i.kind === 'post').length, 0, 'Sam has not played that yard: her words wait behind the gate');
  await r.play(sam.token, tomorrow);
  assert.equal((await items()).find((i) => i.kind === 'post')?.excerpt, 'how I built today', 'now he has');
  const id = r.community.findThread('daily', lateDay)!;
  const post = r.community.threadPage(id.id).posts[0];
  r.community.movePost(post.id, 'hidden', 'spam', true);
  assert.equal((await items()).filter((i) => i.kind === 'post').length, 0, 'a post that came down leaves the feed');
  await r.close();
});

test('a friend request is limited like the other writes, and DELETE /me takes the friendships and the lines', async () => {
  const r = await rig();
  const sam = r.person('a', 'Sam');
  const ann = r.person('b', 'Ann');
  const run = await r.play(ann.token, r.today);
  await r.play(sam.token, r.today, 1);
  for (let i = 0; i < FRIEND_RATE_LIMIT; i++) await r.call('POST', '/friends/request', sam.token, { hash: run.replayHash });
  assert.equal((await r.call('POST', '/friends/request', sam.token, { hash: run.replayHash })).status, 429);
  r.community.answerFriend(ann.id, sam.id, true);
  assert.equal((await r.call('DELETE', '/me', sam.token)).status, 200);
  assert.deepEqual(r.community.friendsOf(ann.id), []);
  assert.deepEqual(r.community.feed([sam.id]), []);
  await r.close();
});
