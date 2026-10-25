#!/usr/bin/env node
// `npm run dev:all` — starts the game dev server and the Workshop Control Room together.
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const procs = [
  spawn(process.execPath, [path.join(ROOT, 'control-room', 'server.mjs')], { stdio: 'inherit', env: process.env }),
  spawn(process.execPath, [path.join(ROOT, 'scripts', 'dev.mjs')], { stdio: 'inherit', env: process.env }),
];
setTimeout(() => {
  console.log('\n  ┌───────────────────────────────────────────────────┐');
  console.log('  │  Workshop Control Room:  http://127.0.0.1:4310/   │');
  console.log('  │  Junkyard Draft (dev):   http://127.0.0.1:5173/   │');
  console.log('  └───────────────────────────────────────────────────┘\n');
}, 1500);
const stop = () => { for (const p of procs) p.kill('SIGTERM'); process.exit(0); };
process.on('SIGINT', stop); process.on('SIGTERM', stop);
for (const p of procs) p.on('exit', (code) => { if (code && code !== 0) console.error(`child exited with ${code}`); });
