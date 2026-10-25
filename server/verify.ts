/**
 * Replay verifier + verified-only leaderboard (the trusted side of scoring).
 * - POST /verify   { replay: ReplayFile, player?: string } → re-simulates; stores ONLY verified scores.
 * - GET  /board?seed=<seed>&limit=20 → verified scores for a seed (never client-claimed scores).
 * - GET  /daily?limit=10 → today's UTC daily seed (same rule as the client) with its verified board.
 * - GET  /replay?hash=<replayHash> → the stored actions of a VERIFIED entry (for playback); 404 otherwise.
 * - GET  /health → { ok, rulesVersion, entries, uptimeSec }
 *
 * Deployable: binds to HOST:PORT (default 127.0.0.1:4400), keeps its JSON board in DATA_DIR/board.json
 * (default server/data), logs one line per request, rate-limits POST /verify per client IP
 * (default 60/min), and sends CORS headers for CORS_ORIGIN (default *). Behind a reverse proxy set
 * TRUST_PROXY=1 so X-Forwarded-For identifies the client.
 *
 * Run (dev):   node --import tsx server/verify.ts
 * Run (prod):  npm run verifier:build && node server/dist/verify.mjs --host 0.0.0.0 --data-dir /data
 * CLI flags --host --port --data-dir --cors-origin --rate-limit override the env vars of the same name.
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { decodeReplay, verifyReplay, type ReplayFile } from '../game/src/sim/replay';
import { RULES_VERSION } from '../game/src/sim/types';
import { dailySeedFor } from '../game/src/sim/daily';

export interface BoardEntry { seed: string; score: number; player: string; verifiedAt: string; rulesVersion: number; actions: number; replayHash: string; replayAvailable?: boolean }
/** Actions of a verified replay, kept so anyone can watch it; bounded by the replay limits enforced at verification. */
export interface StoredReplay { seed: string; rulesVersion: number; actions: ReplayFile['actions']; score: number; player: string; verifiedAt: string }
export interface Board { entries: BoardEntry[]; replays?: Record<string, StoredReplay> }

const MAX_BODY = 512 * 1024;

function hash(text: string): string {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0).toString(16).padStart(8, '0');
}

export class Verifier {
  private data: Board;
  constructor(private file: string) {
    this.data = fs.existsSync(file) ? (JSON.parse(fs.readFileSync(file, 'utf8')) as Board) : { entries: [] };
  }
  private save() { fs.mkdirSync(path.dirname(this.file), { recursive: true }); fs.writeFileSync(this.file, JSON.stringify(this.data, null, 1)); }
  get size() { return this.data.entries.length; }

  /** Verify a replay; on success record it. Returns the verdict (never trusts claimedScore). */
  submit(replayText: string, player = 'anonymous'): { ok: boolean; score?: number; error?: string; entry?: BoardEntry } {
    let replay: ReplayFile;
    try { replay = decodeReplay(replayText); } catch (e) { return { ok: false, error: `rejected: ${(e as Error).message}` }; }
    if (replay.rulesVersion !== RULES_VERSION) return { ok: false, error: `rejected: rules version ${replay.rulesVersion} not accepted (server has ${RULES_VERSION})` };
    const v = verifyReplay(replay);
    if (!v.ok) return { ok: false, error: v.error ? `rejected: ${v.error}` : `rejected: re-simulated score $${v.score} does not match claimed $${v.claimed}${v.finished ? '' : ' (run not finished)'}` };
    const replayHash = hash(JSON.stringify({ seed: replay.seed, actions: replay.actions }));
    if (this.data.entries.some((e) => e.replayHash === replayHash)) return { ok: false, error: 'rejected: duplicate replay' };
    const entry: BoardEntry = { seed: replay.seed, score: v.score, player: String(player).slice(0, 32) || 'anonymous', verifiedAt: new Date().toISOString(), rulesVersion: replay.rulesVersion, actions: replay.actions.length, replayHash };
    this.data.entries.push(entry);
    (this.data.replays ||= {})[replayHash] = { seed: replay.seed, rulesVersion: replay.rulesVersion, actions: replay.actions, score: v.score, player: entry.player, verifiedAt: entry.verifiedAt };
    this.save();
    return { ok: true, score: v.score, entry };
  }
  board(seed: string, limit = 20): BoardEntry[] {
    return this.data.entries.filter((e) => e.seed === seed).sort((a, b) => b.score - a.score || a.verifiedAt.localeCompare(b.verifiedAt)).slice(0, limit).map((e) => ({ ...e, replayAvailable: !!this.data.replays?.[e.replayHash] }));
  }
  /** Stored replay of a verified entry (boards written before replay storage existed have none). */
  replay(hash: string): (StoredReplay & { hash: string }) | null {
    const r = this.data.replays?.[hash];
    return r ? { hash, ...r } : null;
  }
  /** Today's challenge: the seed every client derives for this UTC date, plus its verified board. */
  daily(limit = 10, now = new Date()): { seed: string; date: string; rulesVersion: number; verified: true; entries: BoardEntry[] } {
    const seed = dailySeedFor(now);
    return { seed, date: now.toISOString().slice(0, 10), rulesVersion: RULES_VERSION, verified: true, entries: this.board(seed, limit) };
  }
}

