/**
 * Replay verifier + verified-only leaderboard (the trusted side of scoring).
 * - POST /verify   { replay: ReplayFile, player?: string } → re-simulates; stores ONLY verified scores.
 * - GET  /board?seed=<seed>&limit=20 → verified scores for a seed (never client-claimed scores).
 * - GET  /daily?limit=10[&date=YYYY-MM-DD] → the minted daily seed for today (or an opened past day) with its verified board,
 *   the commitment to the next day's seed and the previous day's record (PLAN-v3 0.6.1); a day that has not opened is 403.
 *   Each day closes 48 h after 00:00 UTC (`closesAt`); from then on `final`/`frozenAt` are set and the board never changes;
 *   a later submission is verified and answered `{ ok, score, late: true, recorded: false }` (PLAN-v3 0.6.2).
 * - GET  /archive?from=&to=&limit=30 → closed days newest first with N, bot par, medals and the top five; `nextTo` pages older.
 * - Cold storage (PLAN-v4 0.7.0): frozen dailies older than HOT_DAYS move to cold/YYYY-MM.json with every entry and only the top
 *   COLD_REPLAYS_PER_DAY replays; boards, histograms, medals, pars and the archive read them lazily; the commit path writes the hot file only.
 * - Reveal gate (PLAN-v3 0.6.6): GET /replay for a replay on an OPEN minted daily answers 403 unless the bearer's player has a
 *   verified entry on that seed; closed days, ordinary and practice seeds are never gated.
 * - Medals (PLAN-v3 0.6.4): at freeze the day's verified scores set bronze/silver/gold at the 50th/80th/95th nearest-rank
 *   percentiles (null below 5 runs); stored on the day, returned by /daily, /archive and /histogram (frozen daily seeds only).
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
import { replay as replayRun } from '../game/src/sim/run';
import { RULES_VERSION } from '../game/src/sim/types';
import { dailySeedFor, isMintedDailySeed, dailyDateOf } from '../game/src/sim/daily';
import { mintSeed, commitmentFor, shiftDate, utcDate, dayStartMs, isUtcDate, DAILY_WINDOW_MS } from './mint';
import { medalThresholds, type Medals } from '../game/src/daily/medals';
import { ColdStore, HOT_DAYS, COLD_REPLAYS_PER_DAY, type ColdDay } from './cold';
export { HOT_DAYS, COLD_REPLAYS_PER_DAY, ColdStore } from './cold';
export { medalThresholds, medalFor, MEDAL_PERCENTILES, MEDAL_MIN_N, type Medals } from '../game/src/daily/medals';
export { mintSeed, commitmentFor, shiftDate, utcDate, isUtcDate, DAILY_WINDOW_MS } from './mint';
import { validateBatch, FUNNEL, type EventBatch, type EventName, type Props } from '../game/src/telemetry/events';
import pkg from '../package.json' with { type: 'json' };
import { tagFor, labelFor, normaliseName, nameProblem, TOKEN_HEX } from '../game/src/identity/identity';

/** Protocol level of this server's HTTP surface (PLAN-v3 §1): 2 adds identity (bearer tokens, /identity, DELETE /me, keep-best per player). */
export const PROTOCOL = 2;
export const RENAME_COOLDOWN_MS = 24 * 60 * 60_000;
/** A claimed identity: the player id is the SHA-256 of a device token the server never stores. */
export interface Player { name: string; tag: string; createdAt: string; renamedAt: string }
/** Player id from a bearer token (32 hex chars); null when absent or malformed. The token itself is never kept or logged. */
export function playerIdFromToken(token: string | null | undefined): string | null {
  if (!token || !TOKEN_HEX.test(token)) return null;
  return createHash('sha256').update(token).digest('hex');
}
export function bearerOf(req: http.IncomingMessage): string | null {
  const h = req.headers.authorization; if (!h) return null;
  const m = /^Bearer\s+([0-9a-f]{32})$/i.exec(h.trim()); return m ? m[1].toLowerCase() : null;
}

export const VERSION: string = pkg.version;

