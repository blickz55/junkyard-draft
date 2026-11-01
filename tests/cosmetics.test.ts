// Production roadmap 0.11.12: cosmetics. The unlock rules at their thresholds; a look holds one of a kind; what was earned stays; days of dailies
// count hot, cold and across devices; a title reaches boards, posts, recordings and the profile; a recording carries its author's paint; the
// shop refuses what was not earned; and nothing in the simulation can see any of it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { CommunityStore } from '../server/community';
import { Pipeline, type Classifier } from '../server/moderation';
import { createServer, playerIdFromToken, Verifier } from '../server/verify';
import {
  COSMETIC_KINDS,
  COSMETICS,
  cosmeticById,
  earned,
  lookFrom,
  measures,
  PLAIN,
  unlockedBy,
  type Needs,
  type Progress,
} from '../game/src/content/cosmetics';
import { STRING_KEYS } from '../game/src/content/strings';
import { MORE_STRINGS } from '../game/src/content/strings-more';
import { lookKey, lookName, withTitle } from '../game/src/content/title';
import { apply, newRun } from '../game/src/sim/run';
import { encodeReplay, exportReplay } from '../game/src/sim/replay';
import { RULES } from '../game/src/sim/rules';

const T0 = Date.parse('2030-03-12T10:00:00Z');
const DAY = 86_400_000;

/** Progress that meets a need exactly, or falls one short. */
function at(needs: Needs, short = 0): Progress {
  const days = (needs.days ?? 0) - (needs.days ? short : 0);
  const gold = (needs.gold ?? 0) - (needs.gold ? short : 0);
  const bronze = (needs.medals ?? 0) - (needs.medals ? short : 0);
  const top = (needs.top ?? 0) - (needs.top ? short : 0);
  return { days, trophies: { 'medal-gold': gold, 'medal-bronze': bronze, 'top-division': top } };
}

