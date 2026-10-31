// Production roadmap 0.11.0: the community store on node:sqlite. Migrations go up and down, atomically, once; a changed file
// or a gap stops the start; a page of a 100k-post thread comes back under 20 ms; forgetting a player reaches every column
// that can hold one (the schema is walked, so a new column cannot be left out); a live database is archived by snapshot.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { spawnSync } from 'node:child_process';
import {
  COUNTS_TTL_MS,
  CommunityStore,
  MAX_THREAD_PAGE,
  PLAYER_COLUMNS,
  hashMigrations,
  inspectDatabase,
  snapshotDatabase,
  type CommunityOptions,
} from '../server/community';
import { createServer, playerIdFromToken, REACT_RATE_LIMIT, Verifier } from '../server/verify';
import { REACTIONS, isReaction, reactionLine, reactionTotal } from '../game/src/content/reactions';
import { t, type StringKey } from '../game/src/content/strings';
import { apply, newRun } from '../game/src/sim/run';
import { encodeReplay, exportReplay } from '../game/src/sim/replay';
import { RULES } from '../game/src/sim/rules';

const TABLES = [
  'accounts',
  'email_links',
  'threads',
  'posts',
  'reactions',
  'views',
  'friends',
  'messages',
  'notifications',
  'push_subscriptions',
  'reports',
  'moderation_actions',
  'divisions',
  'trophies',
  'cosmetics',
];
/** A finished game on a seed, enough for the verifier to take it. */
function playedRun(seed: string) {
  const s = newRun(seed);
  for (let r = 1; r <= RULES.rounds; r++) {
    apply(s, { t: 'pick', i: 0 });
    apply(s, { t: 'run' });
    apply(s, { t: 'next' });
  }
  return s;
}
const tempDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'jd-community-'));
const open = (dir = tempDir(), o: CommunityOptions = {}) => new CommunityStore(path.join(dir, 'community.db'), o);
/** The store's connection, for what the store itself has no method for yet. */
const db = (s: CommunityStore) => (s as unknown as { db: import('node:sqlite').DatabaseSync }).db;
const tables = (s: CommunityStore) =>
  (
    db(s).prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name <> 'schema_migrations' ORDER BY name").all() as {
      name: string;
    }[]
  ).map((r) => r.name);

test('migrations: up makes every table of the roadmap, down takes them away again, up works a second time, and a reopen applies nothing', () => {
  const dir = tempDir();
  const s = open(dir);
  assert.equal(s.version, s.migrations.length);
  assert.deepEqual(tables(s), [...TABLES].sort());
  assert.deepEqual(s.migrate(), [], 'nothing left to apply');
  assert.deepEqual(s.rollback(0), [1]);
  assert.equal(s.version, 0);
  assert.deepEqual(tables(s), []);
  assert.deepEqual(s.migrate(), [1]);
  assert.deepEqual(tables(s), [...TABLES].sort());
  const t = s.threadFor('daily', '2030-01-10');
  s.addPost(t.id, 'p1', 'kept');
  s.close();
  const again = open(dir);
  assert.equal(again.version, 1);
  assert.equal(again.threadPage(t.id).posts[0].body, 'kept', 'a reopen keeps the data and runs nothing');
  assert.equal((db(again).prepare('SELECT COUNT(*) AS n FROM schema_migrations').get() as { n: number }).n, 1);
  again.close();
});

/** Migrations to break on purpose. */
const one = {
  version: 1,
  name: 'a',
  up: 'CREATE TABLE accounts (x); CREATE TABLE threads (x); CREATE TABLE posts (x);',
  down: 'DROP TABLE accounts; DROP TABLE threads; DROP TABLE posts;',
};
const two = { version: 2, name: 'b', up: 'CREATE TABLE extra (x);', down: 'DROP TABLE extra;' };

test('a migration is all or nothing: the failing one leaves no table and no record, the ones before it stay', () => {
  const data = tempDir();
  assert.throws(() => open(data, { migrations: [one, { ...two, up: 'CREATE TABLE half (x); CREATE TABLE half (x);' }] }), /already exists/);
  const s = open(data, { migrations: [one, { ...two, up: 'CREATE TABLE half (x);' }] });
  assert.equal(s.version, 2, 'the version with the fault ran again once it was fixed, and the first one did not');
  s.close();
});