/** `finalMachines` (rules v3, PLAN-v2 0.5.5): machines on the grid in the last round, derived by the verifier from the re-simulated replay, never taken from a payload; entries written before it exist without it and rank last among equal scores until derived from their stored replay. */
export interface BoardEntry { seed: string; score: number; player: string; verifiedAt: string; rulesVersion: number; actions: number; replayHash: string; replayAvailable?: boolean; finalMachines?: number; /** claimed identity (PLAN-v3 0.6.0); absent on anonymous entries, which are never claimable */ playerId?: string }
/** Printed under every board: the one comparator, in words. */
export const TIE_BREAK = 'Equal scores: fewer machines in round 6 first, then the earlier verified submission.';
/** Machines on the grid in the final round of a replay, or null when it cannot be re-simulated. */
export function finalMachinesOf(r: Pick<ReplayFile, 'seed' | 'actions' | 'rulesVersion'>): number | null {
  try { const s = replayRun(r.seed, r.actions, r.rulesVersion); const last = s.rounds[s.rounds.length - 1]; return last ? last.layout.machines.length : null; } catch { return null; }
}
/** Actions of a verified replay, kept so anyone can watch it; bounded by the replay limits enforced at verification. */
export interface StoredReplay { seed: string; rulesVersion: number; actions: ReplayFile['actions']; score: number; player: string; verifiedAt: string }
/** The autoplayer's median score on a seed: a target that exists on day one without inventing competitors. */
export interface BotPar { par: number; runs: number; tries: number; rulesVersion: number; computedAt: string }
/** One issued daily (PLAN-v3 0.6.1): the seed minted from the secret for that UTC date, the commitment to the next day's seed, and the window. */
export interface DailyRecord { date: string; seed: string; commitment: string; issuedAt: string; closesAt: string; rulesVersion: number; build: string; /** set once the window closed (= closesAt); the board is final from then on (PLAN-v3 0.6.2) */ frozenAt?: string; /** computed once at freeze from the final board (PLAN-v3 0.6.4): thresholds, or null when fewer than MEDAL_MIN_N runs; absent while open */ medals?: Medals | null }
/** One closed day in GET /archive. */
export interface ArchiveDay { date: string; seed: string; closesAt: string; frozenAt: string; n: number; botPar: number | null; medals: Medals | null; top: BoardEntry[] }
export const MAX_ARCHIVE_LIMIT = 100;
/** Defaults the policy page publishes (PLAN-v3 0.6.5); env/flags override the rate limits at runtime. */
export const DEFAULT_RATE_LIMIT = 60, DEFAULT_PLAYER_RATE_LIMIT = 2, IDENTITY_RATE_LIMIT = 5, DEFAULT_EVENTS_RATE_LIMIT = 30;
export const DEFAULT_REPLAYS_PER_SEED = 100, DEFAULT_MAX_ENTRIES_PER_SEED = 1000, DEFAULT_MAX_SEEDS = 5000, DEFAULT_EVENTS_RETENTION_DAYS = 30;
export interface Board { entries: BoardEntry[]; replays?: Record<string, StoredReplay>; pars?: Record<string, BotPar>; players?: Record<string, Player>; dailies?: Record<string, DailyRecord> }

export const MAX_BODY_BYTES = 512 * 1024;
const MAX_BODY = MAX_BODY_BYTES;
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
  /** secret the daily seeds are minted from (DAILY_SECRET); a random per-process secret when absent (tests, ad-hoc runs) */
  dailySecret?: string;
}

/** The one comparator (PLAN-v2 0.5.5): score desc, fewer final-round machines, earlier receipt, then the hash so the order is total. Boards, histogram ranks and neighbours, retention and the returned rank all use it. */
const byRank = (a: BoardEntry, b: BoardEntry) => b.score - a.score || (a.finalMachines ?? Infinity) - (b.finalMachines ?? Infinity) || a.verifiedAt.localeCompare(b.verifiedAt) || a.replayHash.localeCompare(b.replayHash);

export class Verifier {
  private data: Board;
  readonly replaysPerSeed: number;
  readonly maxEntriesPerSeed: number;
  readonly maxSeeds: number;
  private readonly dailySecret: string;
  /** Closed dailies older than HOT_DAYS live here (PLAN-v4 0.7.0): read-only, final, loaded lazily. */
  readonly cold: ColdStore;
  constructor(private file: string, opts: VerifierOptions = {}) {
    this.dailySecret = opts.dailySecret || randomBytes(32).toString('hex');
    this.cold = new ColdStore(path.join(path.dirname(file), 'cold'));
    this.replaysPerSeed = opts.replaysPerSeed ?? DEFAULT_REPLAYS_PER_SEED;
    this.maxEntriesPerSeed = opts.maxEntriesPerSeed ?? DEFAULT_MAX_ENTRIES_PER_SEED;
    this.maxSeeds = opts.maxSeeds ?? DEFAULT_MAX_SEEDS;
    this.data = fs.existsSync(file) ? loadBoard(fs.readFileSync(file, 'utf8')) : { entries: [] };
    this.deriveTieBreaks();
  }
  /** Entries recorded before finalMachines existed get it from their stored replay (current version only); persisted when anything changed. */
  private deriveTieBreaks() {
    let changed = false;
    const entries = this.data.entries.map((e) => {
      if (e.finalMachines != null || e.rulesVersion !== RULES_VERSION) return e;
      const r = this.data.replays?.[e.replayHash]; if (!r) return e;
      const n = finalMachinesOf({ seed: r.seed, actions: r.actions, rulesVersion: r.rulesVersion });
      if (n == null) return e;
      changed = true; return { ...e, finalMachines: n };
    });
    if (!changed) return;
    try { this.commit({ ...this.data, entries }); } catch { this.data = { ...this.data, entries }; } // storage trouble: rank correctly in memory anyway
  }

