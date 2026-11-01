// Production roadmap 0.12.5: Assisted and Human boards. A game a tool played keeps a board of its own and reaches none of what the people's board
// feeds; a player keeps one best on each; a moderator moves a game either way with a logged reason, and a closed day stays final; and a game from a
// production page with the test hooks open tags itself, while a dev build, which the browser tests use, does not.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { CommunityStore } from '../server/community';
import { createServer, playerIdFromToken, Verifier } from '../server/verify';
import { apply, newRun } from '../game/src/sim/run';
import { encodeReplay, exportReplay } from '../game/src/sim/replay';
import { RULES } from '../game/src/sim/rules';
import { originOf } from '../game/src/render/devapi';

const T0 = Date.parse('2030-03-12T10:00:00Z');
const DAY = 86_400_000;

type Row = { player: string; score: number; replayHash: string; origin?: string };

async function rig() {
  let now = T0;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jd-assisted-'));
  const audit = path.join(dir, 'audit.jsonl');
  const verifier = new Verifier(path.join(dir, 'board.json'), { dailySecret: 'fixture-secret', auditFile: audit });
  const community = new CommunityStore(path.join(dir, 'community.db'), { now: () => now });
  const srv = createServer(verifier, { log: null, community, moderationToken: 'tok', now: () => now, playerRateLimit: 1000 });
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
    verifier.claim(id, name, new Date(now));
    return { token, id };
  };
  const play = async (token: string, seed: string, pick: number, origin?: string) => {
    const s = newRun(seed);
    for (let r = 1; r <= RULES.rounds; r++) {
      apply(s, { t: 'pick', i: (pick >> (r - 1)) & 1 });
      apply(s, { t: 'run' });
      apply(s, { t: 'next' });
    }
    const out = await call('POST', '/verify', { replay: JSON.parse(encodeReplay(exportReplay(s, 'test'))), origin }, { Authorization: `Bearer ${token}` });
    assert.equal(out.status, 200, JSON.stringify(out.json));
    return (out.json as unknown as { entry: Row }).entry;
  };
  const board = async (seed: string, assisted = false) =>
    (await call('GET', `/board?seed=${seed}${assisted ? '&assisted=1' : ''}`)).json as unknown as { entries: Row[]; assistedCount: number };
  const move = (hash: string, origin: string, reason = 'looked at the recording') =>
    call('POST', '/moderation/reclassify', { hash, origin, reason }, { 'X-Moderation-Token': 'tok' });
  return {
    audit,
    call,
    community,
    verifier,
    person,
    play,
    board,
    move,
    today: verifier.periodRecord('2030-03-12', new Date(now))!.seed,
    now: () => new Date(now),
    tick: (ms: number) => (now += ms),
    close: async () => {
      await new Promise((r) => srv.close(r));
      community.close();
    },
  };
}

test('a game from a production page with the hooks open tags itself; a dev build and a plain page do not', () => {
  assert.deepEqual(originOf(false, true), { origin: 'tool' });
  assert.deepEqual(originOf(true, true), {}, 'our own browser tests read the main board');
  assert.deepEqual(originOf(false, false), {});
});

test('a tool game stays off the people board and everything it feeds, and is on its own', async () => {
  const r = await rig();
  const ann = r.person('a', 'Ann');
  const bot = r.person('b', 'Bot');
  const human = await r.play(ann.token, r.today, 0);
  const tool = await r.play(bot.token, r.today, 1, 'tool');

  const main = await r.board(r.today);
  assert.deepEqual(
    main.entries.map((e) => e.replayHash),
    [human.replayHash],
  );
  assert.equal(main.assistedCount, 1);
  const side = await r.board(r.today, true);
  assert.deepEqual(
    side.entries.map((e) => e.replayHash),
    [tool.replayHash],
  );
  assert.equal(side.entries[0].origin, 'tool');

  const hist = (await r.call('GET', `/histogram?seed=${r.today}`)).json as unknown as { n: number };
  assert.equal(hist.n, 1, 'not on the chart');
  const daily = (await r.call('GET', '/daily?limit=10')).json as unknown as { entries: Row[] };
  assert.deepEqual(
    daily.entries.map((e) => e.player.split('#')[0]),
    ['Ann'],
  );
  assert.equal(r.community.feed([bot.id]).length, 0, 'not in the feed of friends');
  await r.close();
});

test('a player keeps one best on each board, and one never replaces the other', async () => {
  const r = await rig();
  const ann = r.person('a', 'Ann');
  const human = await r.play(ann.token, 'yard-a', 0);
  const tool = await r.play(ann.token, 'yard-a', 1, 'tool');
  assert.deepEqual(
    (await r.board('yard-a')).entries.map((e) => e.replayHash),
    [human.replayHash],
  );
  assert.deepEqual(
    (await r.board('yard-a', true)).entries.map((e) => e.replayHash),
    [tool.replayHash],
  );
  await r.close();
});

test('anything but the word tool is a person, on their word', async () => {
  const r = await rig();
  const ann = r.person('a', 'Ann');
  const e = await r.play(ann.token, 'yard-a', 0, 'something else');
  assert.equal(e.origin, undefined);
  assert.equal((await r.board('yard-a')).entries.length, 1);
  await r.close();
});

test('a moderator moves a game either way, with a reason on the record', async () => {
  const r = await rig();
  const ann = r.person('a', 'Ann');
  const game = await r.play(ann.token, r.today, 0);
  assert.equal((await r.call('POST', '/moderation/reclassify', { hash: game.replayHash, origin: 'tool', reason: 'x' })).status, 401);
  assert.equal((await r.move(game.replayHash, 'robot')).status, 422);
  assert.equal((await r.move(game.replayHash, 'tool', '  ')).status, 422, 'a reason is required');
  assert.equal((await r.move('f'.repeat(64), 'tool')).status, 404);

  assert.equal((await r.move(game.replayHash, 'tool', 'a script, by the recording')).status, 200);
  assert.equal((await r.board(r.today)).entries.length, 0);
  assert.equal((await r.board(r.today, true)).entries.length, 1);
  assert.equal((await r.move(game.replayHash, 'tool')).status, 200, 'where it is already: nothing to do');
  assert.equal((await r.move(game.replayHash, 'human', 'an appeal, upheld')).status, 200);
  assert.equal((await r.board(r.today)).entries.length, 1);

  const lines = fs
    .readFileSync(r.audit, 'utf8')
    .trim()
    .split('\n')
    .map((l) => JSON.parse(l) as { action: string; to?: string; reason?: string });
  assert.deepEqual(
    lines.filter((l) => l.action === 'reclassify').map((l) => [l.to, l.reason]),
    [
      ['tool', 'a script, by the recording'],
      ['human', 'an appeal, upheld'],
    ],
  );
  await r.close();
});

test('two games on one board for one player is refused, and a closed day is final', async () => {
  const r = await rig();
  const ann = r.person('a', 'Ann');
  const human = await r.play(ann.token, r.today, 0);
  const tool = await r.play(ann.token, r.today, 1, 'tool');
  const clash = await r.move(tool.replayHash, 'human');
  assert.equal(clash.status, 409);
  assert.match(String(clash.json.error), /already has a game on that board/);
  r.tick(3 * DAY);
  const closed = await r.move(human.replayHash, 'tool');
  assert.equal(closed.status, 409);
  assert.match(String(closed.json.error), /final/);
  await r.close();
});
