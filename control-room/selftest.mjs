#!/usr/bin/env node
// Instrumentation self-test: records a clearly labelled intentional failure followed by a
// success, then verifies both reached the collector file and the running server (if any).
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const EVENTS = path.join(ROOT, '.control-room', 'events.jsonl');
const emit = (...a) => execFileSync('node', [path.join(ROOT, 'control-room/emit.mjs'), ...a], { stdio: 'inherit' });
const stamp = Date.now();

emit('selftest', '--phase', 'fail', '--note', `INTENTIONAL failure #${stamp}: self-test check reports fail on purpose`);
emit('check', '--task', 'CR2', '--name', `self-test intentional failure #${stamp}`, '--command', 'npm run selftest:instrumentation', '--result', 'fail', '--summary', 'This failure is intentional and part of the instrumentation self-test.');
emit('selftest', '--phase', 'pass', '--note', `self-test #${stamp}: subsequent success recorded`);
emit('check', '--task', 'CR2', '--name', `self-test subsequent success #${stamp}`, '--command', 'npm run selftest:instrumentation', '--result', 'pass');

const lines = fs.readFileSync(EVENTS, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
const mine = lines.filter((e) => e.event === 'cr.selftest' && String(e.note).includes(`#${stamp}`));
if (mine.length !== 2 || mine[0].phase !== 'fail' || mine[1].phase !== 'pass') { console.error('self-test: events missing from collector file'); process.exit(1); }
console.log('self-test: fail→pass pair present in events.jsonl');

try {
  await new Promise((r) => setTimeout(r, 1500));
  const res = await fetch('http://127.0.0.1:4310/api/state');
  const st = await res.json();
  const seen = st.selftest.filter((s) => String(s.note).includes(`#${stamp}`)).map((s) => s.phase);
  if (seen.join(',') !== 'fail,pass') { console.error('self-test: server state missing pair, saw', seen); process.exit(1); }
  console.log('self-test: server state shows fail→pass pair');
} catch (e) { console.log('self-test: server not running (file-level check passed only)'); }