test('the list: an id starts with its kind, there is something of every kind, and everything painted has a coat', () => {
  assert.equal(new Set(COSMETICS.map((c) => c.id)).size, COSMETICS.length);
  for (const c of COSMETICS) {
    assert.ok(c.id.startsWith(`${c.kind}-`), c.id);
    assert.ok(Object.keys(c.needs).length > 0, `${c.id}: nothing is free`);
    if (c.kind === 'title') assert.equal(c.colour, undefined, c.id);
    else assert.match(c.colour!, /^#[0-9a-f]{6}$/, c.id);
  }
  for (const kind of COSMETIC_KINDS)
    assert.ok(
      COSMETICS.some((c) => c.kind === kind),
      kind,
    );
});

test('the rules: each thing unlocks on its number and not one short of it', () => {
  for (const c of COSMETICS) {
    assert.equal(earned(c, at(c.needs)), true, `${c.id} on the line`);
    assert.equal(earned(c, at(c.needs, 1)), false, `${c.id} one short`);
  }
  assert.deepEqual(unlockedBy({ days: 0, trophies: {} }), []);
  assert.deepEqual(unlockedBy({ days: 3, trophies: {} }), ['yard-dusk']);
  assert.deepEqual(unlockedBy({ days: 7, trophies: {} }), ['yard-dusk', 'skin-oxide', 'title-regular']);
  assert.deepEqual(unlockedBy({ days: 0, trophies: { 'medal-silver': 1 } }), ['skin-verdigris']);
  assert.deepEqual(unlockedBy({ days: 0, trophies: { 'medal-gold': 1 } }), ['skin-verdigris', 'skin-brass'], 'a gold is a medal too');
  assert.deepEqual(unlockedBy({ days: 0, trophies: { 'top-division': 1 } }), ['title-top-shelf']);
  assert.deepEqual(measures({ days: 2, trophies: { 'medal-gold': 1, 'medal-silver': 2, 'medal-bronze': 3, 'top-division': 4 } }), {
    days: 2,
    medals: 6,
    gold: 1,
    top: 4,
  });
  assert.equal(
    COSMETICS.filter((c) => !earned(c, { days: 30, trophies: { 'medal-gold': 10, 'top-division': 3 } })).length,
    0,
    'nothing on the list is out of reach',
  );
});

test('a look holds one of a kind and drops what this list does not know', () => {
  assert.deepEqual(lookFrom([]), PLAIN);
  assert.deepEqual(lookFrom(['yard-dusk', 'skin-brass', 'title-regular']), { yard: 'yard-dusk', skin: 'skin-brass', title: 'title-regular' });
  assert.deepEqual(lookFrom(['skin-from-a-newer-server', 7, null, 'title-regular']), { ...PLAIN, title: 'title-regular' });
  assert.equal(cosmeticById('nonsense'), null);
});

test('every thing has a name; a title is in the first-visit table, because boards show it; an unknown one says nothing', () => {
  const first = new Set<string>(STRING_KEYS);
  for (const c of COSMETICS) {
    assert.ok(lookName(c.id), c.id);
    if (c.kind === 'title') assert.ok(first.has(lookKey(c.id)), `${c.id} on a first visit`);
    else assert.ok(lookKey(c.id) in MORE_STRINGS, `${c.id} only weighs on the panel`);
  }
  assert.equal(lookName('title-from-a-newer-server'), '');
  assert.equal(withTitle('Ann#AB12', 'title-from-a-newer-server'), 'Ann#AB12');
  assert.equal(withTitle('Ann#AB12', null), 'Ann#AB12');
  assert.equal(withTitle('Ann#AB12', 'title-regular'), 'Ann#AB12 · Regular');
});

test('nothing in the simulation can see any of this', () => {
  const dir = path.join(import.meta.dirname, '..', 'game', 'src', 'sim');
  for (const f of fs.readdirSync(dir, { recursive: true }) as string[]) {
    if (!f.endsWith('.ts')) continue;
    const text = fs.readFileSync(path.join(dir, f), 'utf8');
    assert.doesNotMatch(text, /cosmetics|render\/paint|render\/looks|content\/title/, f);
  }
});

test('the store: what was earned stays, one of a kind is worn, and nothing unearned can be', () => {
  const s = new CommunityStore(path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'jd-cosmetics-')), 'community.db'));
  assert.deepEqual(s.grantCosmetics('ann', ['yard-dusk', 'yard-moss', 'title-regular']), ['yard-dusk', 'yard-moss', 'title-regular']);
  assert.deepEqual(s.grantCosmetics('ann', ['yard-dusk', 'skin-oxide']), ['skin-oxide'], 'only what is new');
  assert.equal(s.equipCosmetic('ann', 'skin-brass', true), false, 'not earned');
  assert.equal(s.equipCosmetic('sam', 'yard-dusk', true), false, 'not theirs');
  assert.equal(s.equipCosmetic('ann', 'yard-dusk', true), true);
  assert.equal(s.equipCosmetic('ann', 'yard-moss', true), true);
  assert.equal(s.equipCosmetic('ann', 'title-regular', true), true);
  assert.deepEqual(
    s
      .cosmeticsOf('ann')
      .filter((c) => c.equipped)
      .map((c) => c.id)
      .sort(),
    ['title-regular', 'yard-moss'],
    'the first coat came off, and a title is another kind',
  );
  assert.equal(s.equipCosmetic('ann', 'yard-moss', false), true);
  assert.deepEqual(
    s
      .cosmeticsOf('ann')
      .filter((c) => c.equipped)
      .map((c) => c.id),
    ['title-regular'],
  );
  s.addDeviceKey('old-device', 'ann');
  assert.deepEqual([...s.titlesOf(['ann', 'old-device', 'sam']).entries()].sort(), [
    ['ann', 'title-regular'],
    ['old-device', 'title-regular'],
  ]);
  assert.equal(s.titlesOf([]).size, 0);
  s.close();
});

async function rig() {
  let now = T0;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jd-cosmetics-http-'));
  const verifier = new Verifier(path.join(dir, 'board.json'), { dailySecret: 'fixture-secret', auditFile: null });
  const community = new CommunityStore(path.join(dir, 'community.db'), { now: () => now });
  const classify: Classifier = async () => ({ category: 'ok', score: 1 });
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
    return { status: res.status, json: (await res.json()) as Record<string, unknown> };
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
      apply(s, { t: 'pick', i: (pick >> (r - 1)) & 1 });
      apply(s, { t: 'run' });
      apply(s, { t: 'next' });
    }
    const out = await call('POST', '/verify', token, { replay: JSON.parse(encodeReplay(exportReplay(s, 'test'))) });
    assert.equal(out.status, 200, JSON.stringify(out.json));
    return (out.json as unknown as { entry: { replayHash: string; score: number } }).entry;
  };
  const date = () => new Date(now).toISOString().slice(0, 10);
  /** A game on today's daily, then on to tomorrow. */
  const playDay = async (token: string) => {
    const game = await play(token, verifier.periodRecord(date(), new Date(now))!.seed);
    now += DAY;
    return game;
  };
  const shop = async (token: string) =>
    (await call('GET', '/me/cosmetics', token)).json as unknown as { owned: string[]; look: typeof PLAIN; progress: Progress };
  const wear = (token: string, id: string, on = true) => call('POST', '/me/cosmetics', token, { id, on });
  return {
    call,
    verifier,
    community,
    moderation,
    person,
    play,
    playDay,
    shop,
    wear,
    date,
    now: () => new Date(now),
    tick: (ms: number) => (now += ms),
    close: async () => {
      moderation.close();
      await new Promise((r) => srv.close(r));
      community.close();
    },
  };
}

