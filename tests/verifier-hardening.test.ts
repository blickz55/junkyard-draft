// Production roadmap 0.8.1, verifier hardening first cut: one test per item.
import { test } from 'node:test';
import { dropOnLine } from './e2e/line';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import {
  Verifier,
  createServer,
  playerIdFromToken,
  installShutdown,
  hashIp,
  redactPath,
  DEFAULT_REPORT_POLICY,
  DAILY_HISTORY_DAYS,
  DEFAULT_EVENTS_RETENTION_DAYS,
  DEFAULT_READ_RATE_LIMIT,
  DEFAULT_WRITE_RATE_LIMIT,
  DEFAULT_MAX_PLAYERS,
  EventStore,
  HIDDEN_LABEL,
  ParService,
  type ServerOptions,
  type BoardEntry,
} from '../server/verify';
import { checkLogLines } from '../tools/log-check';
import { apply, newRun } from '../game/src/sim/run';
import { encodeReplay, exportReplay } from '../game/src/sim/replay';
import { RULES } from '../game/src/sim/rules';
import { shiftDate, utcDate } from '../server/mint';
import { tagFor } from '../game/src/identity/identity';

function finishedRun(seed: string) {
  const s = newRun(seed);
  for (let r = 1; r <= RULES.rounds; r++) {
    apply(s, { t: 'pick', i: s.offers.indexOf('crusher') >= 0 ? s.offers.indexOf('crusher') : 0 });
    if (r === 1) {
      dropOnLine(s);
    }
    apply(s, { t: 'run' });
    apply(s, { t: 'next' });
  }
  return s;
}
const tmpBoard = (prefix = 'jd-hard-') => path.join(fs.mkdtempSync(path.join(os.tmpdir(), prefix)), 'board.json');
const tok = (c: string) => c.repeat(32);
const pid = (c: string) => playerIdFromToken(tok(c))!;
async function listen(v: Verifier, opts: ServerOptions = {}) {
  const logs: string[] = [];
  const errors: string[] = [];
  const server = createServer(v, { rateLimit: null, log: (l) => logs.push(l), errorLog: (l) => errors.push(l), ...opts });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const call = async (method: string, p: string, headers: Record<string, string> = {}, body?: unknown) => {
    const r = await fetch(`${base}${p}`, {
      method,
      headers: { 'Content-Type': 'application/json', ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: r.status, headers: r.headers, json: (await r.json()) as Record<string, unknown> };
  };
  return {
    server,
    base,
    logs,
    errors,
    call,
    close: () => {
      server.closeAllConnections();
      server.close();
    },
  };
}
const bear = (c: string) => ({ Authorization: `Bearer ${tok(c)}` });

test('0.8.1 per-address limits: identity, group, report and deletion writes share one bucket per address; reads share another; /health is exempt', async () => {
  const v = new Verifier(tmpBoard());
  let t = Date.parse('2030-04-01T10:00:00Z');
  const s = await listen(v, { trustProxy: true, now: () => t, writeRateLimit: 3, readRateLimit: 4 });
  try {
    const from = (ip: string) => ({ 'X-Forwarded-For': ip });
    assert.equal((await s.call('POST', '/identity', { ...bear('a'), ...from('10.0.0.1') }, { name: 'Alpha' })).status, 200);
    assert.equal((await s.call('POST', '/groups', { ...bear('a'), ...from('10.0.0.1') }, { name: 'Crew' })).status, 200);
    assert.equal(
      (await s.call('POST', '/report', { ...bear('a'), ...from('10.0.0.1') }, { playerId: pid('a'), reason: 'spam' })).status,
      422,
      'self-report refused but counted',
    );
    const fourth = await s.call('DELETE', '/me', { ...bear('a'), ...from('10.0.0.1') });
    assert.equal(fourth.status, 429, 'the fourth write from one address in a minute is refused');
    assert.ok(Number(fourth.headers.get('retry-after')) >= 1);
    assert.equal((await s.call('POST', '/identity', { ...bear('b'), ...from('10.0.0.2') }, { name: 'Beta' })).status, 200, 'another address is not affected');
    for (let i = 0; i < 4; i++) assert.equal((await s.call('GET', '/board?seed=x', from('10.0.0.3'))).status, 200);
    assert.equal((await s.call('GET', '/board?seed=x', from('10.0.0.3'))).status, 429, 'the fifth read from one address in a minute is refused');
    assert.equal((await s.call('GET', '/health', from('10.0.0.3'))).status, 200, '/health is never limited');
    t += 61_000;
    assert.equal((await s.call('GET', '/board?seed=x', from('10.0.0.3'))).status, 200, 'the window resets');
    assert.equal((await s.call('DELETE', '/me', { ...bear('a'), ...from('10.0.0.1') })).status, 200);
    assert.equal(DEFAULT_READ_RATE_LIMIT, 300);
    assert.equal(DEFAULT_WRITE_RATE_LIMIT, 30);
    const off = await listen(v, { readRateLimit: null, writeRateLimit: null, now: () => t });
    try {
      for (let i = 0; i < 6; i++) assert.equal((await off.call('GET', '/board?seed=x')).status, 200, 'null disables the read limiter');
    } finally {
      off.close();
    }
  } finally {
    s.close();
  }
});

test('0.8.1 history bound: a daily or weekly older than DAILY_HISTORY_DAYS is never minted on request; the archive and existing records are untouched', async () => {
  const v = new Verifier(tmpBoard(), { dailySecret: 'hist' });
  const now = new Date('2030-06-15T12:00:00Z');
  assert.equal(DAILY_HISTORY_DAYS, 400);
  assert.equal(v.historyStart(now), shiftDate(utcDate(now), -400));
  assert.ok(v.dailyRecord(v.historyStart(now), now), 'the first day of the window is served');
  assert.equal(v.dailyRecord(shiftDate(v.historyStart(now), -1), now), null, 'one day earlier is not');
  assert.equal(v.dailyRecord('2001-01-01', now), null);
  assert.equal(v.weeklyRecord('2020-W10', now), null, 'an old week is not minted');
  assert.ok(v.weeklyRecord('2030-W20', now), 'a recent week is');
  const s = await listen(v, { now: () => now.getTime() });
  try {
    const old = await s.call('GET', '/daily?date=2001-01-01');
    assert.equal(old.status, 403);
    assert.equal(old.json.historyStart, v.historyStart(now));
    assert.match(String(old.json.error), /kept 400 days back/);
    const ok = await s.call('GET', `/daily?date=${shiftDate(utcDate(now), -2)}`);
    assert.equal(ok.status, 200);
    const week = await s.call('GET', '/weekly?week=2020-W10');
    assert.equal(week.status, 403);
    assert.equal(week.json.historyStart, v.historyStart(now));
    const h = await s.call('GET', '/health');
    assert.equal(h.json.historyStart, v.historyStart(now));
  } finally {
    s.close();
  }
  // nothing before the window was written
  const keys = Object.keys(JSON.parse(fs.readFileSync(v['file' as keyof Verifier] as unknown as string, 'utf8')).dailies as Record<string, unknown>);
  assert.ok(
    keys.every((k) => /^\d{4}-W\d{2}$/.test(k) || k >= v.historyStart(now)),
    `only in-window records on disk: ${keys.join(',')}`,
  );
});

test('0.8.1 identity cap: over the cap the oldest never-submitting identities outside every group are evicted; when nothing can be evicted the claim answers 503', async () => {
  const v = new Verifier(tmpBoard(), { maxPlayers: 2 });
  const t0 = new Date('2030-01-01T00:00:00Z'),
    t1 = new Date('2030-01-02T00:00:00Z'),
    t2 = new Date('2030-01-03T00:00:00Z');
  assert.ok(v.claim(pid('a'), 'Oldest', t0).ok && v.claim(pid('b'), 'Second', t1).ok);
  assert.ok(v.claim(pid('c'), 'Third', t2).ok, 'the third claim evicts the oldest idle identity');
  assert.equal(v.player(pid('a')), null);
  assert.ok(v.player(pid('b')) && v.player(pid('c')));
  assert.ok(v.claim(pid('b'), 'Second', t2).ok, 'an existing identity renaming is not a new claim');
  // both remaining players submitted: nothing is evictable
  assert.ok(v.submit(encodeReplay(exportReplay(finishedRun('cap-seed'))), 'x', pid('b'), t2).recorded);
  assert.ok(v.submit(encodeReplay(exportReplay(finishedRun('cap-seed-2'))), 'x', pid('c'), t2).recorded);
  const full = v.claim(pid('d'), 'Fourth', t2);
  assert.equal(full.ok, false);
  if (!full.ok) {
    assert.equal(full.busy, true);
    assert.match(full.error, /too many players/);
  }
  const s = await listen(v, { now: () => t2.getTime() });
  try {
    const r = await s.call('POST', '/identity', bear('d'), { name: 'Fourth' });
    assert.equal(r.status, 503);
    assert.equal(r.headers.get('retry-after'), '60');
  } finally {
    s.close();
  }
  // a group member is never evicted
  const g = new Verifier(tmpBoard(), { maxPlayers: 2 });
  assert.ok(g.claim(pid('a'), 'Member', t0).ok && g.claim(pid('b'), 'Idle', t1).ok);
  assert.ok(g.createGroup(pid('a'), 'Crew', t1).ok);
  assert.ok(g.claim(pid('c'), 'New', t2).ok);
  assert.ok(g.player(pid('a')), 'the group member stays');
  assert.equal(g.player(pid('b')), null, 'the idle one went');
  assert.equal(DEFAULT_MAX_PLAYERS, 20_000);
});

test('0.8.1 request log: one JSON object per request with a request id and a daily-salted address hash; group codes redacted; the id is echoed; the same address hashes alike within a day and differently across days', async () => {
  const v = new Verifier(tmpBoard());
  let t = Date.parse('2030-04-01T10:00:00Z');
  const s = await listen(v, { trustProxy: true, now: () => t });
  try {
    const r1 = await s.call('GET', '/board?seed=x&group=abcdefgh&limit=5', { 'X-Forwarded-For': '203.0.113.9' });
    assert.equal(r1.status, 401);
    const id1 = r1.headers.get('x-request-id')!;
    assert.match(id1, /^[0-9a-f]{8}$/);
    const r2 = await s.call('GET', '/board?seed=x', { 'X-Forwarded-For': '203.0.113.9' });
    t += 86_400_000;
    const r3 = await s.call('GET', '/board?seed=x', { 'X-Forwarded-For': '203.0.113.9' });
    const rows = s.logs.map((l) => JSON.parse(l) as { ts: string; id: string; ip: string; method: string; path: string; status: number; ms: number });
    assert.equal(rows.length, 3);
    assert.deepEqual(Object.keys(rows[0]).sort(), ['id', 'ip', 'method', 'ms', 'path', 'status', 'ts']);
    assert.equal(rows[0].id, id1);
    assert.equal(rows[0].path, '/board?seed=x&group=~&limit=5');
    assert.equal(rows[0].status, 401);
    assert.equal(rows[1].id, r2.headers.get('x-request-id'));
    assert.match(rows[0].ip, /^[0-9a-f]{16}$/);
    assert.equal(rows[0].ip, rows[1].ip, 'one key per client within a day');
    assert.notEqual(rows[1].ip, rows[2].ip, 'unlinkable across days');
    assert.ok(!s.logs.some((l) => l.includes('203.0.113.9') || l.includes('abcdefgh')), 'neither the address nor the code appears');
    assert.equal(r3.status, 200);
    assert.equal(redactPath('/daily?group=zzzzzzzz'), '/daily?group=~');
    assert.equal(redactPath('/board?seed=a&group=zzzzzzzz&limit=2'), '/board?seed=a&group=~&limit=2');
    assert.equal(redactPath('/board?seed=groupies'), '/board?seed=groupies');
    assert.equal(hashIp('salt', '1.2.3.4', new Date('2030-01-01T05:00:00Z')), hashIp('salt', '1.2.3.4', new Date('2030-01-01T23:00:00Z')));
    assert.notEqual(hashIp('salt', '1.2.3.4', new Date('2030-01-01T05:00:00Z')), hashIp('salt', '1.2.3.4', new Date('2030-01-02T05:00:00Z')));
    // tools/log-check.ts accepts this log and rejects a leaked address or code
    assert.deepEqual(checkLogLines([...s.logs, 'replay verifier v0.8 → http://0.0.0.0:4400/  (board: /data/board.json)']).problems, []);
    assert.ok(checkLogLines([JSON.stringify({ ...rows[0], ip: '203.0.113.9' })]).problems.length >= 1, 'a raw address in the ip field is caught');
    assert.equal(checkLogLines([JSON.stringify({ ...rows[0], path: '/board?group=abcdefgh' })]).problems.length, 1, 'a code in the path is caught');
    assert.equal(checkLogLines(['nothing here']).requests, 0);
  } finally {
    s.close();
  }
});

test('0.8.1 a 500 logs its exception with the request id, and the client gets the id back', async () => {
  const v = new Verifier(tmpBoard());
  (v as unknown as { board: () => never }).board = () => {
    throw new TypeError('boom in board');
  };
  const s = await listen(v);
  try {
    const r = await s.call('GET', '/board?seed=x&group=secretcode'); // group needs a bearer: 401 before board() — use a plain board read instead
    assert.equal(r.status, 401);
    const r2 = await s.call('GET', '/board?seed=x');
    assert.equal(r2.status, 500);
    assert.equal(r2.json.requestId, r2.headers.get('x-request-id'));
    assert.equal(s.errors.length, 1);
    const err = JSON.parse(s.errors[0]) as { id: string; path: string; error: string; stack: string[] };
    assert.equal(err.id, r2.headers.get('x-request-id'));
    assert.equal(err.error, 'TypeError: boom in board');
    assert.equal(err.path, '/board?seed=x');
    assert.ok(Array.isArray(err.stack) && err.stack.length > 0);
    assert.equal((await s.call('GET', '/health')).status, 200, 'the server keeps serving');
  } finally {
    s.close();
  }
});

test('0.8.1 timeouts are set and the drain stops accepting, waits for the announcer and exits 0', async () => {
  const v = new Verifier(tmpBoard());
  const server = createServer(v, { rateLimit: null, log: null });
  assert.deepEqual([server.headersTimeout, server.requestTimeout, server.keepAliveTimeout], [15_000, 30_000, 5_000]);
  const custom = createServer(v, { rateLimit: null, log: null, timeouts: { headersMs: 1_000, requestMs: 2_000, keepAliveMs: 500 } });
  assert.deepEqual([custom.headersTimeout, custom.requestTimeout, custom.keepAliveTimeout], [1_000, 2_000, 500]);
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  const port = (server.address() as { port: number }).port;
  assert.equal((await fetch(`http://127.0.0.1:${port}/health`)).status, 200);
  let idled = 0;
  const exits: number[] = [];
  const lines: string[] = [];
  const shutdown = installShutdown(server, {
    announcer: {
      idle: async () => {
        idled++;
      },
    },
    exit: (c) => exits.push(c),
    log: (l) => lines.push(l),
    signals: [],
  });
  await shutdown();
  await shutdown();
  assert.equal(server.listening, false, 'no longer accepting');
  assert.deepEqual(exits, [0]);
  assert.equal(idled, 1, 'queued announcements were awaited once');
  assert.equal((JSON.parse(lines[0]) as { event: string }).event, 'shutdown');
  await assert.rejects(fetch(`http://127.0.0.1:${port}/health`), 'the port is closed');
});

test('0.8.1 /health reports the hot file, the last commit, the identity count, the par queue and limiter cardinalities', async () => {
  const file = tmpBoard();
  const v = new Verifier(file);
  assert.deepEqual(v.health, { hotFileBytes: 0, lastCommitMs: 0, commits: 0, players: 0, coldBytes: 0 });
  assert.ok(v.claim(pid('a'), 'Alpha').ok);
  assert.equal(v.health.commits, 1);
  assert.equal(v.health.players, 1);
  assert.equal(v.health.hotFileBytes, fs.statSync(file).size);
  assert.ok(v.health.lastCommitMs >= 0);
  assert.equal(new Verifier(file).health.hotFileBytes, fs.statSync(file).size, 'a restart reads the size from disk');
  const par = new ParService(
    v,
    () =>
      new Promise(() => {
        /* never resolves: stays busy */
      }),
  );
  const s = await listen(v, { par, trustProxy: true });
  try {
    await s.call('GET', '/board?seed=queued-seed', { 'X-Forwarded-For': '10.1.1.1' });
    const h = (await s.call('GET', '/health')).json as {
      hotFileBytes: number;
      lastCommitMs: number;
      commits: number;
      players: number;
      coldBytes: number;
      par: { busy: string | null; queued: number; failures: number };
      limiters: Record<string, number>;
      log: string;
      historyStart: string;
    };
    assert.equal(h.hotFileBytes, fs.statSync(file).size);
    assert.equal(h.commits, 2, "the claim, then the /board read minting today's daily for the par priority check");
    assert.equal(h.players, 1);
    assert.equal(h.coldBytes, 0);
    assert.equal(h.par.busy, 'queued-seed');
    assert.equal(h.par.queued, 0);
    assert.equal(h.par.failures, 0);
    assert.equal(h.limiters.read, 1, 'one address has read');
    assert.equal(h.limiters.write, 0);
    assert.equal(h.limiters.ip, 0);
    assert.equal(h.limiters.player, 0);
    assert.equal(h.log, 'json');
    assert.match(h.historyStart, /^\d{4}-\d{2}-\d{2}$/);
  } finally {
    s.close();
  }
});

test("0.8.1 report-to-hide: two established reporters are needed, a young reporter does not count, an unconfirmed hide lapses after 72 h, a moderator's confirm makes it stand, clear restores; the policy is configurable", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jd-hard-mod-'));
  const file = path.join(dir, 'board.json');
  const v = new Verifier(file, { dailySecret: 'mod2' });
  assert.deepEqual(v.reportPolicy, DEFAULT_REPORT_POLICY);
  assert.deepEqual(DEFAULT_REPORT_POLICY, { reporters: 2, establishedDays: 7, expiryHours: 72 });
  const t0 = new Date('2030-03-01T10:00:00Z');
  const day = (n: number, h = 10) => new Date(Date.UTC(2030, 2, 1 + n, h));
  const [tgt, old1, old2, young, named] = ['e', 'a', 'b', 'c', 'd'].map(pid); // tokens are hex: letters a–f only
  for (const [id, name] of [
    [tgt, 'Target'],
    [old1, 'Old One'],
    [old2, 'Old Two'],
    [young, 'Young'],
    [named, 'Named'],
  ] as const)
    assert.ok(v.claim(id, name, t0).ok);
  const label = `Target#${tagFor(tgt)}`;
  const sub = (seed: string, who: string, when: Date) => {
    const r = v.submit(encodeReplay(exportReplay(finishedRun(seed))), 'x', who, when);
    assert.ok(r.ok && r.recorded, JSON.stringify(r));
    return r.entry!;
  };
  const e = sub('mod2-seed', tgt, t0);
  sub('old1-seed', old1, t0);
  sub('old2-seed', old2, t0); // established from day 7 on
  const t8 = day(8);
  sub('young-seed', young, t8); // young's entry is new on day 8
  const shown = (when: Date) => v.board('mod2-seed', 20, null, when).find((x) => x.replayHash === e.replayHash)!.player;
  // one established report: recorded, not hidden
  assert.deepEqual(v.report(old1, { hash: e.replayHash }, 'offensive', t8), { ok: true, playerId: tgt, hidden: false, duplicate: false });
  assert.equal(shown(t8), label);
  // a young reporter and a reporter with no entry do not count
  assert.equal((v.report(young, { playerId: tgt }, 'spam', t8) as { hidden: boolean }).hidden, false);
  assert.equal((v.report(named, { playerId: tgt }, 'spam', t8) as { hidden: boolean }).hidden, false);
  assert.equal(shown(t8), label);
  assert.equal(v.reports(t8)[0].reports.filter((r) => r.established).length, 1);
  // the second established reporter hides the name everywhere
  assert.deepEqual(v.report(old2, { playerId: tgt }, 'impersonation', t8), { ok: true, playerId: tgt, hidden: true, duplicate: false });
  assert.equal(shown(t8), HIDDEN_LABEL);
  assert.equal(v.hidden(tgt, t8), true);
  assert.equal(v.entry(e.replayHash, null, t8)!.player, HIDDEN_LABEL);
  assert.equal(v.replay(e.replayHash, t8)!.player, HIDDEN_LABEL);
  const row = v.reports(t8)[0];
  assert.equal(row.hidden, true);
  assert.equal(row.expiresAt, new Date(t8.getTime() + 72 * 3_600_000).toISOString());
  assert.equal(row.confirmedAt, undefined);
  // 72 h later the unconfirmed hide lapses: shown again on every read without a rewrite, the reports stay open for the moderator
  const t11 = new Date(t8.getTime() + 72 * 3_600_000);
  assert.equal(v.hidden(tgt, new Date(t11.getTime() - 1)), true);
  assert.equal(v.hidden(tgt, t11), false);
  assert.equal(shown(t11), label);
  assert.equal(v.entry(e.replayHash, null, t11)!.player, label);
  assert.equal(v.replay(e.replayHash, t11)!.player, label);
  assert.equal(v.reports(t11)[0].hidden, false);
  assert.equal(v.reports(t11)[0].reports.length, 4);
  const again = new Verifier(file, { dailySecret: 'mod2' });
  assert.equal(again.hidden(tgt, t11), false);
  assert.equal(again.hidden(tgt, t8), true, 'the lapse is derived from the clock, so a restart agrees');
  // the moderator confirms: hidden from now, no expiry, until clear or rename
  const c = again.confirmHide(tgt, t11);
  assert.ok(c.ok);
  if (c.ok) assert.equal(c.name, 'Target');
  assert.equal(again.hidden(tgt, new Date(t11.getTime() + 365 * 86_400_000)), true);
  assert.equal(again.reports(t11)[0].expiresAt, null);
  assert.ok(again.reports(t11)[0].confirmedAt);
  assert.equal((again.confirmHide('f'.repeat(64), t11) as { status: number }).status, 404);
  assert.deepEqual(again.clearReports(tgt, t11), { ok: true, playerId: tgt, name: 'Target', clears: 1 });
  assert.equal(again.hidden(tgt, t11), false);
  assert.equal(again.board('mod2-seed', 20, null, t11).find((x) => x.replayHash === e.replayHash)!.player, label);
  // after a lapse a fresh established report hides again (the earlier established reports still stand)
  const v2 = new Verifier(file, { dailySecret: 'mod2' });
  assert.equal((v2.report(old1, { playerId: tgt }, 'spam', t11) as { hidden: boolean }).hidden, false, 'one report after a clear: standing 1 of 2');
  assert.equal((v2.report(old2, { playerId: tgt }, 'spam', t11) as { hidden: boolean }).hidden, true);
  // audit rows name the confirm
  const rows = fs
    .readFileSync(path.join(dir, 'moderation.jsonl'), 'utf8')
    .trim()
    .split('\n')
    .map((l) => JSON.parse(l) as { action: string; by?: string });
  assert.deepEqual(
    rows.map((r) => r.action),
    ['report', 'report', 'report', 'report', 'confirm', 'clear', 'report', 'report'],
  );
  // HTTP: /moderation/confirm, the policy in the list, the player told at the right clock
  const s = await listen(v2, { now: () => t11.getTime(), moderationToken: 'mod' });
  try {
    const mod = { 'X-Moderation-Token': 'mod' };
    const lst = await s.call('GET', '/moderation/reports', mod);
    assert.deepEqual(lst.json.policy, DEFAULT_REPORT_POLICY);
    assert.equal((lst.json.reports as { hidden: boolean }[])[0].hidden, true);
    assert.equal((await s.call('GET', '/identity', bear('e'))).json.hidden, true);
    assert.equal((await s.call('POST', '/moderation/confirm', mod, { playerId: tgt })).status, 200);
    assert.equal((await s.call('POST', '/moderation/confirm', mod, { playerId: 'f'.repeat(64) })).status, 404);
    assert.equal((await s.call('POST', '/moderation/clear', mod, { playerId: tgt })).status, 200);
    assert.equal((await s.call('GET', '/identity', bear('e'))).json.hidden, undefined);
  } finally {
    s.close();
  }
  // configurable: one report from any named player (the 0.7.7 rule, used by the e2e)
  const lax = new Verifier(tmpBoard(), { reportPolicy: { reporters: 1, establishedDays: 0 } });
  assert.ok(lax.claim(pid('1'), 'Ann', t0).ok && lax.claim(pid('2'), 'Bob', t0).ok);
  assert.equal((lax.report(pid('1'), { playerId: pid('2') }, 'spam', t0) as { hidden: boolean }).hidden, true);
  assert.deepEqual(lax.reportPolicy, { reporters: 1, establishedDays: 0, expiryHours: 72 });
});

test("0.8.1 deletion drops the player's kept cold replays and anonymises their cold entries; the index forgets the hashes", () => {
  const file = tmpBoard();
  const v = new Verifier(file, { dailySecret: 'cold-del' });
  const tOld = new Date('2030-01-10T10:00:00Z');
  const tNow = new Date('2030-03-12T10:00:00Z');
  assert.ok(v.claim(pid('a'), 'Gone Soon', tOld).ok && v.claim(pid('b'), 'Stays', tOld).ok);
  const rec = v.dailyRecord('2030-01-10', tOld)!;
  const mine = v.submit(encodeReplay(exportReplay(finishedRun(rec.seed))), 'x', pid('a'), tOld).entry!;
  const other = v.submit(encodeReplay(exportReplay(twist(rec.seed))), 'x', pid('b'), tOld).entry!;
  assert.deepEqual(v.splitCold(tNow).moved, ['2030-01-10']);
  assert.equal(v.cold.dateOfReplay(mine.replayHash), '2030-01-10');
  assert.ok(v.replay(mine.replayHash, tNow));
  const out = v.deletePlayer(pid('a'));
  assert.deepEqual(out, { entries: 0, coldReplays: 1 }, 'no hot entries, one cold replay dropped');
  assert.equal(v.replay(mine.replayHash, tNow), null, 'the cold replay is gone');
  assert.equal(v.cold.dateOfReplay(mine.replayHash), null, 'and the index forgot it');
  assert.ok(v.replay(other.replayHash, tNow), "the other player's replay stays");
  const board = v.board(rec.seed, 20, null, tNow);
  assert.equal(board.length, 2);
  const deleted = board.find((e) => e.replayHash === mine.replayHash)!;
  assert.equal(deleted.player, 'deleted');
  assert.equal(deleted.playerId, undefined);
  assert.equal(deleted.score, mine.score, 'the score stays');
  const onDisk = JSON.parse(fs.readFileSync(path.join(path.dirname(file), 'cold', '2030-01.json'), 'utf8')) as {
    days: Record<string, { entries: BoardEntry[]; replays: Record<string, unknown> }>;
  };
  assert.equal(Object.keys(onDisk.days['2030-01-10'].replays).length, 1);
  assert.ok(onDisk.days['2030-01-10'].entries.every((e) => e.playerId !== pid('a')));
  assert.equal(new Verifier(file, { dailySecret: 'cold-del' }).replay(mine.replayHash, tNow), null, 'a restart agrees');
});
/** a second legal run on the same seed with a different outcome (sells the first offer instead) */
function twist(seed: string) {
  const s = newRun(seed);
  for (let r = 1; r <= RULES.rounds; r++) {
    apply(s, { t: 'pick', i: 0 });
    if (r === 1) {
      const conv = s.layout.machines.find((m) => m.x === 3 && m.y === 2)!;
      apply(s, { t: 'unplace', id: conv.id });
      apply(s, { t: 'place', id: s.bin[0].id, x: 3, y: 2, dir: 0 });
    }
    apply(s, { t: 'run' });
    apply(s, { t: 'next' });
  }
  return s;
}

test('0.8.1 opt-in events keep their address hash 7 days, as the policy page always said', () => {
  assert.equal(DEFAULT_EVENTS_RETENTION_DAYS, 7);
  const store = new EventStore(path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'jd-ev-')), 'events.jsonl'));
  assert.equal(store.retentionDays, 7);
  const now = new Date('2030-04-10T00:00:00Z');
  store.append(
    { installId: 'a'.repeat(32), consent: true, events: [{ name: 'app_start', at: now.toISOString() }] } as unknown as Parameters<EventStore['append']>[0],
    '10.0.0.1',
    new Date(now.getTime() - 8 * 86_400_000),
  );
  store.append(
    { installId: 'b'.repeat(32), consent: true, events: [{ name: 'app_start', at: now.toISOString() }] } as unknown as Parameters<EventStore['append']>[0],
    '10.0.0.1',
    new Date(now.getTime() - 6 * 86_400_000),
  );
  assert.equal(store.prune(now), 1);
  assert.equal(store.rows().length, 1);
});