test('the start stops on an applied migration that changed or a gap in the numbers', () => {
  const data = tempDir();
  open(data, { migrations: [one] }).close();
  assert.throws(() => open(data, { migrations: [{ ...one, up: `${one.up} -- edited` }] }), /was changed after it was applied/);
  assert.throws(() => hashMigrations([one, { ...two, version: 3 }]), /out of sequence: expected 2/);
});

test('a database newer than the code runs as it is (a rollback to the previous image) and cannot be taken down from there', () => {
  const data = tempDir();
  open(data, { migrations: [one, two] }).close();
  const older = open(data, { migrations: [one] });
  assert.equal(older.version, 2, 'nothing was reversed');
  assert.throws(() => older.rollback(1), /no down file for migration 2/);
  older.close();
});

test('threads: made on first use, one per kind and key; pages run oldest first by a cursor, hide what is not published and stop at the last post', () => {
  let now = 1000;
  const s = open(tempDir(), { now: () => now });
  const t = s.threadFor('daily', '2030-01-10', 'The tenth');
  assert.equal(s.threadFor('daily', '2030-01-10', 'ignored').id, t.id);
  assert.notEqual(s.threadFor('weekly', '2030-01-10').id, t.id);
  assert.deepEqual({ title: t.title, postCount: t.postCount, lastPostAt: t.lastPostAt }, { title: 'The tenth', postCount: 0, lastPostAt: null });
  const ids: number[] = [];
  for (let i = 0; i < 5; i++) {
    now += 10;
    ids.push(s.addPost(t.id, `p${i}`, `body ${i}`, i === 0 ? 'hash' : null).id);
  }
  assert.deepEqual({ ...s.threadFor('daily', '2030-01-10') }, { ...t, postCount: 5, lastPostAt: now });
  db(s).prepare("UPDATE posts SET state = 'hidden' WHERE id = ?").run(ids[2]);
  const first = s.threadPage(t.id, { limit: 2 });
  assert.deepEqual(
    first.posts.map((p) => p.body),
    ['body 0', 'body 1'],
  );
  assert.equal(first.posts[0].replayHash, 'hash');
  assert.equal(first.next, ids[1]);
  const last = s.threadPage(t.id, { after: first.next!, limit: 2 });
  assert.deepEqual(
    last.posts.map((p) => p.body),
    ['body 3', 'body 4'],
    'the hidden post is skipped',
  );
  assert.equal(last.next, null);
  assert.deepEqual(s.threadPage(999), { posts: [], next: null });
  assert.equal(s.threadPage(t.id, { limit: 0 }).posts.length, 1, 'a limit is at least one');
  s.close();
});

test('a page of a 100k-post thread comes back under 20 ms, wherever it is in the thread', () => {
  const s = open();
  const t = s.threadFor('daily', '2030-01-10');
  const other = s.threadFor('daily', '2030-01-11');
  const conn = db(s);
  conn.exec('BEGIN');
  const insert = conn.prepare('INSERT INTO posts (thread_id, author_id, body, created_at) VALUES (?, ?, ?, ?)');
  for (let i = 0; i < 100_000; i++) insert.run(t.id, `p${i % 500}`, `A comment of ordinary length, number ${i}, about the yard.`, i);
  for (let i = 0; i < 20_000; i++) insert.run(other.id, `p${i % 500}`, 'noise in the next thread', i);
  conn.exec('COMMIT');
  const times: number[] = [];
  for (let i = 0; i < 200; i++) {
    const after = (i * 499) % 100_000;
    const t0 = performance.now();
    const page = s.threadPage(t.id, { after, limit: 50 });
    times.push(performance.now() - t0);
    assert.equal(page.posts.length, Math.min(50, 100_000 - after));
  }
  times.sort((a, b) => a - b);
  const p95 = times[Math.floor(times.length * 0.95)];
  assert.ok(p95 < 20, `thread page p95 ${p95.toFixed(2)} ms`);
  assert.equal(s.threadPage(t.id, { limit: 10_000 }).posts.length, MAX_THREAD_PAGE, 'the limit is clamped');
  const plan = conn.prepare("EXPLAIN QUERY PLAN SELECT * FROM posts WHERE thread_id = 1 AND state = 'published' AND id > 5 ORDER BY id LIMIT 51").all() as {
    detail: string;
  }[];
  assert.ok(plan.some((r) => /USING (COVERING )?INDEX posts_page/.test(r.detail)) && !plan.some((r) => /TEMP B-TREE/.test(r.detail)), JSON.stringify(plan));
  s.close();
});

