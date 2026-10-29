/**
 * Replay verifier + verified-only leaderboard (the trusted side of scoring).
 * - POST /verify   { replay: ReplayFile, player?: string } → re-simulates; stores ONLY verified scores.
 * - GET  /board?seed=<seed>&limit=20 → verified scores for a seed (never client-claimed scores).
 * - GET  /daily?limit=10 → today's UTC daily seed (same rule as the client) with its verified board.
 * - GET  /replay?hash=<replayHash> → the stored actions of a VERIFIED entry (for playback); 404 otherwise.
 * - GET  /health → { ok, version, rulesVersion, entries, uptimeSec }
 * - GET  /histogram?seed=<seed>&hash=<replayHash> → the verified score distribution for a seed (PLAN-v1 0.4.1): bins, N, and
 *                 the caller's rank / percentile / neighbours when its replay hash is on the board. Never a fabricated population.
 * - POST /events  { installId, consent: true, events[] } → opt-in funnel events (PLAN-v1 0.3.7), appended to events.jsonl with a
 *                 daily-salted IP hash; only the fixed vocabulary in game/src/telemetry/events.ts is accepted; 30-day retention.
 * - GET  /funnel  → unique installs per funnel step and event counts (what tools/funnel.ts prints).
 * - Bot par (PLAN-v1 0.4.5): the first time a seed is asked about, the shipped autoplayer runs in a worker thread (wall-clock
 *   capped, never on the request path) and the median of its runs is stored as `botPar`; /board, /histogram and /daily
 *   return it. It is a population-independent target labelled as a bot, never an entry on any board.
 *
 * Guarantees (each covered by tests/verifier.test.ts):
 * - A malformed request never kills the process (URL parsing and every handler are guarded; 400/500 JSON).
 * - Nothing is recorded in memory until it is on disk: candidate state is written to a temp file in the
 *   same directory and renamed over the board; a failed write leaves memory and disk unchanged and the
 *   client gets 503 so it can retry.
 * - Boards are partitioned by rules version: entries persisted under another RULES_VERSION never enter
 *   the current board, rank or replay lookups.
 * - Replay identity is SHA-256 over the canonical { rulesVersion, seed, actions } (legacy 8-hex FNV ids
 *   from earlier boards still resolve for playback).
 * - Bounded resources: stored replays per seed, entries per seed, number of seeds, rate-limiter keys,
 *   request body size, and every query limit is a finite integer clamped to [1, max].
 *
 * Deployable: binds to HOST:PORT (default 127.0.0.1:4400), keeps its JSON board in DATA_DIR/board.json
 * (default <cwd>/server/data, the same for source and bundled runs), logs one line per request,
 * rate-limits POST /verify per client IP (default 60/min), and sends CORS headers for CORS_ORIGIN
 * (default *). Behind a reverse proxy set TRUST_PROXY=1 so X-Forwarded-For identifies the client.
 *
 * Run (dev):   node --import tsx server/verify.ts
 * Run (prod):  npm run verifier:build && node server/dist/verify.mjs --host 0.0.0.0 --data-dir /data
 * CLI flags --host --port --data-dir --cors-origin --rate-limit override the env vars of the same name.
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { playSeed } from '../tools/autoplay-lib';
import { Rng } from '../game/src/sim/rng';
import { decodeReplay, verifyReplay, canonicalReplayJson, type ReplayFile } from '../game/src/sim/replay';
import { RULES_VERSION } from '../game/src/sim/types';
import { dailySeedFor } from '../game/src/sim/daily';
import { validateBatch, FUNNEL, type EventBatch, type EventName, type Props } from '../game/src/telemetry/events';
import pkg from '../package.json' with { type: 'json' };

export const VERSION: string = pkg.version;

export interface BoardEntry { seed: string; score: number; player: string; verifiedAt: string; rulesVersion: number; actions: number; replayHash: string; replayAvailable?: boolean }
/** Actions of a verified replay, kept so anyone can watch it; bounded by the replay limits enforced at verification. */
export interface StoredReplay { seed: string; rulesVersion: number; actions: ReplayFile['actions']; score: number; player: string; verifiedAt: string }
/** The autoplayer's median score on a seed: a target that exists on day one without inventing competitors. */
export interface BotPar { par: number; runs: number; tries: number; rulesVersion: number; computedAt: string }
export interface Board { entries: BoardEntry[]; replays?: Record<string, StoredReplay>; pars?: Record<string, BotPar> }

