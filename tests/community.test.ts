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
  INBOX_READ_DAYS,
  MAX_THREAD_PAGE,
  PLAYER_COLUMNS,
  hashMigrations,
  inspectDatabase,
  snapshotDatabase,
  type CommunityOptions,
} from '../server/community';
import { createServer, playerIdFromToken, REACT_RATE_LIMIT, Verifier } from '../server/verify';
import { REACTIONS, isReaction, reactionLine, reactionTotal } from '../game/src/content/reactions';
import { DIVISION_MAX, DIVISION_MIN, DIVISION_TIERS, divisionKey, divisionSizes, placeDivisions } from '../game/src/daily/divisions';
import { t, type StringKey } from '../game/src/content/strings';
import { apply, newRun } from '../game/src/sim/run';
import { encodeReplay, exportReplay } from '../game/src/sim/replay';
import { RULES } from '../game/src/sim/rules';
import { dropOnLine } from './e2e/line';

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
function playedRun(seed: string, pick = 0) {
  const s = newRun(seed);
  for (let r = 1; r <= RULES.rounds; r++) {
    apply(s, { t: 'pick', i: Math.min(pick, s.offers.length - 1) });
    apply(s, { t: 'run' });
    apply(s, { t: 'next' });
  }
  return s;
}
/** A game that ships more than `playedRun`: the first shift builds the recipe's first step. */
function betterRun(seed: string) {
  const s = newRun(seed);
  for (let r = 1; r <= RULES.rounds; r++) {
    apply(s, { t: 'pick', i: Math.max(0, s.offers.indexOf('crusher')) });
    if (r === 1) dropOnLine(s, 'crusher');
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

test('divisions: sizes for 5, 17, 64, 65 and 1,000 players; the top is sixteen when that leaves a real second one, the rest even, all within 16 to 64', () => {
  assert.deepEqual(divisionSizes(0), []);
  assert.deepEqual(divisionSizes(5), [5], 'under sixteen: one division');
  assert.deepEqual(divisionSizes(17), [17], 'sixteen would leave one player alone');
  assert.deepEqual(divisionSizes(31), [31]);
  assert.deepEqual(divisionSizes(32), [16, 16]);
  assert.deepEqual(divisionSizes(64), [16, 24, 24]);
  assert.deepEqual(divisionSizes(65), [16, 25, 24]);
  const big = divisionSizes(1000);
  assert.equal(big[0], 16);
  assert.equal(
    big.reduce((a, b) => a + b, 0),
    1000,
  );
  assert.equal(new Set(big.slice(1)).size, 2, 'even: two neighbouring sizes at most');
  for (let n = 32; n <= 3000; n += 7) {
    const sizes = divisionSizes(n);
    assert.equal(
      sizes.reduce((a, b) => a + b, 0),
      n,
    );
    for (const size of sizes) assert.ok(size >= DIVISION_MIN && size <= DIVISION_MAX, `${n}: ${sizes.join(' ')}`);
    assert.ok(Math.max(...sizes.slice(1)) - Math.min(...sizes.slice(1)) <= 1);
  }
});

test('division names run down the yard: one tier each while they last, then numbered, every name once', () => {
  assert.deepEqual(
    [0, 1, 2].map((i) => divisionKey(i, 3).key),
    ['table', 'dockside', 'foundry'],
  );
  const many = Array.from({ length: 31 }, (_, i) => divisionKey(i, 31));
  assert.equal(many[0].key, 'table-1');
  assert.equal(many[30].tier, 'heap');
  assert.equal(new Set(many.map((d) => d.key)).size, 31);
  assert.deepEqual(
    DIVISION_TIERS.filter((t) => many.some((d) => d.tier === t)),
    [...DIVISION_TIERS],
    'every tier is used',
  );
  for (const d of many) assert.ok(d.number! >= 1);
  const placed = placeDivisions(Array.from({ length: 40 }, (_, i) => i));
  assert.deepEqual(
    placed.slice(0, 4).map((p) => [p.player, p.division, p.place, p.medal]),
    [
      [0, 0, 1, 'gold'],
      [1, 0, 2, 'silver'],
      [2, 0, 3, 'bronze'],
      [3, 0, 4, null],
    ],
  );
  assert.deepEqual(((p) => [p.key, p.place, p.size, p.medal])(placed[16]), ['dockside', 1, 24, 'gold'], 'the first of the next division has its own medal');
});

test('closing a day: computed once, trophies add up and never decay, one line each for the inbox, nothing for an empty day', () => {
  const s = open();
  const players = (n: number) => Array.from({ length: n }, (_, i) => ({ playerId: `p${i}`, score: 1000 - i }));
  assert.equal(s.closeDay('2030-01-09', []), 0);
  assert.equal(s.closeDay('2030-01-10', players(40)), 40);
  assert.equal(s.closeDay('2030-01-10', players(40)), 0, 'once');
  assert.equal(s.closeDay('2030-01-11', players(3)), 3);
  assert.deepEqual(s.trophiesOf('p0'), { 'medal-gold': 2, 'top-division': 1 }, 'a one-division day has no top division');
  assert.deepEqual(s.trophiesOf('p16'), { 'medal-gold': 1 });
  assert.deepEqual(s.trophiesOf('p39'), {});
  const mine = s.divisionsOf('p17');
  assert.deepEqual(mine, [{ period: '2030-01-10', division: 1, name: 'dockside', place: 2, score: 983, medal: 'silver', size: 24 }]);
  assert.deepEqual(
    s.divisionsOf('p0').map((d) => d.period),
    ['2030-01-11', '2030-01-10'],
    'newest first',
  );
  assert.equal(s.divisionBoard('2030-01-10', 1).length, 24);
  assert.deepEqual(s.divisionBoard('2030-01-10', 9), []);
  const lines = db(s).prepare("SELECT payload FROM notifications WHERE kind = 'division' AND player_id = 'p17'").all() as { payload: string }[];
  assert.deepEqual(
    lines.map((l) => JSON.parse(l.payload)),
    [{ period: '2030-01-10', division: 1, name: 'dockside', place: 2, size: 24, score: 983, medal: 'silver' }],
  );
  s.forget('p17');
  assert.equal(s.divisionBoard('2030-01-10', 1)[1].playerId, null, 'the place stays, the name goes');
  assert.deepEqual(s.trophiesOf('p17'), {});
  s.close();
});

test('the morning after: the day closes by the clock and no sooner, the player finds their division and the board, and a restart does not count it twice', async () => {
  let now = Date.parse('2030-03-12T10:00:00Z');
  const dir = tempDir();
  const verifier = new Verifier(path.join(dir, 'board.json'), { dailySecret: 'fixture-secret' });
  const community = open(dir, { now: () => now });
  const server = createServer(verifier, { log: null, community, now: () => now });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const token = 'a'.repeat(32),
    second = 'b'.repeat(32);
  const bearer = (t: string) => ({ headers: { Authorization: `Bearer ${t}` } });
  interface Mine {
    divisions: { period: string; name: string; size: number; place: number; medal: string }[];
    trophies: object;
  }
  interface Rows {
    name: string;
    rows: { place: number; player: string; you: boolean }[];
  }
  const json = async <T>(p: string, init?: RequestInit) => (await (await fetch(`${base}${p}`, init)).json()) as T;
  try {
    const { seed } = await json<{ seed: string }>('/daily');
    const date = new Date(now);
    assert.ok(verifier.claim(playerIdFromToken(token)!, 'First', date).ok && verifier.claim(playerIdFromToken(second)!, 'Second', date).ok);
    assert.ok(verifier.submit(encodeReplay(exportReplay(playedRun(seed, 1))), 'x', playerIdFromToken(token), date).recorded);
    assert.ok(verifier.submit(encodeReplay(exportReplay(playedRun(seed, 2))), 'x', playerIdFromToken(second), date).recorded);
    assert.ok(verifier.submit(encodeReplay(exportReplay(playedRun(seed, 0))), 'anon', null, date).recorded);
    assert.deepEqual((await json<Mine>('/me/divisions', bearer(token))).divisions, [], 'the day is still open');
    now = Date.parse('2030-03-14T00:00:01Z'); // 48 h after the day began
    await json('/daily');
    const me = await json<Mine>('/me/divisions', bearer(token));
    assert.equal(me.divisions.length, 1);
    const row = me.divisions[0];
    assert.deepEqual([row.period, row.name, row.size], ['2030-03-12', 'table', 2], 'two named players; the anonymous entry has nobody to place');
    assert.equal(row.medal, row.place === 1 ? 'gold' : 'silver');
    assert.equal(Object.keys(me.trophies).length, 1);
    const board = await json<Rows>('/division?period=2030-03-12&division=0', bearer(token));
    assert.equal(board.name, 'table');
    assert.equal(board.rows.length, 2);
    assert.deepEqual(
      board.rows.map((r) => r.place),
      [1, 2],
    );
    assert.equal(board.rows.filter((r) => r.you).length, 1);
    assert.ok(board.rows.every((r) => /^(First|Second)#/.test(r.player)));
    assert.equal((await fetch(`${base}/division?period=2030-03-12&division=4`)).status, 404);
    assert.equal((await fetch(`${base}/me/divisions`)).status, 401);
    const again = new Verifier(path.join(dir, 'board.json'), { dailySecret: 'fixture-secret' });
    again.onFreeze = () => assert.fail('a frozen day does not close twice');
    again.dailyRecord('2030-03-12', new Date(now));
    await fetch(`${base}/me`, { method: 'DELETE', ...bearer(token) });
    const after = await json<Rows>('/division?period=2030-03-12&division=0');
    assert.ok(
      after.rows.some((r) => r.player === 'deleted'),
      'the place stays, the name goes',
    );
  } finally {
    server.closeAllConnections();
    await new Promise<void>((r) => server.close(() => r()));
    community.close();
  }
  const plain = createServer(verifier, { log: null });
  await new Promise<void>((r) => plain.listen(0, '127.0.0.1', r));
  try {
    const url = `http://127.0.0.1:${(plain.address() as AddressInfo).port}`;
    assert.equal((await fetch(`${url}/division?period=x`)).status, 503);
    assert.equal((await fetch(`${url}/me/divisions`, bearer(second))).status, 503);
  } finally {
    plain.closeAllConnections();
    await new Promise<void>((r) => plain.close(() => r()));
  }
});

test('the inbox: newest first, the same unread line once, read lines stay a while and then go', () => {
  let now = Date.parse('2030-01-01T00:00:00Z');
  const s = open(tempDir(), { now: () => now });
  s.notify('p', 'division', { period: 'a' });
  s.notify('p', 'division', { period: 'a' });
  now += 1000;
  s.notify('p', 'division', { period: 'b' });
  s.notify('other', 'division', { period: 'z' });
  const first = s.inbox('p');
  assert.equal(first.unread, 2);
  assert.deepEqual(
    first.items.map((i) => [i.payload.period, i.read]),
    [
      ['b', false],
      ['a', false],
    ],
  );
  assert.equal(s.inbox('p', 1).items.length, 1);
  assert.equal(s.inbox('p', 1000).items.length, 2, 'the limit is clamped, not refused');
  assert.equal(s.markRead('p'), 2);
  assert.equal(s.inbox('p').unread, 0);
  assert.equal(s.inbox('other').unread, 1, "someone else's lines stay");
  s.notify('p', 'division', { period: 'a' });
  assert.equal(s.inbox('p').items.length, 3, 'once read, the same line can come again');
  now += (INBOX_READ_DAYS + 1) * 86_400_000;
  s.markRead('p');
  assert.equal(s.inbox('p').items.length, 1, 'long-read lines go on the next read');
  s.close();
});

test('the inbox over the wire: a reaction, a beaten challenge and a crew day each make one line, with names and no ids', async () => {
  let now = Date.parse('2030-03-12T10:00:00Z');
  const dir = tempDir();
  const verifier = new Verifier(path.join(dir, 'board.json'), { dailySecret: 'fixture-secret' });
  const community = open(dir, { now: () => now });
  const server = createServer(verifier, { log: null, community, now: () => now });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const a = 'a'.repeat(32),
    b = 'b'.repeat(32);
  const auth = (t: string) => ({ Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' });
  const inbox = async (t: string) =>
    (await (await fetch(`${base}/me/inbox`, { headers: auth(t) })).json()) as { unread: number; items: { kind: string; payload: Record<string, unknown> }[] };
  const post = (p: string, t: string, body: unknown) => fetch(`${base}${p}`, { method: 'POST', headers: auth(t), body: JSON.stringify(body) });
  try {
    const date = new Date(now);
    const pa = playerIdFromToken(a)!,
      pb = playerIdFromToken(b)!;
    assert.ok(verifier.claim(pa, 'Ana', date).ok && verifier.claim(pb, 'Bo', date).ok);
    const crew = verifier.createGroup(pa, 'Night Shift', date);
    assert.ok(crew.ok);
    assert.ok(verifier.joinGroup(pb, crew.group!.code).ok);
    const { seed } = (await (await fetch(`${base}/daily`)).json()) as { seed: string };
    const low = encodeReplay(exportReplay(playedRun(seed, 0)));
    assert.ok(verifier.submit(low, 'x', pa, date).recorded);
    const challenge = verifier.board(seed, 1)[0];
    // Bo beats it from the challenge link, and the challenger hears; a lower game, or one with no link, says nothing
    const better = betterRun(seed);
    const verified = await post('/verify', b, { replay: exportReplay(better), challenge: challenge.replayHash });
    const entry = ((await verified.json()) as { entry: { replayHash: string; score: number } }).entry;
    assert.ok(entry.score > challenge.score);
    assert.equal((await post('/react', b, { hash: challenge.replayHash, emote: 'fire' })).status, 200);
    const seen = await inbox(a);
    assert.equal(seen.unread, 2);
    assert.deepEqual(seen.items.map((i) => i.kind).sort(), ['challenge', 'reactions']);
    const line = seen.items.find((i) => i.kind === 'challenge')!;
    assert.deepEqual(
      [line.payload.seed, line.payload.theirs, line.payload.score, /^Bo#/.test(String(line.payload.player))],
      [seed, challenge.score, entry.score, true],
    );
    assert.equal('by' in line.payload, false, 'the player id stays on the server');
    assert.deepEqual(seen.items.find((i) => i.kind === 'reactions')!.payload.reactions, { fire: 1 });
    assert.equal((await inbox(b)).unread, 0, 'the one who beat it hears nothing');
    assert.deepEqual(await (await post('/me/inbox/read', a, {})).json(), { ok: true, read: 2 });
    assert.equal((await inbox(a)).unread, 0);
    // the day closes: a division line each, and a crew line each
    now = Date.parse('2030-03-14T00:00:01Z');
    await fetch(`${base}/daily`);
    const bo = await inbox(b);
    assert.deepEqual(bo.items.map((i) => i.kind).sort(), ['crew-day', 'division']);
    const day = bo.items.find((i) => i.kind === 'crew-day')!.payload;
    assert.deepEqual([day.crew, day.place, day.size, day.period, day.score], ['Night Shift', 1, 2, '2030-03-12', entry.score]);
    assert.match(String(day.top), /^Bo#/);
    assert.equal('code' in day, false, 'a crew code never travels in a line');
    const unauth = await fetch(`${base}/me/inbox`);
    assert.equal(unauth.status, 401);
    assert.equal((await fetch(`${base}/me/inbox/read`, { method: 'POST' })).status, 401);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((r) => server.close(() => r()));
    community.close();
  }
  const plain = createServer(verifier, { log: null });
  await new Promise<void>((r) => plain.listen(0, '127.0.0.1', r));
  try {
    const url = `http://127.0.0.1:${(plain.address() as AddressInfo).port}`;
    assert.equal((await fetch(`${url}/me/inbox`, { headers: auth(a) })).status, 503);
    assert.equal((await fetch(`${url}/me/inbox/read`, { method: 'POST', headers: auth(a) })).status, 503);
  } finally {
    plain.closeAllConnections();
    await new Promise<void>((r) => plain.close(() => r()));
  }
});