/** Each row a table can hold for `me`, on both sides where there are two. */
function everyRow(s: CommunityStore, me: string, other: string) {
  const c = db(s);
  const run = (sql: string, ...a: (string | number | null)[]) => c.prepare(sql).run(...a);
  run('INSERT INTO accounts (player_id, email_hash, created_at) VALUES (?, ?, 1)', me, 'emailhash');
  run('INSERT INTO accounts (player_id, created_at) VALUES (?, 1)', other);
  run("INSERT INTO email_links (token_hash, email_hash, player_id, created_at, expires_at) VALUES ('secret-token-hash', 'emailhash', ?, 1, 2)", me);
  const mine = s.threadFor('hub', 'my-topic');
  run('UPDATE threads SET author_id = ? WHERE id = ?', me, mine.id);
  const t = s.threadFor('daily', '2030-01-10');
  const p = s.addPost(t.id, me, 'my words');
  s.addPost(t.id, other, 'their words');
  run("INSERT INTO reactions (replay_hash, player_id, emote, created_at) VALUES ('h', ?, 'wow', 1)", me);
  run("INSERT INTO views (replay_hash, viewer_id, first_at, last_at) VALUES ('h', ?, 1, 1)", me);
  run("INSERT INTO friends (player_id, other_id, state, created_at) VALUES (?, ?, 'friend', 1), (?, ?, 'blocked', 1)", me, other, other, me);
  const m = run("INSERT INTO messages (sender_id, recipient_id, body, created_at, expires_at) VALUES (?, ?, 'hello', 1, 2)", me, other);
  run("INSERT INTO messages (sender_id, recipient_id, body, created_at, expires_at) VALUES (?, ?, 'hi', 1, 2)", other, me);
  run("INSERT INTO notifications (player_id, kind, created_at) VALUES (?, 'reply', 1)", me);
  run("INSERT INTO push_subscriptions (endpoint, player_id, p256dh, auth, hour_utc, created_at) VALUES ('https://push/1', ?, 'k', 'a', 9, 1)", me);
  run("INSERT INTO reports (target_kind, target_ref, reporter_id, reason, created_at) VALUES ('post', 77, ?, 'spam', 1)", me);
  run("INSERT INTO reports (target_kind, target_ref, reporter_id, reason, created_at) VALUES ('post', ?, ?, 'spam', 1)", p.id, other);
  run("INSERT INTO reports (target_kind, target_ref, reporter_id, reason, created_at) VALUES ('message', ?, ?, 'spam', 1)", Number(m.lastInsertRowid), other);
  run("INSERT INTO moderation_actions (actor, action, target_kind, target_ref, created_at) VALUES ('owner', 'mute', 'player', ?, 1)", me);
  run("INSERT INTO divisions (period, division, name, player_id, place, score) VALUES ('2030-01-10', 1, 'Rust', ?, 1, 500)", me);
  run("INSERT INTO trophies (player_id, kind, count, last_at) VALUES (?, 'gold', 1, 1)", me);
  run("INSERT INTO cosmetics (player_id, cosmetic, unlocked_at) VALUES (?, 'yard-dusk', 1)", me);
  return { thread: t, hub: mine };
}