const MAX_BODY = 512 * 1024;
export const MAX_BOARD_LIMIT = 100;
export const MAX_DAILY_LIMIT = 50;

/** Replay identity: SHA-256 of the canonical verified content (actions in canonical field order, see replay.ts). Collision-free in practice, unlike the 32-bit FNV it replaces. */
export const replayId = (r: Pick<ReplayFile, 'rulesVersion' | 'seed' | 'actions'>): string =>
  createHash('sha256').update(canonicalReplayJson(r)).digest('hex');

/** Parse a query limit: finite integer clamped to [1, max]; anything else is the default. */
export function clampInt(raw: string | null | undefined, def: number, max: number, min = 1): number {
  if (raw == null || raw === '') return def;
  const n = Number(raw);
  if (!Number.isFinite(n) || !Number.isInteger(n)) return def;
  return Math.min(max, Math.max(min, n));
}

export class StorageError extends Error {}

/** One bin of a score histogram: [from, to) except the last, which includes its upper edge. */
export interface HistogramBin { from: number; to: number; count: number }
export interface Histogram {
  seed: string; n: number; step: number; bins: HistogramBin[];
  /** the caller's own verified entry, when its hash is on this seed's board */
  mine: { score: number; rank: number; bin: number; percentile: number } | null;
  /** up to five entries above and five below the caller (board order), for the "around you" slice */
  around: { rank: number; player: string; score: number; mine: boolean }[];
}
/** A bin width that reads well on an axis: 1, 2, 2.5, 5 × 10^k, at least 1. */
export function niceStep(raw: number): number {
  if (!(raw > 0)) return 1;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const m = raw / pow;
  const nice = m <= 1 ? 1 : m <= 2 ? 2 : m <= 2.5 ? 2.5 : m <= 5 ? 5 : 10;
  return Math.max(1, nice * pow);
}
/**
 * Pure histogram over board-ordered entries (best first). `binCount` is a target: the step is rounded to a nice width,
 * so the bin count may differ. Percentile = share of other verified runs with a strictly lower score (ties do not count
 * as beaten). With no entries the histogram is empty; nothing is ever invented.
 */
export function histogramOf(ranked: BoardEntry[], hash?: string, binCount = 10): Omit<Histogram, 'seed'> {
  const n = ranked.length;
  if (n === 0) return { n: 0, step: 1, bins: [], mine: null, around: [] };
  const max = Math.max(...ranked.map((e) => e.score), 1);
  const step = niceStep(max / binCount);
  const count = Math.floor(max / step) + 1;
  const bins: HistogramBin[] = Array.from({ length: count }, (_, i) => ({ from: i * step, to: (i + 1) * step, count: 0 }));
  for (const e of ranked) bins[Math.min(count - 1, Math.floor(e.score / step))].count++;
  const idx = hash ? ranked.findIndex((e) => e.replayHash === hash) : -1;
  let mine: Histogram['mine'] = null; let around: Histogram['around'] = [];
  if (idx >= 0) {
    const score = ranked[idx].score;
    const lower = ranked.filter((e) => e.score < score).length;
    mine = { score, rank: idx + 1, bin: Math.min(count - 1, Math.floor(score / step)), percentile: n > 1 ? Math.floor((100 * lower) / (n - 1)) : 0 };
    around = ranked.slice(Math.max(0, idx - 5), idx + 6).map((e, k, arr) => { const rank = idx - (arr.indexOf(e) - k) + (k - arr.indexOf(e)) + 1; void rank; return { rank: ranked.indexOf(e) + 1, player: e.player, score: e.score, mine: e.replayHash === hash }; });
  }
  return { n, step, bins, mine, around };
}

export interface VerifierOptions {
  /** stored replays are kept only for each seed's top N entries (by the board order); default 100 = the /board cap */
  replaysPerSeed?: number;
  /** entries kept per seed (lowest-ranked are dropped on write); default 1000 */
  maxEntriesPerSeed?: number;
  /** seeds kept in the file (least recently active seeds are dropped on write); default 5000 */
  maxSeeds?: number;
}

const byRank = (a: BoardEntry, b: BoardEntry) => b.score - a.score || a.verifiedAt.localeCompare(b.verifiedAt);

export class Verifier {
  private data: Board;
  readonly replaysPerSeed: number;
  readonly maxEntriesPerSeed: number;
  readonly maxSeeds: number;
  constructor(private file: string, opts: VerifierOptions = {}) {
    this.replaysPerSeed = opts.replaysPerSeed ?? 100;
    this.maxEntriesPerSeed = opts.maxEntriesPerSeed ?? 1000;
    this.maxSeeds = opts.maxSeeds ?? 5000;
    this.data = fs.existsSync(file) ? loadBoard(fs.readFileSync(file, 'utf8')) : { entries: [] };
  }