test('the shop: days of dailies earn things, each with one line in the inbox, and what is not earned cannot be worn', async () => {
  const r = await rig();
  const ann = r.person('a', 'Ann');
  assert.deepEqual(await r.shop(ann.token).then((s) => [s.owned, s.progress.days]), [[], 0]);
  await r.playDay(ann.token);
  await r.playDay(ann.token);
  assert.deepEqual((await r.shop(ann.token)).owned, [], 'two days earn nothing yet');
  await r.playDay(ann.token);
  const shop = await r.shop(ann.token);
  assert.deepEqual(shop.owned.sort(), ['skin-brass', 'skin-verdigris', 'yard-dusk'], 'alone on those days she took their gold as well');
  assert.equal(shop.progress.days, 3);
  assert.deepEqual(shop.look, PLAIN, 'nothing goes on by itself');

  const lines = async () => ((await r.call('GET', '/me/inbox', ann.token)).json as unknown as { items: { kind: string; payload: { id: string } }[] }).items;
  await r.shop(ann.token);
  assert.deepEqual(
    (await lines())
      .filter((l) => l.kind === 'cosmetic')
      .map((l) => l.payload.id)
      .sort(),
    ['skin-brass', 'skin-verdigris', 'yard-dusk'],
    'one line each, however often it is asked',
  );

  const refused = await r.wear(ann.token, 'skin-cobalt');
  assert.equal(refused.status, 403);
  assert.equal(refused.json.code, 'locked');
  assert.equal((await r.wear(ann.token, 'skin-from-the-future')).status, 422);
  assert.equal((await r.call('POST', '/me/cosmetics', ann.token, {})).status, 422);
  const worn = await r.wear(ann.token, 'yard-dusk');
  assert.equal(worn.status, 200);
  assert.deepEqual(worn.json.look, { ...PLAIN, yard: 'yard-dusk' });
  assert.deepEqual((await r.shop(ann.token)).look, { ...PLAIN, yard: 'yard-dusk' });
  assert.deepEqual((await r.wear(ann.token, 'yard-dusk', false)).json.look, PLAIN);
  await r.close();
});

test('trophies earn things too, and Home is what notices: the look comes back with the placements', async () => {
  const r = await rig();
  const ann = r.person('a', 'Ann');
  r.community.closeDay(
    '2030-03-01',
    Array.from({ length: 40 }, (_, i) => ({ playerId: i ? `p${i}` : ann.id, score: 100 - i })),
  );
  const home = (await r.call('GET', '/me/divisions?limit=1', ann.token)).json as unknown as { look: typeof PLAIN };
  assert.deepEqual(home.look, PLAIN);
  assert.deepEqual((await r.shop(ann.token)).owned.sort(), ['skin-brass', 'skin-verdigris', 'title-top-shelf']);
  assert.equal((await r.wear(ann.token, 'title-top-shelf')).status, 200);
  assert.deepEqual(((await r.call('GET', '/me/divisions', ann.token)).json as unknown as { look: typeof PLAIN }).look, { ...PLAIN, title: 'title-top-shelf' });
  await r.close();
});

test('days count on closed days and across devices, and what was earned stays', async () => {
  const r = await rig();
  const ann = r.person('a', 'Ann');
  await r.playDay(ann.token);
  await r.playDay(ann.token);
  const device = 'd'.repeat(32);
  const deviceId = playerIdFromToken(device)!;
  r.verifier.claim(deviceId, 'Old', r.now());
  await r.playDay(device);
  r.community.addDeviceKey(deviceId, ann.id);
  assert.equal((await r.shop(ann.token)).progress.days, 3, 'the earlier device counts');
  assert.ok((await r.shop(ann.token)).owned.includes('yard-dusk'));

  r.tick(40 * DAY);
  assert.ok(r.verifier.splitCold(r.now()).moved.length >= 3, 'the days went to cold storage');
  assert.equal(r.verifier.dailiesOf([ann.id, deviceId]), 3);
  await r.play(ann.token, 'yard-a');
  assert.equal(r.verifier.dailiesOf([ann.id]), 2, 'a practice yard is not a daily');
  await r.close();
});