test('forgetting a player reaches every row that holds their id; what others read stays without a name, and the moderation log stays', () => {
  const me = 'a'.repeat(16),
    other = 'b'.repeat(16);
  const s = open();
  const { thread, hub } = everyRow(s, me, other);
  assert.ok(s.forget(me) > 15);
  for (const c of PLAYER_COLUMNS) {
    const n = db(s).prepare(`SELECT COUNT(*) AS n FROM ${c.table} WHERE ${c.column} = ?`).get(me) as { n: number };
    assert.equal(n.n, 0, `${c.table}.${c.column}`);
  }
  assert.equal(s.threadFor('daily', '2030-01-10').postCount, 1, 'the thread counts what is left');
  assert.deepEqual(
    s.threadPage(thread.id).posts.map((p) => p.body),
    ['their words'],
  );
  assert.equal(s.threadFor('hub', 'my-topic').id, hub.id, "the topic stays for the people in it, with no author's name");
  assert.equal((db(s).prepare('SELECT COUNT(*) AS n FROM reports').get() as { n: number }).n, 0, 'reports on what went are gone too');
  assert.equal((db(s).prepare('SELECT COUNT(*) AS n FROM divisions WHERE player_id IS NULL').get() as { n: number }).n, 1, 'a closed division keeps its shape');
  assert.equal((db(s).prepare('SELECT COUNT(*) AS n FROM moderation_actions').get() as { n: number }).n, 1, 'the audit stays');
  assert.equal(s.forget(me), 0, 'again: nothing to do');
  s.close();
});

test('the list of player columns is complete: the schema is walked, so a new column has to be placed', () => {
  const s = open();
  const listed = new Set(PLAYER_COLUMNS.map((c) => `${c.table}.${c.column}`));
  const notPlayers = new Set(['posts.thread_id']);
  const found: string[] = [];
  for (const table of tables(s)) {
    const columns = db(s).prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
    for (const { name } of columns)
      if (/(_id|_by|^actor|^author|^player|^owner|^sender|^recipient|^reporter|^viewer)$/.test(name)) found.push(`${table}.${name}`);
  }
  // the actor of a moderation action is the moderator: kept in the audit by policy, the one column that outlives its subject
  const missing = found.filter((c) => !listed.has(c) && !notPlayers.has(c) && c !== 'moderation_actions.actor');
  assert.deepEqual(missing, []);
  for (const c of listed) assert.ok(found.includes(c), `${c} is listed and exists`);
  s.close();
});

test("the export gives a player their rows: never someone else's block of them, never a link token", () => {
  const me = 'a'.repeat(16),
    other = 'b'.repeat(16);
  const s = open();
  everyRow(s, me, other);
  const out = s.exportPlayer(me);
  assert.equal(out.accounts[0].email_hash, 'emailhash');
  assert.equal(out.posts[0].body, 'my words');
  assert.equal(out.messages.length, 2, 'sent and received');
  assert.equal(out.friends.length, 1, 'only the row they own');
  assert.equal(out.friends[0].state, 'friend');
  assert.equal(out.email_links, undefined);
  assert.ok(!JSON.stringify(out).includes('secret-token-hash'));
  assert.deepEqual(s.exportPlayer('c'.repeat(16)), {}, 'a stranger has nothing');
  s.close();
});

test('health: the size on disk and the schema every time, the counts at most once a minute', () => {
  let now = 1000;
  const s = open(tempDir(), { now: () => now });
  const t = s.threadFor('daily', '2030-01-10');
  s.addPost(t.id, 'p', 'one');
  const h = s.health();
  assert.deepEqual({ schema: h.schema, threads: h.threads, posts: h.posts, accounts: h.accounts }, { schema: 1, threads: 1, posts: 1, accounts: 0 });
  assert.ok(h.bytes > 0);
  s.addPost(t.id, 'p', 'two');
  assert.equal(s.health().posts, 1, 'cached');
  now += COUNTS_TTL_MS;
  assert.equal(s.health().posts, 2);
  s.close();
  assert.ok(!fs.existsSync(`${s.file}-wal`), 'a clean close folds the log in');
});