test('0.8.1 hidden labels resolve at read time: a board read with a clock past the expiry shows the name without any write', () => {
  const v = new Verifier(tmpBoard(), { reportPolicy: { reporters: 1, establishedDays: 0, expiryHours: 1 } });
  const t0 = new Date('2030-05-01T00:00:00Z');
  assert.ok(v.claim(pid('a'), 'Rep', t0).ok && v.claim(pid('b'), 'Tgt', t0).ok);
  const e = v.submit(encodeReplay(exportReplay(finishedRun('rt-seed'))), 'x', pid('b'), t0).entry!;
  assert.equal((v.report(pid('a'), { hash: e.replayHash }, 'spam', t0) as { hidden: boolean }).hidden, true);
  const commits = v.health.commits;
  assert.equal(v.board('rt-seed', 20, null, t0)[0].player, HIDDEN_LABEL);
  assert.equal(v.board('rt-seed', 20, null, new Date(t0.getTime() + 3_600_000))[0].player, `Tgt#${tagFor(pid('b'))}`);
  assert.equal(v.histogram('rt-seed', e.replayHash, null, new Date(t0.getTime() + 3_600_000)).around[0].player, `Tgt#${tagFor(pid('b'))}`);
  assert.equal(v.health.commits, commits, 'reading never writes');
});

// keep the http import used for the type of a server in installShutdown's contract
void http;
