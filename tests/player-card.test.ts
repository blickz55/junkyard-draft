// Production roadmap 0.11.13: the author card. Who a player is, reached through a game or a post; a switch that leaves only the name, held
// over the three places a card opens from; a block that reads the same; the reveal gate on the games a card lists; a post that is down names
// nobody; a run from an earlier device follows its player; and a public page that does not read the cold files per request.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { CommunityStore } from '../server/community';
import { topGames } from '../server/cold';
import { Pipeline, type Classifier } from '../server/moderation';
import { createServer, playerIdFromToken, Verifier, type BoardEntry } from '../server/verify';
import { apply, newRun } from '../game/src/sim/run';
import { encodeReplay, exportReplay } from '../game/src/sim/replay';
import { RULES } from '../game/src/sim/rules';
import { RULES_VERSION } from '../game/src/sim/types';

const T0 = Date.parse('2030-03-12T10:00:00Z');
const DAY = 86_400_000;
const OPEN_DAY = '2030-03-12';

type Card = {
  ok: boolean;
  player: string;
  private: boolean;
  friendable: boolean;
  own?: boolean;
  hidden?: boolean;
  joined?: string;
  trophies?: Record<string, number>;
  best?: { hash: string; seed: string; score: number }[];
};

async function rig() {
  let now = T0;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jd-card-'));
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
      apply(s, { t: 'pick', i: (pick >> (r - 1)) & 1 });
      apply(s, { t: 'run' });
      apply(s, { t: 'next' });
    }
    const out = await call('POST', '/verify', token, { replay: JSON.parse(encodeReplay(exportReplay(s, 'test'))) });
    assert.equal(out.status, 200, JSON.stringify(out.json));
    return (out.json as unknown as { entry: { replayHash: string; score: number } }).entry;
  };
  const post = async (token: string, key: string, body: string) => {
    const out = await call('POST', '/posts', token, { key, body });
    assert.equal(out.status, 200, JSON.stringify(out.json));
    await moderation.idle();
    return (out.json as unknown as { post: { id: number } }).post.id;
  };
  const card = async (target: string, bearer?: string) => {
    const out = await call('GET', `/card?${target}`, bearer);
    return { status: out.status, card: out.json as unknown as Card, raw: JSON.stringify(out.json) };
  };
  return {
    call,
    verifier,
    community,
    moderation,
    person,
    play,
    post,
    card,
    today: verifier.periodRecord(OPEN_DAY, new Date(now))!.seed,
    now: () => new Date(now),
    tick: (ms: number) => (now += ms),
    close: async () => {
      moderation.close();
      await new Promise((r) => srv.close(r));
      community.close();
    },
  };
}
const entry = (seed: string, score: number, replayHash: string) => ({ seed, score, replayHash }) as BoardEntry;

test('best games: one per yard, highest first, and a tie always reads the same', () => {
  const games = [entry('a', 10, 'h1'), entry('a', 30, 'h2'), entry('b', 20, 'h4'), entry('c', 20, 'h3'), entry('d', 5, 'h5')];
  assert.deepEqual(
    topGames(games).map((e) => e.replayHash),
    ['h2', 'h3', 'h4'],
  );
  assert.deepEqual(
    topGames([...games].reverse()).map((e) => e.replayHash),
    ['h2', 'h3', 'h4'],
  );
  assert.equal(topGames(games, 1).length, 1);
  assert.deepEqual(topGames([]), []);
});

test('a card says who, since when, what they won and their best games, and holds no id', async () => {
  const r = await rig();
  const ann = r.person('a', 'Ann');
  const sam = r.person('b', 'Sam');
  const games = [];
  for (const [i, yard] of ['yard-a', 'yard-b', 'yard-c', 'yard-d'].entries()) {
    games.push(await r.play(ann.token, yard, i));
    r.tick(60_000); // two submissions a minute
  }
  const ranked = Array.from({ length: 40 }, (_, i) => ({ playerId: i ? `p${i}` : ann.id, score: 100 - i }));
  assert.equal(r.community.closeDay('2030-03-01', ranked), 40);

  const { status, card, raw } = await r.card(`hash=${games[0].replayHash}`, sam.token);
  assert.equal(status, 200);
  assert.equal(card.player, `Ann#${r.verifier.player(ann.id)!.tag}`);
  assert.equal(card.private, false);
  assert.equal(card.joined, '2030-03');
  assert.ok(card.trophies!['medal-gold'] >= 1, JSON.stringify(card.trophies));
  assert.equal(card.best!.length, 3, 'three games, however many there are');
  const scores = card.best!.map((g) => g.score);
  assert.deepEqual(
    scores,
    [...scores].sort((a, b) => b - a),
    'best first',
  );
  assert.ok(new Set(card.best!.map((g) => g.seed)).size === 3, 'one per yard');
  for (const id of [ann.id, sam.id]) assert.ok(!raw.includes(id), 'no id in it');
  assert.equal(card.friendable, true);

  const nobody = await r.card(`hash=${games[0].replayHash}`);
  assert.equal(nobody.status, 200, 'no key needed');
  assert.equal(nobody.card.friendable, false);
  assert.equal(nobody.card.player, card.player);
  await r.close();
});

