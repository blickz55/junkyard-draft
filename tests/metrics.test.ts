// Production roadmap 0.12.5: GET /metrics. The text is OpenMetrics to the letter, the route exists only with a token and answers only to it, and
// nothing in it names anyone, because a dashboard gets shared.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { CommunityStore } from '../server/community';
import { openMetrics, OPENMETRICS_TYPE } from '../server/metrics';
import { createServer, playerIdFromToken, Verifier } from '../server/verify';
import { apply, newRun } from '../game/src/sim/run';
import { encodeReplay, exportReplay } from '../game/src/sim/replay';
import { RULES } from '../game/src/sim/rules';

test('the text: help, type, a sample; a counter ends in _total; labels are escaped; it ends in EOF', () => {
  const text = openMetrics([
    { name: 'jd_a', help: 'A gauge.', type: 'gauge', value: 3 },
    { name: 'jd_b', help: 'A counter.', type: 'counter', value: 7 },
    { name: 'jd_c', help: 'By kind.', type: 'gauge', label: 'limiter', value: { ip: 1, 'a"b\\c': 2 } },
  ]);
  assert.equal(
    text,
    [
      '# HELP jd_a A gauge.',
      '# TYPE jd_a gauge',
      'jd_a 3',
      '# HELP jd_b A counter.',
      '# TYPE jd_b counter',
      'jd_b_total 7',
      '# HELP jd_c By kind.',
      '# TYPE jd_c gauge',
      'jd_c{limiter="ip"} 1',
      'jd_c{limiter="a\\"b\\\\c"} 2',
      '# EOF',
      '',
    ].join('\n'),
  );
  assert.equal(openMetrics([]), '# EOF\n');
});

async function rig(metricsToken?: string) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jd-metrics-'));
  const verifier = new Verifier(path.join(dir, 'board.json'), { dailySecret: 'fixture-secret', auditFile: null });
  const community = new CommunityStore(path.join(dir, 'community.db'));
  const srv = createServer(verifier, { log: null, community, metricsToken });
  await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${(srv.address() as AddressInfo).port}`;
  return {
    base,
    verifier,
    community,
    scrape: (authorization?: string) => fetch(`${base}/metrics`, { headers: authorization ? { Authorization: authorization } : {} }),
    close: async () => {
      await new Promise((r) => srv.close(r));
      community.close();
    },
  };
}

test('with no token there is no route', async () => {
  const r = await rig();
  assert.equal((await r.scrape()).status, 404);
  assert.equal((await r.scrape('Bearer anything')).status, 404);
  await r.close();
});

test('it answers only to its token', async () => {
  const r = await rig('sesame');
  assert.equal((await r.scrape()).status, 401);
  assert.equal((await r.scrape('Bearer wrong!')).status, 401, 'the same length');
  assert.equal((await r.scrape('Bearer not even close')).status, 401, 'another length');
  assert.equal((await r.scrape('Bearer sesame')).status, 200);
  await r.close();
});

test('it says how the server is, and nothing about anyone', async () => {
  const r = await rig('sesame');
  const token = 'a'.repeat(32);
  const id = playerIdFromToken(token)!;
  r.verifier.claim(id, 'Findable');
  const run = newRun('metrics-yard');
  for (let n = 1; n <= RULES.rounds; n++) {
    apply(run, { t: 'pick', i: 0 });
    apply(run, { t: 'run' });
    apply(run, { t: 'next' });
  }
  const sent = await fetch(`${r.base}/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ replay: JSON.parse(encodeReplay(exportReplay(run, 'test'))) }),
  });
  assert.equal(sent.status, 200);
  const { entry } = (await sent.json()) as { entry: { replayHash: string } };

  const res = await r.scrape('Bearer sesame');
  assert.equal(res.headers.get('content-type'), OPENMETRICS_TYPE);
  assert.equal(res.headers.get('cache-control'), 'no-store');
  const text = await res.text();
  assert.match(text, /^jd_up 1$/m);
  assert.match(text, /^jd_entries 1$/m);
  assert.match(text, /^jd_players 1$/m);
  assert.match(text, /^jd_hot_file_bytes [1-9]\d*$/m);
  assert.match(text, /^jd_commits_total [1-9]\d*$/m);
  assert.match(text, /^jd_limiter_keys\{limiter="ip"\} \d+$/m);
  assert.match(text, /^jd_community_posts 0$/m);
  assert.ok(text.endsWith('# EOF\n'));
  for (const secret of [id, 'Findable', entry.replayHash, 'metrics-yard', '127.0.0.1']) assert.ok(!text.includes(secret), secret);
  await r.close();
});
