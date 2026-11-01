// Production roadmap 0.11.5: the daily thread. The reveal gate holds for words as it does for recordings, Sal's posts are the same
// for a fixed board, a post can be changed for five minutes and goes back through the classifier, a player can take their own back,
// a run can be attached, the others in a thread hear there is more, and a closed day reads as a plain page with no script.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { CommunityStore } from '../server/community';
import { EDIT_WINDOW_MS, OWNER, Pipeline, type Classifier } from '../server/moderation';
import { createServer, playerIdFromToken, Verifier } from '../server/verify';
import { closingPost, openingPost, SAL_STRINGS, type DayFacts } from '../game/src/content/sal-posts';
import { dayPage } from '../server/community-page';
import { apply, newRun } from '../game/src/sim/run';
import { encodeReplay, exportReplay } from '../game/src/sim/replay';
import { RULES } from '../game/src/sim/rules';

const T0 = Date.parse('2030-03-12T10:00:00Z');
const DAY = 86_400_000;
const CLOSED_DAY = '2030-03-09';
const OPEN_DAY = '2030-03-12';

test('Sal opens a day the same for everyone and says nothing about anyone', () => {
  assert.equal(openingPost('2030-03-12'), openingPost('2030-03-12'));
  const days = new Set(Array.from({ length: 30 }, (_, i) => openingPost(`2030-04-${String(i + 1).padStart(2, '0')}`)));
  assert.equal(days.size, 3, 'the days differ');
  for (const line of days) assert.doesNotMatch(line, /\$\d/, 'no score in it');
});