test('a card with no games says so, and asking for nobody finds nobody', async () => {
  const r = await rig();
  const ann = r.person('a', 'Ann');
  const id = await r.post(ann.token, 'hub:strategies', 'Press before the dock');
  const { card } = await r.card(`postId=${id}`);
  assert.deepEqual(card.best, []);
  for (const target of ['', 'hash=' + 'f'.repeat(64), 'postId=99999', 'postId=0', 'postId=-1', 'postId=1.5', 'postId=nonsense']) {
    assert.equal((await r.card(target)).status, 404, target);
  }
  await r.close();
});

test('the switch leaves only the name on a board, on a comment and in the hub, and only the owner sees past it', async () => {
  const r = await rig();
  const ann = r.person('a', 'Ann');
  const sam = r.person('b', 'Sam');
  const game = await r.play(ann.token, 'yard-a');
  r.community.closeDay(
    '2030-03-01',
    Array.from({ length: 40 }, (_, i) => ({ playerId: i ? `p${i}` : ann.id, score: 100 - i })),
  );
  const surfaces = {
    board: `hash=${game.replayHash}`,
    comment: `postId=${await r.post(ann.token, game.replayHash, 'A good one')}`,
    hub: `postId=${await r.post(ann.token, 'hub:strategies', 'Press before the dock')}`,
  };
  const name = `Ann#${r.verifier.player(ann.id)!.tag}`;
  for (const [where, target] of Object.entries(surfaces)) {
    const { card } = await r.card(target, sam.token);
    assert.equal(card.private, false, where);
    assert.equal(card.best!.length, 1, where);
  }

  assert.deepEqual((await r.call('POST', '/me/card', ann.token, { private: true })).json, { ok: true, private: true });
  for (const [where, target] of Object.entries(surfaces)) {
    for (const viewer of [sam.token, undefined]) {
      const { status, card, raw } = await r.card(target, viewer);
      assert.equal(status, 200, where);
      assert.deepEqual(Object.keys(card).sort(), ['friendable', 'ok', 'player', 'private'], `${where}: nothing but the name`);
      assert.equal(card.player, name, where);
      assert.equal(card.private, true, where);
      assert.ok(!raw.includes(String(game.score)), `${where}: no score`);
      assert.ok(!raw.includes(game.replayHash), `${where}: no game`);
    }
    const own = await r.card(target, ann.token);
    assert.equal(own.card.private, false, `${where}: the owner sees their card`);
    assert.equal(own.card.own, true, where);
    assert.equal(own.card.hidden, true, `${where}: and is told the others do not`);
    assert.equal(own.card.best!.length, 1, where);
  }
  const board = (await r.call('GET', '/board?seed=yard-a')).json as unknown as { entries: { replayHash: string }[] };
  assert.equal(board.entries[0].replayHash, game.replayHash, 'the score stays on the board');

  assert.deepEqual((await r.call('POST', '/me/card', ann.token, { private: false })).json, { ok: true, private: false });
  for (const target of Object.values(surfaces)) assert.equal((await r.card(target, sam.token)).card.best!.length, 1);
  await r.close();
});

test('a block reads exactly like the switch, both ways, so it is not announced', async () => {
  const r = await rig();
  const ann = r.person('a', 'Ann');
  const sam = r.person('b', 'Sam');
  const annGame = await r.play(ann.token, 'yard-a');
  const samGame = await r.play(sam.token, 'yard-b');
  await r.call('POST', '/me/card', ann.token, { private: true });
  const shown = (await r.card(`hash=${annGame.replayHash}`, sam.token)).card;
  await r.call('POST', '/me/card', ann.token, { private: false });
  assert.equal((await r.call('POST', '/friends/block', ann.token, { hash: samGame.replayHash })).status, 200);
  assert.deepEqual((await r.card(`hash=${annGame.replayHash}`, sam.token)).card, shown, 'the same to the last field, Add friend included');
  const other = (await r.card(`hash=${samGame.replayHash}`, ann.token)).card;
  assert.equal(other.private, true, 'the one who blocked sees no more of them');
  assert.equal(other.best, undefined);
  assert.equal((await r.card(`hash=${annGame.replayHash}`)).card.private, false, 'a stranger still sees it');
  await r.close();
});

