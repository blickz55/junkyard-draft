// Production roadmap 0.12.5: voiding a day. A compromised day is voided and re-issued, never re-scored: its games leave the board but are kept for a
// person, what they earned is taken back, the old yard is refused, the new one plays and closes like any other, the commitment chain stays checkable,
// and only the owner can do it. Forgetting a player reaches the kept file too.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { CommunityStore } from '../server/community';
import { commitmentFor, mintReissue, mintSeed } from '../server/mint';
import { Pipeline, type Classifier } from '../server/moderation';
import { createServer, playerIdFromToken, Verifier } from '../server/verify';
import { apply, newRun } from '../game/src/sim/run';
import { encodeReplay, exportReplay } from '../game/src/sim/replay';
import { RULES } from '../game/src/sim/rules';

const T0 = Date.parse('2030-03-12T10:00:00Z');
const DAY = 86_400_000;
const DATE = '2030-03-12';
const SECRET = 'fixture-secret';
const ROOT = path.join(import.meta.dirname, '..');

async function rig() {
  let now = T0;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jd-void-'));
  const audit = path.join(dir, 'audit.jsonl');
  const verifier = new Verifier(path.join(dir, 'board.json'), { dailySecret: SECRET, auditFile: audit });
  const community = new CommunityStore(path.join(dir, 'community.db'), { now: () => now });
  const classify: Classifier = async () => ({ category: 'ok', score: 1 });
  const moderation = new Pipeline({ store: community, classify, audit: () => {}, now: () => now, sweepMs: 0, logError: () => {} });
  const srv = createServer(verifier, { log: null, community, moderation, moderationToken: 'tok', now: () => now, playerRateLimit: 1000, postRateLimit: 1000 });
  await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${(srv.address() as AddressInfo).port}`;
  const call = async (method: string, p: string, body?: unknown, headers: Record<string, string> = {}) => {
    const res = await fetch(`${base}${p}`, {
      method,
      headers: { 'Content-Type': 'application/json', ...headers },
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
  const send = (token: string, seed: string, pick = 0) => {
    const s = newRun(seed);
    for (let r = 1; r <= RULES.rounds; r++) {
      apply(s, { t: 'pick', i: (pick >> (r - 1)) & 1 });
      apply(s, { t: 'run' });
      apply(s, { t: 'next' });
    }
    return call('POST', '/verify', { replay: JSON.parse(encodeReplay(exportReplay(s, 'test'))) }, { Authorization: `Bearer ${token}` });
  };
  const voidIt = (date = DATE, reason = 'a bug in the offers', token = 'tok') =>
    call('POST', '/moderation/void', { date, reason }, { 'X-Moderation-Token': token });
  const daily = async (date = DATE) =>
    (await call('GET', `/daily?date=${date}&limit=5`)).json as unknown as {
      seed: string;
      commitment: string;
      closesAt: string;
      final?: boolean;
      entries: { player: string }[];
      voided?: { seed: string; reason: string }[];
    };
  return {
    base,
    dir,
    audit,
    call,
    community,
    moderation,
    verifier,
    person,
    send,
    voidIt,
    daily,
    now: () => new Date(now),
    tick: (ms: number) => (now += ms),
    close: async () => {
      moderation.close();
      await new Promise((r) => srv.close(r));
      community.close();
    },
  };
}

test('the new seed is not the old one, follows from nothing public, and is the same each time', () => {
  const first = mintSeed(SECRET, DATE);
  const second = mintReissue(SECRET, DATE, 1);
  const third = mintReissue(SECRET, DATE, 2);
  assert.match(second, /^daily-2030-03-12-[a-z2-7]{8}$/);
  assert.equal(new Set([first, second, third]).size, 3);
  assert.equal(mintReissue(SECRET, DATE, 1), second);
  assert.notEqual(mintReissue('another secret', DATE, 1), second);
  assert.throws(() => mintReissue('', DATE, 1), /secret/);
});

test('an open day: its games leave the board for a file, the old yard is refused, the new one plays', async () => {
  const r = await rig();
  const ann = r.person('a', 'Ann');
  const before = await r.daily();
  assert.equal((await r.send(ann.token, before.seed)).status, 200);

  const out = await r.voidIt();
  assert.equal(out.status, 200, JSON.stringify(out.json));
  assert.equal((out.json as unknown as { games: number }).games, 1);

  const after = await r.daily();
  assert.equal(after.seed, mintReissue(SECRET, DATE, 1));
  assert.equal(after.entries.length, 0, 'the board starts again');
  assert.deepEqual(
    after.voided?.map((v) => [v.seed, v.reason]),
    [[before.seed, 'a bug in the offers']],
  );
  assert.equal(Date.parse(after.closesAt), T0 + 2 * DAY, 'a full window from now');

  const refused = await r.send(ann.token, before.seed, 1);
  assert.equal(refused.status, 422);
  assert.equal(refused.json.code, 'unissued-seed');
  assert.equal((await r.send(ann.token, after.seed)).status, 200, 'and the day is playable');
  assert.equal((await r.daily()).entries.length, 1);

  const kept = JSON.parse(fs.readFileSync(path.join(r.dir, 'voided', `${DATE}-1.json`), 'utf8')) as {
    record: { seed: string };
    entries: { player: string }[];
    replays: Record<string, unknown>;
    voided: { reason: string };
  };
  assert.equal(kept.record.seed, before.seed);
  assert.equal(kept.entries.length, 1, 'kept for a person to read');
  assert.equal(Object.keys(kept.replays).length, 1);
  assert.equal(kept.voided.reason, 'a bug in the offers');

  const lines = fs
    .readFileSync(r.audit, 'utf8')
    .trim()
    .split('\n')
    .map((l) => JSON.parse(l) as { action: string; reason?: string; games?: number });
  assert.deepEqual(
    lines.filter((l) => l.action === 'void').map((l) => [l.games, l.reason]),
    [[1, 'a bug in the offers']],
  );
  await r.close();
});

test('the chain stays checkable: the day before still commits to the yard the day opened on', async () => {
  const r = await rig();
  const yesterday = await r.daily('2030-03-11');
  const before = await r.daily();
  assert.equal(commitmentFor(before.seed), yesterday.commitment);
  await r.voidIt();
  const after = await r.daily();
  assert.notEqual(commitmentFor(after.seed), yesterday.commitment);
  assert.equal(commitmentFor(after.voided![0].seed), yesterday.commitment, 'what mint-check reads');
  assert.equal(after.commitment, before.commitment, 'tomorrow is unchanged');
  await r.voidIt(DATE, 'and again');
  const third = await r.daily();
  assert.equal(third.seed, mintReissue(SECRET, DATE, 2));
  assert.equal(third.voided![0].seed, before.seed, 'the first stays first');
  await r.close();
});

test('a closed day: what it earned is taken back, and its second close counts instead', async () => {
  const r = await rig();
  const ann = r.person('a', 'Ann');
  const sam = r.person('b', 'Sam');
  const first = await r.daily();
  await r.send(ann.token, first.seed);
  r.tick(3 * DAY);
  await r.daily(); // the freeze is noticed
  assert.equal(r.community.trophiesOf(ann.id)['medal-gold'], 1);
  assert.equal(r.community.divisionsOf(ann.id).length, 1);
  const inbox = () => r.community.inbox(ann.id).items.filter((i) => i.kind === 'division').length;
  assert.equal(inbox(), 1);
  r.community.addActivity(ann.id, 'run', { hash: 'h', seed: first.seed, score: 1 });

  assert.equal((await r.voidIt()).status, 200);
  assert.deepEqual(r.community.trophiesOf(ann.id), {}, 'the medal is gone');
  assert.deepEqual(r.community.divisionsOf(ann.id), []);
  assert.equal(inbox(), 0);
  assert.equal(r.community.feed([ann.id]).length, 0);

  const again = await r.daily();
  assert.equal(again.final ?? false, false, 'open again');
  assert.equal((await r.send(sam.token, again.seed)).status, 200);
  r.tick(3 * DAY);
  await r.daily();
  assert.equal(r.community.trophiesOf(sam.id)['medal-gold'], 1, 'the new day closes like any other');
  assert.deepEqual(r.community.trophiesOf(ann.id), {});
  await r.close();
});

test('only the owner, with a reason, on a day that exists', async () => {
  const r = await rig();
  const lou = r.person('c', 'Lou');
  r.community.setTrusted(lou.id, true);
  assert.equal((await r.call('POST', '/moderation/void', { date: DATE, reason: 'x' })).status, 401);
  assert.equal((await r.voidIt(DATE, 'x', lou.token)).status, 403, 'a trusted player will not do');
  assert.equal((await r.voidIt('nonsense')).status, 422);
  assert.equal((await r.voidIt(DATE, '   ')).status, 422);
  assert.equal((await r.voidIt('2030-01-01')).status, 404, 'never issued');
  await r.daily();
  r.tick(40 * DAY);
  await r.daily();
  r.verifier.splitCold(r.now());
  const cold = await r.voidIt();
  assert.equal(cold.status, 404);
  assert.match(String(cold.json.error), /cold storage stays as it closed/);
  await r.close();
});

test('forgetting a player reaches the kept file, and their export shows it', async () => {
  const r = await rig();
  const ann = r.person('a', 'Ann');
  const sam = r.person('b', 'Sam');
  const day = await r.daily();
  await r.send(ann.token, day.seed, 0);
  await r.send(sam.token, day.seed, 1);
  await r.voidIt();
  const data = (await r.call('GET', '/me/export', undefined, { Authorization: `Bearer ${ann.token}` })).json as unknown as {
    entries: { replayHash: string; seed: string }[];
  };
  assert.ok(
    data.entries.some((e) => e.seed === day.seed),
    'the voided game is in the export',
  );
  assert.equal((await r.call('DELETE', '/me', undefined, { Authorization: `Bearer ${ann.token}` })).status, 200);
  const kept = fs.readFileSync(path.join(r.dir, 'voided', `${DATE}-1.json`), 'utf8');
  assert.ok(!kept.includes(ann.id), 'her id is gone from the file');
  assert.ok(!kept.includes('Ann#'), 'and her name');
  assert.ok(kept.includes(sam.id), 'the other game stays');
  const parsed = JSON.parse(kept) as { replays: Record<string, unknown>; entries: unknown[] };
  assert.equal(Object.keys(parsed.replays).length, 1, 'her recording is gone');
  assert.equal(parsed.entries.length, 2, 'her entry stays, as deleted, like any other');
  await r.close();
});

test('the tool asks first, then voids a fixture day; mint-check reads the chain', async () => {
  const r = await rig();
  const ann = r.person('a', 'Ann');
  const day = await r.daily();
  await r.send(ann.token, day.seed);
  const run = (...args: string[]) =>
    new Promise<{ status: number | null; out: string }>((done) => {
      const child = spawn(process.execPath, ['--import', 'tsx', path.join(ROOT, 'tools/void-day.ts'), ...args], { cwd: ROOT });
      let out = '';
      child.stdout.on('data', (c) => (out += c));
      child.stderr.on('data', (c) => (out += c));
      child.on('close', (status) => done({ status, out }));
    });
  const dry = await run(r.base, DATE, '--reason', 'a bug', '--token', 'tok');
  assert.equal(dry.status, 0, dry.out);
  assert.match(dry.out, /would void 2030-03-12/);
  assert.equal((await r.daily()).seed, day.seed, 'nothing happened');
  const done = await run(r.base, DATE, '--reason', 'a bug', '--token', 'tok', '--yes');
  assert.equal(done.status, 0, done.out);
  assert.match(done.out, /voided 2030-03-12: 1 games kept aside, re-issued as daily-2030-03-12-/);
  assert.notEqual((await r.daily()).seed, day.seed);
  const refused = await run(r.base, DATE, '--reason', 'a bug', '--token', 'wrong', '--yes');
  assert.equal(refused.status, 1, refused.out);
  assert.equal(spawnSync(process.execPath, ['--import', 'tsx', path.join(ROOT, 'tools/void-day.ts')], { cwd: ROOT }).status, 2);
  const check = await new Promise<{ status: number | null; out: string }>((done) => {
    const child = spawn(
      process.execPath,
      ['--import', 'tsx', path.join(ROOT, 'tools/mint-check.ts'), r.base, '--date', DATE, '--week', '2030-W09', '--secret', SECRET],
      { cwd: ROOT },
    );
    let out = '';
    child.stdout.on('data', (c) => (out += c));
    child.stderr.on('data', (c) => (out += c));
    child.on('close', (status) => done({ status, out }));
  });
  assert.equal(check.status, 0, check.out);
  assert.match(check.out, /NOTE 2030-03-12: voided 1 time\(s\) and re-issued as daily-2030-03-12-/);
  await r.close();
});