test('a title reaches the board, the daily, a post and the profile; paint reaches the recording; the switch keeps it off a profile', async () => {
  const r = await rig();
  const ann = r.person('a', 'Ann');
  const sam = r.person('b', 'Sam');
  r.community.grantCosmetics(ann.id, ['title-regular', 'skin-brass', 'yard-dusk']);
  await r.wear(ann.token, 'title-regular');
  await r.wear(ann.token, 'skin-brass');
  await r.wear(ann.token, 'yard-dusk');
  const seed = r.verifier.periodRecord(r.date(), r.now())!.seed;
  const game = await r.play(ann.token, seed);
  await r.play(sam.token, seed, 1);
  type Row = { player: string; badge?: string };
  const badges = (rows: Row[]) => Object.fromEntries(rows.map((e) => [e.player.split('#')[0], e.badge ?? null]));
  assert.deepEqual(badges(((await r.call('GET', `/board?seed=${seed}`)).json as unknown as { entries: Row[] }).entries), { Ann: 'title-regular', Sam: null });
  assert.deepEqual(badges(((await r.call('GET', '/daily')).json as unknown as { entries: Row[] }).entries), { Ann: 'title-regular', Sam: null });

  assert.equal((await r.call('POST', '/posts', ann.token, { key: 'hub:strategies', body: 'Press before the dock' })).status, 200);
  await r.moderation.idle();
  const thread = (await r.call('GET', '/thread?key=hub:strategies')).json as unknown as { posts: { badge: string | null }[] };
  assert.equal(thread.posts[0].badge, 'title-regular');

  const recording = (await r.call('GET', `/replay?hash=${game.replayHash}`, sam.token)).json as unknown as { look: typeof PLAIN };
  assert.deepEqual(recording.look, { yard: 'yard-dusk', skin: 'skin-brass', title: 'title-regular' }, 'in the author paint');

  const card = async () => (await r.call('GET', `/card?hash=${game.replayHash}`, sam.token)).json as unknown as { badge?: string; private: boolean };
  assert.equal((await card()).badge, 'title-regular');
  await r.call('POST', '/me/card', ann.token, { private: true });
  assert.deepEqual(await card().then((c) => [c.private, c.badge]), [true, undefined], 'nothing but the name');
  await r.close();
});

test('a run from an earlier device shows its player: the title on the board and the paint on the recording', async () => {
  const r = await rig();
  const ann = r.person('a', 'Ann');
  const device = 'd'.repeat(32);
  const deviceId = playerIdFromToken(device)!;
  r.verifier.claim(deviceId, 'Old', r.now());
  const old = await r.play(device, 'yard-old');
  r.community.addDeviceKey(deviceId, ann.id);
  r.community.grantCosmetics(ann.id, ['title-regular', 'skin-brass']);
  await r.wear(ann.token, 'title-regular');
  await r.wear(ann.token, 'skin-brass');
  const board = (await r.call('GET', '/board?seed=yard-old')).json as unknown as { entries: { badge?: string }[] };
  assert.equal(board.entries[0].badge, 'title-regular');
  const recording = (await r.call('GET', `/replay?hash=${old.replayHash}`)).json as unknown as { look: typeof PLAIN };
  assert.equal(recording.look.skin, 'skin-brass');
  await r.close();
});

test('it is the player own data: in the export, gone on delete; and the routes need a key and a store', async () => {
  const r = await rig();
  const ann = r.person('a', 'Ann');
  r.community.grantCosmetics(ann.id, ['title-regular']);
  assert.equal((await r.call('GET', '/me/cosmetics')).status, 401);
  assert.equal((await r.call('POST', '/me/cosmetics', undefined, { id: 'title-regular' })).status, 401);
  assert.equal((await r.call('PUT', '/me/cosmetics', ann.token, {})).status, 405);
  const data = (await r.call('GET', '/me/export', ann.token)).json as unknown as { community: { cosmetics: { cosmetic: string }[] } };
  assert.equal(data.community.cosmetics[0].cosmetic, 'title-regular');
  assert.equal((await r.call('DELETE', '/me', ann.token)).status, 200);
  assert.deepEqual(r.community.cosmeticsOf(ann.id), []);
  await r.close();

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jd-cosmetics-none-'));
  const srv = createServer(new Verifier(path.join(dir, 'board.json'), { dailySecret: 'fixture-secret', auditFile: null }), { log: null });
  await new Promise<void>((done) => srv.listen(0, '127.0.0.1', done));
  assert.equal((await fetch(`http://127.0.0.1:${(srv.address() as AddressInfo).port}/me/cosmetics`)).status, 503);
  await new Promise((done) => srv.close(done));
});
