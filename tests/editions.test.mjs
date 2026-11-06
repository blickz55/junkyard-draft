// The editions (scripts/esbuild-config.mjs): a web build carries no Steam code anywhere in its output, lazy chunks included, which is
// what tools/bundle-size.ts --forbid holds in perf.yml; a Steam build (scripts/build-steam.mjs) carries the bridge module in a chunk
// of its own that a first visit never loads, bakes the verifier it was given and refuses the loopback default; build.json says which
// edition a folder is. Two production builds into scratch folders under tools/, about 30 s.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './e2e/fixture.mjs';
import { buildDist } from '../scripts/build-lib.mjs';
import { buildSteam } from '../scripts/build-steam.mjs';
import { DEFAULT_VERIFIER_URL, EDITIONS } from '../scripts/esbuild-config.mjs';
import { forbidden, weigh } from '../tools/bundle-size.ts';

const VERIFIER = 'https://verify.example';
const perfYml = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'perf.yml'), 'utf8');
const FORBID = perfYml.match(/bundle-size\.ts [^\n]*--forbid '([^']+)'/)?.[1];
const RE = new RegExp(FORBID ?? 'jdDesktop\\??\\.steam|steam-bridge');
const buildJson = (dist) => JSON.parse(fs.readFileSync(path.join(dist, 'build.json'), 'utf8'));
const read = (dist, f) => fs.readFileSync(path.join(dist, f), 'utf8');

let scratch, web, steam;
before(async () => {
  scratch = fs.mkdtempSync(path.join(ROOT, 'tools', 'scratch-editions-'));
  web = path.join(scratch, 'web');
  steam = path.join(scratch, 'steam');
  await buildDist({ root: ROOT, dist: web, verifierUrl: VERIFIER, reports: false });
  await buildSteam({ root: ROOT, dist: steam, verifierUrl: VERIFIER });
});
after(() => {
  if (scratch) fs.rmSync(scratch, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
});

test('editions: perf.yml forbids the bridge in the web bundle with the expression this file checks', () => {
  assert.ok(FORBID, 'perf.yml runs bundle-size.ts with --forbid');
  assert.deepEqual(EDITIONS, ['web', 'steam'], 'web and steam only: the tester build is the web edition with NO_SERVER baked');
  assert.match('window.jdDesktop?.steam', RE, 'the minified optional chain');
  assert.match('window.jdDesktop.steam', RE);
  assert.match("require('./steam-bridge.cjs')", RE);
  assert.doesNotMatch('window.jdDesktop.saveClip', RE, 'the clip sink is not Steam');
});

test('editions: the web build carries no Steam code in any chunk, and build.json says web', { timeout: 60000 }, () => {
  assert.deepEqual(forbidden(web, RE), [], 'nothing under the web dist matches');
  const b = buildJson(web);
  assert.equal(b.edition, 'web');
  assert.equal(b.verifierUrl, VERIFIER, 'the verifier as passed');
  assert.ok(fs.existsSync(path.join(web, 'sw.js')), 'the web app keeps its service worker');
  assert.ok(!read(web, b.bundle).includes('steam-none'), 'no module name leaks either');
  const w = weigh(
    b.initial.map((f) => path.join(web, f)),
    300,
  );
  assert.ok(w.ok, `a first visit stays under the budget: ${w.gzipKiB.toFixed(1)} KiB gzip`);
});

test('editions: the Steam build carries the bridge in a chunk of its own, bakes the verifier it was given, has no service worker', { timeout: 60000 }, () => {
  const hits = forbidden(steam, RE);
  const b = buildJson(steam);
  assert.equal(hits.length, 1, `exactly one file carries the bridge: ${hits.join(', ')}`);
  assert.match(hits[0], /^chunk-[A-Z0-9]{8}\.js$/, 'a chunk, not the bundle');
  assert.ok(!b.initial.includes(hits[0]), 'a first visit does not load it: it comes behind the import() in main.ts');
  assert.equal(b.edition, 'steam');
  assert.equal(b.verifierUrl, VERIFIER, 'the verifier as passed');
  assert.ok(!fs.existsSync(path.join(steam, 'sw.js')), 'no service worker in a depot');
  assert.ok(read(steam, b.bundle).includes(`./${hits[0]}`), 'the bundle imports the bridge chunk');
  assert.ok(fs.existsSync(path.join(steam, 'index.html')));
  // the web bundle and the Steam bundle differ only by what the edition brings: the same weight within a kilobyte
  const ws = weigh([path.join(steam, b.bundle)], 300),
    ww = weigh([path.join(web, buildJson(web).bundle)], 300);
  assert.ok(Math.abs(ws.gzipKiB - ww.gzipKiB) < 1, `bundles within a KiB gzip: web ${ww.gzipKiB.toFixed(1)}, steam ${ws.gzipKiB.toFixed(1)}`);
});

test('editions: a Steam build refuses an unset verifier and the loopback default', async () => {
  const dist = path.join(scratch, 'refused');
  for (const verifierUrl of ['', DEFAULT_VERIFIER_URL, 'http://localhost:4400', 'http://127.0.0.1:4499/'])
    await assert.rejects(buildSteam({ root: ROOT, dist, verifierUrl }), /hosted verifier/, JSON.stringify(verifierUrl));
  const saved = process.env.VERIFIER_URL;
  delete process.env.VERIFIER_URL;
  try {
    await assert.rejects(buildSteam({ root: ROOT, dist }), /VERIFIER_URL must name it/, 'nothing in the environment');
  } finally {
    if (saved !== undefined) process.env.VERIFIER_URL = saved;
  }
  assert.ok(!fs.existsSync(dist), 'nothing was built');
});
