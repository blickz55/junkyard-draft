// Production roadmap 0.11.1: email sign-in, with a stand-in for the mail service. The full flow, a second device restoring the
// identity, single use and expiry, the device that opens the link is the one that signs in, no way to test who plays here, the
// limits, signing out, and DELETE /me taking the hash, the copy and the devices. The merge that keeps nothing a device earned.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { CommunityStore } from '../server/community';
import {
  LINK_PER_ADDRESS,
  LINK_PER_PLAYER,
  LINK_TTL_MS,
  MAX_SYNC_BYTES,
  MailError,
  emailHash,
  linkTokenHash,
  linkUrl,
  normaliseEmail,
  resendMailer,
  signInMail,
  type Mail,
} from '../server/link';
import { createServer, playerIdFromToken, Verifier } from '../server/verify';
import { apply, newRun } from '../game/src/sim/run';
import { encodeReplay, exportReplay } from '../game/src/sim/replay';
import { RULES } from '../game/src/sim/rules';
import { mergeSync, sameProgress } from '../game/src/render/sync';
import type { SyncData } from '../game/src/render/storage';

const tokens = { a: 'a'.repeat(32), b: 'b'.repeat(32), c: 'c'.repeat(32) };
const finished = (seed: string, pick = 0) => {
  const s = newRun(seed);
  for (let r = 1; r <= RULES.rounds; r++) {
    apply(s, { t: 'pick', i: Math.min(pick, s.offers.length - 1) });
    apply(s, { t: 'run' });
    apply(s, { t: 'next' });
  }
  return s;
};

/** A verifier with the store and a mailbox that keeps what would have gone out. */
async function rig(o: { mailer?: boolean; failMail?: boolean } = {}) {
  let now = Date.parse('2030-03-12T10:00:00Z');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jd-link-'));
  const verifier = new Verifier(path.join(dir, 'board.json'), { dailySecret: 'fixture-secret' });
  const community = new CommunityStore(path.join(dir, 'community.db'), { now: () => now });
  const mails: Mail[] = [];
  const mailer = async (m: Mail) => {
    if (o.failMail) throw new MailError('down');
    mails.push(m);
  };
  const server = createServer(verifier, { log: null, community, now: () => now, mailer: o.mailer === false ? null : mailer, siteUrl: 'https://game.example' });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const call = async (method: string, p: string, token: string | null, body?: unknown) => {
    const res = await fetch(`${base}${p}`, {
      method,
      headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
    });
    return { status: res.status, json: (await res.json()) as Record<string, unknown> };
  };
  /** The link token inside the last mail. */
  const lastToken = () => /#link=([\w-]+)/.exec(mails[mails.length - 1].text)![1];
  const ask = (token: string, email: string) => call('POST', '/link/start', token, { email });
  const open = (token: string, link: string) => call('POST', '/link/verify', token, { token: link });
  const close = async () => {
    server.closeAllConnections();
    await new Promise<void>((r) => server.close(() => r()));
    community.close();
  };
  return { verifier, community, mails, call, ask, open, lastToken, close, tick: (ms: number) => (now += ms), base };
}

