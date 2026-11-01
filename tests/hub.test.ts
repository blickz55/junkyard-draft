// Production roadmap 0.11.10: the community hub. Four categories with one thread each, plain pages with no script, posting through the
// same pipeline, a game attached with its card, pin and lock for a person, and topics of a player's own that open only once fifty
// people are posting in a week, so the hub never looks dead.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { CommunityStore } from '../server/community';
import { OWNER, Pipeline, type Classifier } from '../server/moderation';
import { createServer, playerIdFromToken, Verifier } from '../server/verify';
import { categoryOf, HUB_CATEGORIES, HUB_V2_POSTERS, isHubCategory, isTopicKey, TOPIC_TITLE_MAX } from '../game/src/content/hub';
import { apply, newRun } from '../game/src/sim/run';
import { encodeReplay, exportReplay } from '../game/src/sim/replay';
import { RULES } from '../game/src/sim/rules';

const T0 = Date.parse('2030-03-12T10:00:00Z');
const DAY = 86_400_000;

test('the four categories and their keys', () => {
  assert.deepEqual([...HUB_CATEGORIES], ['strategies', 'yards', 'help', 'offshift']);
  assert.equal(categoryOf('hub:help'), 'help');
  assert.equal(categoryOf('hub:nonsense'), null);
  assert.equal(categoryOf('2030-03-12'), null);
  assert.ok(isHubCategory('yards') && !isHubCategory('yard'));
  assert.ok(isTopicKey('topic:0123456789ab') && !isTopicKey('topic:zz') && !isTopicKey('hub:help'));
});

async function rig() {
  let now = T0;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jd-hub-'));
  const verifier = new Verifier(path.join(dir, 'board.json'), { dailySecret: 'fixture-secret', auditFile: null });
  const community = new CommunityStore(path.join(dir, 'community.db'), { now: () => now });
  const reads: string[] = [];
  const classify: Classifier = async (body) => {
    reads.push(body);
    return body.includes('awful') ? { category: 'hate', score: 95 } : { category: 'ok', score: 1 };
  };
  const moderation = new Pipeline({ store: community, classify, audit: () => {}, now: () => now, sweepMs: 0, logError: () => {} });
  const srv = createServer(verifier, { log: null, community, moderation, moderationToken: 'tok', now: () => now, postRateLimit: 1000 });
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
  /** Enough other people posting this week to open topics. */
  const crowd = async () => {
    const thread = community.threadFor('hub', 'hub:offshift', null, null, 'offshift');
    for (let i = 0; i < HUB_V2_POSTERS; i++) {
      community.bindEmail(`crowd-${i}`, `crowd-hash-${i}`);
      assert.ok(moderation.write(`crowd-${i}`, thread.id, `hello from ${i}`).ok);
      await moderation.idle();
    }
  };
  return {
    base,
    call,
    verifier,
    community,
    moderation,
    person,
    crowd,
    reads,
    tick: (ms: number) => (now += ms),
    close: async () => {
      moderation.close();
      await new Promise((r) => srv.close(r));
      community.close();
    },
  };
}

test('a category takes posts through the pipeline with no gate, and the front page counts them', async () => {
  const r = await rig();
  const sam = r.person('a', 'Sam');
  const none = await r.call('GET', '/hub');
  assert.equal(none.json.open, false);
  assert.deepEqual(
    (none.json.categories as unknown as { key: string; posts: number }[]).map((c) => [c.key, c.posts]),
    HUB_CATEGORIES.map((c) => [c, 0]),
  );
  const refused = await r.call('POST', '/posts', sam.token, { key: 'hub:strategies', body: 'see example.com' });
  assert.equal(refused.status, 422);
  assert.equal(refused.json.code, 'link', 'the same filter');
  assert.equal((await r.call('POST', '/posts', sam.token, { key: 'hub:nonsense', body: 'hello' })).status, 404);
  assert.equal((await r.call('POST', '/posts', sam.token, { key: 'hub:strategies', body: 'Press before the dock' })).status, 200);
  assert.equal((await r.call('POST', '/posts', sam.token, { key: 'hub:strategies', body: 'something awful' })).status, 200);
  await r.moderation.idle();
  const hub = await r.call('GET', '/hub');
  assert.equal((hub.json.categories as unknown as { key: string; posts: number }[])[0].posts, 1, 'what came down is not counted');
  const thread = await r.call('GET', '/thread?key=hub:strategies');
  assert.equal(thread.status, 200, 'reading needs no game');
  assert.deepEqual((thread.json.foreman as unknown as { open: null }).open, null);
  assert.equal(thread.json.category, 'strategies');
  await r.close();
});