test('a game on an open day stays off a card until the viewer has played that day or the day has closed', async () => {
  const r = await rig();
  const ann = r.person('a', 'Ann');
  const sam = r.person('b', 'Sam');
  const open = await r.play(ann.token, r.today);
  const other = await r.play(ann.token, 'yard-a');
  const hashes = async (bearer?: string) => (await r.card(`hash=${other.replayHash}`, bearer)).card.best!.map((g) => g.hash);
  assert.deepEqual(await hashes(sam.token), [other.replayHash]);
  assert.deepEqual(await hashes(), [other.replayHash]);
  assert.deepEqual((await hashes(ann.token)).sort(), [open.replayHash, other.replayHash].sort(), 'their own, of course');
  await r.play(sam.token, r.today, 1);
  assert.ok((await hashes(sam.token)).includes(open.replayHash), 'the viewer has played it');
  assert.ok(!(await hashes()).includes(open.replayHash));
  r.tick(Date.parse(r.verifier.periodRecord(OPEN_DAY, r.now())!.closesAt) - r.now().getTime());
  assert.ok((await hashes()).includes(open.replayHash), 'the day has closed');
  await r.close();
});

test('a post that is down or behind its gate names nobody', async () => {
  const r = await rig();
  const ann = r.person('a', 'Ann');
  const sam = r.person('b', 'Sam');
  const down = await r.post(ann.token, 'hub:strategies', 'something awful');
  assert.equal((await r.card(`postId=${down}`, sam.token)).status, 404);
  assert.equal((await r.card(`postId=${down}`)).status, 404);
  assert.equal((await r.card(`postId=${down}`, ann.token)).status, 200, 'the author can still open their own');

  await r.play(ann.token, r.today);
  const gated = await r.post(ann.token, OPEN_DAY, 'Good yard today');
  assert.equal((await r.card(`postId=${gated}`, sam.token)).status, 404, 'an open day stays behind its gate');
  await r.play(sam.token, r.today, 1);
  assert.equal((await r.card(`postId=${gated}`, sam.token)).status, 200);

  const taken = await r.post(ann.token, 'hub:strategies', 'Thought better of this');
  assert.equal((await r.card(`postId=${taken}`, sam.token)).status, 200);
  assert.equal((await r.call('POST', '/posts/delete', ann.token, { id: taken })).status, 200);
  assert.equal((await r.card(`postId=${taken}`, sam.token)).status, 404, 'taken back');
  await r.close();
});

test('a run from before a device signed in follows the player: the name, the switch, the games and Add friend', async () => {
  const r = await rig();
  const ann = r.person('a', 'Ann');
  const sam = r.person('b', 'Sam');
  const device = 'd'.repeat(32);
  const deviceId = playerIdFromToken(device)!;
  r.verifier.claim(deviceId, 'Old', r.now());
  const old = await r.play(device, 'yard-old');
  const now = await r.play(ann.token, 'yard-new', 1);
  assert.equal(r.verifier.ownerOf(old.replayHash), deviceId);
  r.community.addDeviceKey(deviceId, ann.id);

  const { card } = await r.card(`hash=${old.replayHash}`, sam.token);
  assert.equal(card.player, `Ann#${r.verifier.player(ann.id)!.tag}`, 'the player, not the device');
  assert.deepEqual(card.best!.map((g) => g.hash).sort(), [old.replayHash, now.replayHash].sort(), 'both devices');
  assert.equal(card.friendable, true);

  assert.equal((await r.card(`hash=${old.replayHash}`, device)).card.own, true, 'that device is them');
  assert.equal(((await r.call('GET', `/entry?hash=${old.replayHash}`, ann.token)).json as unknown as { own: boolean }).own, true);

  assert.deepEqual((await r.call('POST', '/friends/request', sam.token, { hash: old.replayHash })).json, { ok: true, result: 'sent' });
  const inbox = (await r.call('GET', '/me/inbox', ann.token)).json as unknown as { items: { kind: string }[] };
  assert.equal(inbox.items.at(-1)!.kind, 'friend-request', 'the player hears, not the device');

  await r.call('POST', '/me/card', ann.token, { private: true });
  assert.equal((await r.card(`hash=${old.replayHash}`, sam.token)).card.private, true, 'the switch holds for the old run too');
  await r.close();
});

