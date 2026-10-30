#!/usr/bin/env node
// Emit a structured, agent-reported Control Room event.
// These are *reported* by the developing agent (objectives, task stages, check results,
// screenshots, builds, checkpoints) and are labelled as such in the dashboard, separate
// from runtime-observed hook events.
//
// Usage:
//   node control-room/emit.mjs objective --task T1 --title "..." --criterion "..." --stage implement --agent main --next "..." [--blocker "..."]
//   node control-room/emit.mjs task --id T1 --title "..." --stage test --status active|queued|done|blocked|failed [--deps T0,T2] [--agent main] [--note "..."]
//   node control-room/emit.mjs check --task T1 --name "unit tests" --command "npm test" --result pass|fail [--report tests/report.txt] [--summary "..."]
//   node control-room/emit.mjs screenshot --path .control-room/screenshots/x.png --task T1 [--note "..."]
//   node control-room/emit.mjs build --kind dev|verified|production --result pass|fail [--url http://127.0.0.1:5173] [--commit abc123] [--note "..."]
//   node control-room/emit.mjs checkpoint --commit abc123 --summary "..." [--task T1]
//   node control-room/emit.mjs note --text "..." [--task T1]
//   node control-room/emit.mjs selftest --phase fail|pass --note "..."
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = path.join(ROOT, '.control-room');
const OUT_FILE = path.join(OUT_DIR, 'events.jsonl');

const [type, ...rest] = process.argv.slice(2);
const TYPES = ['objective', 'task', 'check', 'screenshot', 'build', 'checkpoint', 'note', 'selftest'];
if (!TYPES.includes(type)) {
  console.error(`usage: emit.mjs <${TYPES.join('|')}> --key value ...`);
  process.exit(1);
}
const args = {};
for (let i = 0; i < rest.length; i++) {
  if (rest[i].startsWith('--')) {
    const k = rest[i].slice(2);
    const v = rest[i + 1] !== undefined && !rest[i + 1].startsWith('--') ? rest[++i] : 'true';
    args[k] = v;
  }
}
if (args.deps)
  args.deps = args.deps
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
if (args.path) args.path = path.isAbsolute(args.path) ? path.relative(ROOT, args.path) : args.path;
if (args.report) args.report = path.isAbsolute(args.report) ? path.relative(ROOT, args.report) : args.report;
if (type === 'screenshot' && args.path) {
  try {
    args.captured = fs.statSync(path.join(ROOT, args.path)).mtime.toISOString();
  } catch {
    args.captured = 'unavailable';
  }
}
const ev = { ts: new Date().toISOString(), kind: 'reported', event: `cr.${type}`, ...args };
fs.mkdirSync(OUT_DIR, { recursive: true });
fs.appendFileSync(OUT_FILE, JSON.stringify(ev) + '\n');
console.log(
  `[control-room] ${ev.event} ${Object.entries(args)
    .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
    .join(' ')}`,
);
