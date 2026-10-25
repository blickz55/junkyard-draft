/**
 * Local replay verifier + leaderboard (foundation for trusted server verification).
 * - POST /verify   { replay: ReplayFile, player?: string } → re-simulates; stores ONLY verified scores.
 * - GET  /board?seed=<seed>&limit=20 → verified scores for a seed (never client-claimed scores).
 * - GET  /daily?limit=10 → today's UTC daily seed (same rule as the client) with its verified board.
 * - GET  /health
 * Storage is a JSON file (server/data/board.json by default). Binds to localhost.
 * Run: node --import tsx server/verify.ts   (PORT, BOARD_FILE env)
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { decodeReplay, verifyReplay, type ReplayFile } from '../game/src/sim/replay';
import { RULES_VERSION } from '../game/src/sim/types';
import { dailySeedFor } from '../game/src/sim/daily';

export interface BoardEntry { seed: string; score: number; player: string; verifiedAt: string; rulesVersion: number; actions: number; replayHash: string }
export interface Board { entries: BoardEntry[] }

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
    this.save();
    return { ok: true, score: v.score, entry };
  }
  board(seed: string, limit = 20): BoardEntry[] {
    return this.data.entries.filter((e) => e.seed === seed).sort((a, b) => b.score - a.score || a.verifiedAt.localeCompare(b.verifiedAt)).slice(0, limit);
  }
  /** Today's challenge: the seed every client derives for this UTC date, plus its verified board. */
  daily(limit = 10, now = new Date()): { seed: string; date: string; rulesVersion: number; verified: true; entries: BoardEntry[] } {
    const seed = dailySeedFor(now);
    return { seed, date: now.toISOString().slice(0, 10), rulesVersion: RULES_VERSION, verified: true, entries: this.board(seed, limit) };
  }
}

export function createServer(verifier: Verifier) {
  return http.createServer((req, res) => {
    const url = new URL(req.url || '/', 'http://localhost');
    const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' };
    const json = (code: number, body: unknown) => { res.writeHead(code, { 'Content-Type': 'application/json', ...cors }); res.end(JSON.stringify(body)); };
    if (req.method === 'OPTIONS') { res.writeHead(204, cors); return res.end(); }
    if (req.method === 'GET' && url.pathname === '/health') return json(200, { ok: true, rulesVersion: RULES_VERSION });
    if (req.method === 'GET' && url.pathname === '/daily') return json(200, verifier.daily(Math.min(50, Number(url.searchParams.get('limit') || 10))));
    if (req.method === 'GET' && url.pathname === '/board') { const seed = url.searchParams.get('seed') || ''; return json(200, { seed, verified: true, entries: verifier.board(seed, Number(url.searchParams.get('limit') || 20)) }); }
    if (req.method === 'POST' && url.pathname === '/verify') {
      let body = '';
      req.on('data', (c) => { body += c; if (body.length > MAX_BODY) { json(413, { ok: false, error: 'too large' }); req.destroy(); } });
      req.on('end', () => {
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
  const file = process.env.BOARD_FILE || path.join(ROOT, 'server', 'data', 'board.json');
  const port = Number(process.env.PORT || 4400);
  createServer(new Verifier(file)).listen(port, '127.0.0.1', () => console.log(`replay verifier → http://127.0.0.1:${port}/  (board: ${path.relative(ROOT, file)})`));
}