test('closed days count, and a public page reads the cold files once per change, never once per request', async () => {
  const r = await rig();
  const ann = r.person('a', 'Ann');
  const game = await r.play(ann.token, r.today);
  r.tick(40 * DAY);
  assert.ok(r.verifier.splitCold(r.now()).moved.length > 0, 'the day went to cold storage');

  const cold = r.verifier.cold as unknown as { readJson: (f: string) => unknown };
  const read = cold.readJson.bind(cold);
  let reads = 0;
  cold.readJson = (f) => {
    reads++;
    return read(f);
  };
  const best = async () => (await r.card(`hash=${game.replayHash}`)).card.best!;
  assert.deepEqual(
    (await best()).map((g) => g.hash),
    [game.replayHash],
  );
  const first = reads;
  assert.ok(first > 0, 'it read the months');
  for (let i = 0; i < 5; i++) await best();
  assert.equal(reads, first, 'and never again for the same files');

  const next = verifierDay(r);
  const later = await r.play(ann.token, next);
  r.tick(40 * DAY);
  assert.ok(r.verifier.splitCold(r.now()).moved.length > 0);
  assert.deepEqual((await best()).map((g) => g.hash).sort(), [game.replayHash, later.replayHash].sort(), 'a new day moved in: read again, and it shows');
  assert.ok(reads > first);
  await r.close();
});
/** Today's yard on the rig's clock, a later day than the first. */
const verifierDay = (r: Awaited<ReturnType<typeof rig>>) => r.verifier.periodRecord(r.now().toISOString().slice(0, 10), r.now())!.seed;

test('the store forgets with the player: cold games leave the index, and a deleted player has no card', async () => {
  const r = await rig();
  const ann = r.person('a', 'Ann');
  const sam = r.person('b', 'Sam');
  const game = await r.play(ann.token, r.today);
  const id = await r.post(ann.token, 'hub:strategies', 'Press before the dock');
  r.tick(40 * DAY);
  r.verifier.splitCold(r.now());
  assert.equal(r.verifier.cold.summaryOf(ann.id, RULES_VERSION).best.length, 1);
  await r.call('POST', '/me/card', ann.token, { private: true });
  const seen = (await r.call('GET', '/thread?key=hub:strategies', sam.token)).json as unknown as { posts: { card: boolean }[] };
  assert.equal(seen.posts[0].card, true, 'the panel may offer it');

  assert.equal((await r.call('DELETE', '/me', ann.token)).status, 200);
  assert.equal(r.community.cardPrivate(ann.id), false, 'the switch went with the player');
  assert.deepEqual(r.verifier.cold.summaryOf(ann.id, RULES_VERSION).best, []);
  assert.equal((await r.card(`hash=${game.replayHash}`, sam.token)).status, 404);
  assert.equal((await r.card(`postId=${id}`, sam.token)).status, 404);
  const after = (await r.call('GET', '/thread?key=hub:strategies', sam.token)).json as unknown as { posts: { card: boolean; author: string }[] };
  for (const p of after.posts) assert.equal(p.card, false, 'and the panel is told not to offer it');
  await r.close();
});

test('the switch needs a key, not an email, and turning it links nothing', async () => {
  const r = await rig();
  const lou = r.person('c', 'Lou', false);
  const sam = r.person('b', 'Sam');
  assert.equal((await r.call('GET', '/me/card')).status, 401);
  assert.equal((await r.call('POST', '/me/card', undefined, { private: true })).status, 401);
  assert.equal((await r.call('PUT', '/me/card', lou.token, { private: true })).status, 405);
  assert.deepEqual((await r.call('GET', '/me/card', lou.token)).json, { ok: true, private: false });
  assert.deepEqual((await r.call('POST', '/me/card', lou.token, { private: 'yes' })).json, { ok: true, private: false }, 'only true turns it on');
  assert.deepEqual((await r.call('POST', '/me/card', lou.token, { private: true })).json, { ok: true, private: true });
  assert.deepEqual((await r.call('GET', '/me/card', lou.token)).json, { ok: true, private: true });
  assert.equal(r.community.isLinked(lou.id), false, 'the row holds no email');
  assert.equal(r.community.writeBlock(lou.id)?.code, 'not-linked', 'and writing stays shut');
  const game = await r.play(lou.token, 'yard-a');
  assert.equal((await r.call('POST', '/friends/request', sam.token, { hash: game.replayHash })).status, 422, 'nor can they be asked');
  const data = (await r.call('GET', '/me/export', lou.token)).json as unknown as { community: { accounts: { card_private: number }[] } };
  assert.equal(data.community.accounts[0].card_private, 1, 'the choice is in their export');
  await r.close();
});

test('with no community store the routes say so', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jd-card-none-'));
  const verifier = new Verifier(path.join(dir, 'board.json'), { dailySecret: 'fixture-secret', auditFile: null });
  const srv = createServer(verifier, { log: null });
  await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${(srv.address() as AddressInfo).port}`;
  assert.equal((await fetch(`${base}/card?hash=${'f'.repeat(64)}`)).status, 503);
  assert.equal((await fetch(`${base}/me/card`)).status, 503);
  await new Promise((r) => srv.close(r));
});