test('a snapshot of a live database has everything committed, and passes the integrity check', () => {
  const dir = tempDir();
  const s = open(dir);
  const t = s.threadFor('daily', '2030-01-10');
  for (let i = 0; i < 100; i++) s.addPost(t.id, 'p', `post ${i}`);
  assert.ok(fs.existsSync(`${s.file}-wal`), 'the posts are still in the log');
  const dest = path.join(tempDir(), 'snapshot.db');
  snapshotDatabase(s.file, dest);
  s.addPost(t.id, 'p', 'after the snapshot');
  s.close();
  const seen = inspectDatabase(dest);
  assert.deepEqual(seen, { integrity: 'ok', schema: 1, accounts: 0, threads: 1, posts: 100 });
  assert.ok(!fs.existsSync(`${dest}-wal`), 'one file, nothing beside it');
});

test('the operator tool shows where a directory stands and takes it back down', () => {
  const dir = tempDir();
  open(dir).close();
  const tool = (...a: string[]) => spawnSync(process.execPath, ['--import', 'tsx', 'tools/community.ts', ...a], { encoding: 'utf8' });
  assert.match(tool(dir, 'status').stdout, /"schema": 1/);
  const down = tool(dir, 'down', '0');
  assert.equal(down.status, 0, down.stderr);
  assert.deepEqual(JSON.parse(down.stdout).reversed, [1]);
  assert.equal(JSON.parse(tool(dir, 'status').stdout).schema, 0, 'it stays down: only the verifier migrates up');
  assert.equal(tool(tempDir(), 'status').status, 1, 'no database, no status');
  assert.equal(tool().status, 2);
  assert.equal(tool(dir, 'down', 'x').status, 2);
});

test('the routes: /health reports the store, /me/export carries it, DELETE /me empties it', async () => {
  const dir = tempDir();
  const verifier = new Verifier(path.join(dir, 'board.json'), { dailySecret: 'fixture-secret' });
  const community = open(dir);
  const token = 'a'.repeat(32);
  const id = playerIdFromToken(token)!;
  everyRow(community, id, 'b'.repeat(16));
  const server = createServer(verifier, { log: null, community });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const bearer = { Authorization: `Bearer ${token}` };
  try {
    const health = (await (await fetch(`${base}/health`)).json()) as { community: { schema: number; posts: number; bytes: number } };
    assert.equal(health.community.schema, 1);
    assert.equal(health.community.posts, 2);
    assert.ok(health.community.bytes > 0);
    const out = (await (await fetch(`${base}/me/export`, { headers: bearer })).json()) as { community: { posts: { body: string }[] } };
    assert.equal(out.community.posts[0].body, 'my words');
    const gone = (await (await fetch(`${base}/me`, { method: 'DELETE', headers: bearer })).json()) as { communityRowsRemoved: number };
    assert.ok(gone.communityRowsRemoved > 15);
    const after = (await (await fetch(`${base}/me/export`, { headers: bearer })).json()) as { community: object };
    assert.deepEqual(after.community, {});
  } finally {
    server.closeAllConnections();
    await new Promise<void>((r) => server.close(() => r()));
    community.close();
  }
  const plain = createServer(verifier, { log: null });
  await new Promise<void>((r) => plain.listen(0, '127.0.0.1', r));
  try {
    const url = `http://127.0.0.1:${(plain.address() as AddressInfo).port}`;
    assert.equal(((await (await fetch(`${url}/health`)).json()) as { community: unknown }).community, null, 'a verifier without the store says so');
    const again = (await (await fetch(`${url}/me`, { method: 'DELETE', headers: bearer })).json()) as { communityRowsRemoved: number };
    assert.equal(again.communityRowsRemoved, 0);
  } finally {
    plain.closeAllConnections();
    await new Promise<void>((r) => plain.close(() => r()));
  }
});