test('Sal closes a day from the board: a fixed board always reads the same, and each size of board reads right', () => {
  const facts: DayFacts = {
    runs: 41,
    median: 1200,
    top: [
      { player: 'Ann#AB12', score: 3100 },
      { player: 'Bob#CD34', score: 2900 },
      { player: 'Cal#EF56', score: 2750 },
    ],
    reacted: { player: 'Bob#CD34', score: 2900 },
  };
  const key = '2030-03-09';
  const line = closingPost(key, facts);
  assert.equal(line, closingPost(key, structuredClone(facts)));
  assert.match(
    line,
    /41 games on it, the middle of the pack at \$1200\. Ann#AB12 took it with \$3100, ahead of Bob#CD34 and Cal#EF56\. The one you all reacted to: Bob#CD34 on \$2900\.$/,
  );
  const one = closingPost(key, { runs: 1, median: 900, top: [{ player: 'Ann#AB12', score: 900 }], reacted: null });
  assert.match(one, /1 game on it, the middle of the pack at \$900\. Ann#AB12 took it with \$900\.$/);
  const two = closingPost(key, { runs: 2, median: 800, top: facts.top.slice(0, 2), reacted: null });
  assert.match(two, /Ann#AB12 took it with \$3100, ahead of Bob#CD34\.$/);
  assert.equal(closingPost(key, { runs: 0, median: null, top: [], reacted: null }), 'Nobody put a game on this one. Quiet yard.');
  const leads = new Set(Array.from({ length: 30 }, (_, i) => closingPost(`2030-04-${String(i + 1).padStart(2, '0')}`, facts).split(' 41 games')[0]));
  assert.equal(leads.size, 3);
});

test('a page of a thread: words are escaped, an open day shows none, and nothing on it can run', () => {
  const html = dayPage({
    key: '2030-03-09',
    weekly: false,
    opening: 'open words',
    closing: 'close words',
    posts: [{ author: '<b>Ann</b>', body: '<script>alert(1)</script> & "quotes"', createdAt: T0, edited: true }],
  });
  assert.doesNotMatch(html, /<script|<b>Ann/);
  assert.ok(html.includes('&lt;script&gt;alert(1)&lt;/script&gt; &amp; &quot;quotes&quot;'));
  assert.ok(html.includes('edited'));
  assert.ok(html.includes('The talk on the yard of 2030-03-09'));
  const open = dayPage({ key: '2030-W11', weekly: true, opening: 'open words', closing: null, posts: null });
  assert.ok(open.includes('still open'));
  assert.ok(!open.includes('open words'), 'nothing of the thread');
  assert.ok(open.includes('The talk on the week 2030-W11'));
  assert.ok(Object.keys(SAL_STRINGS).every((k) => /^sal\.[A-Za-z0-9.]+$/.test(k)));
});

async function rig() {
  let now = T0;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jd-thread-'));
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
  const call = async (method: string, p: string, bearer?: string, body?: unknown) => {
    const res = await fetch(`${base}${p}`, {
      method,
      headers: { 'Content-Type': 'application/json', ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}) },
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
  const play = async (token: string, seed: string, pick = 0) => {
    const s = newRun(seed);
    for (let r = 1; r <= RULES.rounds; r++) {
      apply(s, { t: 'pick', i: pick });
      apply(s, { t: 'run' });
      apply(s, { t: 'next' });
    }
    const out = await call('POST', '/verify', token, { replay: JSON.parse(encodeReplay(exportReplay(s, 'test'))) });
    assert.equal(out.status, 200, JSON.stringify(out.json));
    return out.json as unknown as { entry: { replayHash: string; score: number } };
  };
  return {
    base,
    call,
    verifier,
    community,
    moderation,
    reads,
    person,
    play,
    tick: (ms: number) => (now += ms),
    now: () => new Date(now),
    close: async () => {
      moderation.close();
      await new Promise((r) => srv.close(r));
      community.close();
    },
  };
}
type View = {
  id: number;
  author: string;
  body: string;
  own: boolean;
  state?: string;
  waiting?: boolean;
  reason?: string | null;
  editable?: boolean;
  hash: string | null;
  edited: boolean;
};
const postsOf = (j: Record<string, unknown>) => j.posts as View[];

test('the gate holds for words: an open day is closed to whoever has not played it, and to nobody after it closes', async () => {
  const r = await rig();
  const sam = r.person('a', 'Sam');
  const ann = r.person('b', 'Ann');
  const seed = r.verifier.periodRecord(OPEN_DAY, r.now())!.seed;
  const out = await r.call('GET', `/thread?key=${OPEN_DAY}`, ann.token);
  assert.equal(out.status, 403);
  assert.equal(out.json.code, 'reveal-gate');
  assert.equal((await r.call('GET', `/thread?key=${OPEN_DAY}`)).status, 403, 'nor without a key');
  assert.equal((await r.call('POST', '/posts', ann.token, { key: OPEN_DAY, body: 'hello' })).status, 403, 'nor can they write on it');
  await r.play(sam.token, seed);
  const inside = await r.call('GET', `/thread?key=${OPEN_DAY}`, sam.token);
  assert.equal(inside.status, 200, 'a checked game opens it');
  assert.equal(inside.json.closed, false);
  assert.equal(inside.json.write, 'ok');
  assert.equal((await r.call('POST', '/posts', sam.token, { key: OPEN_DAY, body: 'I built a thing' })).status, 200);
  await r.moderation.idle();
  r.tick(3 * DAY);
  const after = await r.call('GET', `/thread?key=${OPEN_DAY}`);
  assert.equal(after.status, 200, 'after the close anyone reads it, with no key at all');
  assert.equal(after.json.closed, true);
  assert.equal(after.json.write, 'not-linked');
  assert.deepEqual(
    postsOf(after.json).map((p) => p.body),
    ['I built a thing'],
  );
  assert.match((after.json.foreman as unknown as { close: string }).close, /1 game on it/);
  await r.close();
});

test('no id leaves the server: a post shows a name, and only its author learns what state it is in', async () => {
  const r = await rig();
  const sam = r.person('a', 'Sam');
  const ann = r.person('b', 'Ann');
  await r.call('POST', '/posts', sam.token, { key: CLOSED_DAY, body: 'hello there' });
  await r.moderation.idle();
  const raw = JSON.stringify((await r.call('GET', `/thread?key=${CLOSED_DAY}`, ann.token)).json);
  assert.ok(!raw.includes(sam.id) && !raw.includes(ann.id));
  const other = postsOf((await r.call('GET', `/thread?key=${CLOSED_DAY}`, ann.token)).json)[0];
  assert.equal(other.author, `Sam#${r.verifier.player(sam.id)!.tag}`);
  assert.equal(other.own, false);
  assert.ok(!('state' in other) && !('reason' in other) && !('editable' in other));
  const mine = postsOf((await r.call('GET', `/thread?key=${CLOSED_DAY}`, sam.token)).json)[0];
  assert.equal(mine.own, true);
  assert.equal(mine.state, 'published');
  assert.equal(mine.editable, true);
  await r.close();
});

test('the author sees a post down with its reason; others do not see it; a run can be attached if it is of this yard', async () => {
  const r = await rig();
  const sam = r.person('a', 'Sam');
  const ann = r.person('b', 'Ann');
  const seed = r.verifier.periodRecord(OPEN_DAY, r.now())!.seed;
  const { entry } = await r.play(sam.token, seed);
  const bad = await r.call('POST', '/posts', sam.token, { key: OPEN_DAY, body: 'with a run', hash: 'f'.repeat(64) });
  assert.equal(bad.status, 422);
  assert.equal(bad.json.code, 'bad-run');
  const ok = await r.call('POST', '/posts', sam.token, { key: OPEN_DAY, body: 'with a run', hash: entry.replayHash });
  assert.equal(ok.status, 200);
  await r.call('POST', '/posts', sam.token, { key: OPEN_DAY, body: 'something awful' });
  await r.moderation.idle();
  r.tick(3 * DAY);
  const mine = postsOf((await r.call('GET', `/thread?key=${OPEN_DAY}`, sam.token)).json);
  assert.deepEqual(
    mine.map((p) => [p.body, p.state, p.reason, p.hash]),
    [
      ['with a run', 'published', null, entry.replayHash],
      ['something awful', 'hidden', 'hate', null],
    ],
  );
  const theirs = postsOf((await r.call('GET', `/thread?key=${OPEN_DAY}`, ann.token)).json);
  assert.deepEqual(
    theirs.map((p) => p.body),
    ['with a run'],
  );
  await r.close();
});

test('new words wait down until the classifier has read them, so clean words cannot be swapped for bad ones in front of anyone', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jd-thread-wait-'));
  const store = new CommunityStore(path.join(dir, 'community.db'), { now: () => T0 });
  let release = () => {};
  const moderation = new Pipeline({
    store,
    classify: () =>
      new Promise((res) => {
        release = () => res({ category: 'ok', score: 1 });
      }),
    audit: () => {},
    now: () => T0,
    sweepMs: 0,
  });
  store.bindEmail('sam', 'h');
  const thread = store.threadFor('daily', CLOSED_DAY);
  const first = moderation.write('sam', thread.id, 'first words');
  assert.ok(first.ok);
  release();
  await moderation.idle();
  assert.equal(store.threadFor('daily', CLOSED_DAY).postCount, 1);
  const edited = moderation.edit('sam', first.post.id, 'second words');
  assert.ok(edited.ok);
  assert.equal(edited.post.state, 'hidden');
  assert.equal(store.threadFor('daily', CLOSED_DAY).postCount, 0, 'not up meanwhile');
  assert.deepEqual(store.threadPage(thread.id).posts, []);
  assert.equal(store.threadPage(thread.id, { viewer: 'sam' }).posts[0].body, 'second words', 'its author reads it');
  release();
  await moderation.idle();
  assert.equal(store.threadFor('daily', CLOSED_DAY).postCount, 1);
  moderation.close();
  store.close();
});

test('five minutes to change a post: the words go back through the classifier and it waits again; after that, or once it is down, no', async () => {
  const r = await rig();
  const sam = r.person('a', 'Sam');
  const ann = r.person('b', 'Ann');
  const posted = await r.call('POST', '/posts', sam.token, { key: CLOSED_DAY, body: 'first words' });
  const id = (posted.json.post as unknown as View).id;
  assert.equal((posted.json.post as unknown as View).waiting, true);
  await r.moderation.idle();
  assert.equal((await r.call('POST', '/posts/edit', ann.token, { id, body: 'not mine' })).status, 404);
  const ok = await r.call('POST', '/posts/edit', sam.token, { id, body: 'second words' });
  assert.equal(ok.status, 200);
  assert.equal((ok.json.post as unknown as View).waiting, true, 'it waits for the classifier again');
  await r.moderation.idle();
  assert.deepEqual(r.reads, ['first words', 'second words']);
  const read = postsOf((await r.call('GET', `/thread?key=${CLOSED_DAY}`, ann.token)).json)[0];
  assert.equal(read.body, 'second words');
  assert.equal(read.edited, true);
  const toAwful = await r.call('POST', '/posts/edit', sam.token, { id, body: 'now something awful' });
  assert.equal(toAwful.status, 200);
  await r.moderation.idle();
  assert.equal(r.community.post(id)!.state, 'hidden', 'clean words cannot be swapped for bad ones past the classifier');
  const down = await r.call('POST', '/posts/edit', sam.token, { id, body: 'better words' });
  assert.equal(down.status, 409, 'a post the pipeline took down stays as it is');

  const later = await r.call('POST', '/posts', sam.token, { key: CLOSED_DAY, body: 'a later post' });
  await r.moderation.idle();
  const laterId = (later.json.post as unknown as View).id;
  r.moderation.decidePost(OWNER, laterId, 'clear', null, '');
  assert.notEqual(r.community.post(laterId)!.reviewedAt, null);
  assert.equal((await r.call('POST', '/posts/edit', sam.token, { id: laterId, body: 'changed after a person looked' })).status, 200);
  assert.equal(r.community.post(laterId)!.reviewedAt, null, 'what a person said was about the old words');
  await r.moderation.idle();
  r.tick(EDIT_WINDOW_MS);
  const late = await r.call('POST', '/posts/edit', sam.token, { id: laterId, body: 'too late' });
  assert.equal(late.status, 409);
  assert.equal(late.json.code, 'too-late');
  assert.equal(postsOf((await r.call('GET', `/thread?key=${CLOSED_DAY}`, sam.token)).json).at(-1)!.editable, false);
  await r.close();
});

test('a player takes their own post back: the words go at once and open reports close; a post under review stays', async () => {
  const r = await rig();
  const sam = r.person('a', 'Sam');
  const ann = r.person('b', 'Ann');
  const posted = await r.call('POST', '/posts', sam.token, { key: CLOSED_DAY, body: 'my words' });
  const id = (posted.json.post as unknown as View).id;
  await r.moderation.idle();
  r.moderation.report(ann.id, id, 'spam', false);
  assert.equal(r.community.moderationQueue().length, 1);
  assert.equal((await r.call('POST', '/posts/delete', ann.token, { id })).status, 404);
  assert.equal((await r.call('POST', '/posts/delete', sam.token, { id })).status, 200);
  const gone = r.community.post(id)!;
  assert.equal(gone.state, 'deleted');
  assert.equal(gone.body, '');
  assert.equal(r.community.moderationQueue().length, 0);
  assert.equal(r.community.threadFor('daily', CLOSED_DAY).postCount, 0);
  assert.deepEqual(postsOf((await r.call('GET', `/thread?key=${CLOSED_DAY}`, sam.token)).json), []);
  assert.equal((await r.call('POST', '/posts/delete', sam.token, { id })).status, 404, 'once');
  const held = await r.call('POST', '/posts', sam.token, { key: CLOSED_DAY, body: 'something awful' });
  await r.moderation.idle();
  const heldId = (held.json.post as unknown as View).id;
  const refused = await r.call('POST', '/posts/delete', sam.token, { id: heldId });
  assert.equal(refused.status, 409);
  assert.equal(refused.json.code, 'under-review');
  assert.equal(r.moderation.transparency().months[0].removed, 0, 'taking your own post back is not a removal');
  await r.close();
});

test('the others in a thread hear there is more: one unread line however much arrives, never for your own words, and never for a post that came down', async () => {
  const r = await rig();
  const sam = r.person('a', 'Sam');
  const ann = r.person('b', 'Ann');
  await r.call('POST', '/posts', sam.token, { key: CLOSED_DAY, body: 'first' });
  await r.moderation.idle();
  assert.equal(r.community.inbox(sam.id).items.length, 0);
  await r.call('POST', '/posts', ann.token, { key: CLOSED_DAY, body: 'second' });
  await r.moderation.idle();
  await r.call('POST', '/posts', ann.token, { key: CLOSED_DAY, body: 'third' });
  await r.moderation.idle();
  const lines = r.community.inbox(sam.id).items;
  assert.equal(lines.length, 1, 'a batch stays a batch');
  assert.deepEqual([lines[0].kind, lines[0].payload], ['thread-reply', { kind: 'daily', key: CLOSED_DAY }]);
  r.community.markRead(sam.id);
  await r.call('POST', '/posts', ann.token, { key: CLOSED_DAY, body: 'something awful' });
  await r.moderation.idle();
  assert.equal(r.community.inbox(sam.id).unread, 0, 'nobody heard about what came down');
  const inbox = await r.call('GET', '/me/inbox', sam.token);
  assert.equal((inbox.json.items as unknown as { kind: string }[])[0].kind, 'thread-reply');
  await r.close();
});

test('a game has a talk of its own: behind the same gate, its owner hears, and the line names the game; `/entry` says how much there is', async () => {
  const r = await rig();
  const sam = r.person('a', 'Sam');
  const ann = r.person('b', 'Ann');
  const cal = r.person('c', 'Cal');
  const seed = r.verifier.periodRecord(OPEN_DAY, r.now())!.seed;
  const { entry } = await r.play(sam.token, seed);
  const hash = entry.replayHash;
  assert.equal((await r.call('GET', `/thread?key=${hash}`, ann.token)).status, 403, 'an open yard, no game of their own');
  assert.equal((await r.call('POST', '/posts', ann.token, { key: hash, body: 'nice' })).status, 403);
  assert.equal((await r.call('GET', `/thread?key=${'f'.repeat(64)}`, ann.token)).status, 404);
  await r.play(ann.token, seed, 1);
  await r.play(cal.token, seed, 2);
  const open = await r.call('GET', `/thread?key=${hash}`, ann.token);
  assert.equal(open.status, 200);
  assert.deepEqual([open.json.kind, open.json.foreman], ['run', { open: null, close: null }]);
  assert.deepEqual(open.json.run, { player: `Sam#${r.verifier.player(sam.id)!.tag}`, score: entry.score });
  assert.deepEqual((await r.call('GET', `/entry?hash=${hash}`, ann.token)).json.talk, { posts: 0 });
  assert.equal((await r.call('POST', '/posts', ann.token, { key: hash, body: 'that press is clever' })).status, 200);
  await r.moderation.idle();
  assert.deepEqual((await r.call('GET', `/entry?hash=${hash}`, ann.token)).json.talk, { posts: 1 });
  const line = ((await r.call('GET', '/me/inbox', sam.token)).json.items as unknown as { kind: string; payload: Record<string, unknown> }[])[0];
  assert.equal(line.kind, 'thread-reply');
  assert.deepEqual(
    { ...line.payload },
    { kind: 'run', key: hash, seed, score: entry.score, player: (open.json.run as unknown as { player: string }).player, own: true },
    'the owner never wrote, and still hears',
  );
  assert.equal(r.community.inbox(ann.id).items.length, 0, 'not for your own words');
  assert.equal((await r.call('POST', '/posts', cal.token, { key: hash, body: 'seconded' })).status, 200);
  await r.moderation.idle();
  const other = ((await r.call('GET', '/me/inbox', ann.token)).json.items as unknown as { payload: Record<string, unknown> }[])[0];
  assert.equal(other.payload.own, false, 'someone who wrote there hears too, and it is not their game');
  await r.close();
});

test('/daily says how much talk there is while writing is open, and only then', async () => {
  const r = await rig();
  const sam = r.person('a', 'Sam');
  await r.call('POST', '/posts', sam.token, { key: CLOSED_DAY, body: 'hello' });
  await r.moderation.idle();
  assert.deepEqual((await r.call('GET', `/daily?date=${CLOSED_DAY}&limit=1`)).json.talk, { posts: 1 });
  assert.deepEqual((await r.call('GET', `/daily?date=${OPEN_DAY}&limit=1`)).json.talk, { posts: 0 });
  await r.close();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jd-thread-off-'));
  const verifier = new Verifier(path.join(dir, 'board.json'), { dailySecret: 'fixture-secret', auditFile: null });
  const community = new CommunityStore(path.join(dir, 'community.db'));
  const moderation = new Pipeline({ store: community, classify: null, audit: () => {}, sweepMs: 0 });
  const srv = createServer(verifier, { log: null, community, moderation });
  await new Promise<void>((res) => srv.listen(0, '127.0.0.1', res));
  const base = `http://127.0.0.1:${(srv.address() as AddressInfo).port}`;
  const daily = (await (await fetch(`${base}/daily?limit=1`)).json()) as Record<string, unknown>;
  assert.ok(!('talk' in daily), 'the game shows no way in');
  assert.equal((await fetch(`${base}/thread?key=${OPEN_DAY}`)).status, 503);
  assert.equal((await fetch(`${base}/community/day/${OPEN_DAY}`)).status, 404);
  await new Promise((res) => srv.close(res));
  community.close();
});

test('the web page of a closed day: names, words and Sal, no script and a policy that allows none; an open day shows nothing of its talk', async () => {
  const r = await rig();
  const sam = r.person('a', 'Sam');
  const seed = r.verifier.periodRecord(OPEN_DAY, r.now())!.seed;
  await r.play(sam.token, seed);
  await r.call('POST', '/posts', sam.token, { key: OPEN_DAY, body: 'I built <a thing>' });
  await r.moderation.idle();
  const open = await fetch(`${r.base}/community/day/${OPEN_DAY}`);
  assert.equal(open.status, 200);
  const openHtml = await open.text();
  assert.ok(openHtml.includes('still open'));
  assert.ok(!openHtml.includes('I built'), 'the gate holds on the web too');
  r.tick(3 * DAY);
  const res = await fetch(`${r.base}/community/day/${OPEN_DAY}`);
  const html = await res.text();
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-security-policy')!, /default-src 'none'; style-src 'self'/);
  assert.ok(html.includes('I built &lt;a thing&gt;'));
  assert.ok(html.includes(`Sam#${r.verifier.player(sam.id)!.tag}`));
  assert.ok(html.includes('1 game on it'));
  assert.doesNotMatch(html, /<script/);
  assert.equal((await fetch(`${r.base}/community/day/someday`)).status, 404);
  assert.equal((await fetch(`${r.base}/community/site.css`)).status, 200);
  await r.close();
});