  /** Current-version entries for a seed in board order. Entries persisted under another rules version never rank. */
  private rank(seed: string, data: Board = this.data): BoardEntry[] {
    return data.entries.filter((e) => e.seed === seed && e.rulesVersion === RULES_VERSION).sort(byRank);
  }
  /** Current-version entries (what /health and the boards count). */
  get size() { return this.data.entries.reduce((n, e) => n + (e.rulesVersion === RULES_VERSION ? 1 : 0), 0); }
  get sizeAllVersions() { return this.data.entries.length; }

  /** Retention on a candidate board: cap entries for `seed`, cap the number of seeds, keep replays only for each seed's top N. */
  private prune(data: Board, seed: string) {
    const ranked = this.rank(seed, data);
    if (ranked.length > this.maxEntriesPerSeed) {
      const drop = new Set(ranked.slice(this.maxEntriesPerSeed).map((e) => e.replayHash));
      data.entries = data.entries.filter((e) => !drop.has(e.replayHash));
    }
    const lastActive = new Map<string, string>();
    for (const e of data.entries) if ((lastActive.get(e.seed) ?? '') < e.verifiedAt) lastActive.set(e.seed, e.verifiedAt);
    if (lastActive.size > this.maxSeeds) {
      const stale = new Set([...lastActive.entries()].sort((a, b) => a[1].localeCompare(b[1])).slice(0, lastActive.size - this.maxSeeds).map(([s]) => s));
      data.entries = data.entries.filter((e) => !stale.has(e.seed));
    }
    if (data.replays) {
      const keep = new Set<string>();
      const touched = new Set(data.entries.map((e) => e.seed));
      for (const s of touched) for (const e of this.rank(s, data).slice(0, this.replaysPerSeed)) keep.add(e.replayHash);
      for (const h of Object.keys(data.replays)) if (!keep.has(h)) delete data.replays[h];
    }
  }

  /** Write a candidate board atomically (temp file + rename in the same directory). Memory changes only after the rename succeeds. */
  private commit(candidate: Board) {
    const dir = path.dirname(this.file);
    const tmp = path.join(dir, `.board-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}.tmp`);
    try {
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(tmp, JSON.stringify(candidate, null, 1));
      fs.renameSync(tmp, this.file);
    } catch (e) {
      try { fs.rmSync(tmp, { force: true }); } catch { /* best effort */ }
      throw new StorageError(`storage unavailable: ${(e as Error).message}`);
    }
    this.data = candidate;
  }