test('addresses: trimmed and lowercased for the hash, and what is not an address is refused', () => {
  assert.equal(normaliseEmail('  Sam@Example.COM '), 'sam@example.com');
  for (const bad of [
    '',
    'sam',
    'sam@',
    '@example.com',
    'sam@example',
    'a b@example.com',
    'sam@exa mple.com',
    'sam@example..com',
    7,
    null,
    `${'x'.repeat(250)}@example.com`,
  ])
    assert.equal(normaliseEmail(bad), null, String(bad));
  assert.equal(emailHash('sam@example.com').length, 64);
  assert.equal(linkUrl('https://game.example/', 'tok'), 'https://game.example/#link=tok');
  const mail = signInMail('sam@example.com', 'https://game.example/#link=tok', 'key');
  assert.match(mail.text, /https:\/\/game\.example\/#link=tok/);
  assert.match(mail.html, /href="https:\/\/game\.example\/#link=tok"/);
  assert.match(mail.text, /15 minutes/);
  assert.match(mail.text, /ignore this email/);
});

test('the Resend request: one HTTPS POST with the key, the address, both bodies and the idempotency key; a refusal or no answer is a MailError', async () => {
  const seen: { headers: http.IncomingHttpHeaders; body: Record<string, unknown>; url?: string }[] = [];
  let status = 200;
  const stub = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      seen.push({ headers: req.headers, body: JSON.parse(body) as Record<string, unknown>, url: req.url });
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ id: 'x', echo: 'sam@example.com' }));
    });
  });
  await new Promise<void>((r) => stub.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${(stub.address() as AddressInfo).port}/emails`;
  const send = resendMailer({ apiKey: 're_test', from: 'Junkyard Draft <sign-in@send.example>', replyTo: 'contact@example', url });
  try {
    await send(signInMail('sam@example.com', 'https://game.example/#link=tok', 'idem'));
    const r = seen[0];
    assert.equal(r.url, '/emails');
    assert.equal(r.headers.authorization, 'Bearer re_test');
    assert.equal(r.headers['idempotency-key'], 'idem');
    assert.ok(r.headers['user-agent']);
    assert.deepEqual(r.body.to, ['sam@example.com']);
    assert.equal(r.body.from, 'Junkyard Draft <sign-in@send.example>');
    assert.equal(r.body.reply_to, 'contact@example');
    assert.match(String(r.body.subject), /sign-in link/);
    assert.ok(r.body.text && r.body.html);
    status = 422;
    await assert.rejects(
      send(signInMail('sam@example.com', 'u', 'k')),
      (e: Error) => e instanceof MailError && e.message === 'the mail service answered 422',
      'the status and not the body, which can echo the address',
    );
  } finally {
    stub.closeAllConnections();
    await new Promise<void>((r) => stub.close(() => r()));
  }
  await assert.rejects(resendMailer({ apiKey: 'k', from: 'f', url, timeoutMs: 500 })(signInMail('s@e.co', 'u', 'k')), MailError);
});

test('the full flow: a link binds the address, a second device becomes the same player, its games count for that player, and the copy travels', async () => {
  const r = await rig();
  try {
    const first = playerIdFromToken(tokens.a)!;
    assert.ok(r.verifier.claim(first, 'Sam', new Date()).ok);
    assert.deepEqual(await r.ask(tokens.a, ' Sam@Example.com '), { status: 200, json: { ok: true } });
    assert.equal(r.mails.length, 1);
    assert.equal(r.mails[0].to, 'sam@example.com');
    const stored = JSON.stringify(
      (r.community as unknown as { db: { prepare(s: string): { all(): unknown[] } } }).db.prepare('SELECT * FROM email_links').all(),
    );
    assert.ok(!stored.includes('sam@') && !stored.includes(r.lastToken()), 'only hashes are stored');
    assert.ok(stored.includes(linkTokenHash(r.lastToken())));
    const linked = await r.open(tokens.a, r.lastToken());
    assert.equal(linked.status, 200);
    assert.deepEqual(
      { joined: linked.json.joined, playerId: linked.json.playerId, name: linked.json.name, blob: linked.json.blob },
      { joined: false, playerId: first, name: 'Sam', blob: null },
    );
    assert.equal(r.community.playerByEmail(emailHash('sam@example.com')), first);
    // the copy goes up from the first device
    const blob = { bests: { runs: 3 } };
    assert.deepEqual((await r.call('POST', '/me/sync', tokens.a, { blob })).json, { ok: true });
    assert.deepEqual((await r.call('GET', '/me/sync', tokens.a)).json, { ok: true, blob });
    // a second device, with its own key
    const second = playerIdFromToken(tokens.b)!;
    assert.ok(r.verifier.submit(encodeReplay(exportReplay(finished('old-yard'))), 'x', second, new Date()).recorded);
    await r.ask(tokens.b, 'sam@example.com');
    const joined = await r.open(tokens.b, r.lastToken());
    assert.deepEqual(
      { joined: joined.json.joined, playerId: joined.json.playerId, name: joined.json.name, blob: joined.json.blob },
      { joined: true, playerId: first, name: 'Sam', blob },
    );
    assert.deepEqual(r.community.deviceKeysOf(first), [second]);
    // from now on the second device's key is the first player everywhere
    assert.equal((await r.call('GET', '/identity', tokens.b)).json.name, 'Sam');
    const replay = exportReplay(finished('shared-yard'));
    assert.equal((await r.call('POST', '/verify', tokens.b, { replay })).status, 200);
    assert.equal(r.verifier.board('shared-yard', 1)[0].player.startsWith('Sam#'), true);
    assert.equal(r.verifier.ownerOf(r.verifier.board('shared-yard', 1)[0].replayHash), first);
    assert.deepEqual((await r.call('GET', '/me/sync', tokens.b)).json, { ok: true, blob });
    // opening a fresh link on a device already in is fine and changes nothing
    await r.ask(tokens.b, 'sam@example.com');
    assert.equal((await r.open(tokens.b, r.lastToken())).json.joined, false);
    assert.deepEqual(r.community.deviceKeysOf(first), [second]);
  } finally {
    await r.close();
  }
});

test('a link works once and for fifteen minutes; a made-up one does nothing', async () => {
  const r = await rig();
  try {
    await r.ask(tokens.a, 'sam@example.com');
    const link = r.lastToken();
    assert.equal((await r.open(tokens.a, link)).status, 200);
    const again = await r.open(tokens.b, link);
    assert.deepEqual([again.status, again.json.code], [410, 'link-gone']);
    assert.equal((await r.open(tokens.a, 'made-up-token-of-a-decent-length')).status, 410);
    assert.equal((await r.call('POST', '/link/verify', tokens.a, {})).status, 410, 'no token at all');
    await r.ask(tokens.b, 'late@example.com');
    r.tick(LINK_TTL_MS + 1);
    assert.equal((await r.open(tokens.b, r.lastToken())).status, 410);
    assert.equal(r.community.playerByEmail(emailHash('late@example.com')), null);
    await r.ask(tokens.b, 'late@example.com');
    r.tick(LINK_TTL_MS - 1);
    assert.equal((await r.open(tokens.b, r.lastToken())).status, 200, 'just inside the window');
  } finally {
    await r.close();
  }
});

test("the device that opens the link signs in, never the one that asked: typing someone else's address gains nothing", async () => {
  const r = await rig();
  try {
    const victim = playerIdFromToken(tokens.a)!;
    await r.ask(tokens.a, 'victim@example.com');
    await r.open(tokens.a, r.lastToken());
    const stranger = playerIdFromToken(tokens.b)!;
    await r.ask(tokens.b, 'victim@example.com'); // the stranger asks; the victim gets the mail and, say, opens it
    await r.open(tokens.a, r.lastToken());
    assert.equal(r.community.playerOfKey(stranger), null, "the stranger's device is still only itself");
    assert.equal((await r.call('GET', '/me/sync', tokens.b)).status, 403);
    assert.equal(r.community.playerByEmail(emailHash('victim@example.com')), victim);
  } finally {
    await r.close();
  }
});

test('nobody can test who plays here: a known and an unknown address get the same answer', async () => {
  const r = await rig();
  try {
    await r.ask(tokens.a, 'known@example.com');
    await r.open(tokens.a, r.lastToken());
    const known = await r.ask(tokens.b, 'known@example.com');
    const unknown = await r.ask(tokens.b, 'nobody@example.com');
    assert.deepEqual(known, unknown);
    assert.equal(r.mails[r.mails.length - 1].subject, r.mails[r.mails.length - 2].subject);
  } finally {
    await r.close();
  }
});

test('the limits: per address, per player and per network address, and they reset within the hour', async () => {
  const r = await rig();
  try {
    for (let i = 0; i < LINK_PER_ADDRESS; i++) assert.equal((await r.ask(i ? tokens.b : tokens.a, 'flood@example.com')).status, 200);
    const third = await r.ask(tokens.c, 'flood@example.com');
    assert.deepEqual([third.status, third.json.code], [429, 'rate-limited']);
    assert.equal(r.mails.length, LINK_PER_ADDRESS, 'an address cannot be flooded through us');
    r.tick(3_600_001);
    for (let i = 0; i < LINK_PER_PLAYER; i++) assert.equal((await r.ask(tokens.a, `p${i}@example.com`)).status, 200);
    assert.equal((await r.ask(tokens.a, 'one-more@example.com')).status, 429, 'one device cannot spray addresses');
    for (let i = 0; i < 5; i++) await r.ask(tokens.b, `q${i}@example.com`);
    assert.equal((await r.ask(tokens.c, 'ip@example.com')).status, 429, 'nor can one network address');
  } finally {
    await r.close();
  }
});

test('refusals: no key, not an address, bad bodies, an address taken on this device, a copy too large, the wrong method', async () => {
  const r = await rig();
  try {
    assert.equal((await r.call('POST', '/link/start', null, { email: 'sam@example.com' })).status, 401);
    assert.equal((await r.call('GET', '/me/sync', null)).status, 401);
    assert.deepEqual(((x) => [x.status, x.json.code])(await r.ask(tokens.a, 'nope')), [422, 'bad-email']);
    assert.equal((await r.call('POST', '/link/verify', tokens.a, 'not json')).status, 400);
    assert.equal((await r.call('PUT' as string, '/link/start', tokens.a, {})).status, 405);
    assert.deepEqual(((x) => [x.status, x.json.code])(await r.call('GET', '/me/sync', tokens.a)), [403, 'not-linked']);
    assert.equal((await r.call('POST', '/me/sync', tokens.a, { blob: {} })).status, 403);
    assert.equal((await r.call('POST', '/link/unlink', tokens.a, {})).status, 403);
    await r.ask(tokens.a, 'one@example.com');
    await r.open(tokens.a, r.lastToken());
    await r.ask(tokens.a, 'two@example.com');
    const other = await r.open(tokens.a, r.lastToken());
    assert.deepEqual([other.status, other.json.code], [409, 'linked-elsewhere']);
    assert.equal(r.community.emailOf(playerIdFromToken(tokens.a)!), emailHash('one@example.com'));
    const big = await r.call('POST', '/me/sync', tokens.a, { blob: 'x'.repeat(MAX_SYNC_BYTES) }).catch(() => null);
    assert.ok(!big || big.status === 413);
  } finally {
    await r.close();
  }
});

test('the mail service down: says so and signs nobody in; no key: the routes say off and /health knows', async () => {
  const down = await rig({ failMail: true });
  try {
    assert.deepEqual(((x) => [x.status, x.json.code])(await down.ask(tokens.a, 'sam@example.com')), [502, 'mail-failed']);
    assert.equal(((await (await fetch(`${down.base}/health`)).json()) as { email: boolean }).email, true);
  } finally {
    await down.close();
  }
  const off = await rig({ mailer: false });
  try {
    assert.deepEqual(((x) => [x.status, x.json.code])(await off.ask(tokens.a, 'sam@example.com')), [503, 'email-off']);
    assert.equal(((await (await fetch(`${off.base}/health`)).json()) as { email: boolean }).email, false);
  } finally {
    await off.close();
  }
});

test('signing out forgets the address and the copy; the device asking stays the player, the others go back to being themselves', async () => {
  const r = await rig();
  try {
    const first = playerIdFromToken(tokens.a)!,
      second = playerIdFromToken(tokens.b)!,
      third = playerIdFromToken(tokens.c)!;
    await r.ask(tokens.a, 'sam@example.com');
    await r.open(tokens.a, r.lastToken());
    await r.call('POST', '/me/sync', tokens.a, { blob: { bests: 1 } });
    await r.ask(tokens.b, 'sam@example.com');
    await r.open(tokens.b, r.lastToken());
    await r.ask(tokens.c, 'sam@example.com');
    await r.open(tokens.c, r.lastToken());
    assert.deepEqual((await r.call('POST', '/link/unlink', tokens.b, {})).json, { ok: true });
    assert.equal(r.community.playerByEmail(emailHash('sam@example.com')), null);
    assert.equal(r.community.syncBlob(first), null);
    assert.deepEqual(r.community.deviceKeysOf(first), [second], 'the device that asked stays');
    assert.equal(r.community.playerOfKey(third), null);
    assert.equal((await r.call('GET', '/me/sync', tokens.c)).status, 403);
    // and the address can start again, on any device
    r.tick(3_600_001);
    await r.ask(tokens.c, 'sam@example.com');
    assert.equal((await r.open(tokens.c, r.lastToken())).json.playerId, third);
  } finally {
    await r.close();
  }
});

test('DELETE /me takes the hash, the copy, the devices and what those devices had on the boards; the export shows them first', async () => {
  const r = await rig();
  try {
    const first = playerIdFromToken(tokens.a)!,
      second = playerIdFromToken(tokens.b)!;
    assert.ok(r.verifier.claim(second, 'Phone', new Date()).ok);
    assert.ok(r.verifier.submit(encodeReplay(exportReplay(finished('phone-yard'))), 'x', second, new Date()).recorded);
    await r.ask(tokens.a, 'sam@example.com');
    await r.open(tokens.a, r.lastToken());
    await r.call('POST', '/me/sync', tokens.a, { blob: { bests: 1 } });
    await r.ask(tokens.b, 'sam@example.com');
    await r.open(tokens.b, r.lastToken());
    const exported = (await r.call('GET', '/me/export', tokens.b)).json as {
      playerId: string;
      earlierDevices: { entries: unknown[]; player: { name: string } }[];
      community: { accounts: { email_hash: string }[] };
    };
    assert.equal(exported.playerId, first);
    assert.equal(exported.community.accounts[0].email_hash, emailHash('sam@example.com'));
    assert.equal(exported.earlierDevices.length, 1);
    assert.equal(exported.earlierDevices[0].entries.length, 1);
    assert.equal(exported.earlierDevices[0].player.name, 'Phone');
    assert.ok(!JSON.stringify(exported).includes(tokens.b), 'never a key');
    const gone = await r.call('DELETE', '/me', tokens.b);
    assert.equal(gone.status, 200);
    assert.equal(gone.json.anonymisedEntries, 1, "the phone's game went with the player");
    assert.equal(r.community.playerByEmail(emailHash('sam@example.com')), null);
    assert.equal(r.community.syncBlob(first), null);
    assert.deepEqual(r.community.deviceKeysOf(first), []);
    assert.equal(r.community.playerOfKey(second), null);
    assert.equal(r.verifier.board('phone-yard', 1)[0].player, 'deleted');
  } finally {
    await r.close();
  }
});

const empty = (over: Partial<SyncData> = {}): SyncData => ({
  settings: {},
  bests: { overall: null, bySeed: {}, runs: 0 },
  stars: {},
  days: [],
  dailies: [],
  medals: [],
  standings: [],
  watched: [],
  kinds: {},
  ...over,
});

test('merging two devices keeps everything either earned, in either order, and meeting again changes nothing', () => {
  const phone = empty({
    settings: { volume: 0.2 },
    bests: {
      overall: { score: 500, seed: 'a', at: '2030-01-01' },
      bySeed: { a: { score: 500, at: '2030-01-01' }, b: { score: 100, at: '2030-01-02' } },
      runs: 7,
    },
    stars: { a: 3, b: 1 },
    days: ['2030-01-01', '2030-01-02'],
    dailies: ['2030-01-01'],
    medals: [{ seed: 'a', medal: 'bronze', score: 500, at: '2030-01-01' }],
    standings: [{ seed: 'a', at: '2030-01-01', score: 500, percentile: 40, n: 10, rank: 6 }],
    kinds: { crusher: 4, press: 1 },
  });
  const desk = empty({
    settings: { volume: 0.9 },
    bests: {
      overall: { score: 700, seed: 'b', at: '2030-01-03' },
      bySeed: { b: { score: 700, at: '2030-01-03' }, c: { score: 50, at: '2030-01-03' } },
      runs: 5,
    },
    stars: { b: 2, c: 1 },
    days: ['2030-01-02', '2030-01-03'],
    dailies: ['2030-01-03'],
    medals: [{ seed: 'a', medal: 'silver', score: 600, at: '2030-01-05' }],
    standings: [{ seed: 'a', at: '2030-01-04', score: 600, percentile: 70, n: 12, rank: 4 }],
    kinds: { crusher: 2, furnace: 3 },
  });
  const m = mergeSync(phone, desk);
  assert.equal(m.settings.volume, 0.2, "this device's settings stay when merging progress");
  assert.equal(m.bests.overall?.score, 700);
  assert.deepEqual(Object.fromEntries(Object.entries(m.bests.bySeed).map(([k, v]) => [k, v.score])), { a: 500, b: 700, c: 50 });
  assert.equal(m.bests.runs, 7);
  assert.deepEqual(m.stars, { a: 3, b: 2, c: 1 });
  assert.deepEqual(m.days, ['2030-01-01', '2030-01-02', '2030-01-03']);
  assert.deepEqual(m.dailies, ['2030-01-01', '2030-01-03']);
  assert.equal(m.medals[0].medal, 'silver', 'the newer word on a yard wins');
  assert.equal(m.standings[0].rank, 4);
  assert.deepEqual(m.kinds, { crusher: 4, press: 1, furnace: 3 }, 'the higher side: adding would count a game twice at every meeting');
  assert.ok(sameProgress(m, mergeSync(desk, phone)), 'either order');
  assert.ok(sameProgress(m, mergeSync(m, desk)), 'meeting again changes nothing');
  assert.ok(!sameProgress(m, phone));
  assert.equal(mergeSync(empty(), desk).bests.overall?.score, 700);
  assert.equal(mergeSync(desk, empty()).bests.overall?.score, 700);
});