  /** Current-version entries for a seed in board order. Entries persisted under another rules version never rank. */
  private rank(seed: string, data: Board = this.data): BoardEntry[] {
    const hot = data.entries.filter((e) => e.seed === seed && e.rulesVersion === RULES_VERSION).sort(byRank);
    if (hot.length || data !== this.data) return hot;
    return this.coldEntries(seed).filter((e) => e.rulesVersion === RULES_VERSION).sort(byRank);
  }
  /** A cold day's entries with labels resolved against the current identities (renames and deletions follow the player without rewriting cold files). */
  private coldEntries(seed: string): BoardEntry[] {
    const date = this.cold.dateOfSeed(seed); if (!date) return [];
    const day = this.cold.day(date); if (!day || day.record.seed !== seed) return [];
    return day.entries.map((e) => {
      if (!e.playerId) return e;
      const p = this.data.players?.[e.playerId];
      return p ? { ...e, player: labelFor(p.name, p.tag) } : { ...e, player: 'deleted', playerId: undefined };
    });
  }
  /** The issued record for a date from the hot board or cold storage, never minting (PLAN-v4 0.7.0). */
  private issuedRecord(date: string): DailyRecord | null { return this.data.dailies?.[date] ?? this.cold.day(date)?.record ?? null; }
  /**
   * Move frozen dailies older than HOT_DAYS to cold storage: every entry, the record, the par and only the top
   * COLD_REPLAYS_PER_DAY replays. Idempotent; a day is written cold before it leaves the hot board, so a failed hot
   * commit leaves a duplicate that the next split overwrites and the archive dedupes by date.
   */
  splitCold(now = new Date()): { moved: string[] } {
    this.observeFreeze(now);
    const cutoff = shiftDate(utcDate(now), -HOT_DAYS);
    const due = Object.values(this.data.dailies ?? {}).filter((r) => r.frozenAt && r.date < cutoff).sort((a, b) => a.date.localeCompare(b.date));
    if (!due.length) return { moved: [] };
    let entries = this.data.entries; const replays = { ...(this.data.replays ?? {}) }; const pars = { ...(this.data.pars ?? {}) }; const dailies = { ...(this.data.dailies ?? {}) };
    const moved: string[] = [];
    for (const rec of due) {
      const mine = entries.filter((e) => e.seed === rec.seed);
      const top = mine.filter((e) => e.rulesVersion === RULES_VERSION).sort(byRank).slice(0, COLD_REPLAYS_PER_DAY);
      const keep: Record<string, StoredReplay> = {}; for (const e of top) { const r = replays[e.replayHash]; if (r) keep[e.replayHash] = r; }
      const day: ColdDay = { record: rec, entries: mine, replays: keep, par: pars[rec.seed] ?? null };
      try { this.cold.put(day); } catch { continue; } // cold write failed: the day stays hot and is retried on the next split
      entries = entries.filter((e) => e.seed !== rec.seed);
      for (const e of mine) delete replays[e.replayHash];
      delete pars[rec.seed]; delete dailies[rec.date];
      moved.push(rec.date);
    }
    if (moved.length) { const next = { ...this.data, entries, replays, pars, dailies }; try { this.commit(next); } catch { this.data = next; } }
    return { moved };
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
      for (const e of data.entries) if (e.rulesVersion !== RULES_VERSION) keep.add(e.replayHash); // other versions never rank here, but a rollback needs their replays intact (PLAN-v2 §1)
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
  /** Identity records (PLAN-v3 0.6.0). */
  player(id: string): (Player & { playerId: string }) | null { const p = this.data.players?.[id]; return p ? { playerId: id, ...p } : null; }
  /** Claim or rename a display name for a player id. Returns the record or a refusal. */
  claim(playerId: string, rawName: unknown, now = new Date()): { ok: true; player: Player & { playerId: string } } | { ok: false; error: string; retryAfterSec?: number } {
    const problem = nameProblem(rawName); if (problem) return { ok: false, error: problem };
    const name = normaliseName(rawName); const tag = tagFor(playerId);
    const prev = this.data.players?.[playerId];
    if (prev && prev.name === name) return { ok: true, player: { playerId, ...prev } };
    if (prev && prev.renamedAt) { const since = now.getTime() - new Date(prev.renamedAt).getTime(); if (since < RENAME_COOLDOWN_MS) return { ok: false, error: 'name was changed recently; try again later', retryAfterSec: Math.ceil((RENAME_COOLDOWN_MS - since) / 1000) }; }
    const rec: Player = { name, tag, createdAt: prev?.createdAt ?? now.toISOString(), renamedAt: now.toISOString() };
    const players = { ...(this.data.players ?? {}), [playerId]: rec };
    const label = labelFor(name, tag);
    const entries = this.data.entries.map((e) => (e.playerId === playerId ? { ...e, player: label } : e)); // a rename follows the player onto the boards
    this.commit({ ...this.data, players, entries });
    return { ok: true, player: { playerId, ...rec } };
  }
  /** GDPR-minimal deletion: the name goes, the player's entries are anonymised and lose their replays, the id is forgotten. */
  deletePlayer(playerId: string): { entries: number } {
    const mine = this.data.entries.filter((e) => e.playerId === playerId);
    const players = { ...(this.data.players ?? {}) }; delete players[playerId];
    const replays = { ...(this.data.replays ?? {}) }; for (const e of mine) delete replays[e.replayHash];
    const entries = this.data.entries.map((e) => (e.playerId === playerId ? { ...e, player: 'deleted', playerId: undefined } : e));
    this.commit({ ...this.data, players, replays, entries });
    return { entries: mine.length };
  }

  submit(replayText: string, player = 'anonymous', playerId: string | null = null, now = new Date()): { ok: boolean; score?: number; error?: string; entry?: BoardEntry; recorded?: boolean; player?: string; late?: boolean; closesAt?: string } {
    let replay: ReplayFile;
    try { replay = decodeReplay(replayText); } catch (e) { return { ok: false, error: `rejected: ${(e as Error).message}` }; }
    if (replay.rulesVersion !== RULES_VERSION) return { ok: false, error: `rejected: rules version ${replay.rulesVersion} not accepted (server has ${RULES_VERSION})` };
    const v = verifyReplay(replay);
    if (!v.ok) return { ok: false, error: v.error ? `rejected: ${v.error}` : `rejected: re-simulated score $${v.score} does not match claimed $${v.claimed}${v.finished ? '' : ' (run not finished)'}` };
    const replayHash = replayId(replay);
    if (this.data.entries.some((e) => e.replayHash === replayHash)) return { ok: false, error: 'rejected: duplicate replay' };
    if (isMintedDailySeed(replay.seed)) { // a minted-looking seed counts only if this server issued it and its window is open (PLAN-v3 0.6.1)
      const rec = this.issuedRecord(dailyDateOf(replay.seed) ?? '');
      if (!rec || rec.seed !== replay.seed) return { ok: false, error: 'rejected: not an issued daily seed' };
    }
    const claimed = playerId ? this.data.players?.[playerId] : undefined;
    const label = claimed ? labelFor(claimed.name, claimed.tag) : String(player).replace(/\s+/g, ' ').trim().slice(0, 32) || 'anonymous';
    if (isMintedDailySeed(replay.seed)) { // after the close the run is verified and told so, but the final board never changes (PLAN-v3 0.6.2)
      const rec = this.issuedRecord(dailyDateOf(replay.seed)!)!;
      if (now.getTime() >= Date.parse(rec.closesAt)) { this.observeFreeze(now); return { ok: true, score: v.score, late: true, recorded: false, closesAt: rec.closesAt, player: label }; }
    }
    const entry: BoardEntry = { seed: replay.seed, score: v.score, player: label, verifiedAt: new Date().toISOString(), rulesVersion: replay.rulesVersion, actions: replay.actions.length, replayHash, finalMachines: finalMachinesOf(replay) ?? undefined, ...(playerId ? { playerId } : {}) };
    // keep-best per (seed, player): a worse or equal run is verified but not recorded; a better one replaces the old entry and its replay
    let entries = this.data.entries; const replays = { ...(this.data.replays ?? {}) };
    if (playerId) {
      const mine = entries.find((e) => e.seed === replay.seed && e.playerId === playerId && e.rulesVersion === RULES_VERSION);
      if (mine && byRank(mine, entry) <= 0) return { ok: true, score: v.score, entry: mine, recorded: false, player: label };
      if (mine) { entries = entries.filter((e) => e !== mine); delete replays[mine.replayHash]; }
    }
    replays[replayHash] = { seed: replay.seed, rulesVersion: replay.rulesVersion, actions: replay.actions, score: v.score, player: entry.player, verifiedAt: entry.verifiedAt };
    const candidate: Board = {
      ...this.data, // never rebuild the board from a subset of its fields: cached pars were lost that way (review F08)
      entries: [...entries, entry],
      replays,
    };
    this.prune(candidate, replay.seed);
    this.commit(candidate); // throws StorageError: nothing recorded, caller answers 503
    return { ok: true, score: v.score, entry, recorded: true, player: label };
  }
  board(seed: string, limit = 20): BoardEntry[] {
    const n = Math.min(MAX_BOARD_LIMIT, Math.max(1, Math.floor(limit) || 1));
    return this.rank(seed).slice(0, n).map((e) => ({ ...e, replayAvailable: !!this.data.replays?.[e.replayHash] || !!this.cold.dateOfReplay(e.replayHash) }));
  }
  /** Stored replay of a verified, current-version entry (boards written before replay storage existed have none). */
  replay(hash: string): (StoredReplay & { hash: string }) | null {
    const r = this.data.replays?.[hash] ?? (() => { const d = this.cold.dateOfReplay(hash); return d ? this.cold.day(d)?.replays[hash] : undefined; })();
    return r && r.rulesVersion === RULES_VERSION ? { hash, ...r } : null;
  }
  /** Why a replay is not served: 'compacted' when its entry is on a cold day below the kept top (PLAN-v4 0.7.0), else 'unknown'. */
  replayMissingReason(hash: string, seed?: string | null): 'compacted' | 'unknown' {
    if (!seed) return 'unknown';
    const date = this.cold.dateOfSeed(seed); if (!date) return 'unknown';
    const day = this.cold.day(date);
    return day && day.entries.some((e) => e.replayHash === hash) ? 'compacted' : 'unknown';
  }
  /**
   * Reveal gate (PLAN-v3 0.6.6): on an open daily, other players' replays are served only to a player with a verified
   * entry on that seed; once the day closes everyone may watch. Ordinary seeds and practice seeds are never gated.
   * Returns null when allowed, otherwise the reason (and the close time) for a 403.
   */
  revealGate(seed: string, playerId: string | null, now = new Date()): { error: string; closesAt: string } | null {
    if (!isMintedDailySeed(seed)) return null;
    const rec = this.data.dailies?.[dailyDateOf(seed) ?? ''];
    if (!rec || rec.seed !== seed) return null; // not an issued daily: nothing to protect
    if (rec.frozenAt || Date.parse(rec.closesAt) <= now.getTime()) return null;
    if (playerId && this.data.entries.some((e) => e.seed === seed && e.playerId === playerId && e.rulesVersion === RULES_VERSION)) return null;
    return { error: `replays on an open daily are revealed after you submit a verified run for it, or when the day closes at ${rec.closesAt}`, closesAt: rec.closesAt };
  }
  /** The stored bot par for a seed under the current rules, or null when it has not been computed. */
  par(seed: string): number | null { const p = this.data.pars?.[seed] ?? (() => { const d = this.cold.dateOfSeed(seed); return d ? this.cold.day(d)?.par ?? undefined : undefined; })(); return p && p.rulesVersion === RULES_VERSION ? p.par : null; }
  /** Persist a computed par (atomic, like every write); cached pars are capped at maxSeeds, oldest first (review F07). */
  setPar(seed: string, par: number, runs: number, tries: number) {
    const pars = { ...(this.data.pars ?? {}), [seed]: { par, runs, tries, rulesVersion: RULES_VERSION, computedAt: new Date().toISOString() } };
    const keys = Object.keys(pars);
    const dailySeeds = new Set(Object.values(this.data.dailies ?? {}).map((d) => d.seed)); // a day's par is computed once and kept (PLAN-v3 0.6.2)
    if (keys.length > this.maxSeeds) for (const k of keys.filter((k) => !dailySeeds.has(k)).sort((a, b) => pars[a].computedAt.localeCompare(pars[b].computedAt)).slice(0, keys.length - this.maxSeeds)) delete pars[k];
    this.commit({ ...this.data, pars });
  }
  /** Number of cached pars (for tests and /health). */
  get parCount() { return Object.keys(this.data.pars ?? {}).length; }
  /** Verified score distribution for a seed; `hash` locates the caller's own entry. */
  histogram(seed: string, hash?: string): Histogram { return { seed, ...histogramOf(this.rank(seed), hash) }; }
  /** The issued daily for a UTC date, minting and persisting it on first request; null when that day has not opened yet (PLAN-v3 0.6.1). */
  /** Mark every issued day whose window has closed as frozen at its close time: idempotent, persisted, derived from the clock alone (PLAN-v3 0.6.2). */
  private observeFreeze(now: Date) {
    const ds = this.data.dailies; if (!ds) return;
    let changed = false; const next: Record<string, DailyRecord> = {};
    for (const [k, r] of Object.entries(ds)) {
      if (!r.frozenAt && Date.parse(r.closesAt) <= now.getTime()) { next[k] = { ...r, frozenAt: r.closesAt, medals: medalThresholds(this.rank(r.seed).map((e) => e.score)) }; changed = true; } // the final board sets the medals (PLAN-v3 0.6.4)
      else if (r.frozenAt && r.medals === undefined) { next[k] = { ...r, medals: medalThresholds(this.rank(r.seed).map((e) => e.score)) }; changed = true; } // a day frozen before medals existed
      else next[k] = r;
    }
    if (!changed) return;
    const d = { ...this.data, dailies: next }; try { this.commit(d); } catch { this.data = d; }
  }
  dailyRecord(date: string, now = new Date()): DailyRecord | null {
    if (!isUtcDate(date) || date > utcDate(now)) return null;
    const have = this.data.dailies?.[date]; if (have) { this.observeFreeze(now); return this.data.dailies![date]; }
    const cold = this.cold.day(date)?.record; if (cold) return cold; // a closed day in cold storage is final: never re-minted
    const rec: DailyRecord = { date, seed: mintSeed(this.dailySecret, date), commitment: commitmentFor(mintSeed(this.dailySecret, shiftDate(date, 1))), issuedAt: now.toISOString(), closesAt: new Date(dayStartMs(date) + DAILY_WINDOW_MS).toISOString(), rulesVersion: RULES_VERSION, build: VERSION };
    const next = { ...this.data, dailies: { ...(this.data.dailies ?? {}), [date]: rec } };
    try { this.commit(next); } catch { this.data = next; } // storage trouble: serve the minted seed anyway; it is persisted with the next successful write
    this.observeFreeze(now); // a day issued after its own close (an archive lookup) is frozen at once
    return this.data.dailies![date];
  }
  /** Closed days, newest first, paged by `limit` with `nextTo` = the next older date to pass as `to` (PLAN-v3 0.6.2). */
  archive(o: { from?: string; to?: string; limit?: number } = {}, now = new Date()): { days: ArchiveDay[]; nextTo: string | null } {
    this.observeFreeze(now);
    const limit = Math.min(MAX_ARCHIVE_LIMIT, Math.max(1, Math.floor(o.limit ?? 30)));
    const inRange = (d: string) => (!o.from || d >= o.from) && (!o.to || d <= o.to);
    const hotFrozen = Object.values(this.data.dailies ?? {}).filter((r) => r.frozenAt && inRange(r.date));
    const hotDates = new Set(hotFrozen.map((r) => r.date));
    const coldDates = this.cold.dates().filter((d) => inRange(d) && !hotDates.has(d)); // a day present in both (a failed hot commit after a cold write) counts once
    const dates = [...hotFrozen.map((r) => r.date), ...coldDates].sort((a, b) => b.localeCompare(a));
    const days: ArchiveDay[] = [];
    for (const date of dates.slice(0, limit)) {
      const r = this.data.dailies?.[date] ?? this.cold.day(date)?.record; if (!r) continue;
      days.push({ date: r.date, seed: r.seed, closesAt: r.closesAt, frozenAt: r.frozenAt ?? r.closesAt, n: this.rank(r.seed).length, botPar: this.par(r.seed), medals: r.medals ?? null, top: this.board(r.seed, 5) });
    }
    return { days, nextTo: dates.length > limit ? dates[limit] : null };
  }
  /** Medal thresholds for a seed that is a frozen daily; null otherwise (open days, ordinary seeds, too few runs). */
  medalsForSeed(seed: string, now = new Date()): Medals | null {
    if (!isMintedDailySeed(seed)) return null;
    this.observeFreeze(now);
    const rec = this.issuedRecord(dailyDateOf(seed) ?? '');
    return rec && rec.seed === seed && rec.frozenAt ? rec.medals ?? null : null;
  }
  /** Today's minted seed (the one bot par computes first). */
  todaySeed(now = new Date()): string { return this.dailyRecord(utcDate(now), now)!.seed; }
  /** Today's challenge (or an opened past day): the minted record, its verified board, and the previous day for commitment checks. */
  daily(limit = 10, now = new Date(), date = utcDate(now)): (Omit<DailyRecord, 'frozenAt'> & { frozenAt: string | null; final: boolean; now: string; verified: true; minted: true; entries: BoardEntry[]; previous: { date: string; seed: string; commitment: string } | null }) | null {
    const rec = this.dailyRecord(date, now); if (!rec) return null;
    const prev = this.dailyRecord(shiftDate(date, -1), now);
    return { ...rec, frozenAt: rec.frozenAt ?? null, final: !!rec.frozenAt, now: now.toISOString(), verified: true, minted: true, entries: this.board(rec.seed, Math.min(MAX_DAILY_LIMIT, limit)), previous: prev ? { date: prev.date, seed: prev.seed, commitment: prev.commitment } : null };
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
    const players: Record<string, Player> = {};
    if (raw.players && typeof raw.players === 'object') for (const [id, p] of Object.entries(raw.players as Record<string, Player>)) if (p && typeof p.name === 'string' && typeof p.tag === 'string' && /^[0-9a-f]{64}$/.test(id)) players[id] = { name: p.name, tag: p.tag, createdAt: typeof p.createdAt === 'string' ? p.createdAt : '', renamedAt: typeof p.renamedAt === 'string' ? p.renamedAt : '' };
    const dailies: Record<string, DailyRecord> = {};
    if (raw.dailies && typeof raw.dailies === 'object') for (const [date, d] of Object.entries(raw.dailies as Record<string, DailyRecord>)) if (d && isUtcDate(date) && typeof d.seed === 'string' && isMintedDailySeed(d.seed) && typeof d.commitment === 'string') dailies[date] = { date, seed: d.seed, commitment: d.commitment, issuedAt: typeof d.issuedAt === 'string' ? d.issuedAt : '', closesAt: typeof d.closesAt === 'string' ? d.closesAt : new Date(dayStartMs(date) + DAILY_WINDOW_MS).toISOString(), rulesVersion: typeof d.rulesVersion === 'number' ? d.rulesVersion : RULES_VERSION, build: typeof d.build === 'string' ? d.build : '', ...(typeof d.frozenAt === 'string' ? { frozenAt: d.frozenAt } : {}), ...(d.medals === null ? { medals: null } : d.medals && typeof d.medals === 'object' && typeof d.medals.gold === 'number' && typeof d.medals.silver === 'number' && typeof d.medals.bronze === 'number' && typeof d.medals.n === 'number' ? { medals: { n: d.medals.n, bronze: d.medals.bronze, silver: d.medals.silver, gold: d.medals.gold } } : {}) };
    const out: Board = { entries, replays };
    if (Object.keys(pars).length) out.pars = pars;
    if (Object.keys(players).length) out.players = players;
    if (Object.keys(dailies).length) out.dailies = dailies;
    return out;
  } catch { return { entries: [] }; }
}

/** One stored funnel event (a line of events.jsonl). The IP is a daily-salted hash, never the address. */
export interface StoredEvent { at: string; receivedAt: string; installId: string; ip: string; name: EventName; props: Props }

/** Append-only JSON-lines store for opt-in funnel events with time-based retention (PLAN-v1 0.3.7). */
export class EventStore {
  constructor(public readonly file: string, public readonly retentionDays = DEFAULT_EVENTS_RETENTION_DAYS, private readonly salt = randomBytes(16).toString('hex')) {}
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
  /** POST /verify limit per player id per minute when a bearer is present (default 2) */
  playerRateLimit?: number;
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
  const withPar = (seed: string) => { par?.request(seed, seed === verifier.todaySeed(new Date((opts.now ?? Date.now)()))); return verifier.par(seed); }; // today's minted seed goes first; the answer never waits for the job
  const erl = events ? new RateLimiter(opts.eventsRateLimit ?? DEFAULT_EVENTS_RATE_LIMIT, 60_000, opts.now) : null;
  const prl = new RateLimiter(opts.playerRateLimit ?? DEFAULT_PLAYER_RATE_LIMIT, 60_000, opts.now); // per-player submissions (PLAN-v3 §1 abuse baseline)
  const irl = new RateLimiter(IDENTITY_RATE_LIMIT, 60_000, opts.now); // per-player identity calls
  const MAX_EVENTS_BODY = 64 * 1024;
  const corsOrigin = opts.corsOrigin ?? '*';
  const log = opts.log === null ? null : opts.log ?? ((l: string) => console.log(l));
  const started = Date.now();
  const cors = { 'Access-Control-Allow-Origin': corsOrigin, 'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type, Authorization', 'Vary': 'Origin' }; // Authorization and DELETE: identity (PLAN-v3 0.6.0)
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
      if (req.method === 'GET' && url.pathname === '/health') return json(200, { ok: true, version: VERSION, rulesVersion: RULES_VERSION, protocol: PROTOCOL, entries: verifier.size, entriesAllVersions: verifier.sizeAllVersions, cold: { days: verifier.cold.dayCount, replays: verifier.cold.replayCount }, uptimeSec: Math.round((Date.now() - started) / 1000) });
      if (req.method === 'GET' && url.pathname === '/replay') {
        const r = verifier.replay(url.searchParams.get('hash') || '');
        if (!r) { const why = verifier.replayMissingReason(url.searchParams.get('hash') || '', url.searchParams.get('seed')); return json(404, why === 'compacted' ? { ok: false, reason: 'compacted', error: `replay compacted: only the top ${COLD_REPLAYS_PER_DAY} replays of a day older than ${HOT_DAYS} days are kept; the entry and its score stay on the final board` } : { ok: false, error: 'no verified replay with that hash' }); }
        const bearer = playerIdFromToken(bearerOf(req)); if (req.headers.authorization && !bearer) return json(401, { ok: false, error: 'bad token' });
        const gate = verifier.revealGate(r.seed, bearer, new Date((opts.now ?? Date.now)()));
        if (gate) return json(403, { ok: false, reason: 'reveal-gate', ...gate });
        return json(200, { ok: true, ...r });
      }
      if (req.method === 'GET' && url.pathname === '/daily') {
        const now = new Date((opts.now ?? Date.now)()); const dateQ = url.searchParams.get('date');
        if (dateQ !== null && !isUtcDate(dateQ)) return json(400, { ok: false, error: 'date must be YYYY-MM-DD' });
        const d = verifier.daily(clampInt(url.searchParams.get('limit'), 10, MAX_DAILY_LIMIT), now, dateQ ?? undefined);
        if (!d) return json(403, { ok: false, error: `the daily for ${dateQ} has not opened yet (dailies open at 00:00 UTC)`, today: utcDate(now) });
        return json(200, { ok: true, ...d, botPar: withPar(d.seed), tieBreak: TIE_BREAK });
      }
      if (req.method === 'GET' && url.pathname === '/archive') {
        const now = new Date((opts.now ?? Date.now)()); const from = url.searchParams.get('from'), to = url.searchParams.get('to');
        if ((from !== null && !isUtcDate(from)) || (to !== null && !isUtcDate(to))) return json(400, { ok: false, error: 'from/to must be YYYY-MM-DD' });
        return json(200, { ok: true, ...verifier.archive({ from: from ?? undefined, to: to ?? undefined, limit: clampInt(url.searchParams.get('limit'), 30, MAX_ARCHIVE_LIMIT) }, now), tieBreak: TIE_BREAK });
      }
      if (req.method === 'GET' && url.pathname === '/histogram') { const seed = (url.searchParams.get('seed') || '').slice(0, 64); return json(200, { ok: true, ...verifier.histogram(seed, (url.searchParams.get('hash') || '').slice(0, 64) || undefined), botPar: withPar(seed), medals: verifier.medalsForSeed(seed, new Date((opts.now ?? Date.now)())), tieBreak: TIE_BREAK }); }
      if (req.method === 'GET' && url.pathname === '/board') { const seed = (url.searchParams.get('seed') || '').slice(0, 64); return json(200, { seed, verified: true, entries: verifier.board(seed, clampInt(url.searchParams.get('limit'), 20, MAX_BOARD_LIMIT)), botPar: withPar(seed), tieBreak: TIE_BREAK }); }
      // identity (PLAN-v3 0.6.0): the bearer is a device token; only its hash is used or stored
      const bearerId = playerIdFromToken(bearerOf(req));
      if (req.headers.authorization && !bearerId) return json(401, { ok: false, error: 'bad token' });
      if (url.pathname === '/identity' && req.method === 'GET') { if (!bearerId) return json(401, { ok: false, error: 'token required' }); const p = verifier.player(bearerId); return p ? json(200, { ok: true, ...p }) : json(404, { ok: false, error: 'no name claimed for this token', playerId: bearerId, tag: tagFor(bearerId) }); }
      if (url.pathname === '/identity' && req.method === 'POST') {
        if (!bearerId) { req.resume(); return json(401, { ok: false, error: 'token required' }); }
        const r = irl.take(bearerId); if (!r.ok) { req.resume(); return json(429, { ok: false, error: 'rate limited' }, { 'Retry-After': String(r.retryAfterSec) }); }
        let body = '';
        req.on('data', (c) => { body += c; if (body.length > 4096) { json(413, { ok: false, error: 'too large' }); req.destroy(); } });
        req.on('end', () => guarded(() => {
          if (res.writableEnded) return;
          let parsed: { name?: unknown } | null = null;
          try { parsed = JSON.parse(body) as { name?: unknown }; } catch { return json(400, { ok: false, error: 'bad request' }); }
          try {
            const out = verifier.claim(bearerId, parsed && typeof parsed === 'object' ? parsed.name : undefined, new Date((opts.now ?? Date.now)()));
            if (!out.ok) return json(out.retryAfterSec ? 429 : 422, { ok: false, error: out.error }, out.retryAfterSec ? { 'Retry-After': String(out.retryAfterSec) } : {});
            json(200, { ok: true, ...out.player });
          } catch (e) { if (e instanceof StorageError) return json(503, { ok: false, error: 'storage unavailable; try again' }, { 'Retry-After': '5' }); json(500, { ok: false, error: 'internal error' }); }
        }));
        return;
      }
      if (url.pathname === '/me' && req.method === 'DELETE') {
        if (!bearerId) return json(401, { ok: false, error: 'token required' });
        try { const r = verifier.deletePlayer(bearerId); return json(200, { ok: true, anonymisedEntries: r.entries }); }
        catch (e) { if (e instanceof StorageError) return json(503, { ok: false, error: 'storage unavailable; try again' }, { 'Retry-After': '5' }); return json(500, { ok: false, error: 'internal error' }); }
      }
      if (req.method === 'POST' && url.pathname === '/verify') {
        if (rl) { const r = rl.take(ip); if (!r.ok) { req.resume(); return json(429, { ok: false, error: `rate limited: ${rl.limit} submissions per ${rl.windowMs / 1000}s` }, { 'Retry-After': String(r.retryAfterSec) }); } }
        if (bearerId) { const r = prl.take(bearerId); if (!r.ok) { req.resume(); return json(429, { ok: false, error: `rate limited: ${prl.limit} submissions per minute per player` }, { 'Retry-After': String(r.retryAfterSec) }); } }
        let body = '';
        req.on('data', (c) => { body += c; if (body.length > MAX_BODY) { json(413, { ok: false, error: 'too large' }); req.destroy(); } });
        req.on('end', () => guarded(() => {
          if (res.writableEnded) return;
          let parsed: { replay: unknown; player?: string };
          try { parsed = JSON.parse(body) as { replay: unknown; player?: string }; } catch (e) { return json(400, { ok: false, error: `bad request: ${(e as Error).message}` }); }
          if (!parsed || typeof parsed !== 'object') return json(400, { ok: false, error: 'bad request: body is not an object' });
          try {
            const result = verifier.submit(JSON.stringify(parsed.replay ?? null), typeof parsed.player === 'string' ? parsed.player : undefined, bearerId, new Date((opts.now ?? Date.now)()));
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
  const limit = Number(flag('rate-limit') || process.env.RATE_LIMIT || DEFAULT_RATE_LIMIT);
  const trustProxy = process.env.TRUST_PROXY === '1';
  const playerRateLimit = Number(process.env.PLAYER_RATE_LIMIT || DEFAULT_PLAYER_RATE_LIMIT); // POST /verify per player id per minute (PLAN-v3 §1)
  // opt-in funnel events live next to the board (EVENTS_FILE overrides); retention is enforced at start and hourly
  const events = new EventStore(process.env.EVENTS_FILE || path.join(path.dirname(file), 'events.jsonl'), Number(process.env.EVENTS_RETENTION_DAYS || DEFAULT_EVENTS_RETENTION_DAYS));
  const pruned = events.prune(); if (pruned) console.log(`events: pruned ${pruned} rows older than ${events.retentionDays} days`);
  setInterval(() => { try { events.prune(); } catch { /* next hour */ } }, 3_600_000).unref();
  // daily secret (PLAN-v3 0.6.1): DAILY_SECRET / --daily-secret, else a generated one kept next to the board so restarts mint the same days
  const secretFile = path.join(path.dirname(file), 'daily-secret');
  let dailySecret = flag('daily-secret') || process.env.DAILY_SECRET || '';
  if (!dailySecret) { try { dailySecret = fs.readFileSync(secretFile, 'utf8').trim(); } catch { /* none yet */ } }
  if (!dailySecret) { dailySecret = randomBytes(32).toString('hex'); fs.mkdirSync(path.dirname(secretFile), { recursive: true }); fs.writeFileSync(secretFile, dailySecret + '\n', { mode: 0o600 }); console.log(`daily secret generated at ${secretFile}: back it up (DAILY_SECRET overrides it)`); }
  const verifier = new Verifier(file, { dailySecret });
  // cold storage (PLAN-v4 0.7.0): closed dailies older than HOT_DAYS leave the hot board at startup and once an hour
  try { const { moved } = verifier.splitCold(new Date()); if (moved.length) console.log(`cold: moved ${moved.length} closed day(s) to ${path.join(path.dirname(file), 'cold')}`); } catch (e) { console.error(`cold split failed: ${(e as Error).message}`); }
  setInterval(() => { try { verifier.splitCold(new Date()); } catch { /* next hour */ } }, 3_600_000).unref();
  const par = process.env.BOT_PAR === '0' ? null : new ParService(verifier, (s) => computeParInWorker(s, Number(process.env.BOT_PAR_CAP_MS || 20_000)));
  createServer(verifier, { rateLimit: { limit, windowMs: 60_000 }, playerRateLimit, corsOrigin, trustProxy, log: process.env.VERIFIER_LOG === '0' ? null : undefined, events, par })
    .listen(port, host, () => console.log(`replay verifier v${VERSION} → http://${host}:${port}/  (board: ${file}, events: ${events.file}, rules v${RULES_VERSION}, ${limit} submissions/min/IP, ${playerRateLimit}/min/player, CORS ${corsOrigin}${trustProxy ? ', trusting X-Forwarded-For' : ''})`));
}