/** Fixed-window per-key counter (good enough for a small public verifier; one process). */
export class RateLimiter {
  private hits = new Map<string, { count: number; resetAt: number }>();
  constructor(public limit: number, public windowMs: number, private now: () => number = Date.now) {}
  /** Returns { ok, retryAfterSec } and counts the hit. */
  take(key: string): { ok: boolean; remaining: number; retryAfterSec: number } {
    const t = this.now();
    let h = this.hits.get(key);
    if (!h || h.resetAt <= t) { h = { count: 0, resetAt: t + this.windowMs }; this.hits.set(key, h); }
    if (this.hits.size > 10000) for (const [k, v] of this.hits) if (v.resetAt <= t) this.hits.delete(k); // bounded memory
    h.count++;
    const ok = h.count <= this.limit;
    return { ok, remaining: Math.max(0, this.limit - h.count), retryAfterSec: ok ? 0 : Math.ceil((h.resetAt - t) / 1000) };
  }
}

export interface ServerOptions {
  /** POST /verify limit per client IP per window (default 60 per 60 s); null disables */
  rateLimit?: { limit: number; windowMs: number } | null;
  /** honour X-Forwarded-For (only behind a proxy you control) */
  trustProxy?: boolean;
  /** Access-Control-Allow-Origin value (default '*') */
  corsOrigin?: string;
  /** one line per request to `log` (default console.log); null disables */
  log?: ((line: string) => void) | null;
  now?: () => number;
}

export function clientIp(req: http.IncomingMessage, trustProxy: boolean): string {
  if (trustProxy) { const xf = req.headers['x-forwarded-for']; const first = (Array.isArray(xf) ? xf[0] : xf || '').split(',')[0].trim(); if (first) return first; }
  return req.socket.remoteAddress || 'unknown';
}

export function createServer(verifier: Verifier, opts: ServerOptions = {}) {
  const rl = opts.rateLimit === null ? null : new RateLimiter(opts.rateLimit?.limit ?? 60, opts.rateLimit?.windowMs ?? 60_000, opts.now);
  const corsOrigin = opts.corsOrigin ?? '*';
  const log = opts.log === null ? null : opts.log ?? ((l: string) => console.log(l));
  const started = Date.now();
  return http.createServer((req, res) => {
    const t0 = Date.now();
    const url = new URL(req.url || '/', 'http://localhost');
    const ip = clientIp(req, !!opts.trustProxy);
    const cors = { 'Access-Control-Allow-Origin': corsOrigin, 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type', 'Vary': 'Origin' };
    const json = (code: number, body: unknown, extra: Record<string, string> = {}) => {
      res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...cors, ...extra }); res.end(JSON.stringify(body));
      log?.(`${new Date().toISOString()} ${ip} ${req.method} ${url.pathname}${url.search} ${code} ${Date.now() - t0}ms`);
    };
    if (req.method === 'OPTIONS') { res.writeHead(204, cors); return res.end(); }
    if (req.method === 'GET' && url.pathname === '/health') return json(200, { ok: true, rulesVersion: RULES_VERSION, entries: verifier.size, uptimeSec: Math.round((Date.now() - started) / 1000) });
    if (req.method === 'GET' && url.pathname === '/replay') { const r = verifier.replay(url.searchParams.get('hash') || ''); return r ? json(200, { ok: true, ...r }) : json(404, { ok: false, error: 'no verified replay with that hash' }); }
    if (req.method === 'GET' && url.pathname === '/daily') return json(200, verifier.daily(Math.min(50, Number(url.searchParams.get('limit') || 10))));
    if (req.method === 'GET' && url.pathname === '/board') { const seed = url.searchParams.get('seed') || ''; return json(200, { seed, verified: true, entries: verifier.board(seed, Math.min(100, Number(url.searchParams.get('limit') || 20))) }); }
    if (req.method === 'POST' && url.pathname === '/verify') {
      if (rl) { const r = rl.take(ip); if (!r.ok) { req.resume(); return json(429, { ok: false, error: `rate limited: ${rl.limit} submissions per ${rl.windowMs / 1000}s` }, { 'Retry-After': String(r.retryAfterSec) }); } }
      let body = '';
      req.on('data', (c) => { body += c; if (body.length > MAX_BODY) { json(413, { ok: false, error: 'too large' }); req.destroy(); } });
      req.on('end', () => {
        if (res.writableEnded) return;
        try {
          const parsed = JSON.parse(body) as { replay: unknown; player?: string };
          const result = verifier.submit(JSON.stringify(parsed.replay), parsed.player);
          json(result.ok ? 200 : 422, result);
        } catch (e) { json(400, { ok: false, error: `bad request: ${(e as Error).message}` }); }
      });
      return;
    }
    json(404, { ok: false, error: 'not found' });
  });
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const args = process.argv.slice(2);
  const flag = (k: string) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : undefined; };
  const host = flag('host') || process.env.HOST || '127.0.0.1';
  const port = Number(flag('port') || process.env.PORT || 4400);
  const dataDir = flag('data-dir') || process.env.DATA_DIR || path.join(ROOT, 'server', 'data');
  const file = process.env.BOARD_FILE || path.join(dataDir, 'board.json');
  const corsOrigin = flag('cors-origin') || process.env.CORS_ORIGIN || '*';
  const limit = Number(flag('rate-limit') || process.env.RATE_LIMIT || 60);
  const trustProxy = process.env.TRUST_PROXY === '1';
  createServer(new Verifier(file), { rateLimit: { limit, windowMs: 60_000 }, corsOrigin, trustProxy, log: process.env.VERIFIER_LOG === '0' ? null : undefined })
    .listen(port, host, () => console.log(`replay verifier → http://${host}:${port}/  (board: ${file}, rules v${RULES_VERSION}, ${limit} submissions/min/IP, CORS ${corsOrigin}${trustProxy ? ', trusting X-Forwarded-For' : ''})`));
}
