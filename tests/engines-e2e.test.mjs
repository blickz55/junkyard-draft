// Production roadmap 0.8.11, determinism across engines: the sim bundle re-simulates every golden replay in Chromium,
// Firefox and WebKit and the final-state and per-round event hashes must equal the ones Node recorded in
// tests/golden/INDEX.json (and recomputes here). An engine that is not installed is skipped with a note, unless
// ENGINES_REQUIRED=1 (CI's engines job installs all three and sets it). Own port (5194): the e2e files run in parallel.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
if (!process.env.PLAYWRIGHT_BROWSERS_PATH && fs.existsSync('/opt/pw-browsers')) process.env.PLAYWRIGHT_BROWSERS_PATH = '/opt/pw-browsers';
const pw = await import('playwright');
const { build } = await import('esbuild');
const { decodeReplay } = await import('../game/src/sim/replay.ts');
const { digestReplay, sha256Hex } = await import('../game/src/sim/digest.ts');
const { RULES_VERSION } = await import('../game/src/sim/types.ts');
const PORT = 5194;
const URL = `http://127.0.0.1:${PORT}`;
const REQUIRED = process.env.ENGINES_REQUIRED === '1';
const ENGINES = ['chromium', 'firefox', 'webkit'];

const DIR = path.join(ROOT, 'tests', 'golden');
const index = JSON.parse(fs.readFileSync(path.join(DIR, 'INDEX.json'), 'utf8'));
const corpus = index.entries.map((e) => ({ ...e, text: fs.readFileSync(path.join(DIR, e.file), 'utf8') }));

test('determinism across engines: Chromium, Firefox and WebKit agree with Node on every golden replay', { timeout: 240000 }, async (t) => {
  // Node's own view first: the corpus hashes are what this checkout computes
  for (const e of corpus) {
    const d = digestReplay(decodeReplay(e.text));
    assert.equal(d.score, e.score, `${e.file} score`);
    assert.equal(d.state, e.stateHash, `${e.file} state hash in Node`);
    assert.deepEqual(d.rounds, e.roundHashes, `${e.file} round hashes in Node`);
  }
  const scratch = fs.mkdtempSync(path.join(ROOT, 'tools', 'scratch-engines-'));
  const bundle = path.join(scratch, 'engines.js');
  await build({
    entryPoints: [path.join(ROOT, 'tools', 'engines-entry.ts')],
    bundle: true,
    format: 'iife',
    platform: 'browser',
    target: 'es2020',
    outfile: bundle,
    logLevel: 'silent',
  });
  const js = fs.readFileSync(bundle);
  const html = '<!doctype html><html><head><meta charset="utf-8"><title>engines</title></head><body><script src="/engines.js"></script></body></html>';
  const server = http.createServer((req, res) => {
    if (req.url === '/engines.js') {
      res.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8' });
      res.end(js);
    } else {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(html);
    }
  });
  await new Promise((r) => server.listen(PORT, '127.0.0.1', r));
  const summary = [];
  try {
    for (const name of ENGINES) {
      await t.test(name, async (tt) => {
        let browser;
        try {
          browser = await pw[name].launch();
        } catch (e) {
          if (REQUIRED) throw new Error(`${name} is required (ENGINES_REQUIRED=1) but did not launch: ${String(e).split('\n')[0]}`, { cause: e });
          summary.push({ engine: name, skipped: true });
          console.log(`engines: ${name} not installed here (npx playwright install ${name}); skipped`);
          return tt.skip(`${name} not installed`);
        }
        try {
          const page = await browser.newPage();
          const errors = [];
          page.on('pageerror', (e) => errors.push(String(e)));
          await page.goto(`${URL}/`);
          await page.waitForFunction(() => !!window.__jdEngine, null, { timeout: 15000 });
          const ua = await page.evaluate(() => window.__jdEngine.ua);
          assert.equal(await page.evaluate(() => window.__jdEngine.rulesVersion), RULES_VERSION);
          assert.equal(await page.evaluate(() => window.__jdEngine.sha256('abc')), sha256Hex('abc'), `${name}: the hash function itself agrees`);
          let rounds = 0;
          for (const e of corpus) {
            const d = await page.evaluate((text) => window.__jdEngine.digest(text), e.text);
            assert.equal(d.score, e.score, `${name}: ${e.file} score`);
            assert.equal(d.state, e.stateHash, `${name}: ${e.file} final-state hash differs from Node's`);
            assert.deepEqual(d.rounds, e.roundHashes, `${name}: ${e.file} per-round event hashes differ from Node's`);
            rounds += d.rounds.length;
          }
          assert.deepEqual(errors, [], `${name}: no page errors`);
          summary.push({ engine: name, ua, files: corpus.length, rounds });
          console.log(`engines: ${name} agrees with Node on ${corpus.length} replays / ${rounds} rounds (${ua})`);
        } finally {
          await browser.close();
        }
      });
    }
    const ran = summary.filter((s) => !s.skipped);
    assert.ok(
      ran.some((s) => s.engine === 'chromium'),
      'Chromium is always available (the rest of the suite needs it)',
    );
    if (REQUIRED) assert.equal(ran.length, ENGINES.length, 'all three engines ran');
  } finally {
    server.closeAllConnections?.();
    server.close();
    try {
      fs.rmSync(scratch, { recursive: true, force: true });
    } catch {}
  }
});