  /** Verify a replay; on success record it. Returns the verdict (never trusts claimedScore). Throws StorageError if it cannot persist. */
  submit(replayText: string, player = 'anonymous'): { ok: boolean; score?: number; error?: string; entry?: BoardEntry } {
    let replay: ReplayFile;
    try { replay = decodeReplay(replayText); } catch (e) { return { ok: false, error: `rejected: ${(e as Error).message}` }; }
    if (replay.rulesVersion !== RULES_VERSION) return { ok: false, error: `rejected: rules version ${replay.rulesVersion} not accepted (server has ${RULES_VERSION})` };
    const v = verifyReplay(replay);
    if (!v.ok) return { ok: false, error: v.error ? `rejected: ${v.error}` : `rejected: re-simulated score $${v.score} does not match claimed $${v.claimed}${v.finished ? '' : ' (run not finished)'}` };
    const replayHash = replayId(replay);
    if (this.data.entries.some((e) => e.replayHash === replayHash)) return { ok: false, error: 'rejected: duplicate replay' };
    const entry: BoardEntry = { seed: replay.seed, score: v.score, player: String(player).replace(/\s+/g, ' ').trim().slice(0, 32) || 'anonymous', verifiedAt: new Date().toISOString(), rulesVersion: replay.rulesVersion, actions: replay.actions.length, replayHash };
    const candidate: Board = {
      ...this.data, // never rebuild the board from a subset of its fields: cached pars were lost that way (review F08)
      entries: [...this.data.entries, entry],
      replays: { ...(this.data.replays ?? {}), [replayHash]: { seed: replay.seed, rulesVersion: replay.rulesVersion, actions: replay.actions, score: v.score, player: entry.player, verifiedAt: entry.verifiedAt } },
    };
    this.prune(candidate, replay.seed);
    this.commit(candidate); // throws StorageError: nothing recorded, caller answers 503
    return { ok: true, score: v.score, entry };
  }
  board(seed: string, limit = 20): BoardEntry[] {
    const n = Math.min(MAX_BOARD_LIMIT, Math.max(1, Math.floor(limit) || 1));
    return this.rank(seed).slice(0, n).map((e) => ({ ...e, replayAvailable: !!this.data.replays?.[e.replayHash] }));
  }
  /** Stored replay of a verified, current-version entry (boards written before replay storage existed have none). */
  replay(hash: string): (StoredReplay & { hash: string }) | null {
    const r = this.data.replays?.[hash];
    return r && r.rulesVersion === RULES_VERSION ? { hash, ...r } : null;
  }
  /** The stored bot par for a seed under the current rules, or null when it has not been computed. */
  par(seed: string): number | null { const p = this.data.pars?.[seed]; return p && p.rulesVersion === RULES_VERSION ? p.par : null; }
  /** Persist a computed par (atomic, like every write); cached pars are capped at maxSeeds, oldest first (review F07). */
  setPar(seed: string, par: number, runs: number, tries: number) {
    const pars = { ...(this.data.pars ?? {}), [seed]: { par, runs, tries, rulesVersion: RULES_VERSION, computedAt: new Date().toISOString() } };
    const keys = Object.keys(pars);
    if (keys.length > this.maxSeeds) for (const k of keys.sort((a, b) => pars[a].computedAt.localeCompare(pars[b].computedAt)).slice(0, keys.length - this.maxSeeds)) delete pars[k];
    this.commit({ ...this.data, pars });
  }
  /** Number of cached pars (for tests and /health). */
  get parCount() { return Object.keys(this.data.pars ?? {}).length; }
  /** Verified score distribution for a seed; `hash` locates the caller's own entry. */
  histogram(seed: string, hash?: string): Histogram { return { seed, ...histogramOf(this.rank(seed), hash) }; }
  /** Today's challenge: the seed every client derives for this UTC date, plus its verified board. */
  daily(limit = 10, now = new Date()): { seed: string; date: string; rulesVersion: number; verified: true; entries: BoardEntry[] } {
    const seed = dailySeedFor(now);
    return { seed, date: now.toISOString().slice(0, 10), rulesVersion: RULES_VERSION, verified: true, entries: this.board(seed, Math.min(MAX_DAILY_LIMIT, limit)) };
  }
}

// ---------- bot par: the autoplayer as a day-one target ----------
export const PAR_RUNS = 5;
export const PAR_TRIES = 40;
/** Median autoplayer score over PAR_RUNS independent searches (fixed rng streams, so identical on every machine). Synchronous: run it in a worker. */
export function computeParSync(seed: string, runs = PAR_RUNS, tries = PAR_TRIES): number {
  const scores: number[] = [];
  for (let k = 0; k < runs; k++) scores.push(playSeed(seed, new Rng(`${seed}:par:${k}`), tries).report.score);
  scores.sort((a, b) => a - b);
  return scores[Math.floor(scores.length / 2)];
}
// worker entry: this same module is loaded in a worker thread with { parSeed } and answers with the par
if (!isMainThread && parentPort && workerData && typeof (workerData as { parSeed?: unknown }).parSeed === 'string') {
  const wd = workerData as { parSeed: string; runs?: number; tries?: number };
  parentPort.postMessage(computeParSync(wd.parSeed, wd.runs, wd.tries));
}
/** Only the module-loader flags of this process (e.g. --import tsx) go to the worker: node --test adds flags a Worker rejects. */
function loaderArgs(): string[] {
  const out: string[] = []; const a = process.execArgv;
  for (let i = 0; i < a.length; i++) { const f = a[i]; if (/^--(import|loader|experimental-loader|require)(=|$)/.test(f)) { out.push(f); if (!f.includes('=') && i + 1 < a.length) out.push(a[++i]); } }
  return out;
}
/** Compute a par off the request path: a worker thread running this module, terminated at the wall-clock cap. */
export function computeParInWorker(seed: string, capMs = 20_000, runs = PAR_RUNS, tries = PAR_TRIES): Promise<number> {
  return new Promise((resolve, reject) => {
    const w = new Worker(new URL(import.meta.url), { workerData: { parSeed: seed, runs, tries }, execArgv: loaderArgs() });
    const timer = setTimeout(() => { void w.terminate(); reject(new Error(`par for ${seed} exceeded ${capMs} ms`)); }, capMs);
    w.once('message', (v: number) => { clearTimeout(timer); resolve(v); void w.terminate(); });
    w.once('error', (e) => { clearTimeout(timer); reject(e); });
    w.once('exit', (code) => { clearTimeout(timer); if (code !== 0) reject(new Error(`par worker exited with ${code}`)); });
  });
}
export interface ParServiceOptions { /** seeds waiting behind the running job; anything beyond is refused (reads still answer) */ maxQueue?: number; /** failure memory entries kept */ maxFailures?: number }
/**
 * One par job at a time, deduplicated per seed; failures back off instead of retrying on every request. Admission is
 * bounded (review F07): unauthenticated reads can enqueue at most `maxQueue` seeds, today's daily seed jumps the queue,
 * the failure memory expires and is capped, and ordinary reads are served whether or not new work was admitted.
 */