test('the pages read with no script and no key: the front, a category, a game with its card; words are escaped', async () => {
  const r = await rig();
  const sam = r.person('a', 'Sam');
  const s = newRun('classic-hub-yard');
  for (let i = 1; i <= RULES.rounds; i++) {
    apply(s, { t: 'pick', i: 0 });
    apply(s, { t: 'run' });
    apply(s, { t: 'next' });
  }
  const run = await r.call('POST', '/verify', sam.token, { replay: JSON.parse(encodeReplay(exportReplay(s, 'test'))) });
  const { entry } = run.json as unknown as { entry: { replayHash: string; score: number } };
  await r.call('POST', '/posts', sam.token, { key: 'hub:yards', body: 'My yard <b>today</b>', hash: entry.replayHash });
  await r.moderation.idle();
  const front = await fetch(`${r.base}/community/`);
  const html = await front.text();
  assert.equal(front.status, 200);
  assert.match(front.headers.get('content-security-policy')!, /default-src 'none'; style-src 'self'/);
  for (const words of ['Strategies', 'Show your yard', 'Help and bugs', 'Off-shift', '1 post']) assert.ok(html.includes(words), words);
  assert.doesNotMatch(html, /<script/);
  const page = await (await fetch(`${r.base}/community/hub/yards`)).text();
  assert.ok(page.includes('My yard &lt;b&gt;today&lt;/b&gt;'));
  assert.ok(page.includes(`Sam#${r.verifier.player(sam.id)!.tag}&#39;s $${entry.score}`), 'the game, with its card');
  assert.ok(page.includes(`?challenge=${entry.replayHash}`), 'and a way into the game');
  assert.doesNotMatch(page, /<script/);
  assert.equal((await fetch(`${r.base}/community/hub/nonsense`)).status, 404);
  assert.equal((await fetch(`${r.base}/community/topic/zzz`)).status, 404);
  await r.close();
});

test('topics stay shut until fifty people are posting in a week, then open, and the flag falls again when they stop', async () => {
  const r = await rig();
  const sam = r.person('a', 'Sam');
  const shut = await r.call('POST', '/hub/topic', sam.token, { category: 'strategies', title: 'My plan', body: 'Here it is' });
  assert.equal(shut.status, 403);
  assert.equal(shut.json.code, 'hub-closed');
  await r.crowd();
  assert.equal(r.moderation.hubOpen, true);
  assert.equal((await r.call('GET', '/hub')).json.open, true);
  assert.equal((await r.call('POST', '/hub/topic', undefined, { category: 'strategies', title: 'x', body: 'y' })).status, 401);
  assert.equal((await r.call('POST', '/hub/topic', sam.token, { category: 'nonsense', title: 'My plan', body: 'Here' })).status, 404);
  const link = await r.call('POST', '/hub/topic', sam.token, { category: 'strategies', title: 'see example.com', body: 'Here it is' });
  assert.equal(link.status, 422);
  assert.equal(link.json.code, 'link', 'the title passes the filter too');
  const long = await r.call('POST', '/hub/topic', sam.token, { category: 'strategies', title: 'x'.repeat(TOPIC_TITLE_MAX + 1), body: 'Here it is' });
  assert.equal(long.status, 422);
  const ok = await r.call('POST', '/hub/topic', sam.token, { category: 'strategies', title: 'Two presses or one', body: 'I say two' });
  assert.equal(ok.status, 200);
  await r.moderation.idle();
  assert.ok(r.reads.includes('Two presses or one\n\nI say two'), 'the classifier reads the title with the first post');
  const key = ok.json.key as unknown as string;
  const cats = (await r.call('GET', '/hub')).json.categories as unknown as { key: string; topics: { key: string; title: string; posts: number }[] }[];
  assert.deepEqual(
    cats[0].topics.map((t) => [t.key, t.title, t.posts]),
    [[key, 'Two presses or one', 1]],
  );
  const read = await r.call('GET', `/thread?key=${key}`);
  assert.equal(read.json.title, 'Two presses or one');
  assert.ok((await (await fetch(`${r.base}/community/hub/strategies`)).text()).includes('Two presses or one'));
  assert.ok((await (await fetch(`${r.base}/community/topic/${key.slice('topic:'.length)}`)).text()).includes('I say two'));

  const bad = await r.call('POST', '/hub/topic', sam.token, { category: 'help', title: 'A title', body: 'something awful' });
  await r.moderation.idle();
  const after = (await r.call('GET', '/hub')).json.categories as unknown as { key: string; topics: unknown[] }[];
  assert.equal(after[2].topics.length, 0, 'a topic whose first post came down does not show');
  assert.equal(bad.status, 200);
  assert.equal((await fetch(`${r.base}/community/topic/${(bad.json.key as unknown as string).slice('topic:'.length)}`)).status, 404);

  r.tick(8 * DAY);
  assert.equal(r.moderation.hubOpen, false, 'it is a measure of this week');
  await r.close();
});

