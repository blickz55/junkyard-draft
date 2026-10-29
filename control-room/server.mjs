#!/usr/bin/env node
// Workshop Control Room server: tails .control-room/events.jsonl, keeps the reduced
// dashboard state, streams updates over Server-Sent Events, and serves the static UI.
// Binds to localhost only. Read-only: it never issues commands to Claude Code.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createState, reduce, snapshot } from './state.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA_DIR = path.join(ROOT, '.control-room');
const EVENTS = path.join(DATA_DIR, 'events.jsonl');
const SHOTS = path.join(DATA_DIR, 'screenshots');
const REPORTS = path.join(DATA_DIR, 'reports');
const UI = path.join(ROOT, 'control-room', 'ui');
const DIST = path.join(ROOT, 'dist');
const HOST = '127.0.0.1';
const PORT = Number(process.env.CONTROL_ROOM_PORT || 4310);
const GAME_DEV_URL = process.env.GAME_DEV_URL || 'http://127.0.0.1:5173/';

fs.mkdirSync(SHOTS, { recursive: true });
fs.mkdirSync(REPORTS, { recursive: true });

let state = createState();
let seq = 0;
let offset = 0;
let partial = '';
const clients = new Set();
const startedAt = new Date().toISOString();

function ingest(chunk) {
  partial += chunk;
  const lines = partial.split('\n');
  partial = lines.pop();
  const fresh = [];
  for (const line of lines) {
    if (!line.trim()) continue;
    try { const e = JSON.parse(line); seq++; reduce(state, e, seq); fresh.push(state.feed[state.feed.length - 1]); } catch { /* skip malformed line */ }
  }
  return fresh;
}

function readNew() {
  try {
    if (!fs.existsSync(EVENTS)) return [];
    const size = fs.statSync(EVENTS).size;
    if (size < offset) { // truncated/rotated: rebuild
      state = createState(); seq = 0; offset = 0; partial = '';
      const all = ingest(fs.readFileSync(EVENTS, 'utf8')); offset = size; broadcast('state', snapshot(state)); return [];
    }
    if (size === offset) return [];
    const fd = fs.openSync(EVENTS, 'r');
    const buf = Buffer.alloc(size - offset);
    fs.readSync(fd, buf, 0, buf.length, offset);
    fs.closeSync(fd);
    offset = size;
    return ingest(buf.toString('utf8'));
  } catch (err) { return []; }
}

