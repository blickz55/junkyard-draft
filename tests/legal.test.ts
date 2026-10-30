// Production roadmap 0.8.6, the legal minimum: the generated legal texts are what the code says, the licence and README
// exist and agree, the appeal contact is real, and GET /me/export + DELETE /me behave over HTTP with hot and cold data.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildLegal, legalJson, renderLegalHtml, legalHtmlPath, LEGAL_JSON_PATH, LEGAL_IDS } from '../tools/legal-lib';
import { POLICY_JSON_PATH } from '../tools/policy-lib';
import { OPERATOR } from '../game/src/content/operator';
import { HIDDEN_LABEL } from '../game/src/identity/identity';
import {
  Verifier,
  createServer,
  playerIdFromToken,
  APPEAL_CONTACT,
  HOT_DAYS,
  DEFAULT_EVENTS_RETENTION_DAYS,
  DAILY_HISTORY_DAYS,
  type PlayerExport,
  type ServerOptions,
} from '../server/verify';
import { apply, newRun } from '../game/src/sim/run';
import { encodeReplay, exportReplay } from '../game/src/sim/replay';
import { RULES } from '../game/src/sim/rules';

const read = (p: string) => fs.readFileSync(p, 'utf8').replace(/\r\n/g, '\n');

test('0.8.6 legal texts: the committed legal.json and the three pages are exactly what the code generates; each document carries what the roadmap requires; the contacts are on the domain', () => {
  const l = buildLegal();
  assert.equal(legalJson(l), read(LEGAL_JSON_PATH), `${LEGAL_JSON_PATH} is stale: run npm run policy`);
  for (const d of l.docs) assert.equal(renderLegalHtml(d, l), read(legalHtmlPath(d.id)), `${legalHtmlPath(d.id)} is stale: run npm run policy`);
  assert.deepEqual(
    l.docs.map((d) => d.id),
    [...LEGAL_IDS],
  );
  assert.deepEqual(buildLegal(), l, 'deterministic');
  assert.doesNotMatch(legalJson(l), /\d{4}-\d{2}-\d{2}T/, 'no timestamps: a function of the source');
  const text = (id: string) =>
    l.docs
      .find((d) => d.id === id)!
      .sections.flatMap((s) => [s.title, ...s.items])
      .join('\n');
  const privacy = text('privacy');
  for (const must of [
    'Who is responsible',
    OPERATOR.holder,
    OPERATOR.contactEmail,
    'Legal basis',
    'How long',
    'Who else sees it',
    'Your rights',
    'complain',
    'Hetzner',
    'Cloudflare',
    'GitHub',
    'Discord',
    `${DEFAULT_EVENTS_RETENTION_DAYS} days`,
    `${HOT_DAYS} days after a daily closes`,
    `${DAILY_HISTORY_DAYS} days back`,
    `${OPERATOR.backupKeepDays} days`,
    OPERATOR.logRotation,
    'GET /me/export',
    'DELETE /me',
    'Children',
    'under 13',
  ])
    assert.ok(privacy.includes(must), `the privacy notice says: ${must}`);
  const terms = text('terms');
  for (const must of [
    'no promise of uptime',
    'What "verified" means',
    'does not certify that a human played',
    APPEAL_CONTACT,
    `"${HIDDEN_LABEL}"`,
    'LICENSE',
    'rename once every',
    'Fair play',
    OPERATOR.jurisdiction,
  ])
    assert.ok(terms.includes(must), `the terms say: ${must}`);
  const guide = text('guidelines');
  for (const must of ['Names', 'not a real name', 'Do not automate the daily', APPEAL_CONTACT, 'Reporting', 'Found an exploit?', OPERATOR.contactEmail])
    assert.ok(guide.includes(must), `the guidelines say: ${must}`);
  for (const d of l.docs) {
    const html = renderLegalHtml(d, l);
    assert.doesNotMatch(html, /<script/i, 'no scripts: the CSP allows none');
    assert.match(html, /<h1>/);
    assert.ok(html.includes('href="../"'), 'back to the game');
    assert.ok(html.includes(d.summary.replace(/'/g, '&#39;').replace(/&#39;/g, "'").slice(0, 40)), 'the summary is on the page');
  }
  assert.match(APPEAL_CONTACT, new RegExp(`@${OPERATOR.domain.replace(/\./g, '\\.')}$`), 'the appeal contact is a mailbox on the domain');
  assert.notEqual(APPEAL_CONTACT, 'moderation@example.invalid', 'the placeholder is gone');
  assert.equal(APPEAL_CONTACT, OPERATOR.appealEmail);
  const policy = JSON.parse(read(POLICY_JSON_PATH)) as { sections: { title: string; lines: string[] }[] };
  const identity = policy.sections.find((s) => s.title === 'Identity and your data')!;
  assert.ok(
    identity.lines.some((x) => x.includes('GET /me/export') && x.includes('DELETE /me')),
    'the fairness policy names both data rights',
  );
  assert.ok(
    identity.lines.some((x) => x.includes(APPEAL_CONTACT)),
    'the fairness policy prints the real appeal contact',
  );
});

test('0.8.6 licence and README: LICENSE names the holder and the reserved assets, README points at the legal pages and the licence, package.json refers to the file', () => {
  const lic = read('LICENSE');
  assert.match(lic, /^Junkyard Draft — Source-Available Licence/);
  assert.match(lic, /Copyright \(c\) 2026 /);
  assert.match(lic, /All rights reserved\./);
  for (const must of ['Permitted', 'Not permitted', 'Contributions', 'No warranty', 'brand assets', OPERATOR.contactEmail, 'Phaser'])
    assert.ok(lic.includes(must), `LICENSE has: ${must}`);
  const readme = read('README.md');
  assert.match(readme, /^# Junkyard Draft\n/);
  for (const must of [
    'LICENSE',
    'game/public/legal/privacy.html',
    'game/public/legal/terms.html',
    'game/public/legal/guidelines.html',
    'docs/POLICY.md',
    OPERATOR.appealEmail,
    OPERATOR.contactEmail,
    'npm test',
    'RULES_VERSION',
  ])
    assert.ok(readme.includes(must), `README has: ${must}`);
  assert.equal((JSON.parse(read('package.json')) as { license: string }).license, 'SEE LICENSE IN LICENSE');
  assert.ok(
    fs.existsSync('game/public/legal/privacy.html') && fs.existsSync('game/public/legal/terms.html') && fs.existsSync('game/public/legal/guidelines.html'),
    'the pages ship with the game (game/public is copied into dist)',
  );
});

function finishedRun(seed: string) {
  const s = newRun(seed);
  for (let r = 1; r <= RULES.rounds; r++) {
    apply(s, { t: 'pick', i: s.offers.indexOf('crusher') >= 0 ? s.offers.indexOf('crusher') : 0 });
    if (r === 1) {
      const conv = s.layout.machines.find((m) => m.x === 2 && m.y === 2)!;
      apply(s, { t: 'unplace', id: conv.id });
      apply(s, { t: 'place', id: s.bin[0].id, x: 2, y: 2, dir: 0 });
    }
    apply(s, { t: 'run' });
    apply(s, { t: 'next' });
  }
  return s;
}
const tok = (c: string) => c.repeat(32);
const pid = (c: string) => playerIdFromToken(tok(c))!;
const bear = (c: string) => ({ Authorization: `Bearer ${tok(c)}` });
async function listen(v: Verifier, opts: ServerOptions = {}) {
  const server = createServer(v, { rateLimit: null, log: () => {}, errorLog: () => {}, ...opts });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const call = async (method: string, p: string, headers: Record<string, string> = {}) => {
    const r = await fetch(`${base}${p}`, { method, headers });
    return { status: r.status, json: (await r.json()) as Record<string, unknown> };
  };
  return {
    call,
    close: () => {
      server.closeAllConnections();
      server.close();
    },
  };
}

test('0.8.6 GET /me/export lists the player\'s hot and cold entries with their replays, groups, moderation and filed reports, never the key; DELETE /me then leaves an empty export, "deleted" entries with their scores and no replay anywhere', async () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'jd-legal-')), 'board.json');
  const v = new Verifier(file, { dailySecret: 'legal', reportPolicy: { reporters: 1, establishedDays: 0 } });
  const tOld = new Date('2030-01-10T10:00:00Z');
  const tNow = new Date('2030-03-12T10:00:00Z');
  assert.ok(v.claim(pid('a'), 'Export Me', tOld).ok && v.claim(pid('b'), 'Bystander', tOld).ok);
  const old = v.dailyRecord('2030-01-10', tOld)!;
  const coldEntry = v.submit(encodeReplay(exportReplay(finishedRun(old.seed))), 'x', pid('a'), tOld).entry!;
  assert.deepEqual(v.splitCold(tNow).moved, ['2030-01-10']);
  const today = v.dailyRecord('2030-03-12', tNow)!;
  const hotEntry = v.submit(encodeReplay(exportReplay(finishedRun(today.seed))), 'x', pid('a'), tNow).entry!;
  assert.ok(v.createGroup(pid('a'), 'Friends', tNow).ok);
  assert.ok(v.report(pid('a'), { playerId: pid('b') }, 'spam', tNow).ok, 'a report filed by the exporting player');
  const s = await listen(v, { now: () => tNow.getTime() });
  try {
    assert.equal((await s.call('GET', '/me/export')).status, 401, 'the export needs the key');
    const r = await s.call('GET', '/me/export', bear('a'));
    assert.equal(r.status, 200);
    const x = r.json as unknown as PlayerExport & { ok: boolean };
    assert.equal(x.ok, true);
    assert.equal(x.playerId, pid('a'));
    assert.equal(x.player?.name, 'Export Me');
    assert.equal(x.player?.hidden, false);
    assert.deepEqual(
      x.entries.map((e) => [e.storage, e.replayHash, !!e.replay, e.player]),
      [
        ['cold', coldEntry.replayHash, true, `Export Me#${x.tag}`],
        ['hot', hotEntry.replayHash, true, `Export Me#${x.tag}`],
      ],
      'both storages, ascending by time, with the replay and the current label',
    );
    assert.deepEqual(
      x.groups.map((g) => [g.name, g.creator]),
      [['Friends', true]],
    );
    assert.equal(x.moderation, null, 'nothing was filed about this name');
    assert.deepEqual(
      x.reportsFiled.map((f) => f.reason),
      ['spam'],
    );
    assert.ok(!('reporterId' in x.reportsFiled[0]) && !('playerId' in x.reportsFiled[0]), "the report's target is another player's data");
    assert.ok(Array.isArray(x.notes) && x.notes.length >= 2);
    assert.doesNotMatch(JSON.stringify(x), new RegExp(tok('a')), 'the key itself never appears');
    // the bystander's export shows the report about their name as a count, not who filed it
    const y = (await s.call('GET', '/me/export', bear('b'))).json as unknown as PlayerExport;
    assert.deepEqual(y.moderation && { hidden: y.moderation.hidden, reports: y.moderation.reports }, { hidden: true, reports: 1 });
    assert.ok(!JSON.stringify(y).includes(pid('a')), "the reporter's id is not in the target's export");
    assert.deepEqual(y.entries, []);
    // deletion over HTTP, then the promises hold hot and cold
    const del = await s.call('DELETE', '/me', bear('a'));
    assert.equal(del.status, 200);
    assert.deepEqual(del.json, { ok: true, anonymisedEntries: 1, coldReplaysDropped: 1 });
    const after = (await s.call('GET', '/me/export', bear('a'))).json as unknown as PlayerExport;
    assert.equal(after.player, null);
    assert.deepEqual(after.entries, []);
    assert.deepEqual(after.groups, []);
    assert.equal(after.moderation, null);
    assert.deepEqual(
      after.reportsFiled.map((f) => f.reason),
      ['spam'],
      "the filed report stays in the target's record (the operator's audit of moderation), keyed by a hash that now belongs to no device",
    );
    const hot = v.board(today.seed, 20, null, tNow);
    assert.equal(hot.length, 1);
    assert.equal(hot[0].player, 'deleted');
    assert.equal(hot[0].playerId, undefined);
    assert.equal(hot[0].score, hotEntry.score);
    const cold = v.board(old.seed, 20, null, tNow);
    assert.equal(cold.length, 1);
    assert.equal(cold[0].player, 'deleted');
    assert.equal(cold[0].score, coldEntry.score);
    assert.equal(v.replay(hotEntry.replayHash, tNow), null);
    assert.equal(v.replay(coldEntry.replayHash, tNow), null);
    assert.equal(v.cold.entriesOf(pid('a')).length, 0);
    assert.equal((await s.call('GET', '/identity', bear('a'))).status, 404, 'the old key knows no name');
    assert.equal((await s.call('GET', `/replay?hash=${coldEntry.replayHash}&seed=${encodeURIComponent(old.seed)}`)).status, 404);
    const hotDisk = JSON.parse(fs.readFileSync(file, 'utf8')) as { moderation?: Record<string, { reports: { reporterId: string }[] }> };
    const coldDisk = fs.readFileSync(path.join(path.dirname(file), 'cold', '2030-01.json'), 'utf8');
    assert.ok(!JSON.stringify(hotDisk).includes('Export Me') && !coldDisk.includes('Export Me'), 'the name is nowhere on disk');
    assert.deepEqual(
      hotDisk.moderation?.[pid('b')]?.reports.map((r) => r.reporterId),
      [pid('a')],
      "the filed report keeps the reporter hash in the target's record",
    );
    for (const m of Object.values(hotDisk.moderation ?? {})) m.reports = [];
    assert.ok(!JSON.stringify(hotDisk).includes(pid('a')) && !coldDisk.includes(pid('a')), 'apart from that report, the id is nowhere on disk');
  } finally {
    s.close();
  }
});
