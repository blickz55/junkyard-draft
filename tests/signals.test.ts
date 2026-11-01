// Production roadmap 0.12.5: anomaly signals. A game on a day or a week leaves a line saying when it came and how many tries that was; the same game
// from someone else is noted, not refused twice over; old lines go; a player's lines go with them; and the review names a planted outlier without
// doing anything to anyone.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { CommunityStore, SIGNAL_DAYS, type SignalRow } from '../server/community';
import { MANY_TRIES, reviewSignals, TOO_SOON_MS } from '../server/review';
import { createServer, playerIdFromToken, Verifier } from '../server/verify';
import { apply, newRun } from '../game/src/sim/run';
import { encodeReplay, exportReplay } from '../game/src/sim/replay';
import { RULES } from '../game/src/sim/rules';

const T0 = Date.parse('2030-03-12T10:00:00Z');
const DAY = 86_400_000;
const ROOT = path.join(import.meta.dirname, '..');

async function rig() {
  let now = T0;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jd-signals-'));
  const verifier = new Verifier(path.join(dir, 'board.json'), { dailySecret: 'fixture-secret', auditFile: null });
  const community = new CommunityStore(path.join(dir, 'community.db'), { now: () => now });
  const srv = createServer(verifier, { log: null, community, now: () => now, playerRateLimit: 1000 });
  await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${(srv.address() as AddressInfo).port}`;
  const call = async (method: string, p: string, bearer: string, body?: unknown) => {
    const res = await fetch(`${base}${p}`, {
      method,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${bearer}` },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: res.status, json: (await res.json()) as Record<string, unknown> };
  };
  const person = (letter: string, name: string) => {
    const token = letter.repeat(32);
    const id = playerIdFromToken(token)!;
    verifier.claim(id, name, new Date(now));
    return { token, id };
  };
  const play = (token: string, seed: string, pick = 0) => {
    const s = newRun(seed);
    for (let r = 1; r <= RULES.rounds; r++) {
      apply(s, { t: 'pick', i: (pick >> (r - 1)) & 1 });
      apply(s, { t: 'run' });
      apply(s, { t: 'next' });
    }
    return call('POST', '/verify', token, { replay: JSON.parse(encodeReplay(exportReplay(s, 'test'))) });
  };
  return {
    dir,
    call,
    community,
    verifier,
    person,
    play,
    today: verifier.periodRecord('2030-03-12', new Date(now))!.seed,
    tick: (ms: number) => (now += ms),
    close: async () => {
      await new Promise((r) => srv.close(r));
      community.close();
    },
  };
}

test('a game on a day leaves a line: when it came, and how many tries that was', async () => {
  const r = await rig();
  const ann = r.person('a', 'Ann');
  r.tick(10 * 60_000);
  await r.play(ann.token, r.today, 0);
  r.tick(60_000);
  await r.play(ann.token, r.today, 1);
  await r.play(ann.token, 'yard-a', 0);
  const rows = r.community.signals();
  assert.equal(rows.length, 2, 'a practice yard leaves none');
  assert.deepEqual(
    rows.map((s) => [s.playerId, s.seed, s.tries, s.collisionId]),
    [
      [ann.id, r.today, 1, null],
      [ann.id, r.today, 2, null],
    ],
  );
  assert.equal(rows[0].sinceOpenMs, 10 * 60_000, 'from the first issue of the yard');
  assert.equal(rows[1].sinceOpenMs, 11 * 60_000);
  await r.close();
});

test('the same game from someone else is noted, and a player repeating their own is not a collision', async () => {
  const r = await rig();
  const ann = r.person('a', 'Ann');
  const sam = r.person('b', 'Sam');
  assert.equal((await r.play(ann.token, r.today)).status, 200);
  assert.equal((await r.play(ann.token, r.today)).status, 422, 'the same game again');
  const copied = await r.play(sam.token, r.today);
  assert.equal(copied.status, 422);
  assert.equal(copied.json.code, 'duplicate');
  const rows = r.community.signals();
  assert.deepEqual(
    rows.map((s) => [s.playerId, s.tries, s.collisionId]),
    [
      [ann.id, 1, null],
      [ann.id, 2, null],
      [sam.id, 1, ann.id],
    ],
  );
  await r.close();
});

test('a late game on a closed day leaves nothing: it was never going on the board', async () => {
  const r = await rig();
  const ann = r.person('a', 'Ann');
  r.tick(3 * DAY);
  assert.equal((await r.play(ann.token, r.today)).status, 200);
  assert.equal(r.community.signals().length, 0);
  await r.close();
});