export class ParService {
  private pending: string | null = null;
  private queue: string[] = [];
  private failedAt = new Map<string, number>();
  readonly maxQueue: number;
  readonly maxFailures: number;
  constructor(private readonly verifier: Verifier, private readonly compute: (seed: string) => Promise<number> = (s) => computeParInWorker(s), private readonly cooldownMs = 10 * 60_000, private readonly now: () => number = Date.now, opts: ParServiceOptions = {}) {
    this.maxQueue = opts.maxQueue ?? 8; this.maxFailures = opts.maxFailures ?? 500;
  }
  get busy(): string | null { return this.pending; }
  get queued(): number { return this.queue.length; }
  get failures(): number { return this.failedAt.size; }
  /** Ask for a seed's par; returns at once with whether the work was admitted. Known, queued, recently failed or over-capacity requests are not. */
  request(seed: string, priority = false): boolean {
    if (!seed || this.verifier.par(seed) != null || this.pending === seed || this.queue.includes(seed)) return false;
    const failed = this.failedAt.get(seed); if (failed != null && this.now() - failed < this.cooldownMs) return false;
    if (this.queue.length >= this.maxQueue) { if (!priority) return false; this.queue.pop(); }
    if (priority) this.queue.unshift(seed); else this.queue.push(seed);
    this.drain();
    return true;
  }
  private fail(seed: string) {
    this.failedAt.set(seed, this.now());
    const t = this.now();
    for (const [s, at] of this.failedAt) if (t - at >= this.cooldownMs) this.failedAt.delete(s);
    while (this.failedAt.size > this.maxFailures) this.failedAt.delete(this.failedAt.keys().next().value as string);
  }
  private drain() {
    if (this.pending || !this.queue.length) return;
    const seed = this.queue.shift()!; this.pending = seed;
    this.compute(seed)
      .then((par) => { try { this.verifier.setPar(seed, par, PAR_RUNS, PAR_TRIES); } catch { this.fail(seed); } })
      .catch(() => this.fail(seed))
      .finally(() => { this.pending = null; this.drain(); });
  }
}

/** Parse a board file defensively: a damaged file yields an empty board instead of a crash, and bad rows are dropped. */
export function loadBoard(text: string): Board {
  try {
    const raw = JSON.parse(text) as Partial<Board>;
    const entries = Array.isArray(raw.entries) ? raw.entries.filter((e): e is BoardEntry => !!e && typeof e.seed === 'string' && typeof e.score === 'number' && typeof e.replayHash === 'string' && typeof e.verifiedAt === 'string' && Number.isInteger(e.rulesVersion)) : [];
    const replays: Record<string, StoredReplay> = {};
    if (raw.replays && typeof raw.replays === 'object') for (const [h, r] of Object.entries(raw.replays)) if (r && typeof r.seed === 'string' && Array.isArray(r.actions) && Number.isInteger(r.rulesVersion)) replays[h] = r;
    const pars: Record<string, BotPar> = {};
    if (raw.pars && typeof raw.pars === 'object') for (const [s, p] of Object.entries(raw.pars)) if (p && typeof p.par === 'number' && Number.isInteger(p.rulesVersion)) pars[s] = p;
    return Object.keys(pars).length ? { entries, replays, pars } : { entries, replays };
  } catch { return { entries: [] }; }
}

/** One stored funnel event (a line of events.jsonl). The IP is a daily-salted hash, never the address. */
export interface StoredEvent { at: string; receivedAt: string; installId: string; ip: string; name: EventName; props: Props }