test('a person pins and locks: a locked thread takes no more posts and says so; pinned topics come first; the audit keeps it', async () => {
  const r = await rig();
  const sam = r.person('a', 'Sam');
  await r.crowd();
  const a = await r.call('POST', '/hub/topic', sam.token, { category: 'help', title: 'First topic', body: 'One' });
  r.tick(1000);
  await r.moderation.idle();
  await r.call('POST', '/hub/topic', sam.token, { category: 'help', title: 'Second topic', body: 'Two' });
  await r.moderation.idle();
  const titles = async () =>
    ((await r.call('GET', '/hub')).json.categories as unknown as { topics: { title: string; pinned: boolean; locked: boolean }[] }[])[2].topics.map(
      (t) => t.title,
    );
  assert.deepEqual(await titles(), ['Second topic', 'First topic'], 'latest first');
  const thread = r.community.findThread('hub', a.json.key as unknown as string)!;
  assert.equal((await r.call('POST', '/moderation/thread', undefined, { id: thread.id, pinned: true })).status, 401);
  assert.equal((await r.call('POST', '/moderation/thread', undefined, { id: 99999, pinned: true }, 'tok')).status, 404);
  assert.equal((await r.call('POST', '/moderation/thread', undefined, { id: thread.id, pinned: true }, 'tok')).status, 200);
  assert.deepEqual(await titles(), ['First topic', 'Second topic'], 'pinned first');
  assert.ok(r.moderation.flagThread(OWNER, thread.id, { locked: true }).ok);
  assert.equal((await r.call('GET', `/thread?key=${thread.key}`)).json.locked, true);
  const shut = await r.call('POST', '/posts', sam.token, { key: thread.key, body: 'one more' });
  assert.equal(shut.status, 403);
  assert.equal(shut.json.code, 'locked');
  r.moderation.flagThread(OWNER, thread.id, { locked: false });
  assert.equal((await r.call('POST', '/posts', sam.token, { key: thread.key, body: 'one more' })).status, 200);
  await r.moderation.idle();
  await r.close();
});

test('the days with a talk are listed, and an open day stays behind its gate on the front page too', async () => {
  const r = await rig();
  const sam = r.person('a', 'Sam');
  await r.call('POST', '/posts', sam.token, { key: '2030-03-09', body: 'that was a day' });
  await r.moderation.idle();
  const hub = await r.call('GET', '/hub');
  assert.deepEqual(hub.json.days, [{ key: '2030-03-09', kind: 'daily', posts: 1 }]);
  assert.ok((await (await fetch(`${r.base}/community/`)).text()).includes('/community/day/2030-03-09'));
  await r.close();
});