test('old lines go as new ones come, a player takes theirs with them, and the other side of a collision is cleared', async () => {
  const r = await rig();
  const ann = r.person('a', 'Ann');
  const sam = r.person('b', 'Sam');
  await r.play(ann.token, r.today);
  await r.play(sam.token, r.today);
  const data = (await r.call('GET', '/me/export', sam.token)).json as unknown as { community: { signals: { collision_id?: unknown }[] } };
  assert.equal(data.community.signals.length, 1, 'in their export');
  assert.equal(data.community.signals[0].collision_id, r.community.signals()[1].collisionId === null ? null : ann.id);

  assert.equal((await r.call('DELETE', '/me', ann.token)).status, 200);
  assert.deepEqual(
    r.community.signals().map((s) => [s.playerId, s.collisionId]),
    [[sam.id, null]],
    'her line gone, and her id off the other',
  );

  r.tick((SIGNAL_DAYS + 1) * DAY);
  r.community.addSignal({ playerId: sam.id, seed: 's', replayHash: 'h', score: 1, sinceOpenMs: null, collisionId: null });
  assert.deepEqual(
    r.community.signals().map((s) => s.seed),
    ['s'],
    'the old one aged out',
  );
  await r.close();
});

const row = (over: Partial<SignalRow>): SignalRow => ({
  playerId: 'p',
  seed: 'yard',
  replayHash: 'h',
  score: 100,
  sinceOpenMs: 3_600_000,
  tries: 1,
  collisionId: null,
  createdAt: 0,
  ...over,
});

test('the review: an ordinary field says nothing', () => {
  const field = Array.from({ length: 40 }, (_, i) => row({ playerId: `p${i}`, replayHash: `h${i}`, score: 100 + i, tries: 1 + (i % 4) }));
  assert.deepEqual(reviewSignals(field), []);
  assert.deepEqual(reviewSignals([]), []);
});

test('the review names each kind of oddity, and only the one who earned the line', () => {
  const field = Array.from({ length: 40 }, (_, i) => row({ playerId: `p${i}`, replayHash: `h${i}`, score: 100 + i }));
  const soon = row({ playerId: 'early', replayHash: 'soon', score: 900, sinceOpenMs: TOO_SOON_MS - 1000 });
  const onTime = row({ playerId: 'fine', replayHash: 'ok', score: 901, sinceOpenMs: TOO_SOON_MS + 1000 });
  const lowAndSoon = row({ playerId: 'lucky', replayHash: 'low', score: 50, sinceOpenMs: 1000 });
  const copy = row({ playerId: 'copier', replayHash: 'same', score: 120, collisionId: 'p0-the-holder' });
  const tries = row({ playerId: 'keen', replayHash: 'lots', score: 130, tries: MANY_TRIES });
  const found = reviewSignals([...field, soon, onTime, lowAndSoon, copy, tries]);
  assert.deepEqual(found.map((f) => [f.kind, f.player]).sort(), [
    ['many-tries', 'keen'],
    ['same-game', 'copier'],
    ['too-soon', 'early'],
  ]);
  assert.match(found.find((f) => f.kind === 'too-soon')!.why, /^a top score 179 s after the yard opened$/);
  assert.match(found.find((f) => f.kind === 'same-game')!.why, /the same game as p0-the-hold/);
});

test('many tries on a yard everyone hammers is not an oddity', () => {
  const field = Array.from({ length: 10 }, (_, i) => row({ playerId: `p${i}`, replayHash: `h${i}`, tries: MANY_TRIES + i }));
  assert.deepEqual(reviewSignals(field), []);
});

test('the tool runs against a data directory and lists the planted outlier, changing nothing', async () => {
  const r = await rig();
  const sam = r.person('b', 'Sam');
  for (let i = 0; i < 30; i++)
    r.community.addSignal({ playerId: `p${i}`, seed: r.today, replayHash: `h${i}`, score: 100 + i, sinceOpenMs: 3_600_000, collisionId: null });
  r.community.addSignal({ playerId: sam.id, seed: r.today, replayHash: 'planted-outlier', score: 9000, sinceOpenMs: 30_000, collisionId: null });
  const before = r.community.signals().length;
  await r.close();
  const report = path.join(r.dir, 'review.json');
  const out = spawnSync(process.execPath, ['--import', 'tsx', path.join(ROOT, 'tools/review.ts'), r.dir, '--json', report], { cwd: ROOT, encoding: 'utf8' });
  assert.equal(out.status, 0, out.stderr);
  assert.match(out.stdout, /^31 signals, 1 to look at$/m);
  assert.match(out.stdout, /too-soon .* planted-outl/);
  const written = JSON.parse(fs.readFileSync(report, 'utf8')) as { signals: number; findings: { hash: string }[] };
  assert.equal(written.findings[0].hash, 'planted-outlier');
  const again = new CommunityStore(path.join(r.dir, 'community.db'));
  assert.equal(again.signals().length, before, 'it changed nothing');
  again.close();
  const usage = spawnSync(process.execPath, ['--import', 'tsx', path.join(ROOT, 'tools/review.ts')], { cwd: ROOT, encoding: 'utf8' });
  assert.equal(usage.status, 2);
});