/** Append-only JSON-lines store for opt-in funnel events with time-based retention (PLAN-v1 0.3.7). */
export class EventStore {
  constructor(public readonly file: string, public readonly retentionDays = 30, private readonly salt = randomBytes(16).toString('hex')) {}
  /** Daily-salted hash of a client address: the same client is one key within a day, unlinkable across days or restarts. */
  ipHash(ip: string, now = new Date()): string { return createHash('sha256').update(`${this.salt}:${now.toISOString().slice(0, 10)}:${ip}`).digest('hex').slice(0, 16); }
  /** Append a validated batch; throws StorageError when the file cannot be written (nothing is kept in memory). */
  append(batch: EventBatch, ip: string, now = new Date()): number {
    const rows: StoredEvent[] = batch.events.map((e) => ({ at: e.at, receivedAt: now.toISOString(), installId: batch.installId, ip: this.ipHash(ip, now), name: e.name, props: e.props ?? {} }));
    try { fs.mkdirSync(path.dirname(this.file), { recursive: true }); fs.appendFileSync(this.file, rows.map((r) => JSON.stringify(r)).join('\n') + '\n'); }
    catch (e) { throw new StorageError(`events storage unavailable: ${(e as Error).message}`); }
    return rows.length;
  }
  /** Every stored row (damaged lines are skipped). */
  rows(): StoredEvent[] {
    if (!fs.existsSync(this.file)) return [];
    return fs.readFileSync(this.file, 'utf8').split('\n').filter(Boolean).flatMap((l) => { try { const r = JSON.parse(l) as StoredEvent; return r && typeof r.name === 'string' && typeof r.installId === 'string' && typeof r.receivedAt === 'string' ? [r] : []; } catch { return []; } });
  }
  /** Drop rows received more than retentionDays ago (atomic rewrite). Returns how many were removed. */
  prune(now = new Date()): number {
    const cutoff = now.getTime() - this.retentionDays * 86_400_000;
    const rows = this.rows();
    const keep = rows.filter((r) => Date.parse(r.receivedAt) >= cutoff);
    if (keep.length === rows.length) return 0;
    const tmp = `${this.file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, keep.map((r) => JSON.stringify(r)).join('\n') + (keep.length ? '\n' : ''));
    fs.renameSync(tmp, this.file);
    return rows.length - keep.length;
  }
  /** Unique installs per funnel step, plus event counts. */
  funnel(rows: StoredEvent[] = this.rows()) {
    const byName = new Map<string, Set<string>>();
    const counts: Record<string, number> = {};
    for (const r of rows) { (byName.get(r.name) ?? byName.set(r.name, new Set()).get(r.name)!).add(r.installId); counts[r.name] = (counts[r.name] ?? 0) + 1; }
    const installs = new Set(rows.map((r) => r.installId)).size;
    return { installs, events: rows.length, steps: FUNNEL.map((name) => ({ name, installs: byName.get(name)?.size ?? 0 })), counts };
  }
}

/** Fixed-window per-key counter with bounded cardinality (good enough for a small public verifier; one process). */
export class RateLimiter {
  private hits = new Map<string, { count: number; resetAt: number }>();
  constructor(public limit: number, public windowMs: number, private now: () => number = Date.now, public maxKeys = 10_000) {}
  get keys() { return this.hits.size; }
  /** Returns { ok, retryAfterSec } and counts the hit. */
  take(key: string): { ok: boolean; remaining: number; retryAfterSec: number } {
    const t = this.now();
    let h = this.hits.get(key);
    if (!h || h.resetAt <= t) { h = { count: 0, resetAt: t + this.windowMs }; this.hits.delete(key); this.hits.set(key, h); }
    if (this.hits.size > this.maxKeys) {
      for (const [k, v] of this.hits) if (v.resetAt <= t) this.hits.delete(k);
      // still over: evict the oldest windows first (Map keeps insertion order; re-set above keeps fresh keys last)
      for (const k of this.hits.keys()) { if (this.hits.size <= this.maxKeys) break; if (k !== key) this.hits.delete(k); }
    }
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
  /** opt-in funnel events store; null (default) disables POST /events and GET /funnel */
  events?: EventStore | null;
  /** POST /events limit per client IP per minute (default 30) */
  eventsRateLimit?: number;
  /** bot-par jobs (PLAN-v1 0.4.5); null (default) means pars are never computed */
  par?: ParService | null;
}

export function clientIp(req: http.IncomingMessage, trustProxy: boolean): string {
  if (trustProxy) { const xf = req.headers['x-forwarded-for']; const first = (Array.isArray(xf) ? xf[0] : xf || '').split(',')[0].trim(); if (first) return first; }
  return req.socket.remoteAddress || 'unknown';
}

export function createServer(verifier: Verifier, opts: ServerOptions = {}) {
  const rl = opts.rateLimit === null ? null : new RateLimiter(opts.rateLimit?.limit ?? 60, opts.rateLimit?.windowMs ?? 60_000, opts.now);
  const events = opts.events ?? null;
  const par = opts.par ?? null;
  const withPar = (seed: string) => { par?.request(seed, seed === dailySeedFor(new Date())); return verifier.par(seed); }; // today's seed goes first; the answer never waits for the job
  const erl = events ? new RateLimiter(opts.eventsRateLimit ?? 30, 60_000, opts.now) : null;
  const MAX_EVENTS_BODY = 64 * 1024;
  const corsOrigin = opts.corsOrigin ?? '*';
  const log = opts.log === null ? null : opts.log ?? ((l: string) => console.log(l));
  const started = Date.now();
  const cors = { 'Access-Control-Allow-Origin': corsOrigin, 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type', 'Vary': 'Origin' };
  const server = http.createServer((req, res) => {
    const t0 = Date.now();
    const ip = clientIp(req, !!opts.trustProxy);
    const json = (code: number, body: unknown, extra: Record<string, string> = {}, pathForLog = req.url ?? '') => {
      if (res.writableEnded) return;
      res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...cors, ...extra }); res.end(JSON.stringify(body));
      log?.(`${new Date().toISOString()} ${ip} ${req.method} ${pathForLog} ${code} ${Date.now() - t0}ms`);
    };
    /** Asynchronous handlers (request 'end') run outside the route() try/catch: anything they throw would kill the process. */
    const guarded = (fn: () => void) => { try { fn(); } catch { if (!res.writableEnded) json(500, { ok: false, error: 'internal error' }); } };
    let url: URL;
    try { url = new URL(req.url || '/', 'http://localhost'); } catch { req.resume(); return json(400, { ok: false, error: 'bad request: malformed URL' }, {}, '(malformed)'); }
    const route = () => {
      if (req.method === 'OPTIONS') { res.writeHead(204, cors); return res.end(); }
      if (req.method === 'GET' && url.pathname === '/health') return json(200, { ok: true, version: VERSION, rulesVersion: RULES_VERSION, entries: verifier.size, entriesAllVersions: verifier.sizeAllVersions, uptimeSec: Math.round((Date.now() - started) / 1000) });
      if (req.method === 'GET' && url.pathname === '/replay') { const r = verifier.replay(url.searchParams.get('hash') || ''); return r ? json(200, { ok: true, ...r }) : json(404, { ok: false, error: 'no verified replay with that hash' }); }
      if (req.method === 'GET' && url.pathname === '/daily') { const d = verifier.daily(clampInt(url.searchParams.get('limit'), 10, MAX_DAILY_LIMIT)); return json(200, { ...d, botPar: withPar(d.seed) }); }
      if (req.method === 'GET' && url.pathname === '/histogram') { const seed = (url.searchParams.get('seed') || '').slice(0, 64); return json(200, { ok: true, ...verifier.histogram(seed, (url.searchParams.get('hash') || '').slice(0, 64) || undefined), botPar: withPar(seed) }); }
      if (req.method === 'GET' && url.pathname === '/board') { const seed = (url.searchParams.get('seed') || '').slice(0, 64); return json(200, { seed, verified: true, entries: verifier.board(seed, clampInt(url.searchParams.get('limit'), 20, MAX_BOARD_LIMIT)), botPar: withPar(seed) }); }
      if (req.method === 'POST' && url.pathname === '/verify') {
        if (rl) { const r = rl.take(ip); if (!r.ok) { req.resume(); return json(429, { ok: false, error: `rate limited: ${rl.limit} submissions per ${rl.windowMs / 1000}s` }, { 'Retry-After': String(r.retryAfterSec) }); } }
        let body = '';
        req.on('data', (c) => { body += c; if (body.length > MAX_BODY) { json(413, { ok: false, error: 'too large' }); req.destroy(); } });
        req.on('end', () => guarded(() => {
          if (res.writableEnded) return;
          let parsed: { replay: unknown; player?: string };
          try { parsed = JSON.parse(body) as { replay: unknown; player?: string }; } catch (e) { return json(400, { ok: false, error: `bad request: ${(e as Error).message}` }); }
          if (!parsed || typeof parsed !== 'object') return json(400, { ok: false, error: 'bad request: body is not an object' });
          try {
            const result = verifier.submit(JSON.stringify(parsed.replay ?? null), typeof parsed.player === 'string' ? parsed.player : undefined);
            if (result.ok && result.entry) par?.request(result.entry.seed);
            json(result.ok ? 200 : 422, result);
          } catch (e) {
            if (e instanceof StorageError) return json(503, { ok: false, error: 'storage unavailable, nothing was recorded; try again' }, { 'Retry-After': '5' });
            json(500, { ok: false, error: 'internal error' });
          }
        }));
        return;
      }
      if (req.method === 'GET' && url.pathname === '/funnel' && events) return json(200, { ok: true, ...events.funnel() });
      if (req.method === 'POST' && url.pathname === '/events' && events && erl) {
        const r = erl.take(ip); if (!r.ok) { req.resume(); return json(429, { ok: false, error: 'rate limited' }, { 'Retry-After': String(r.retryAfterSec) }); }
        let body = '';
        req.on('data', (c) => { body += c; if (body.length > MAX_EVENTS_BODY) { json(413, { ok: false, error: 'too large' }); req.destroy(); } });
        req.on('end', () => guarded(() => {
          if (res.writableEnded) return;
          let parsed: unknown;
          try { parsed = JSON.parse(body); } catch (e) { return json(400, { ok: false, error: `bad request: ${(e as Error).message}` }); }
          let batch: ReturnType<typeof validateBatch>;
          try { batch = validateBatch(parsed); } catch { batch = 'unreadable batch'; } // validation is meant to be total; a surprise still answers 4xx
          if (typeof batch === 'string') return json(422, { ok: false, error: `rejected: ${batch}`.slice(0, 200) });
          try { json(200, { ok: true, stored: events.append(batch, ip) }); }
          catch (e) { if (e instanceof StorageError) return json(503, { ok: false, error: 'storage unavailable, nothing was recorded; try again' }, { 'Retry-After': '5' }); json(500, { ok: false, error: 'internal error' }); }
        }));
        return;
      }
      json(404, { ok: false, error: 'not found' });
    };
    try { route(); } catch { json(500, { ok: false, error: 'internal error' }); }
  });
  // malformed HTTP at the socket level (not a parsable request): answer 400 and close instead of letting the parser error propagate
  server.on('clientError', (_err, socket) => { if (socket.writable) socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\nContent-Length: 0\r\n\r\n'); socket.destroy(); });
  return server;
}

const isMain = isMainThread && process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const args = process.argv.slice(2);
  const flag = (k: string) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : undefined; };
  const host = flag('host') || process.env.HOST || '127.0.0.1';
  const port = Number(flag('port') || process.env.PORT || 4400);
  // default relative to the working directory so `npm run verifier` and `node server/dist/verify.mjs` agree on server/data
  const dataDir = flag('data-dir') || process.env.DATA_DIR || path.join(process.cwd(), 'server', 'data');
  const file = process.env.BOARD_FILE || path.join(dataDir, 'board.json');
  const corsOrigin = flag('cors-origin') || process.env.CORS_ORIGIN || '*';
  const limit = Number(flag('rate-limit') || process.env.RATE_LIMIT || 60);
  const trustProxy = process.env.TRUST_PROXY === '1';
  // opt-in funnel events live next to the board (EVENTS_FILE overrides); retention is enforced at start and hourly
  const events = new EventStore(process.env.EVENTS_FILE || path.join(path.dirname(file), 'events.jsonl'), Number(process.env.EVENTS_RETENTION_DAYS || 30));
  const pruned = events.prune(); if (pruned) console.log(`events: pruned ${pruned} rows older than ${events.retentionDays} days`);
  setInterval(() => { try { events.prune(); } catch { /* next hour */ } }, 3_600_000).unref();
  const verifier = new Verifier(file);
  const par = process.env.BOT_PAR === '0' ? null : new ParService(verifier, (s) => computeParInWorker(s, Number(process.env.BOT_PAR_CAP_MS || 20_000)));
  createServer(verifier, { rateLimit: { limit, windowMs: 60_000 }, corsOrigin, trustProxy, log: process.env.VERIFIER_LOG === '0' ? null : undefined, events, par })
    .listen(port, host, () => console.log(`replay verifier v${VERSION} → http://${host}:${port}/  (board: ${file}, events: ${events.file}, rules v${RULES_VERSION}, ${limit} submissions/min/IP, CORS ${corsOrigin}${trustProxy ? ', trusting X-Forwarded-For' : ''})`));
}