test('reactions: one per player per run, a new one replaces it, null takes it back; counts per emote per run, and the owner gets one unread line', () => {
  const s = open();
  s.react('run-a', 'p1', 'fire', 'owner');
  s.react('run-a', 'p2', 'fire', 'owner');
  s.react('run-a', 'p3', 'turtle', 'owner');
  s.react('run-b', 'p1', 'brain', 'owner');
  assert.deepEqual(Object.fromEntries(s.reactionsOn(['run-a', 'run-b', 'nobody'])), { 'run-a': { fire: 2, turtle: 1 }, 'run-b': { brain: 1 } });
  s.react('run-a', 'p1', 'puzzle', 'owner');
  assert.deepEqual(s.reactionsOn(['run-a']).get('run-a'), { fire: 1, puzzle: 1, turtle: 1 }, 'the same player, a new reaction: still three');
  assert.equal(s.reactionOf('run-a', 'p1'), 'puzzle');
  s.react('run-a', 'p1', null, 'owner');
  assert.equal(s.reactionOf('run-a', 'p1'), null);
  assert.deepEqual(s.reactionsOn(['run-a']).get('run-a'), { fire: 1, turtle: 1 });
  assert.deepEqual(s.reactionsOn([]).size, 0);
  const lines = () =>
    db(s).prepare("SELECT player_id, payload FROM notifications WHERE kind = 'reactions' ORDER BY id").all() as { player_id: string; payload: string }[];
  assert.deepEqual(
    lines().map((l) => [l.player_id, JSON.parse(l.payload).hash]),
    [
      ['owner', 'run-a'],
      ['owner', 'run-b'],
    ],
    'a batch per run, not one line per tap',
  );
  db(s).prepare('UPDATE notifications SET read_at = 1').run();
  s.react('run-a', 'p4', 'fire', 'owner');
  assert.equal(lines().length, 3, 'once read, the next reaction opens a new line');
  s.react('run-c', 'owner', 'fire', 'owner');
  s.react('run-d', 'p1', 'fire');
  assert.equal(lines().length, 3, 'nothing for a reaction of your own or on an anonymous run');
  s.close();
});