function broadcast(type, data) {
  const msg = `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of clients) { try { res.write(msg); } catch { clients.delete(res); } }
}

function poll() {
  const fresh = readNew();
  for (const entry of fresh) broadcast('event', entry);
  if (fresh.length) broadcast('summary', summary());
}

// Initial load, then watch + poll fallback.
readNew();
try { fs.watch(DATA_DIR, { persistent: true }, (_t, f) => { if (f === 'events.jsonl') poll(); }); } catch { /* polling covers it */ }
setInterval(poll, 1000);
setInterval(() => { for (const res of clients) { try { res.write(': ping\n\n'); } catch { clients.delete(res); } } }, 15000);

let gitCache = { at: 0, data: null };
function gitLog() {
  return new Promise((resolve) => {
    if (Date.now() - gitCache.at < 10000 && gitCache.data) return resolve(gitCache.data);
    execFile('git', ['log', '--date=iso-strict', '--pretty=format:%h%x1f%ad%x1f%s%x1f%an', '-n', '25'], { cwd: ROOT, timeout: 4000 }, (err, out) => {
      if (err) { const empty = /does not have any commits|bad default revision|unknown revision/i.test(String(err.stderr || err.message)); return resolve({ available: empty, error: empty ? null : 'git log unavailable', commits: [], dirtyFiles: null }); }
      const commits = out.split('\n').filter(Boolean).map((l) => { const [hash, date, subject, author] = l.split('\x1f'); return { hash, date, subject, author }; });
      execFile('git', ['status', '--porcelain'], { cwd: ROOT, timeout: 4000 }, (e2, st) => {
        const data = { available: true, commits, dirtyFiles: e2 ? null : st.split('\n').filter(Boolean).length };
        gitCache = { at: Date.now(), data }; resolve(data);
      });
    });
  });
}

function milestones() {
  try {
    const md = fs.readFileSync(path.join(ROOT, 'docs', 'ROADMAP.md'), 'utf8');
    const sections = []; let cur = null;
    for (const line of md.split('\n')) {
      const h = line.match(/^##\s+(.*)/);
      if (h) { cur = { title: h[1].trim(), items: [] }; sections.push(cur); continue; }
      const m = line.match(/^\s*[-*]\s+\[([ xX~])\]\s+(.*)/);
      if (m && cur) cur.items.push({ done: m[1].toLowerCase() === 'x', active: m[1] === '~', text: m[2].trim() });
    }
    return { available: true, sections: sections.filter((s) => s.items.length).map((s) => ({ ...s, done: s.items.filter((i) => i.done).length, total: s.items.length })) };
  } catch { return { available: false, sections: [] }; }
}

function summary() {
  return { now: new Date().toISOString(), lastHookAt: state.lastHookAt, lastReportedAt: state.lastReportedAt, counts: state.counts, objective: state.objective, lastActivity: state.lastActivity, clients: clients.size, collectorStartedAt: startedAt, eventsFile: path.relative(ROOT, EVENTS), fileBytes: offset };
}

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.json': 'application/json', '.txt': 'text/plain; charset=utf-8', '.md': 'text/plain; charset=utf-8', '.wasm': 'application/wasm' };
function serveFile(res, base, rel) {
  const p = path.resolve(base, rel);
  const inside = path.relative(base, p); // path-boundary containment: a sibling directory sharing the prefix is outside (review)
  if (!inside || inside.startsWith('..') || path.isAbsolute(inside)) { res.writeHead(403); return res.end(); }
  fs.stat(p, (err, st) => {
    if (err || !st.isFile()) { res.writeHead(404); return res.end('not found'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    fs.createReadStream(p).pipe(res);
  });
}
function json(res, data) { res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' }); res.end(JSON.stringify(data)); }

/** decodeURIComponent that answers a malformed escape with null instead of throwing out of the request handler */
const dec = (s) => { try { return decodeURIComponent(s); } catch { return null; } };
const server = http.createServer(async (req, res) => {
  let url;
  try { url = new URL(req.url, `http://${HOST}:${PORT}`); } catch { res.writeHead(400); return res.end('bad request'); }
  const p = url.pathname;
  if (/%[0-9a-f]{0,2}/i.test(p) && dec(p) === null) { res.writeHead(400); return res.end('bad request: malformed escape'); }
  if (p === '/events') {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
    res.write(`event: state\ndata: ${JSON.stringify({ ...snapshot(state), summary: summary(), gameDevUrl: GAME_DEV_URL })}\n\n`);
    clients.add(res);
    req.on('close', () => clients.delete(res));
    return;
  }
  if (p === '/api/state') return json(res, { ...snapshot(state), summary: summary(), gameDevUrl: GAME_DEV_URL });
  if (p === '/api/summary') return json(res, summary());
  if (p === '/api/git') return json(res, await gitLog());
  if (p === '/api/milestones') return json(res, milestones());
  if (p === '/api/events') { const n = Math.min(Number(url.searchParams.get('limit') || 200), 3000); return json(res, state.feed.slice(-n)); }
  if (p.startsWith('/screenshots/')) return serveFile(res, SHOTS, dec(p.slice('/screenshots/'.length)));
  if (p.startsWith('/reports/')) return serveFile(res, REPORTS, dec(p.slice('/reports/'.length)));
  if (p.startsWith('/verified/')) return serveFile(res, DIST, dec(p.slice('/verified/'.length)) || 'index.html');
  if (p === '/verified') { res.writeHead(302, { Location: '/verified/index.html' }); return res.end(); }
  if (p === '/') return serveFile(res, UI, 'index.html');
  return serveFile(res, UI, dec(p.slice(1)));
});

server.listen(PORT, HOST, () => {
  const url = `http://${HOST}:${PORT}/`;
  console.log('');
  console.log('  ╔══════════════════════════════════════════════╗');
  console.log(`  ║  WORKSHOP CONTROL ROOM  →  ${url.padEnd(19)}║`);
  console.log('  ╚══════════════════════════════════════════════╝');
  console.log(`  events: ${path.relative(ROOT, EVENTS)} (${offset} bytes loaded, ${state.feed.length} events)`);
  console.log('');
});
