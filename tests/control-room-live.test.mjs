// Live browser test of the Control Room: starts its own server instance on a spare port with
// a temporary events file, then verifies (1) events arrive without page refresh, (2) a reload
// restores recorded history, (3) a server disconnect is visible in the header.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium, ROOT, freePort, until } from './e2e/fixture.mjs';

const PORT = await freePort();
const up = () => until(async () => { try { return (await fetch(`http://127.0.0.1:${PORT}/api/summary`)).ok; } catch { return false; } }, { timeout: 15000, every: 100, what: 'the control room server' });

test('control room: live updates, reload history, disconnect visibility', { timeout: 60000 }, async () => {
  // Isolated data dir: copy the server to a temp project so it reads its own events file.
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cr-live-'));
  fs.mkdirSync(path.join(tmp, 'control-room', 'ui'), { recursive: true });
  for (const f of ['server.mjs', 'state.mjs', 'emit.mjs']) fs.copyFileSync(path.join(ROOT, 'control-room', f), path.join(tmp, 'control-room', f));
  for (const f of ['index.html', 'app.js', 'style.css']) fs.copyFileSync(path.join(ROOT, 'control-room', 'ui', f), path.join(tmp, 'control-room', 'ui', f));
  fs.mkdirSync(path.join(tmp, '.control-room'), { recursive: true });
  const emit = (...a) => new Promise((res) => spawn('node', [path.join(tmp, 'control-room/emit.mjs'), ...a], { stdio: 'ignore' }).on('exit', res));
  await emit('task', '--id', 'T1', '--title', 'Seed task', '--stage', 'implement', '--status', 'active');
  const startServer = () => spawn('node', [path.join(tmp, 'control-room/server.mjs')], { env: { ...process.env, CONTROL_ROOM_PORT: String(PORT) }, stdio: 'ignore' });
  let server = startServer();
  await up();
  // request hardening (review): a malformed percent-escape is a 400, not a crash; a traversal attempt never leaves the directory
  const base = `http://127.0.0.1:${PORT}`;
  assert.equal((await fetch(`${base}/screenshots/%E0%A4%A`)).status, 400, 'malformed escape → 400');
  assert.equal((await fetch(`${base}/screenshots/..%2F..%2Fpackage.json`)).status, 403, 'traversal → 403');
  assert.equal((await fetch(`${base}/reports/../../package.json`)).ok, false, 'normalised traversal does not serve the repo');
  assert.equal((await fetch(`${base}/api/summary`)).status, 200, 'the server is still serving after the bad requests');
  let browser;
  try {
    browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await page.goto(`http://127.0.0.1:${PORT}/`);
    await page.waitForFunction(() => document.querySelector('#pill-sse')?.textContent.includes('live'), null, { timeout: 10000 });
    const before = await page.locator('#feed-list li').count();
    assert.ok(before >= 1, 'seed history rendered');
    await emit('note', '--text', 'live-note-marker-42');
    await page.waitForFunction(() => document.body.innerText.includes('live-note-marker-42'), null, { timeout: 8000 });
    const after = await page.locator('#feed-list li').count();
    assert.equal(after, before + 1, 'event appended without refresh');
    // Reload restores history
    await page.reload();
    await page.waitForFunction(() => document.body.innerText.includes('live-note-marker-42'), null, { timeout: 8000 });
    assert.ok((await page.locator('#feed-list li').count()) >= after, 'history restored after reload');
    assert.ok(await page.locator('#pipe-svg .task[data-id="T1"]').count() === 1, 'pipeline task restored');
    // Disconnect visible
    server.kill('SIGTERM');
    await page.waitForFunction(() => document.querySelector('#pill-sse')?.textContent.includes('DISCONNECTED'), null, { timeout: 10000 });
    // Restart server: collector restart keeps history (file-backed)
    server = startServer();
    await up();
    await page.waitForFunction(() => document.querySelector('#pill-sse')?.textContent.includes('live'), null, { timeout: 15000 });
    await page.waitForFunction(() => document.body.innerText.includes('live-note-marker-42'), null, { timeout: 8000 });
  } finally {
    if (browser) await browser.close().catch(() => {});
    server.kill('SIGTERM');
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