test('the reaction route: the device key is enough, the list is fixed, the run must exist and be open to you, and a run is not yours to react to', async () => {
  const dir = tempDir();
  const verifier = new Verifier(path.join(dir, 'board.json'), { dailySecret: 'fixture-secret' });
  const community = open(dir);
  const owner = 'a'.repeat(32),
    fan = 'b'.repeat(32);
  const replay = encodeReplay(exportReplay(playedRun('react-yard')));
  assert.ok(verifier.submit(replay, 'x', playerIdFromToken(owner), new Date()).recorded);
  const hash = verifier.board('react-yard', 1)[0].replayHash;
  const server = createServer(verifier, { log: null, community });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const react = (token: string | null, body: unknown) =>
    fetch(`${base}/react`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    });
  try {
    assert.equal((await react(null, { hash, emote: 'fire' })).status, 401);
    assert.equal((await react(fan, 'not json')).status, 400);
    assert.equal((await react(fan, { hash, emote: 'poop' })).status, 422, 'the list is fixed');
    assert.equal((await react(fan, { hash: 7, emote: 'fire' })).status, 422);
    assert.equal((await react(fan, { hash: 'f'.repeat(64), emote: 'fire' })).status, 404);
    const own = await react(owner, { hash, emote: 'fire' });
    assert.equal(own.status, 422);
    assert.equal(((await own.json()) as { code: string }).code, 'own-run');
    const ok = await react(fan, { hash, emote: 'applause' });
    assert.equal(ok.status, 200);
    assert.deepEqual(await ok.json(), { ok: true, reactions: { applause: 1 }, mine: 'applause' });
    const board = (await (await fetch(`${base}/board?seed=react-yard`)).json()) as { entries: { reactions?: object }[] };
    assert.deepEqual(board.entries[0].reactions, { applause: 1 });
    const entry = (bearer: string | null) =>
      fetch(`${base}/entry?hash=${hash}`, { headers: bearer ? { Authorization: `Bearer ${bearer}` } : {} }).then((r) => r.json()) as Promise<{
        mine: string;
        own: boolean;
        reactions: object;
      }>;
    assert.deepEqual(((e) => [e.mine, e.own, e.reactions])(await entry(fan)), ['applause', false, { applause: 1 }]);
    assert.deepEqual(((e) => [e.mine, e.own])(await entry(owner)), [null, true]);
    assert.deepEqual(((e) => [e.mine, e.own])(await entry(null)), [null, false]);
    assert.equal(((await (await react(fan, { hash, emote: null })).json()) as { mine: unknown }).mine, null);
    const empty = (await (await fetch(`${base}/board?seed=react-yard`)).json()) as { entries: object[] };
    assert.equal('reactions' in empty.entries[0], false, 'no reactions, no field');
    const big = await react(fan, JSON.stringify({ hash, emote: 'x'.repeat(2000) })).catch(() => null);
    assert.ok(!big || big.status === 413);
    for (let i = 0; i < REACT_RATE_LIMIT; i++) await react(fan, { hash, emote: 'fire' });
    assert.equal((await react(fan, { hash, emote: 'fire' })).status, 429);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((r) => server.close(() => r()));
    community.close();
  }
  const plain = createServer(verifier, { log: null });
  await new Promise<void>((r) => plain.listen(0, '127.0.0.1', r));
  try {
    const res = await fetch(`http://127.0.0.1:${(plain.address() as AddressInfo).port}/react`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${fan}` },
      body: '{}',
    });
    assert.equal(res.status, 503);
  } finally {
    plain.closeAllConnections();
    await new Promise<void>((r) => plain.close(() => r()));
  }
});

test('the words for reactions: the list is eight, every one has a label, the line shows the most used first', () => {
  assert.equal(REACTIONS.length, 8);
  for (const { id } of REACTIONS) assert.ok(t(`reaction.${id}` as StringKey).length > 2);
  assert.equal(isReaction('fire'), true);
  assert.equal(isReaction('poop'), false);
  assert.equal(reactionLine({ brain: 1, fire: 3, turtle: 2, puzzle: 1 }), '🔥 3 🐢 2 🧠 1');
  assert.equal(reactionLine({}), '');
  assert.equal(reactionTotal({ brain: 1, fire: 3 }), 4);
});

test('seen by: the same viewer twice counts once, and every watch adds to the times', () => {
  let now = 1000;
  const s = open(tempDir(), { now: () => now });
  assert.deepEqual({ ...s.seenBy('run-a') }, { times: 0, players: 0 });
  s.sawRun('run-a', 'p1');
  now = 2000;
  s.sawRun('run-a', 'p1');
  s.sawRun('run-a', 'p2');
  s.sawRun('run-b', 'p1');
  assert.deepEqual({ ...s.seenBy('run-a') }, { times: 3, players: 2 });
  assert.deepEqual({ ...s.seenBy('run-b') }, { times: 1, players: 1 });
  assert.deepEqual(
    { ...(db(s).prepare("SELECT first_at, last_at FROM views WHERE replay_hash = 'run-a' AND viewer_id = 'p1'").get() as object) },
    { first_at: 1000, last_at: 2000 },
  );
  s.close();
});

test("the routes count a watch: by a device with a key, not by the run's own player, and not behind the reveal gate", async () => {
  const dir = tempDir();
  const verifier = new Verifier(path.join(dir, 'board.json'), { dailySecret: 'fixture-secret' });
  const community = open(dir);
  const owner = 'a'.repeat(32),
    fan = 'b'.repeat(32);
  assert.ok(verifier.submit(encodeReplay(exportReplay(playedRun('seen-yard'))), 'x', playerIdFromToken(owner), new Date()).recorded);
  const hash = verifier.board('seen-yard', 1)[0].replayHash;
  const server = createServer(verifier, { log: null, community });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const watch = (token?: string) => fetch(`${base}/replay?hash=${hash}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  const seen = async () => ((await (await fetch(`${base}/entry?hash=${hash}`)).json()) as { seen: object }).seen;
  try {
    assert.equal((await watch()).status, 200);
    assert.deepEqual(await seen(), { times: 0, players: 0 }, 'no key, no viewer');
    await watch(owner);
    assert.deepEqual(await seen(), { times: 0, players: 0 }, "the run's own player does not count");
    await watch(fan);
    await watch(fan);
    assert.deepEqual(await seen(), { times: 2, players: 1 });
  } finally {
    server.closeAllConnections();
    await new Promise<void>((r) => server.close(() => r()));
    community.close();
  }
});
