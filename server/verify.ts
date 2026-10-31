/**
 * Replay verifier + verified-only leaderboard (the trusted side of scoring).
 * - POST /verify   { replay: ReplayFile, player?: string } → re-simulates; stores ONLY verified scores.
 * - GET  /board?seed=<seed>&limit=20 → verified scores for a seed (never client-claimed scores).
 * - GET  /daily?limit=10[&date=YYYY-MM-DD] → the minted daily seed for today (or an opened past day) with its verified board,
 *   the commitment to the next day's seed and the previous day's record (PLAN-v3 0.6.1); a day that has not opened is 403.
 *   Each day closes 48 h after 00:00 UTC (`closesAt`); from then on `final`/`frozenAt` are set and the board never changes;
 *   a later submission is verified and answered `{ ok, score, late: true, recorded: false }` (PLAN-v3 0.6.2).
 * - GET  /archive?from=&to=&limit=30 → closed days newest first with N, bot par, medals and the top five; `nextTo` pages older.
 * - GET  /weekly?limit=10[&week=YYYY-Www] → this week's seed (opens Friday 18:00 UTC, closes 7 days later; PLAN-v4 0.7.5) with its board,
 *   commitment to the next week and the previous week; a Friday's daily carries weeklyCommitment for the weekly opening that evening.
 * - Discord (PLAN-v4 0.7.6): with DISCORD_WEBHOOK_URL the verifier posts one message when a daily or weekly opens, when an open event gets a new #1
 *   and when an event freezes (medal thresholds); one per event type per seed, 429 honoured, other failures logged and dropped, never awaited by a request.
 * - Name moderation (PLAN-v4 0.7.7): POST /report { playerId | hash, reason } (bearer, fixed reasons, 5/min) hides the reported name as
 *   "player" on every board until a moderator acts; GET /moderation/reports and POST /moderation/clear|rename|rename-group (X-Moderation-Token)
 *   with one JSON line per action in moderation.jsonl; scores are never touched and a report is never a ban.
 * - Groups (PLAN-v4 0.7.2): POST /groups { name } (bearer, filtered name, 8-char code), POST /groups/join|leave|rename|disband, GET /groups;
 *   ?group=<code> on /board, /histogram, /daily and /archive (bearer of a member) scopes entries to members' player ids.
 * - GET  /entry?hash=…[&seed=…] → one verified entry's seed, score, label, per-round earnings, frozen flag and medals (PLAN-v4 0.7.1):
 *   what a challenge link needs and nothing a reveal-gated replay would leak (no actions).
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
 * - POST /events  { installId, consent: true, events[] } → anonymous play data (PLAN-v1 0.3.7), appended to events.jsonl with a
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
 *
 * Hardening, first cut (production roadmap 0.8.1): behind TRUST_PROXY the client is the rightmost X-Forwarded-For hop (or
 * X-Real-IP); per-address limiters on every write (identity, groups, reports, deletion) and on reads (/health exempt); past
 * dailies and weeklies can be minted only within DAILY_HISTORY_DAYS of today; identities are capped and never-submitting
 * ones are evicted first; the request log is one JSON line per request with a request id and a daily-salted address hash
 * (never the address, never a group code); every 500 logs its exception; header and request timeouts; a SIGTERM drain;
 * /health reports the hot file's bytes, the last commit's duration, the par queue and limiter cardinalities; a report hides
 * a name only when two established reporters agree or a moderator confirms, and an unconfirmed hide expires after 72 h;
 * deletion also drops a player's cold replays; opt-in events keep their address hash for 7 days.
 *
 * Re-simulation (0.8.2): a submission is prepared (decode, rules version, duplicate, issued seed: no simulation), re-simulated
 * ONCE (score, last-round machines and per-round earnings from one run; three runs before) in a persistent worker thread
 * with a wall-clock cap and a bounded queue, then recorded on the event loop (window, keep-best, retention, commit). Every
 * refusal carries a reason `code` beside its `error`. Boards keep a per-seed sorted index, so reads and the retention pass no
 * longer sort the whole board.
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { playSeed } from '../tools/autoplay-lib';
import { Rng } from '../game/src/sim/rng';
import { decodeReplay, canonicalReplayJson, type ReplayFile } from '../game/src/sim/replay';
import { replay as replayRun, runStars, type RunState } from '../game/src/sim/run';
import { RULES_VERSION } from '../game/src/sim/types';
import { PushStore, PushError, validateHour, validateSubscription } from './push';
import { COMMUNITY_DB, CommunityStore } from './community';
import { isMintedDailySeed, dailyDateOf } from '../game/src/sim/daily';
import { mintSeed, mintWeeklySeed, commitmentFor, shiftDate, utcDate, dayStartMs, isUtcDate, DAILY_WINDOW_MS, base32Lower } from './mint';
import { isWeekId, isWeeklySeed, weeklyIdOf, weeklyWindow, currentWeekId, nextWeekId, prevWeekId, isoWeekId } from '../game/src/sim/weekly';
import { Announcer, type AnnounceEvent } from './webhook';
export { Announcer, formatAnnouncement, announceKey, retryAfterMs, type AnnounceEvent } from './webhook';
export { mintWeeklySeed } from './mint';
export { currentWeekId, weeklyWindow, isWeeklySeed, weeklyIdOf } from '../game/src/sim/weekly';
import { medalThresholds, type Medals } from '../game/src/daily/medals';
import { ColdStore, HOT_DAYS, COLD_REPLAYS_PER_DAY, type ColdDay } from './cold';
import { OPERATOR } from '../game/src/content/operator';
export { HOT_DAYS, COLD_REPLAYS_PER_DAY, ColdStore } from './cold';
export { medalThresholds, medalFor, MEDAL_PERCENTILES, MEDAL_MIN_N, type Medals } from '../game/src/daily/medals';
export { mintSeed, commitmentFor, shiftDate, utcDate, isUtcDate, DAILY_WINDOW_MS } from './mint';
import { validateBatch, FUNNEL, type EventBatch, type EventName, type Props } from '../game/src/telemetry/events';
import pkg from '../package.json' with { type: 'json' };
import { tagFor, labelFor, normaliseName, nameProblem, TOKEN_HEX, REPORT_REASONS, HIDDEN_LABEL, type ReportReason } from '../game/src/identity/identity';

/** Protocol level of this server's HTTP surface (PLAN-v3 §1): 2 adds identity (bearer tokens, /identity, DELETE /me, keep-best per player); GET /me/export (0.8.6) only grows it. */
export const PROTOCOL = 2;
export const RENAME_COOLDOWN_MS = 24 * 60 * 60_000;
/** A claimed identity: the player id is the SHA-256 of a device token the server never stores. */
export interface Player {
  name: string;
  tag: string;
  createdAt: string;
  renamedAt: string;
}
/** Player id from a bearer token (32 hex chars); null when absent or malformed. The token itself is never kept or logged. */
export function playerIdFromToken(token: string | null | undefined): string | null {
  if (!token || !TOKEN_HEX.test(token)) return null;
  return createHash('sha256').update(token).digest('hex');
}
export function bearerOf(req: http.IncomingMessage): string | null {
  const h = req.headers.authorization;
  if (!h) return null;
  const m = /^Bearer\s+([0-9a-f]{32})$/i.exec(h.trim());
  return m ? m[1].toLowerCase() : null;
}

export const VERSION: string = pkg.version;

/** `finalMachines` (rules v3, PLAN-v2 0.5.5): machines on the grid in the last round, derived by the verifier from the re-simulated replay, never taken from a payload; entries written before it exist without it and rank last among equal scores until derived from their stored replay. */
export interface BoardEntry {
  seed: string;
  score: number;
  player: string;
  verifiedAt: string;
  rulesVersion: number;
  actions: number;
  replayHash: string;
  replayAvailable?: boolean;
  finalMachines?: number;
  /** claimed identity (PLAN-v3 0.6.0); absent on anonymous entries, which are never claimable */ playerId?: string;
  /** per-round earnings derived at verification (PLAN-v4 0.7.1); absent on entries verified before and without a stored replay */ rounds?: number[];
  /** stars on the yard's job (rules v4), derived from the re-simulated replay; additive; absent on a yard with no job and on older entries */ stars?: number;
}
/** Printed under every board: the one comparator, in words. */
export const TIE_BREAK = 'Equal scores: fewer machines in round 6 first, then the earlier verified submission.';
/** One run of a replay, or null when an action is illegal. */
function simulateOnce(r: Pick<ReplayFile, 'seed' | 'actions' | 'rulesVersion'>): RunState | null {
  try {
    return replayRun(r.seed, r.actions, r.rulesVersion);
  } catch {
    return null;
  }
}
/** Per-round earnings of a replay, derived by re-simulation (never from the payload): what a challenge link overlays (PLAN-v4 0.7.1). */
export function roundsOf(r: Pick<ReplayFile, 'seed' | 'actions' | 'rulesVersion'>): number[] | null {
  const s = simulateOnce(r);
  return s && s.rounds.length ? s.rounds.map((x) => x.earned) : null;
}
/** Machines on the grid in the final round of a replay, or null when it cannot be re-simulated. */
export function finalMachinesOf(r: Pick<ReplayFile, 'seed' | 'actions' | 'rulesVersion'>): number | null {
  const s = simulateOnce(r);
  const last = s?.rounds[s.rounds.length - 1];
  return last ? last.layout.machines.length : null;
}
/** Why a submission was refused (0.8.2), beside the human `error`; additive, so clients and operators can act without parsing prose. */
export type RefusalCode =
  | 'bad-replay'
  | 'rules-version'
  | 'duplicate'
  | 'unissued-seed'
  | 'illegal-action'
  | 'unfinished'
  | 'did-not-reproduce'
  | 'resim-timeout'
  | 'busy'
  | 'rate-limited'
  | 'too-large'
  | 'bad-request'
  | 'storage';
/** The outcome of the one re-simulation of a submission. */
export type Resim =
  | { ok: true; score: number; finalMachines: number; rounds: number[]; stars?: number }
  | { ok: false; error: string; code: 'rules-version' | 'illegal-action' | 'unfinished' | 'did-not-reproduce' };
/**
 * The one re-simulation (0.8.2): score, machines in the last round and per-round earnings from a single run of the replay.
 * Pure and synchronous; the worker thread and the inline path (tests, tools) share it. The claimed score is never trusted.
 */
export function resimulate(r: ReplayFile): Resim {
  if (r.rulesVersion !== RULES_VERSION)
    return { ok: false, error: `rules version ${r.rulesVersion} unsupported (have ${RULES_VERSION})`, code: 'rules-version' };
  let s: RunState;
  try {
    s = replayRun(r.seed, r.actions, r.rulesVersion);
  } catch (e) {
    return { ok: false, error: (e as Error).message, code: 'illegal-action' };
  }
  if (s.phase !== 'finished')
    return { ok: false, error: `re-simulated score $${s.score} does not match claimed $${r.claimedScore} (run not finished)`, code: 'unfinished' };
  if (s.score !== r.claimedScore)
    return { ok: false, error: `re-simulated score $${s.score} does not match claimed $${r.claimedScore}`, code: 'did-not-reproduce' };
  const last = s.rounds[s.rounds.length - 1];
  return {
    ok: true,
    score: s.score,
    finalMachines: last ? last.layout.machines.length : 0,
    stars: s.job ? runStars(s) : undefined,
    rounds: s.rounds.map((x) => x.earned),
  };
}
export interface SubmitResult {
  ok: boolean;
  score?: number;
  error?: string;
  code?: RefusalCode;
  entry?: BoardEntry;
  recorded?: boolean;
  player?: string;
  late?: boolean;
  closesAt?: string;
}
/** Actions of a verified replay, kept so anyone can watch it; bounded by the replay limits enforced at verification. */
export interface StoredReplay {
  seed: string;
  rulesVersion: number;
  actions: ReplayFile['actions'];
  score: number;
  player: string;
  verifiedAt: string;
}
/** The autoplayer's median score on a seed: a target that exists on day one without inventing competitors. */
export interface BotPar {
  par: number;
  runs: number;
  tries: number;
  rulesVersion: number;
  computedAt: string;
}
/** One issued daily (PLAN-v3 0.6.1): the seed minted from the secret for that UTC date, the commitment to the next day's seed, and the window. */
export interface DailyRecord {
  date: string;
  seed: string;
  commitment: string;
  issuedAt: string;
  closesAt: string;
  rulesVersion: number;
  build: string;
  /** set once the window closed (= closesAt); the board is final from then on (PLAN-v3 0.6.2) */ frozenAt?: string;
  /** computed once at freeze from the final board (PLAN-v3 0.6.4): thresholds, or null when fewer than MEDAL_MIN_N runs; absent while open */
  medals?: Medals | null;
  /** a weekly (PLAN-v4 0.7.5): keyed by its ISO week, `date` is the Friday it opened, `opensAt` Friday 18:00 UTC; dailies have no kind */ kind?: 'weekly';
  week?: string;
  opensAt?: string;
  /** on a Friday's daily: SHA-256 of the weekly seed that opens that evening */ weeklyCommitment?: string;
}
/** The key a record lives under in `dailies`: its date, or its week id for a weekly. */
export const recordKey = (r: DailyRecord): string => (r.kind === 'weekly' ? r.week! : r.date);
/** One closed day in GET /archive. */
export interface ArchiveDay {
  date: string;
  key: string;
  kind: 'daily' | 'weekly';
  seed: string;
  closesAt: string;
  frozenAt: string;
  n: number;
  botPar: number | null;
  medals: Medals | null;
  top: BoardEntry[];
}
export const MAX_ARCHIVE_LIMIT = 100;
/** A group (PLAN-v4 0.7.2): a code that scopes boards to its members' verified entries. Keyed by player id, never by name. */
export interface Group {
  code: string;
  name: string;
  creatorId: string | null;
  createdAt: string;
  renamedAt: string;
  playerIds: string[];
}
export const MAX_GROUPS_PER_PLAYER = 5,
  MAX_GROUP_MEMBERS = 50,
  GROUP_CODE_LEN = 8,
  GROUP_RATE_LIMIT = 5;
const GROUP_CODE = /^[a-z2-7]{8}$/;
// name moderation (PLAN-v4 0.7.7)
export { REPORT_REASONS, HIDDEN_LABEL, type ReportReason };
/** reports per minute per player; reporters kept per target; how often a report may hide the same name before a moderator has to act first */
export const REPORT_RATE_LIMIT = 5,
  MAX_REPORTERS_PER_TARGET = 50,
  MAX_HIDES_PER_NAME = 2;
/** Report-to-hide policy (0.8.1): a name hides when `reporters` distinct established reporters agree (established = holding a verified entry at least `establishedDays` old; 0 means any player with a claimed name counts) or when a moderator confirms the hide; an unconfirmed hide expires after `expiryHours`. */
export interface ReportPolicy {
  reporters: number;
  establishedDays: number;
  expiryHours: number;
}
export const DEFAULT_REPORT_POLICY: ReportPolicy = { reporters: 2, establishedDays: 7, expiryHours: 72 };
/** Past dailies and weeklies can be asked for (and minted) only this many days back from today (0.8.1): bounds what unauthenticated reads can write. */
export const DAILY_HISTORY_DAYS = 400;
/** where a player appeals a moderation decision (PLAN-v4 0.7.7): a mailbox on the game's domain (0.8.6; game/src/content/operator.ts) */
export const APPEAL_CONTACT: string = OPERATOR.appealEmail;
export interface Report {
  reporterId: string;
  reason: ReportReason;
  at: string;
  /** the reporter held a verified entry old enough when reporting (0.8.1); only these count toward a hide */ established?: boolean;
}
/** per reported player: the name as reported, whether it is hidden, how often a moderator cleared it, the open reports */
export interface ModerationRecord {
  name: string;
  hidden: boolean;
  hiddenAt?: string;
  clears: number;
  reports: Report[];
  /** a moderator confirmed the hide (0.8.1): it no longer expires, only clear or rename lifts it */ confirmedAt?: string;
}
/** Every field a player (or a moderator) writes that reaches storage. Each passes nameProblem; tests/verifier.test.ts pushes a blocked string through every one of them and counts the call sites, so a field added without its check fails the suite (PLAN-v4 §1). */
export const USER_WRITTEN_FIELDS = [
  'display name (POST /identity)',
  'group name (POST /groups)',
  'group name (POST /groups/rename)',
  'anonymous label (POST /verify player)',
  'forced display name (POST /moderation/rename)',
  'forced group name (POST /moderation/rename-group)',
] as const;
/** Defaults the policy page publishes (PLAN-v3 0.6.5); env/flags override the rate limits at runtime. */
export const DEFAULT_RATE_LIMIT = 60,
  DEFAULT_PLAYER_RATE_LIMIT = 2,
  IDENTITY_RATE_LIMIT = 5,
  DEFAULT_EVENTS_RATE_LIMIT = 30;
/** per-address limits (0.8.1): reads (every GET but /health) and writes (identity, groups, reports, deletion) per minute */
export const DEFAULT_READ_RATE_LIMIT = 300,
  DEFAULT_WRITE_RATE_LIMIT = 30;
/** claimed identities kept (0.8.1); over the cap the oldest identities that never submitted and belong to no group are evicted first */
export const DEFAULT_MAX_PLAYERS = 20_000;
export const DEFAULT_REPLAYS_PER_SEED = 100,
  DEFAULT_MAX_ENTRIES_PER_SEED = 1000,
  DEFAULT_MAX_SEEDS = 5000,
  DEFAULT_EVENTS_RETENTION_DAYS = 7; // events: 7 days, as the policy page always said (0.8.1 reconciled the code)
/** GET /me/export (0.8.6) */
export interface PlayerExport {
  exportedAt: string;
  protocol: number;
  rulesVersion: number;
  playerId: string;
  tag: string;
  player: { name: string; tag: string; createdAt: string; renamedAt: string; hidden: boolean } | null;
  entries: (BoardEntry & { storage: 'hot' | 'cold'; replay: StoredReplay | null })[];
  groups: { code: string; name: string; members: number; creator: boolean }[];
  moderation: { name: string; hidden: boolean; hiddenAt: string | null; confirmedAt: string | null; clears: number; reports: number } | null;
  reportsFiled: { reason: ReportReason; at: string }[];
  notes: string[];
}
export interface Board {
  entries: BoardEntry[];
  replays?: Record<string, StoredReplay>;
  pars?: Record<string, BotPar>;
  players?: Record<string, Player>;
  dailies?: Record<string, DailyRecord>;
  groups?: Record<string, Group>;
  moderation?: Record<string, ModerationRecord>;
}

export const MAX_BODY_BYTES = 512 * 1024;
const MAX_BODY = MAX_BODY_BYTES;
export const MAX_BOARD_LIMIT = 100;
export const MAX_DAILY_LIMIT = 50;

/** Replay identity: SHA-256 of the canonical verified content (actions in canonical field order, see replay.ts). Collision-free in practice, unlike the 32-bit FNV it replaces. */
export const replayId = (r: Pick<ReplayFile, 'rulesVersion' | 'seed' | 'actions'>): string => createHash('sha256').update(canonicalReplayJson(r)).digest('hex');

/** Parse a query limit: finite integer clamped to [1, max]; anything else is the default. */
export function clampInt(raw: string | null | undefined, def: number, max: number, min = 1): number {
  if (raw == null || raw === '') return def;
  const n = Number(raw);
  if (!Number.isFinite(n) || !Number.isInteger(n)) return def;
  return Math.min(max, Math.max(min, n));
}

export class StorageError extends Error {}

/** One bin of a score histogram: [from, to) except the last, which includes its upper edge. */
export interface HistogramBin {
  from: number;
  to: number;
  count: number;
}
export interface Histogram {
  seed: string;
  n: number;
  step: number;
  bins: HistogramBin[];
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
  let mine: Histogram['mine'] = null;
  let around: Histogram['around'] = [];
  if (idx >= 0) {
    const score = ranked[idx].score;
    const lower = ranked.filter((e) => e.score < score).length;
    mine = { score, rank: idx + 1, bin: Math.min(count - 1, Math.floor(score / step)), percentile: n > 1 ? Math.floor((100 * lower) / (n - 1)) : 0 };
    around = ranked.slice(Math.max(0, idx - 5), idx + 6).map((e, k, arr) => {
      const rank = idx - (arr.indexOf(e) - k) + (k - arr.indexOf(e)) + 1;
      void rank;
      return { rank: ranked.indexOf(e) + 1, player: e.player, score: e.score, mine: e.replayHash === hash };
    });
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
  /** announcements (PLAN-v4 0.7.6): called when a daily or weekly opens, an open event gets a new #1, or an event freezes; must never throw into the caller (the verifier swallows) */
  announce?: (ev: AnnounceEvent) => void;
  /** moderation audit file (PLAN-v4 0.7.7): one JSON line per report and moderator action; default moderation.jsonl next to the board; null disables */
  auditFile?: string | null;
  /** report-to-hide policy (0.8.1); defaults to DEFAULT_REPORT_POLICY */
  reportPolicy?: Partial<ReportPolicy>;
  /** claimed identities kept (0.8.1); default DEFAULT_MAX_PLAYERS */
  maxPlayers?: number;
}

/** The one comparator (PLAN-v2 0.5.5): score desc, fewer final-round machines, earlier receipt, then the hash so the order is total. Boards, histogram ranks and neighbours, retention and the returned rank all use it. */
const byRank = (a: BoardEntry, b: BoardEntry) =>
  b.score - a.score ||
  (a.finalMachines ?? Infinity) - (b.finalMachines ?? Infinity) ||
  a.verifiedAt.localeCompare(b.verifiedAt) ||
  a.replayHash.localeCompare(b.replayHash);

export class Verifier {
  private _data!: Board;
  /** Per-seed board order for the current rules version, built lazily after every change to the board (0.8.2): reads and the retention pass take a seed's sorted slice instead of filtering and sorting every entry. */
  private index: Map<string, BoardEntry[]> | null = null;
  private get data(): Board {
    return this._data;
  }
  private set data(b: Board) {
    this._data = b;
    this.index = null;
  }
  /** Whether the per-seed index is currently built (tests). */
  get indexed(): boolean {
    return this.index !== null;
  }
  readonly replaysPerSeed: number;
  readonly maxEntriesPerSeed: number;
  readonly maxSeeds: number;
  private readonly dailySecret: string;
  private readonly announceFn: ((ev: AnnounceEvent) => void) | null;
  private readonly auditFile: string | null;
  /** Closed dailies older than HOT_DAYS live here (PLAN-v4 0.7.0): read-only, final, loaded lazily. */
  readonly cold: ColdStore;
  readonly reportPolicy: ReportPolicy;
  readonly maxPlayers: number;
  /** what /health reports about the hot file (0.8.1): bytes written by the last commit (or found on disk), its duration, how many commits */
  private stats = { hotFileBytes: 0, lastCommitMs: 0, commits: 0 };
  constructor(
    private file: string,
    opts: VerifierOptions = {},
  ) {
    this.reportPolicy = { ...DEFAULT_REPORT_POLICY, ...(opts.reportPolicy ?? {}) };
    this.maxPlayers = opts.maxPlayers ?? DEFAULT_MAX_PLAYERS;
    this.dailySecret = opts.dailySecret || randomBytes(32).toString('hex');
    this.announceFn = opts.announce ?? null;
    this.auditFile = opts.auditFile === undefined ? path.join(path.dirname(file), 'moderation.jsonl') : opts.auditFile;
    this.cold = new ColdStore(path.join(path.dirname(file), 'cold'));
    this.replaysPerSeed = opts.replaysPerSeed ?? DEFAULT_REPLAYS_PER_SEED;
    this.maxEntriesPerSeed = opts.maxEntriesPerSeed ?? DEFAULT_MAX_ENTRIES_PER_SEED;
    this.maxSeeds = opts.maxSeeds ?? DEFAULT_MAX_SEEDS;
    this.data = fs.existsSync(file) ? loadBoard(fs.readFileSync(file, 'utf8')) : { entries: [] };
    try {
      this.stats.hotFileBytes = fs.statSync(file).size;
    } catch {
      /* no file yet */
    }
    this.deriveTieBreaks();
  }
  /** Hot-file and identity figures for /health (0.8.1): the inputs of the SQLite trigger (5 MB / 50 ms), observable at last. */
  get health() {
    return { ...this.stats, players: Object.keys(this.data.players ?? {}).length, coldBytes: this.cold.bytes() };
  }
  /** The earliest UTC date a daily (or a weekly's opening Friday) may be asked for: today minus DAILY_HISTORY_DAYS (0.8.1). */
  historyStart(now = new Date()): string {
    return shiftDate(utcDate(now), -DAILY_HISTORY_DAYS);
  }
  private withinHistory(date: string, now: Date): boolean {
    return date >= this.historyStart(now);
  }
  /** Entries recorded before finalMachines existed get it from their stored replay (current version only); persisted when anything changed. */
  private deriveTieBreaks() {
    let changed = false;
    const entries = this.data.entries.map((e) => {
      if ((e.finalMachines != null && e.rounds != null) || e.rulesVersion !== RULES_VERSION) return e;
      const r = this.data.replays?.[e.replayHash];
      if (!r) return e;
      const s = simulateOnce({ seed: r.seed, actions: r.actions, rulesVersion: r.rulesVersion }); // one run per entry (0.8.2)
      const last = s?.rounds[s.rounds.length - 1];
      const n = e.finalMachines ?? (last ? last.layout.machines.length : null);
      const rounds = e.rounds ?? (s && s.rounds.length ? s.rounds.map((x) => x.earned) : null);
      if (n == null && rounds == null) return e;
      changed = true;
      return { ...e, ...(n != null ? { finalMachines: n } : {}), ...(rounds ? { rounds } : {}) };
    });
    if (!changed) return;
    try {
      this.commit({ ...this.data, entries });
    } catch {
      this.data = { ...this.data, entries };
    } // storage trouble: rank correctly in memory anyway
  }

  /** Current-version entries for a seed in board order. Entries persisted under another rules version never rank. */
  /** A seed's current-version entries in board order: from the index for the live board, a one-off sort for a candidate board (0.8.2). */
  private sortedSeed(seed: string, data: Board = this.data): BoardEntry[] {
    if (data !== this.data) return data.entries.filter((e) => e.seed === seed && e.rulesVersion === RULES_VERSION).sort(byRank);
    if (!this.index) {
      const idx = new Map<string, BoardEntry[]>();
      for (const e of this.data.entries) {
        if (e.rulesVersion !== RULES_VERSION) continue;
        let a = idx.get(e.seed);
        if (!a) {
          a = [];
          idx.set(e.seed, a);
        }
        a.push(e);
      }
      for (const a of idx.values()) a.sort(byRank);
      this.index = idx;
    }
    return this.index.get(seed) ?? [];
  }
  private rank(seed: string, data: Board = this.data, members?: ReadonlySet<string> | null, now = new Date()): BoardEntry[] {
    const hot = this.sortedSeed(seed, data).map((e) => this.withLabel(e, now));
    const all =
      hot.length || data !== this.data
        ? hot
        : this.coldEntries(seed, now)
            .filter((e) => e.rulesVersion === RULES_VERSION)
            .sort(byRank);
    return members ? all.filter((e) => !!e.playerId && members.has(e.playerId)) : all; // a group board: members' verified entries only, ranks recomputed over them (PLAN-v4 0.7.2)
  }
  /** A cold day's entries with labels resolved against the current identities (renames and deletions follow the player without rewriting cold files). */
  private coldEntries(seed: string, now = new Date()): BoardEntry[] {
    const date = this.cold.dateOfSeed(seed);
    if (!date) return [];
    const day = this.cold.day(date);
    if (!day || day.record.seed !== seed) return [];
    return day.entries.map((e) => {
      if (!e.playerId) return e;
      const p = this.data.players?.[e.playerId];
      return p ? { ...e, player: this.labelOf(e.playerId, p, now) } : { ...e, player: 'deleted', playerId: undefined };
    });
  }
  /** A hot entry with its label resolved now (0.8.1): a hide that expired reads as the name again without a rewrite. */
  private withLabel(e: BoardEntry, now: Date): BoardEntry {
    if (!e.playerId) return e;
    const p = this.data.players?.[e.playerId];
    if (!p) return e;
    const label = this.labelOf(e.playerId, p, now);
    return label === e.player ? e : { ...e, player: label };
  }
  /** Whether a moderation record hides the name at `now` (0.8.1): hidden and either confirmed by a moderator or within the expiry window. */
  isHidden(m: ModerationRecord | undefined, now = new Date()): boolean {
    if (!m || !m.hidden) return false;
    if (m.confirmedAt || !m.hiddenAt) return true;
    return now.getTime() < Date.parse(m.hiddenAt) + this.reportPolicy.expiryHours * 3_600_000;
  }
  /** When an unconfirmed hide lapses; null when not hidden or confirmed. */
  hideExpiresAt(m: ModerationRecord | undefined): string | null {
    return m && m.hidden && !m.confirmedAt && m.hiddenAt ? new Date(Date.parse(m.hiddenAt) + this.reportPolicy.expiryHours * 3_600_000).toISOString() : null;
  }
  /** The label shown for a claimed player: Name#TAG, or "player" while a report hides the name (PLAN-v4 0.7.7). */
  private labelOf(playerId: string, p: Player = this.data.players![playerId], now = new Date()): string {
    return this.isHidden(this.data.moderation?.[playerId], now) ? HIDDEN_LABEL : labelFor(p.name, p.tag);
  }
  private relabel(entries: BoardEntry[], playerId: string, label: string): BoardEntry[] {
    return entries.map((e) => (e.playerId === playerId ? { ...e, player: label } : e));
  }
  /** The issued record for a date or week id from the hot board or cold storage, never minting (PLAN-v4 0.7.0). */
  private issuedRecord(key: string): DailyRecord | null {
    return this.data.dailies?.[key] ?? this.cold.day(key)?.record ?? null;
  }
  /** The record behind a minted seed of either kind; null for ordinary, practice or unissued seeds. */
  private issuedRecordForSeed(seed: string): DailyRecord | null {
    const key = isMintedDailySeed(seed) ? dailyDateOf(seed) : isWeeklySeed(seed) ? weeklyIdOf(seed) : null;
    const rec = key ? this.issuedRecord(key) : null;
    return rec && rec.seed === seed ? rec : null;
  }
  /**
   * The weekly for an ISO week (PLAN-v4 0.7.5): minted and persisted on first request once its Friday 18:00 UTC has passed,
   * null before that; never re-minted once issued or cold. Same freeze, medals, archive and cold path as a daily.
   */
  weeklyRecord(week: string, now = new Date()): DailyRecord | null {
    const w = isWeekId(week) ? weeklyWindow(week) : null;
    if (!w || Date.parse(w.opensAt) > now.getTime()) return null;
    const have = this.data.dailies?.[week];
    if (have) {
      this.observeFreeze(now);
      return this.data.dailies![week];
    }
    const cold = this.cold.day(week)?.record;
    if (cold) return cold;
    if (!this.withinHistory(w.openDate, now)) return null; // 0.8.1: nothing older than DAILY_HISTORY_DAYS is minted on request
    const rec: DailyRecord = {
      kind: 'weekly',
      week,
      date: w.openDate,
      opensAt: w.opensAt,
      seed: mintWeeklySeed(this.dailySecret, week),
      commitment: commitmentFor(mintWeeklySeed(this.dailySecret, nextWeekId(week)!)),
      issuedAt: now.toISOString(),
      closesAt: w.closesAt,
      rulesVersion: RULES_VERSION,
      build: VERSION,
    };
    const next = { ...this.data, dailies: { ...(this.data.dailies ?? {}), [week]: rec } };
    try {
      this.commit(next);
    } catch {
      this.data = next;
    }
    this.observeFreeze(now);
    if (week === currentWeekId(now)) this.announce({ kind: 'seed', record: this.data.dailies![week] });
    return this.data.dailies![week];
  }
  /** This week's seed (or an opened past week): record, board, previous week for the commitment chain. */
  weekly(
    limit = 10,
    now = new Date(),
    week = currentWeekId(now),
    members?: ReadonlySet<string> | null,
  ):
    | (Omit<DailyRecord, 'frozenAt'> & {
        frozenAt: string | null;
        final: boolean;
        now: string;
        verified: true;
        minted: true;
        entries: BoardEntry[];
        previous: { week: string; seed: string; commitment: string } | null;
      })
    | null {
    const rec = this.weeklyRecord(week, now);
    if (!rec) return null;
    const pw = prevWeekId(week);
    const prev = pw ? this.weeklyRecord(pw, now) : null;
    return {
      ...rec,
      frozenAt: rec.frozenAt ?? null,
      final: !!rec.frozenAt,
      now: now.toISOString(),
      verified: true,
      minted: true,
      entries: this.board(rec.seed, Math.min(MAX_DAILY_LIMIT, limit), members, now),
      previous: prev ? { week: prev.week!, seed: prev.seed, commitment: prev.commitment } : null,
    };
  }
  /**
   * Move frozen dailies older than HOT_DAYS to cold storage: every entry, the record, the par and only the top
   * COLD_REPLAYS_PER_DAY replays. Idempotent; a day is written cold before it leaves the hot board, so a failed hot
   * commit leaves a duplicate that the next split overwrites and the archive dedupes by date.
   */
  splitCold(now = new Date()): { moved: string[] } {
    this.observeFreeze(now);
    const cutoff = shiftDate(utcDate(now), -HOT_DAYS);
    const due = Object.values(this.data.dailies ?? {})
      .filter((r) => r.frozenAt && r.date < cutoff)
      .sort((a, b) => a.date.localeCompare(b.date));
    if (!due.length) return { moved: [] };
    let entries = this.data.entries;
    const replays = { ...(this.data.replays ?? {}) };
    const pars = { ...(this.data.pars ?? {}) };
    const dailies = { ...(this.data.dailies ?? {}) };
    const moved: string[] = [];
    for (const rec of due) {
      const mine = entries.filter((e) => e.seed === rec.seed);
      const top = mine
        .filter((e) => e.rulesVersion === RULES_VERSION)
        .sort(byRank)
        .slice(0, COLD_REPLAYS_PER_DAY);
      const keep: Record<string, StoredReplay> = {};
      for (const e of top) {
        const r = replays[e.replayHash];
        if (r) keep[e.replayHash] = r;
      }
      const day: ColdDay = { record: rec, entries: mine, replays: keep, par: pars[rec.seed] ?? null };
      try {
        this.cold.put(day, recordKey(rec));
      } catch {
        continue;
      } // cold write failed: the day stays hot and is retried on the next split
      entries = entries.filter((e) => e.seed !== rec.seed);
      for (const e of mine) delete replays[e.replayHash];
      delete pars[rec.seed];
      delete dailies[recordKey(rec)];
      moved.push(recordKey(rec));
    }
    if (moved.length) {
      const next = { ...this.data, entries, replays, pars, dailies };
      try {
        this.commit(next);
      } catch {
        this.data = next;
      }
    }
    return { moved };
  }
  /** Current-version entries (what /health and the boards count). */
  get size() {
    return this.data.entries.reduce((n, e) => n + (e.rulesVersion === RULES_VERSION ? 1 : 0), 0);
  }
  get sizeAllVersions() {
    return this.data.entries.length;
  }

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
      const stale = new Set(
        [...lastActive.entries()]
          .sort((a, b) => a[1].localeCompare(b[1]))
          .slice(0, lastActive.size - this.maxSeeds)
          .map(([s]) => s),
      );
      data.entries = data.entries.filter((e) => !stale.has(e.seed));
    }
    if (data.replays) {
      const keep = new Set<string>();
      const touched = new Set(data.entries.map((e) => e.seed));
      for (const s of touched)
        for (const e of (s === seed ? this.sortedSeed(s, data) : this.sortedSeed(s)).slice(0, this.replaysPerSeed)) keep.add(e.replayHash); // only the submitted seed changed; every other seed's order comes from the index (0.8.2)
      for (const e of data.entries) if (e.rulesVersion !== RULES_VERSION) keep.add(e.replayHash); // other versions never rank here, but a rollback needs their replays intact (PLAN-v2 §1)
      for (const h of Object.keys(data.replays)) if (!keep.has(h)) delete data.replays[h];
    }
  }

  /** Write a candidate board atomically (temp file + rename in the same directory). Memory changes only after the rename succeeds. */
  private commit(candidate: Board) {
    const dir = path.dirname(this.file);
    const tmp = path.join(dir, `.board-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}.tmp`);
    const t0 = performance.now();
    let bytes: number;
    try {
      fs.mkdirSync(dir, { recursive: true });
      const text = JSON.stringify(candidate, null, 1);
      bytes = Buffer.byteLength(text);
      fs.writeFileSync(tmp, text);
      fs.renameSync(tmp, this.file);
    } catch (e) {
      try {
        fs.rmSync(tmp, { force: true });
      } catch {
        /* best effort */
      }
      throw new StorageError(`storage unavailable: ${(e as Error).message}`);
    }
    this.stats = { hotFileBytes: bytes, lastCommitMs: Math.round((performance.now() - t0) * 100) / 100, commits: this.stats.commits + 1 };
    this.data = candidate;
  }

  /** Verify a replay; on success record it. Returns the verdict (never trusts claimedScore). Throws StorageError if it cannot persist. */
  // ---------- groups (PLAN-v4 0.7.2) ----------
  group(code: string): Group | null {
    return this.data.groups?.[code] ?? null;
  }
  /** The member set of a group the caller belongs to; null for an unknown code or a non-member (one answer, so codes cannot be probed). */
  groupMembers(code: string, playerId: string): ReadonlySet<string> | null {
    const g = this.data.groups?.[code];
    return g && g.playerIds.includes(playerId) ? new Set(g.playerIds) : null;
  }
  private groupInfo(g: Group, playerId: string) {
    return { code: g.code, name: g.name, members: g.playerIds.length, creator: g.creatorId === playerId };
  }
  groupsOf(playerId: string) {
    return Object.values(this.data.groups ?? {})
      .filter((g) => g.playerIds.includes(playerId))
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      .map((g) => this.groupInfo(g, playerId));
  }
  private newGroupCode(): string {
    for (let i = 0; i < 20; i++) {
      const code = base32Lower(randomBytes(5)).slice(0, GROUP_CODE_LEN);
      if (!this.data.groups?.[code]) return code;
    }
    throw new Error('could not mint a group code');
  }
  createGroup(playerId: string, rawName: unknown, now = new Date()): { ok: true; group: ReturnType<Verifier['groupInfo']> } | { ok: false; error: string } {
    if (!this.data.players?.[playerId]) return { ok: false, error: 'claim a name before creating a group' };
    const problem = nameProblem(rawName);
    if (problem) return { ok: false, error: `group ${problem}` };
    if (this.groupsOf(playerId).length >= MAX_GROUPS_PER_PLAYER) return { ok: false, error: `at most ${MAX_GROUPS_PER_PLAYER} groups per player` };
    const g: Group = {
      code: this.newGroupCode(),
      name: normaliseName(rawName),
      creatorId: playerId,
      createdAt: now.toISOString(),
      renamedAt: now.toISOString(),
      playerIds: [playerId],
    };
    this.commit({ ...this.data, groups: { ...(this.data.groups ?? {}), [g.code]: g } });
    return { ok: true, group: this.groupInfo(g, playerId) };
  }
  joinGroup(playerId: string, code: unknown): { ok: true; group: ReturnType<Verifier['groupInfo']> } | { ok: false; error: string } {
    if (!this.data.players?.[playerId]) return { ok: false, error: 'claim a name before joining a group' };
    const g = typeof code === 'string' && GROUP_CODE.test(code) ? this.data.groups?.[code] : undefined;
    if (!g) return { ok: false, error: 'unknown group code' };
    if (g.playerIds.includes(playerId)) return { ok: true, group: this.groupInfo(g, playerId) };
    if (g.playerIds.length >= MAX_GROUP_MEMBERS) return { ok: false, error: `that group is full (${MAX_GROUP_MEMBERS} members)` };
    if (this.groupsOf(playerId).length >= MAX_GROUPS_PER_PLAYER) return { ok: false, error: `at most ${MAX_GROUPS_PER_PLAYER} groups per player` };
    const next = { ...g, playerIds: [...g.playerIds, playerId] };
    this.commit({ ...this.data, groups: { ...(this.data.groups ?? {}), [g.code]: next } });
    return { ok: true, group: this.groupInfo(next, playerId) };
  }
  /** Leave; the last member leaving removes the group; a leaving creator hands the group to the next member. */
  leaveGroup(playerId: string, code: unknown): { ok: true; left: string } | { ok: false; error: string } {
    const g = typeof code === 'string' ? this.data.groups?.[code] : undefined;
    if (!g || !g.playerIds.includes(playerId)) return { ok: false, error: 'not a member of that group' };
    const groups = { ...(this.data.groups ?? {}) };
    const rest = g.playerIds.filter((p) => p !== playerId);
    if (rest.length) groups[g.code] = { ...g, playerIds: rest, creatorId: g.creatorId === playerId ? rest[0] : g.creatorId };
    else delete groups[g.code];
    this.commit({ ...this.data, groups });
    return { ok: true, left: g.code };
  }
  renameGroup(
    playerId: string,
    code: unknown,
    rawName: unknown,
    now = new Date(),
  ): { ok: true; group: ReturnType<Verifier['groupInfo']> } | { ok: false; error: string; retryAfterSec?: number } {
    const g = typeof code === 'string' ? this.data.groups?.[code] : undefined;
    if (!g || g.creatorId !== playerId) return { ok: false, error: "only the group's creator can rename it" };
    const problem = nameProblem(rawName);
    if (problem) return { ok: false, error: `group ${problem}` };
    const name = normaliseName(rawName);
    if (name === g.name) return { ok: true, group: this.groupInfo(g, playerId) };
    const since = now.getTime() - Date.parse(g.renamedAt);
    if (since < RENAME_COOLDOWN_MS)
      return { ok: false, error: 'group was renamed recently; try again later', retryAfterSec: Math.ceil((RENAME_COOLDOWN_MS - since) / 1000) };
    const next = { ...g, name, renamedAt: now.toISOString() };
    this.commit({ ...this.data, groups: { ...(this.data.groups ?? {}), [g.code]: next } });
    return { ok: true, group: this.groupInfo(next, playerId) };
  }
  disbandGroup(playerId: string, code: unknown): { ok: true } | { ok: false; error: string } {
    const g = typeof code === 'string' ? this.data.groups?.[code] : undefined;
    if (!g || g.creatorId !== playerId) return { ok: false, error: "only the group's creator can disband it" };
    const groups = { ...(this.data.groups ?? {}) };
    delete groups[g.code];
    this.commit({ ...this.data, groups });
    return { ok: true };
  }

  /** Identity records (PLAN-v3 0.6.0). */
  player(id: string): (Player & { playerId: string }) | null {
    const p = this.data.players?.[id];
    return p ? { playerId: id, ...p } : null;
  }
  /** Claim or rename a display name for a player id. Returns the record or a refusal. */
  /** Identities with no entry (any version), no group and no moderation record, oldest first: what the cap evicts (0.8.1). */
  private evictablePlayers(players: Record<string, Player>): string[] {
    const keep = new Set<string>();
    for (const e of this.data.entries) if (e.playerId) keep.add(e.playerId);
    for (const g of Object.values(this.data.groups ?? {})) for (const p of g.playerIds) keep.add(p);
    for (const id of Object.keys(this.data.moderation ?? {})) keep.add(id);
    return Object.entries(players)
      .filter(([id]) => !keep.has(id))
      .sort((a, b) => a[1].createdAt.localeCompare(b[1].createdAt))
      .map(([id]) => id);
  }
  claim(
    playerId: string,
    rawName: unknown,
    now = new Date(),
  ):
    | { ok: true; player: Player & { playerId: string } }
    | { ok: false; error: string; retryAfterSec?: number; /** the identity cap is full and nothing can be evicted (0.8.1): 503, try later */ busy?: true } {
    const problem = nameProblem(rawName);
    if (problem) return { ok: false, error: problem };
    const name = normaliseName(rawName);
    const tag = tagFor(playerId);
    const prev = this.data.players?.[playerId];
    if (prev && prev.name === name) return { ok: true, player: { playerId, ...prev } };
    if (prev && prev.renamedAt) {
      const since = now.getTime() - new Date(prev.renamedAt).getTime();
      if (since < RENAME_COOLDOWN_MS)
        return { ok: false, error: 'name was changed recently; try again later', retryAfterSec: Math.ceil((RENAME_COOLDOWN_MS - since) / 1000) };
    }
    const rec: Player = { name, tag, createdAt: prev?.createdAt ?? now.toISOString(), renamedAt: now.toISOString() };
    const players = { ...(this.data.players ?? {}) };
    if (!prev && Object.keys(players).length >= this.maxPlayers) {
      // 0.8.1: identities are free to mint, so the map is capped; the oldest that never submitted and sit in no group go first
      const need = Object.keys(players).length - this.maxPlayers + 1;
      const evict = this.evictablePlayers(players).slice(0, need);
      if (evict.length < need) return { ok: false, error: 'too many players right now; try again later', busy: true };
      for (const id of evict) delete players[id];
    }
    players[playerId] = rec;
    const mod = this.data.moderation?.[playerId];
    let moderation = this.data.moderation;
    if (mod && !mod.hidden && mod.name !== name) {
      moderation = { ...moderation };
      delete moderation[playerId];
    } // a new name starts clean once the old one was cleared; a hidden name stays hidden until a moderator acts (PLAN-v4 0.7.7)
    const label = mod?.hidden ? HIDDEN_LABEL : labelFor(name, tag);
    const entries = this.relabel(this.data.entries, playerId, label); // a rename follows the player onto the boards
    this.commit({ ...this.data, players, entries, ...(moderation !== this.data.moderation ? { moderation } : {}) });
    return { ok: true, player: { playerId, ...rec } };
  }
  /** GDPR-minimal deletion: the name goes, the player's entries are anonymised and lose their replays, the id is forgotten. */
  deletePlayer(playerId: string): { entries: number; coldReplays: number } {
    const mine = this.data.entries.filter((e) => e.playerId === playerId);
    const players = { ...(this.data.players ?? {}) };
    delete players[playerId];
    const replays = { ...(this.data.replays ?? {}) };
    for (const e of mine) delete replays[e.replayHash];
    const entries = this.data.entries.map((e) => (e.playerId === playerId ? { ...e, player: 'deleted', playerId: undefined } : e));
    const groups: Record<string, Group> = {}; // memberships go too (PLAN-v4 0.7.2); an emptied group disappears
    for (const g of Object.values(this.data.groups ?? {})) {
      const rest = g.playerIds.filter((p) => p !== playerId);
      if (rest.length) groups[g.code] = { ...g, playerIds: rest, creatorId: g.creatorId === playerId ? rest[0] : g.creatorId };
    }
    const moderation = { ...(this.data.moderation ?? {}) };
    delete moderation[playerId];
    this.commit({ ...this.data, players, replays, entries, groups, moderation });
    let coldReplays = 0;
    try {
      coldReplays = this.cold.dropPlayer(playerId);
    } catch (e) {
      console.error(`cold deletion for ${playerId.slice(0, 8)}… failed: ${(e as Error).message}`);
    } // 0.8.1: the kept cold replays go too (the policy promised it)
    return { entries: mine.length, coldReplays };
  }
  /**
   * Everything stored under a player id (production roadmap 0.8.6; the access and portability right): the claimed record,
   * every hot and cold entry with its stored replay when one is kept, group memberships, the moderation record of the
   * name (counts only: the reporters are other people's data) and the reports this player filed (reason and time; the
   * target is another player's data). Opt-in play statistics are keyed by a separate random install id and cannot be
   * linked to a player id, so they are absent by construction. A player who never claimed a name still gets their entries.
   */
  exportPlayer(playerId: string, now = new Date()): PlayerExport {
    const player = this.player(playerId);
    const hot = this.data.entries
      .filter((e) => e.playerId === playerId)
      .map((e) => ({ ...this.withLabel(e, now), storage: 'hot' as const, replay: this.data.replays?.[e.replayHash] ?? null }));
    const cold = this.cold
      .entriesOf(playerId)
      .map((c) => ({ ...c.entry, player: player ? this.labelOf(playerId, player, now) : c.entry.player, storage: 'cold' as const, replay: c.replay }));
    const mod = this.data.moderation?.[playerId];
    const reportsFiled = Object.values(this.data.moderation ?? {})
      .flatMap((m) => m.reports.filter((r) => r.reporterId === playerId).map((r) => ({ reason: r.reason, at: r.at })))
      .sort((a, b) => a.at.localeCompare(b.at));
    return {
      exportedAt: now.toISOString(),
      protocol: PROTOCOL,
      rulesVersion: RULES_VERSION,
      playerId,
      tag: tagFor(playerId),
      player: player ? { name: player.name, tag: player.tag, createdAt: player.createdAt, renamedAt: player.renamedAt, hidden: this.isHidden(mod, now) } : null,
      entries: [...hot, ...cold].sort((a, b) => a.verifiedAt.localeCompare(b.verifiedAt)),
      groups: this.groupsOf(playerId),
      moderation: mod
        ? {
            name: mod.name,
            hidden: mod.hidden,
            hiddenAt: mod.hiddenAt ?? null,
            confirmedAt: mod.confirmedAt ?? null,
            clears: mod.clears,
            reports: mod.reports.length,
          }
        : null,
      reportsFiled,
      notes: [
        "Entries carry the label shown on the boards at export time; replays are kept for a seed's top entries and for the top entries of closed days only, so an entry may have replay: null.",
        'Play statistics (if you opted in) are stored under a random install id that is never linked to this player id; they are not part of this export.',
        'Request logs hold a daily-salted hash of the address, never an identifier of this player; they are not part of this export.',
      ],
    };
  }

  // ---------- name moderation (PLAN-v4 0.7.7) ----------
  /** A report target: a claimed player by id, or by the hash of one of their verified entries (hot, or a kept cold replay). */
  private reportTarget(t: { playerId?: unknown; hash?: unknown }): { playerId: string } | { error: string; status: 404 | 422 } {
    if (typeof t.hash === 'string' && t.hash) {
      const hash = t.hash;
      const e =
        this.data.entries.find((x) => x.replayHash === hash) ??
        (() => {
          const d = this.cold.dateOfReplay(hash);
          const day = d ? this.cold.day(d) : null;
          return day?.entries.find((x) => x.replayHash === hash);
        })();
      if (!e) return { error: 'no verified entry with that hash', status: 404 };
      if (!e.playerId || !this.data.players?.[e.playerId]) return { error: 'anonymous entries cannot be reported', status: 422 };
      return { playerId: e.playerId };
    }
    if (typeof t.playerId === 'string' && /^[0-9a-f]{64}$/.test(t.playerId))
      return this.data.players?.[t.playerId] ? { playerId: t.playerId } : { error: 'no such player', status: 404 };
    return { error: 'a report needs a playerId or a replay hash', status: 422 };
  }
  /** Report a name: hides it as HIDDEN_LABEL on every board until a moderator acts (at most MAX_HIDES_PER_NAME times per name); never touches scores; one report per reporter per target. */
  report(
    reporterId: string,
    target: { playerId?: unknown; hash?: unknown },
    reason: unknown,
    now = new Date(),
  ): { ok: true; playerId: string; hidden: boolean; duplicate: boolean } | { ok: false; error: string; status: 404 | 422 } {
    if (!this.data.players?.[reporterId]) return { ok: false, error: 'claim a name before reporting', status: 422 };
    if (typeof reason !== 'string' || !(REPORT_REASONS as readonly string[]).includes(reason))
      return { ok: false, error: `reason must be one of ${REPORT_REASONS.join(', ')}`, status: 422 };
    const t = this.reportTarget(target);
    if ('error' in t) return { ok: false, ...t };
    if (t.playerId === reporterId) return { ok: false, error: 'you cannot report yourself', status: 422 };
    const p = this.data.players[t.playerId];
    const prev = this.data.moderation?.[t.playerId];
    const rec: ModerationRecord =
      prev && (prev.hidden || prev.name === p.name) ? { ...prev, reports: [...prev.reports] } : { name: p.name, hidden: false, clears: 0, reports: [] };
    if (rec.reports.some((r) => r.reporterId === reporterId)) return { ok: true, playerId: t.playerId, hidden: this.isHidden(rec, now), duplicate: true };
    const established =
      this.reportPolicy.establishedDays <= 0 ||
      this.data.entries.some(
        (e) =>
          e.playerId === reporterId &&
          e.rulesVersion === RULES_VERSION &&
          Date.parse(e.verifiedAt) <= now.getTime() - this.reportPolicy.establishedDays * 86_400_000,
      );
    if (rec.reports.length < MAX_REPORTERS_PER_TARGET)
      rec.reports.push({ reporterId, reason: reason as ReportReason, at: now.toISOString(), ...(established ? { established: true } : {}) });
    if (rec.hidden && !this.isHidden(rec, now)) {
      rec.hidden = false;
      delete rec.hiddenAt;
    } // an unconfirmed hide that lapsed is over; a fresh quorum may hide again
    const standing = rec.reports.filter((r) => r.established).length;
    const hide = !rec.hidden && rec.clears < MAX_HIDES_PER_NAME && standing >= this.reportPolicy.reporters;
    if (hide) {
      rec.hidden = true;
      rec.hiddenAt = now.toISOString();
    }
    this.commit({
      ...this.data,
      entries: hide ? this.relabel(this.data.entries, t.playerId, HIDDEN_LABEL) : this.data.entries,
      moderation: { ...(this.data.moderation ?? {}), [t.playerId]: rec },
    });
    this.audit({
      at: now.toISOString(),
      action: 'report',
      playerId: t.playerId,
      name: p.name,
      reason,
      by: reporterId,
      hidden: rec.hidden,
      reports: rec.reports.length,
    });
    return { ok: true, playerId: t.playerId, hidden: rec.hidden, duplicate: false };
  }
  hidden(playerId: string, now = new Date()): boolean {
    return this.isHidden(this.data.moderation?.[playerId], now);
  }
  /** Moderator: the hide stands (0.8.1). A hidden or lapsed name with open reports is hidden from now until clear or rename; it no longer expires. */
  confirmHide(playerId: unknown, now = new Date()): { ok: true; playerId: string; name: string } | { ok: false; error: string; status: 404 } {
    const m = typeof playerId === 'string' ? this.data.moderation?.[playerId] : undefined;
    if (!m || typeof playerId !== 'string' || (!m.hidden && !m.reports.length)) return { ok: false, error: 'no open reports for that player', status: 404 };
    const rec: ModerationRecord = { ...m, hidden: true, hiddenAt: m.hiddenAt ?? now.toISOString(), confirmedAt: now.toISOString() };
    this.commit({
      ...this.data,
      entries: this.relabel(this.data.entries, playerId, HIDDEN_LABEL),
      moderation: { ...(this.data.moderation ?? {}), [playerId]: rec },
    });
    this.audit({ at: now.toISOString(), action: 'confirm', playerId, name: m.name, by: 'moderator', reports: m.reports.length });
    return { ok: true, playerId, name: m.name };
  }
  /** What the moderator sees: every player with a hidden name or open reports, oldest first, with the reported and the current name. */
  reports(now = new Date()): (ModerationRecord & {
    playerId: string;
    tag: string;
    currentName: string | null;
    /** when an unconfirmed hide lapses (0.8.1); null when shown or confirmed */ expiresAt: string | null;
  })[] {
    const at = (m: ModerationRecord) => m.hiddenAt ?? m.reports[0]?.at ?? '';
    return Object.entries(this.data.moderation ?? {})
      .filter(([, m]) => m.hidden || m.reports.length)
      .map(([playerId, m]) => ({
        playerId,
        tag: tagFor(playerId),
        currentName: this.data.players?.[playerId]?.name ?? null,
        ...m,
        hidden: this.isHidden(m, now),
        expiresAt: this.hideExpiresAt(m),
      }))
      .sort((a, b) => at(a).localeCompare(at(b)));
  }
  /** Moderator: the name is fine. It shows again, the reports close, and after MAX_HIDES_PER_NAME clears a report no longer hides this name. */
  clearReports(
    playerId: unknown,
    now = new Date(),
  ): { ok: true; playerId: string; name: string | null; clears: number } | { ok: false; error: string; status: 404 } {
    const m = typeof playerId === 'string' ? this.data.moderation?.[playerId] : undefined;
    if (!m || typeof playerId !== 'string' || (!m.hidden && !m.reports.length)) return { ok: false, error: 'no open reports for that player', status: 404 };
    const p = this.data.players?.[playerId] ?? null;
    const rec: ModerationRecord = { name: p?.name ?? m.name, hidden: false, clears: m.clears + 1, reports: [] };
    this.commit({
      ...this.data,
      entries: p ? this.relabel(this.data.entries, playerId, labelFor(p.name, p.tag)) : this.data.entries,
      moderation: { ...(this.data.moderation ?? {}), [playerId]: rec },
    });
    this.audit({ at: now.toISOString(), action: 'clear', playerId, name: rec.name, by: 'moderator', clears: rec.clears, closed: m.reports.length });
    return { ok: true, playerId, name: p?.name ?? null, clears: rec.clears };
  }
  /** Moderator: force a display name (filtered like any other). The player's rename cooldown restarts, the reports close, the record is dropped. */
  forceRename(
    playerId: unknown,
    rawName: unknown,
    now = new Date(),
  ): { ok: true; player: Player & { playerId: string } } | { ok: false; error: string; status: 404 | 422 } {
    const p = typeof playerId === 'string' ? this.data.players?.[playerId] : undefined;
    if (!p || typeof playerId !== 'string') return { ok: false, error: 'no such player', status: 404 };
    const problem = nameProblem(rawName);
    if (problem) return { ok: false, error: problem, status: 422 };
    const name = normaliseName(rawName);
    const rec: Player = { ...p, name, renamedAt: now.toISOString() };
    const moderation = { ...(this.data.moderation ?? {}) };
    const closed = moderation[playerId]?.reports.length ?? 0;
    delete moderation[playerId];
    this.commit({
      ...this.data,
      players: { ...(this.data.players ?? {}), [playerId]: rec },
      entries: this.relabel(this.data.entries, playerId, labelFor(name, p.tag)),
      moderation,
    });
    this.audit({ at: now.toISOString(), action: 'rename', playerId, from: p.name, to: name, by: 'moderator', closed });
    return { ok: true, player: { playerId, ...rec } };
  }
  /** Moderator: force a group name (filtered like any other); the creator's rename cooldown restarts. */
  forceRenameGroup(
    code: unknown,
    rawName: unknown,
    now = new Date(),
  ): { ok: true; group: { code: string; name: string } } | { ok: false; error: string; status: 404 | 422 } {
    const g = typeof code === 'string' ? this.data.groups?.[code] : undefined;
    if (!g) return { ok: false, error: 'no such group', status: 404 };
    const problem = nameProblem(rawName);
    if (problem) return { ok: false, error: `group ${problem}`, status: 422 };
    const name = normaliseName(rawName);
    this.commit({ ...this.data, groups: { ...(this.data.groups ?? {}), [g.code]: { ...g, name, renamedAt: now.toISOString() } } });
    this.audit({ at: now.toISOString(), action: 'rename-group', code: g.code, from: g.name, to: name, by: 'moderator' });
    return { ok: true, group: { code: g.code, name } };
  }
  /** One JSON line per report and moderator action (best effort: a failed append is logged and never undoes the action). */
  private audit(row: Record<string, unknown>) {
    if (!this.auditFile) return;
    try {
      fs.mkdirSync(path.dirname(this.auditFile), { recursive: true });
      fs.appendFileSync(this.auditFile, JSON.stringify(row) + '\n');
    } catch (e) {
      console.error(`moderation audit append failed: ${(e as Error).message}`);
    }
  }

  /**
   * Step 1 of a submission (0.8.2), cheap and synchronous: decode, rules version, duplicate, issued seed. Nothing is simulated,
   * so the request path refuses most bad input before paying for a re-simulation.
   */
  prepare(replayText: string): { ok: true; replay: ReplayFile; replayHash: string } | { ok: false; error: string; code: RefusalCode } {
    let replay: ReplayFile;
    try {
      replay = decodeReplay(replayText);
    } catch (e) {
      return { ok: false, error: `rejected: ${(e as Error).message}`, code: 'bad-replay' };
    }
    if (replay.rulesVersion !== RULES_VERSION)
      return { ok: false, error: `rejected: rules version ${replay.rulesVersion} not accepted (server has ${RULES_VERSION})`, code: 'rules-version' };
    const replayHash = replayId(replay);
    const dup = this.data.entries.find((e) => e.replayHash === replayHash);
    if (dup && dup.score === replay.claimedScore) return { ok: false, error: 'rejected: duplicate replay', code: 'duplicate' }; // an identical resubmission skips the simulation; the same actions with a different claim still go through it and fail as a mismatch, as before
    if ((isMintedDailySeed(replay.seed) || isWeeklySeed(replay.seed)) && !this.issuedRecordForSeed(replay.seed))
      return { ok: false, error: `rejected: not an issued ${isWeeklySeed(replay.seed) ? 'weekly' : 'daily'} seed`, code: 'unissued-seed' }; // a minted-looking seed counts only if this server issued it (PLAN-v3 0.6.1, PLAN-v4 0.7.5)
    return { ok: true, replay, replayHash };
  }
  /** Step 2: the one re-simulation (the HTTP path runs it in a worker; tests and tools call it inline). */
  resimulate(replay: ReplayFile): Resim {
    return resimulate(replay);
  }
  /** Step 3, synchronous: judge the re-simulation, apply the window, keep-best and retention, commit. Throws StorageError if it cannot persist. */
  record(replay: ReplayFile, replayHash: string, sim: Resim, player = 'anonymous', playerId: string | null = null, now = new Date()): SubmitResult {
    if (!sim.ok) return { ok: false, error: `rejected: ${sim.error}`, code: sim.code };
    if (this.data.entries.some((e) => e.replayHash === replayHash)) return { ok: false, error: 'rejected: duplicate replay', code: 'duplicate' }; // two copies in flight: the second finds the first
    const claimed = playerId ? this.data.players?.[playerId] : undefined;
    const anon = normaliseName(player);
    const label = claimed ? this.labelOf(playerId!, claimed, now) : anon && !nameProblem(anon) ? anon : 'anonymous'; // the anonymous label is a user-written field too: filtered, and dropped rather than refused (PLAN-v4 §1)
    if (isMintedDailySeed(replay.seed) || isWeeklySeed(replay.seed)) {
      // after the close the run is verified and told so, but the final board never changes (PLAN-v3 0.6.2)
      const rec = this.issuedRecordForSeed(replay.seed);
      if (!rec) return { ok: false, error: `rejected: not an issued ${isWeeklySeed(replay.seed) ? 'weekly' : 'daily'} seed`, code: 'unissued-seed' };
      if (now.getTime() >= Date.parse(rec.closesAt)) {
        this.observeFreeze(now);
        return { ok: true, score: sim.score, late: true, recorded: false, closesAt: rec.closesAt, player: label };
      }
    }
    // verifiedAt is the injected clock (0.8.1): reporter standing and tie-breaks read this stamp, so a fake clock in tests governs it too
    const entry: BoardEntry = {
      seed: replay.seed,
      score: sim.score,
      player: label,
      verifiedAt: now.toISOString(),
      rulesVersion: replay.rulesVersion,
      actions: replay.actions.length,
      replayHash,
      finalMachines: sim.finalMachines,
      ...(sim.stars != null ? { stars: sim.stars } : {}),
      rounds: sim.rounds,
      ...(playerId ? { playerId } : {}),
    };
    // keep-best per (seed, player): a worse or equal run is verified but not recorded; a better one replaces the old entry and its replay
    let entries = this.data.entries;
    const replays = { ...(this.data.replays ?? {}) };
    if (playerId) {
      const mine = entries.find((e) => e.seed === replay.seed && e.playerId === playerId && e.rulesVersion === RULES_VERSION);
      if (mine && byRank(mine, entry) <= 0) return { ok: true, score: sim.score, entry: mine, recorded: false, player: label };
      if (mine) {
        entries = entries.filter((e) => e !== mine);
        delete replays[mine.replayHash];
      }
    }
    const event = isMintedDailySeed(replay.seed) || isWeeklySeed(replay.seed) ? this.issuedRecordForSeed(replay.seed) : null;
    const prevTop = event ? (this.rank(replay.seed)[0] ?? null) : null;
    replays[replayHash] = {
      seed: replay.seed,
      rulesVersion: replay.rulesVersion,
      actions: replay.actions,
      score: sim.score,
      player: entry.player,
      verifiedAt: entry.verifiedAt,
    };
    const candidate: Board = {
      ...this.data, // never rebuild the board from a subset of its fields: cached pars were lost that way (review F08)
      entries: [...entries, entry],
      replays,
    };
    this.prune(candidate, replay.seed);
    this.commit(candidate); // throws StorageError: nothing recorded, caller answers 503
    if (event) {
      const top = this.rank(replay.seed)[0];
      if (top && top.replayHash === replayHash && !(prevTop && playerId && prevTop.playerId === playerId))
        this.announce({ kind: 'lead', record: event, entry: top, previous: prevTop });
    } // a new #1 on an open event (PLAN-v4 0.7.6); a leader improving their own run is not news
    return { ok: true, score: sim.score, entry, recorded: true, player: label };
  }
  /** Verify a replay inline and record it: prepare → one re-simulation → record. Returns the verdict (never trusts claimedScore). Throws StorageError if it cannot persist. */
  submit(replayText: string, player = 'anonymous', playerId: string | null = null, now = new Date()): SubmitResult {
    const p = this.prepare(replayText);
    if (!p.ok) return { ok: false, error: p.error, code: p.code };
    return this.record(p.replay, p.replayHash, this.resimulate(p.replay), player, playerId, now);
  }
  board(seed: string, limit = 20, members?: ReadonlySet<string> | null, now = new Date()): BoardEntry[] {
    const n = Math.min(MAX_BOARD_LIMIT, Math.max(1, Math.floor(limit) || 1));
    return this.rank(seed, this.data, members, now)
      .slice(0, n)
      .map((e) => ({ ...e, replayAvailable: !!this.data.replays?.[e.replayHash] || !!this.cold.dateOfReplay(e.replayHash) }));
  }
  /** Stored replay of a verified, current-version entry (boards written before replay storage existed have none). */
  replay(hash: string, now = new Date()): (StoredReplay & { hash: string }) | null {
    const r =
      this.data.replays?.[hash] ??
      (() => {
        const d = this.cold.dateOfReplay(hash);
        return d ? this.cold.day(d)?.replays[hash] : undefined;
      })();
    if (!r || r.rulesVersion !== RULES_VERSION) return null;
    const hot = this.data.entries.find((x) => x.replayHash === hash); // the label follows renames and moderation (PLAN-v4 0.7.7), the stored replay keeps the label at verification
    const player = hot
      ? hot.playerId && this.data.players?.[hot.playerId]
        ? this.labelOf(hot.playerId, undefined, now)
        : hot.player
      : (() => {
          const d = this.cold.dateOfReplay(hash);
          const day = d ? this.cold.day(d) : null;
          return day ? this.coldEntries(day.record.seed, now).find((x) => x.replayHash === hash)?.player : undefined;
        })();
    return { hash, ...r, player: player ?? r.player };
  }
  /** A verified entry for a challenge link (PLAN-v4 0.7.1): earnings and standing, never actions. Hot first, then cold (by kept replay, or by seed when given). */
  entry(
    hash: string,
    seed?: string | null,
    now = new Date(),
  ): {
    seed: string;
    score: number;
    player: string;
    rounds: number[] | null;
    replayHash: string;
    verifiedAt: string;
    rulesVersion: number;
    frozen: boolean;
    medals: Medals | null;
  } | null {
    let e = this.data.entries.find((x) => x.replayHash === hash && x.rulesVersion === RULES_VERSION);
    if (!e) {
      const date = this.cold.dateOfReplay(hash) ?? (seed ? this.cold.dateOfSeed(seed) : null);
      if (date) {
        const day = this.cold.day(date);
        const found = day?.entries.find((x) => x.replayHash === hash);
        if (found && day) e = this.coldEntries(day.record.seed, now).find((x) => x.replayHash === hash) ?? found;
      }
    }
    if (!e) return null;
    const rec = this.issuedRecordForSeed(e.seed);
    const player = e.playerId && this.data.players?.[e.playerId] ? this.labelOf(e.playerId, undefined, now) : e.player;
    return {
      seed: e.seed,
      score: e.score,
      player,
      rounds: e.rounds ?? null,
      replayHash: e.replayHash,
      verifiedAt: e.verifiedAt,
      rulesVersion: e.rulesVersion,
      frozen: !!rec?.frozenAt,
      medals: rec?.frozenAt ? (rec.medals ?? null) : null,
    };
  }
  /** Why a replay is not served: 'compacted' when its entry is on a cold day below the kept top (PLAN-v4 0.7.0), else 'unknown'. */
  replayMissingReason(hash: string, seed?: string | null): 'compacted' | 'unknown' {
    if (!seed) return 'unknown';
    const date = this.cold.dateOfSeed(seed);
    if (!date) return 'unknown';
    const day = this.cold.day(date);
    return day && day.entries.some((e) => e.replayHash === hash) ? 'compacted' : 'unknown';
  }
  /**
   * Reveal gate (PLAN-v3 0.6.6): on an open daily, other players' replays are served only to a player with a verified
   * entry on that seed; once the day closes everyone may watch. Ordinary seeds and practice seeds are never gated.
   * Returns null when allowed, otherwise the reason (and the close time) for a 403.
   */
  revealGate(seed: string, playerId: string | null, now = new Date()): { error: string; closesAt: string } | null {
    if (!isMintedDailySeed(seed) && !isWeeklySeed(seed)) return null;
    const rec = this.issuedRecordForSeed(seed);
    if (!rec) return null; // not an issued daily or weekly: nothing to protect
    if (rec.frozenAt || Date.parse(rec.closesAt) <= now.getTime()) return null;
    if (playerId && this.data.entries.some((e) => e.seed === seed && e.playerId === playerId && e.rulesVersion === RULES_VERSION)) return null;
    return {
      error: `replays on an open daily are revealed after you submit a verified run for it, or when the day closes at ${rec.closesAt}`,
      closesAt: rec.closesAt,
    };
  }
  /** The stored bot par for a seed under the current rules, or null when it has not been computed. */
  par(seed: string): number | null {
    const p =
      this.data.pars?.[seed] ??
      (() => {
        const d = this.cold.dateOfSeed(seed);
        return d ? (this.cold.day(d)?.par ?? undefined) : undefined;
      })();
    return p && p.rulesVersion === RULES_VERSION ? p.par : null;
  }
  /** Persist a computed par (atomic, like every write); cached pars are capped at maxSeeds, oldest first (review F07). */
  setPar(seed: string, par: number, runs: number, tries: number) {
    const pars = { ...(this.data.pars ?? {}), [seed]: { par, runs, tries, rulesVersion: RULES_VERSION, computedAt: new Date().toISOString() } };
    const keys = Object.keys(pars);
    const dailySeeds = new Set(Object.values(this.data.dailies ?? {}).map((d) => d.seed)); // a day's par is computed once and kept (PLAN-v3 0.6.2)
    if (keys.length > this.maxSeeds)
      for (const k of keys
        .filter((k) => !dailySeeds.has(k))
        .sort((a, b) => pars[a].computedAt.localeCompare(pars[b].computedAt))
        .slice(0, keys.length - this.maxSeeds))
        delete pars[k];
    this.commit({ ...this.data, pars });
  }
  /** Number of cached pars (for tests and /health). */
  get parCount() {
    return Object.keys(this.data.pars ?? {}).length;
  }
  /** Verified score distribution for a seed; `hash` locates the caller's own entry. */
  histogram(seed: string, hash?: string, members?: ReadonlySet<string> | null, now = new Date()): Histogram {
    return { seed, ...histogramOf(this.rank(seed, this.data, members, now), hash) };
  }
  /** The issued daily for a UTC date, minting and persisting it on first request; null when that day has not opened yet (PLAN-v3 0.6.1). */
  /** Hand an event to the announcer (PLAN-v4 0.7.6); announcing never affects the operation that caused it. */
  private announce(ev: AnnounceEvent) {
    if (!this.announceFn) return;
    try {
      this.announceFn(ev);
    } catch {
      /* the announcer logs its own trouble */
    }
  }
  /** Mark every issued day whose window has closed as frozen at its close time: idempotent, persisted, derived from the clock alone (PLAN-v3 0.6.2). */
  private observeFreeze(now: Date) {
    const ds = this.data.dailies;
    if (!ds) return;
    let changed = false;
    const next: Record<string, DailyRecord> = {};
    const frozenNow: DailyRecord[] = [];
    for (const [k, r] of Object.entries(ds)) {
      if (!r.frozenAt && Date.parse(r.closesAt) <= now.getTime()) {
        next[k] = { ...r, frozenAt: r.closesAt, medals: medalThresholds(this.rank(r.seed).map((e) => e.score)) };
        changed = true;
        if (Date.parse(r.issuedAt) < Date.parse(r.closesAt)) frozenNow.push(next[k]);
      } // the final board sets the medals (PLAN-v3 0.6.4); a day issued after its own close (an archive lookup) is not announced
      else if (r.frozenAt && r.medals === undefined) {
        next[k] = { ...r, medals: medalThresholds(this.rank(r.seed).map((e) => e.score)) };
        changed = true;
      } // a day frozen before medals existed
      else next[k] = r;
    }
    if (!changed) return;
    const d = { ...this.data, dailies: next };
    try {
      this.commit(d);
    } catch {
      this.data = d;
    }
    for (const r of frozenNow) {
      const n = this.rank(r.seed).length;
      if (n) this.announce({ kind: 'freeze', record: r, n, top: this.board(r.seed, 3) });
    } // a day nobody played is not news
  }
  dailyRecord(date: string, now = new Date()): DailyRecord | null {
    if (!isUtcDate(date) || date > utcDate(now)) return null;
    const have = this.data.dailies?.[date];
    if (have) {
      this.observeFreeze(now);
      return this.data.dailies![date];
    }
    const cold = this.cold.day(date)?.record;
    if (cold) return cold; // a closed day in cold storage is final: never re-minted
    if (!this.withinHistory(date, now)) return null; // 0.8.1: nothing older than DAILY_HISTORY_DAYS is minted on request
    const friday = new Date(dayStartMs(date)).getUTCDay() === 5;
    const rec: DailyRecord = {
      date,
      seed: mintSeed(this.dailySecret, date),
      commitment: commitmentFor(mintSeed(this.dailySecret, shiftDate(date, 1))),
      issuedAt: now.toISOString(),
      closesAt: new Date(dayStartMs(date) + DAILY_WINDOW_MS).toISOString(),
      rulesVersion: RULES_VERSION,
      build: VERSION,
      ...(friday ? { weeklyCommitment: commitmentFor(mintWeeklySeed(this.dailySecret, isoWeekId(new Date(dayStartMs(date))))) } : {}),
    }; // PLAN-v4 0.7.5: a Friday's daily commits to the weekly opening at 18:00 UTC
    const next = { ...this.data, dailies: { ...(this.data.dailies ?? {}), [date]: rec } };
    try {
      this.commit(next);
    } catch {
      this.data = next;
    } // storage trouble: serve the minted seed anyway; it is persisted with the next successful write
    this.observeFreeze(now); // a day issued after its own close (an archive lookup) is frozen at once
    if (date === utcDate(now)) this.announce({ kind: 'seed', record: this.data.dailies![date] }); // today's seed opening, not the previous day minted for the chain nor an archive lookup
    return this.data.dailies![date];
  }
  /** Closed days, newest first, paged by `limit` with `nextTo` = the next older date to pass as `to` (PLAN-v3 0.6.2). */
  archive(
    o: { from?: string; to?: string; limit?: number } = {},
    now = new Date(),
    members?: ReadonlySet<string> | null,
  ): { days: ArchiveDay[]; nextTo: string | null } {
    this.observeFreeze(now);
    const limit = Math.min(MAX_ARCHIVE_LIMIT, Math.max(1, Math.floor(o.limit ?? 30)));
    const dateOfKey = (k: string) => (isWeekId(k) ? weeklyWindow(k)!.openDate : k); // weeklies sort by the Friday they opened
    const inRange = (d: string) => (!o.from || d >= o.from) && (!o.to || d <= o.to);
    const hotFrozen = Object.values(this.data.dailies ?? {}).filter((r) => r.frozenAt && inRange(r.date));
    const hotKeys = new Set(hotFrozen.map(recordKey));
    const coldKeys = this.cold.dates().filter((k) => inRange(dateOfKey(k)) && !hotKeys.has(k)); // a record present in both (a failed hot commit after a cold write) counts once
    const keys = [...hotFrozen.map(recordKey), ...coldKeys].sort((a, b) => dateOfKey(b).localeCompare(dateOfKey(a)) || (isWeekId(a) ? -1 : 1)); // newest first; on the same date the weekly comes first
    const days: ArchiveDay[] = [];
    for (const key of keys.slice(0, limit)) {
      const r = this.data.dailies?.[key] ?? this.cold.day(key)?.record;
      if (!r) continue;
      days.push({
        date: r.date,
        key,
        kind: r.kind === 'weekly' ? 'weekly' : 'daily',
        seed: r.seed,
        closesAt: r.closesAt,
        frozenAt: r.frozenAt ?? r.closesAt,
        n: this.rank(r.seed, this.data, members, now).length,
        botPar: this.par(r.seed),
        medals: r.medals ?? null,
        top: this.board(r.seed, 5, members, now),
      });
    }
    return { days, nextTo: keys.length > limit ? dateOfKey(keys[limit]) : null };
  }
  /** Medal thresholds for a seed that is a frozen daily; null otherwise (open days, ordinary seeds, too few runs). */
  medalsForSeed(seed: string, now = new Date()): Medals | null {
    if (!isMintedDailySeed(seed) && !isWeeklySeed(seed)) return null;
    this.observeFreeze(now);
    const rec = this.issuedRecordForSeed(seed);
    return rec && rec.frozenAt ? (rec.medals ?? null) : null;
  }
  /** Today's minted seed (the one bot par computes first). */
  todaySeed(now = new Date()): string {
    return this.dailyRecord(utcDate(now), now)!.seed;
  }
  /** Today's challenge (or an opened past day): the minted record, its verified board, and the previous day for commitment checks. */
  daily(
    limit = 10,
    now = new Date(),
    date = utcDate(now),
    members?: ReadonlySet<string> | null,
  ):
    | (Omit<DailyRecord, 'frozenAt'> & {
        frozenAt: string | null;
        final: boolean;
        now: string;
        verified: true;
        minted: true;
        entries: BoardEntry[];
        previous: { date: string; seed: string; commitment: string } | null;
      })
    | null {
    const rec = this.dailyRecord(date, now);
    if (!rec) return null;
    const prev = this.dailyRecord(shiftDate(date, -1), now);
    return {
      ...rec,
      frozenAt: rec.frozenAt ?? null,
      final: !!rec.frozenAt,
      now: now.toISOString(),
      verified: true,
      minted: true,
      entries: this.board(rec.seed, Math.min(MAX_DAILY_LIMIT, limit), members, now),
      previous: prev ? { date: prev.date, seed: prev.seed, commitment: prev.commitment } : null,
    };
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
// worker entry for re-simulation (0.8.2): a persistent worker answers { id, replay } with { id, result } until terminated
if (!isMainThread && parentPort && workerData && (workerData as { resimWorker?: unknown }).resimWorker === true) {
  parentPort.on('message', (m: { id: number; replay: ReplayFile }) => {
    let result: Resim;
    try {
      result = resimulate(m.replay);
    } catch (e) {
      result = { ok: false, error: (e as Error).message, code: 'illegal-action' };
    }
    parentPort!.postMessage({ id: m.id, result });
  });
}
export class QueueFullError extends Error {}
export class ResimTimeoutError extends Error {}
export interface VerifyServiceOptions {
  /** wall-clock cap per re-simulation (default 10 s; a legal 4,000-action replay takes milliseconds) */ capMs?: number;
  /** submissions waiting behind the running one; beyond this the request answers 503 busy */ maxQueue?: number;
}
/**
 * Re-simulation off the event loop (0.8.2): one job at a time in a persistent worker thread (spawned on first use, replaced
 * after a timeout or a crash), a bounded FIFO queue, a wall-clock cap per job. The service never touches the board: the
 * request path prepares before and records after. `compute` can be injected (tests); null means the worker.
 */
export class VerifyService {
  private worker: Worker | null = null;
  private seq = 0;
  private jobs = 0;
  private timeouts = 0;
  private queue: { replay: ReplayFile; resolve: (r: Resim) => void; reject: (e: Error) => void }[] = [];
  private pending: { id: number; timer: NodeJS.Timeout; resolve: (r: Resim) => void; reject: (e: Error) => void } | null = null;
  readonly capMs: number;
  readonly maxQueue: number;
  constructor(
    private readonly compute: ((replay: ReplayFile) => Promise<Resim>) | null = null,
    opts: VerifyServiceOptions = {},
  ) {
    this.capMs = opts.capMs ?? 10_000;
    this.maxQueue = opts.maxQueue ?? 32;
  }
  get busy(): boolean {
    return !!this.pending;
  }
  get queued(): number {
    return this.queue.length;
  }
  get stats() {
    return { jobs: this.jobs, timeouts: this.timeouts, queued: this.queue.length, busy: this.busy, capMs: this.capMs, maxQueue: this.maxQueue };
  }
  /** Re-simulate off the loop; rejects with QueueFullError at once when the queue is full, with ResimTimeoutError when the cap passes. */
  verify(replay: ReplayFile): Promise<Resim> {
    if (this.pending && this.queue.length >= this.maxQueue)
      return Promise.reject(new QueueFullError(`verifier busy: ${this.maxQueue} submissions already waiting`));
    return new Promise<Resim>((resolve, reject) => {
      this.queue.push({ replay, resolve, reject });
      this.drain();
    });
  }
  private drain() {
    if (this.pending || !this.queue.length) return;
    const job = this.queue.shift()!;
    const id = ++this.seq;
    this.jobs++;
    const timer = setTimeout(() => {
      const p = this.pending;
      if (!p || p.id !== id) return;
      this.timeouts++;
      this.pending = null;
      this.resetWorker();
      p.reject(new ResimTimeoutError(`re-simulation exceeded ${this.capMs} ms`));
      this.drain();
    }, this.capMs);
    this.pending = { id, timer, resolve: job.resolve, reject: job.reject };
    const run = this.compute ? this.compute(job.replay) : this.inWorker(id, job.replay);
    run.then(
      (r) => this.settle(id, (p) => p.resolve(r)),
      (e: unknown) => this.settle(id, (p) => p.reject(e instanceof Error ? e : new Error(String(e)))),
    );
  }
  private settle(id: number, fn: (p: NonNullable<VerifyService['pending']>) => void) {
    const p = this.pending;
    if (!p || p.id !== id) return;
    clearTimeout(p.timer);
    this.pending = null;
    fn(p);
    this.drain();
  }
  private inWorker(id: number, replay: ReplayFile): Promise<Resim> {
    const w = this.ensureWorker();
    return new Promise<Resim>((resolve, reject) => {
      const done = () => {
        w.off('message', onMsg);
        w.off('error', onErr);
        w.off('exit', onExit);
      };
      const onMsg = (m: { id: number; result: Resim }) => {
        if (m.id !== id) return;
        done();
        resolve(m.result);
      };
      const onErr = (e: Error) => {
        done();
        this.resetWorker();
        reject(e);
      };
      const onExit = (code: number) => {
        done();
        if (this.worker === w) this.worker = null;
        reject(new Error(`re-simulation worker exited with ${code}`));
      };
      w.on('message', onMsg);
      w.on('error', onErr);
      w.on('exit', onExit);
      w.postMessage({ id, replay });
    });
  }
  private ensureWorker(): Worker {
    if (!this.worker) {
      this.worker = new Worker(new URL(import.meta.url), { workerData: { resimWorker: true }, execArgv: loaderArgs() });
      this.worker.unref();
    }
    return this.worker;
  }
  private resetWorker() {
    const w = this.worker;
    this.worker = null;
    if (w) void w.terminate();
  }
  /** Stop the worker and fail whatever is waiting (shutdown). */
  close() {
    this.resetWorker();
    if (this.pending) {
      clearTimeout(this.pending.timer);
      const p = this.pending;
      this.pending = null;
      p.reject(new Error('verifier closing'));
    }
    for (const j of this.queue.splice(0)) j.reject(new Error('verifier closing'));
  }
}
/** Only the module-loader flags of this process (e.g. --import tsx) go to the worker: node --test adds flags a Worker rejects. */
function loaderArgs(): string[] {
  const out: string[] = [];
  const a = process.execArgv;
  for (let i = 0; i < a.length; i++) {
    const f = a[i];
    if (/^--(import|loader|experimental-loader|require)(=|$)/.test(f)) {
      out.push(f);
      if (!f.includes('=') && i + 1 < a.length) out.push(a[++i]);
    }
  }
  return out;
}
/** Compute a par off the request path: a worker thread running this module, terminated at the wall-clock cap. */
export function computeParInWorker(seed: string, capMs = 20_000, runs = PAR_RUNS, tries = PAR_TRIES): Promise<number> {
  return new Promise((resolve, reject) => {
    const w = new Worker(new URL(import.meta.url), { workerData: { parSeed: seed, runs, tries }, execArgv: loaderArgs() });
    const timer = setTimeout(() => {
      void w.terminate();
      reject(new Error(`par for ${seed} exceeded ${capMs} ms`));
    }, capMs);
    w.once('message', (v: number) => {
      clearTimeout(timer);
      resolve(v);
      void w.terminate();
    });
    w.once('error', (e) => {
      clearTimeout(timer);
      reject(e);
    });
    w.once('exit', (code) => {
      clearTimeout(timer);
      if (code !== 0) reject(new Error(`par worker exited with ${code}`));
    });
  });
}
export interface ParServiceOptions {
  /** seeds waiting behind the running job; anything beyond is refused (reads still answer) */ maxQueue?: number;
  /** failure memory entries kept */ maxFailures?: number;
}
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
  constructor(
    private readonly verifier: Verifier,
    private readonly compute: (seed: string) => Promise<number> = (s) => computeParInWorker(s),
    private readonly cooldownMs = 10 * 60_000,
    private readonly now: () => number = Date.now,
    opts: ParServiceOptions = {},
  ) {
    this.maxQueue = opts.maxQueue ?? 8;
    this.maxFailures = opts.maxFailures ?? 500;
  }
  get busy(): string | null {
    return this.pending;
  }
  get queued(): number {
    return this.queue.length;
  }
  get failures(): number {
    return this.failedAt.size;
  }
  /** Ask for a seed's par; returns at once with whether the work was admitted. Known, queued, recently failed or over-capacity requests are not. */
  request(seed: string, priority = false): boolean {
    if (!seed || this.verifier.par(seed) != null || this.pending === seed || this.queue.includes(seed)) return false;
    const failed = this.failedAt.get(seed);
    if (failed != null && this.now() - failed < this.cooldownMs) return false;
    if (this.queue.length >= this.maxQueue) {
      if (!priority) return false;
      this.queue.pop();
    }
    if (priority) this.queue.unshift(seed);
    else this.queue.push(seed);
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
    const seed = this.queue.shift()!;
    this.pending = seed;
    this.compute(seed)
      .then((par) => {
        try {
          this.verifier.setPar(seed, par, PAR_RUNS, PAR_TRIES);
        } catch {
          this.fail(seed);
        }
      })
      .catch(() => this.fail(seed))
      .finally(() => {
        this.pending = null;
        this.drain();
      });
  }
}

/** Parse a board file defensively: a damaged file yields an empty board instead of a crash, and bad rows are dropped. */
export function loadBoard(text: string): Board {
  try {
    const raw = JSON.parse(text) as Partial<Board>;
    const entries = Array.isArray(raw.entries)
      ? raw.entries.filter(
          (e): e is BoardEntry =>
            !!e &&
            typeof e.seed === 'string' &&
            typeof e.score === 'number' &&
            typeof e.replayHash === 'string' &&
            typeof e.verifiedAt === 'string' &&
            Number.isInteger(e.rulesVersion),
        )
      : [];
    const replays: Record<string, StoredReplay> = {};
    if (raw.replays && typeof raw.replays === 'object')
      for (const [h, r] of Object.entries(raw.replays))
        if (r && typeof r.seed === 'string' && Array.isArray(r.actions) && Number.isInteger(r.rulesVersion)) replays[h] = r;
    const pars: Record<string, BotPar> = {};
    if (raw.pars && typeof raw.pars === 'object')
      for (const [s, p] of Object.entries(raw.pars)) if (p && typeof p.par === 'number' && Number.isInteger(p.rulesVersion)) pars[s] = p;
    const players: Record<string, Player> = {};
    if (raw.players && typeof raw.players === 'object')
      for (const [id, p] of Object.entries(raw.players as Record<string, Player>))
        if (p && typeof p.name === 'string' && typeof p.tag === 'string' && /^[0-9a-f]{64}$/.test(id))
          players[id] = {
            name: p.name,
            tag: p.tag,
            createdAt: typeof p.createdAt === 'string' ? p.createdAt : '',
            renamedAt: typeof p.renamedAt === 'string' ? p.renamedAt : '',
          };
    const dailies: Record<string, DailyRecord> = {};
    if (raw.dailies && typeof raw.dailies === 'object')
      for (const [date, d] of Object.entries(raw.dailies as Record<string, DailyRecord>))
        if (
          d &&
          ((isUtcDate(date) && typeof d.seed === 'string' && isMintedDailySeed(d.seed)) ||
            (isWeekId(date) && d.kind === 'weekly' && typeof d.seed === 'string' && isWeeklySeed(d.seed) && isUtcDate(d.date))) &&
          typeof d.commitment === 'string'
        )
          dailies[date] = {
            ...(d.kind === 'weekly'
              ? { kind: 'weekly' as const, week: date, opensAt: typeof d.opensAt === 'string' ? d.opensAt : weeklyWindow(date)!.opensAt }
              : {}),
            ...(typeof d.weeklyCommitment === 'string' ? { weeklyCommitment: d.weeklyCommitment } : {}),
            date: d.kind === 'weekly' ? d.date : date,
            seed: d.seed,
            commitment: d.commitment,
            issuedAt: typeof d.issuedAt === 'string' ? d.issuedAt : '',
            closesAt: typeof d.closesAt === 'string' ? d.closesAt : new Date(dayStartMs(date) + DAILY_WINDOW_MS).toISOString(),
            rulesVersion: typeof d.rulesVersion === 'number' ? d.rulesVersion : RULES_VERSION,
            build: typeof d.build === 'string' ? d.build : '',
            ...(typeof d.frozenAt === 'string' ? { frozenAt: d.frozenAt } : {}),
            ...(d.medals === null
              ? { medals: null }
              : d.medals &&
                  typeof d.medals === 'object' &&
                  typeof d.medals.gold === 'number' &&
                  typeof d.medals.silver === 'number' &&
                  typeof d.medals.bronze === 'number' &&
                  typeof d.medals.n === 'number'
                ? { medals: { n: d.medals.n, bronze: d.medals.bronze, silver: d.medals.silver, gold: d.medals.gold } }
                : {}),
          };
    const out: Board = { entries, replays };
    if (Object.keys(pars).length) out.pars = pars;
    if (Object.keys(players).length) out.players = players;
    const groups: Record<string, Group> = {};
    if (raw.groups && typeof raw.groups === 'object')
      for (const [code, g] of Object.entries(raw.groups as Record<string, Group>))
        if (g && GROUP_CODE.test(code) && typeof g.name === 'string' && Array.isArray(g.playerIds))
          groups[code] = {
            code,
            name: g.name,
            creatorId: typeof g.creatorId === 'string' ? g.creatorId : null,
            createdAt: typeof g.createdAt === 'string' ? g.createdAt : '',
            renamedAt: typeof g.renamedAt === 'string' ? g.renamedAt : '',
            playerIds: g.playerIds.filter((p): p is string => typeof p === 'string' && /^[0-9a-f]{64}$/.test(p)),
          };
    if (Object.keys(dailies).length) out.dailies = dailies;
    if (Object.keys(groups).length) out.groups = groups;
    const moderation: Record<string, ModerationRecord> = {};
    if (raw.moderation && typeof raw.moderation === 'object')
      for (const [id, m] of Object.entries(raw.moderation as Record<string, ModerationRecord>))
        if (m && /^[0-9a-f]{64}$/.test(id) && typeof m.name === 'string')
          moderation[id] = {
            name: m.name,
            hidden: !!m.hidden,
            ...(typeof m.hiddenAt === 'string' ? { hiddenAt: m.hiddenAt } : {}),
            clears: Number.isInteger(m.clears) ? m.clears : 0,
            reports: Array.isArray(m.reports)
              ? m.reports
                  .filter((r) => r && typeof r.reporterId === 'string' && typeof r.reason === 'string' && typeof r.at === 'string')
                  .map((r) => ({ reporterId: r.reporterId, reason: r.reason, at: r.at, ...(r.established === true ? { established: true } : {}) }))
              : [],
            ...(typeof m.confirmedAt === 'string' ? { confirmedAt: m.confirmedAt } : {}),
          };
    if (Object.keys(moderation).length) out.moderation = moderation;
    return out;
  } catch {
    return { entries: [] };
  }
}

/** One stored funnel event (a line of events.jsonl). The IP is a daily-salted hash, never the address. */
export interface StoredEvent {
  at: string;
  receivedAt: string;
  installId: string;
  ip: string;
  name: EventName;
  props: Props;
}

/** Append-only JSON-lines store for opt-in funnel events with time-based retention (PLAN-v1 0.3.7). */
export class EventStore {
  constructor(
    public readonly file: string,
    public readonly retentionDays = DEFAULT_EVENTS_RETENTION_DAYS,
    private readonly salt = randomBytes(16).toString('hex'),
  ) {}
  /** Daily-salted hash of a client address: the same client is one key within a day, unlinkable across days or restarts. */
  ipHash(ip: string, now = new Date()): string {
    return createHash('sha256')
      .update(`${this.salt}:${now.toISOString().slice(0, 10)}:${ip}`)
      .digest('hex')
      .slice(0, 16);
  }
  /** ids seen lately (`installId:id`), so a batch delivered twice counts once (0.9.7); bounded, in memory: a repeat after a restart is the rare case we accept */
  private readonly seenIds: string[] = [];
  private readonly seenSet = new Set<string>();
  static readonly SEEN_MAX = 5000;
  /** Append a validated batch (events whose id this install already sent are skipped); throws StorageError when the file cannot be written (nothing else is kept in memory). */
  append(batch: EventBatch, ip: string, now = new Date()): number {
    const fresh = batch.events.filter((e) => {
      if (!e.id) return true;
      const key = `${batch.installId}:${e.id}`;
      if (this.seenSet.has(key)) return false;
      this.seenSet.add(key);
      this.seenIds.push(key);
      if (this.seenIds.length > EventStore.SEEN_MAX) this.seenSet.delete(this.seenIds.shift()!);
      return true;
    });
    if (!fresh.length) return 0;
    const rows: StoredEvent[] = fresh.map((e) => ({
      at: e.at,
      receivedAt: now.toISOString(),
      installId: batch.installId,
      ip: this.ipHash(ip, now),
      name: e.name,
      props: e.props ?? {},
    }));
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      fs.appendFileSync(this.file, rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
    } catch (e) {
      throw new StorageError(`events storage unavailable: ${(e as Error).message}`);
    }
    return rows.length;
  }
  /** Every stored row (damaged lines are skipped). */
  rows(): StoredEvent[] {
    if (!fs.existsSync(this.file)) return [];
    return fs
      .readFileSync(this.file, 'utf8')
      .split('\n')
      .filter(Boolean)
      .flatMap((l) => {
        try {
          const r = JSON.parse(l) as StoredEvent;
          return r && typeof r.name === 'string' && typeof r.installId === 'string' && typeof r.receivedAt === 'string' ? [r] : [];
        } catch {
          return [];
        }
      });
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
    for (const r of rows) {
      (byName.get(r.name) ?? byName.set(r.name, new Set()).get(r.name)!).add(r.installId);
      counts[r.name] = (counts[r.name] ?? 0) + 1;
    }
    const installs = new Set(rows.map((r) => r.installId)).size;
    return { installs, events: rows.length, steps: FUNNEL.map((name) => ({ name, installs: byName.get(name)?.size ?? 0 })), counts };
  }
}

/** Fixed-window per-key counter with bounded cardinality (good enough for a small public verifier; one process). */
export class RateLimiter {
  private hits = new Map<string, { count: number; resetAt: number }>();
  constructor(
    public limit: number,
    public windowMs: number,
    private now: () => number = Date.now,
    public maxKeys = 10_000,
  ) {}
  get keys() {
    return this.hits.size;
  }
  /** Returns { ok, retryAfterSec } and counts the hit. */
  take(key: string): { ok: boolean; remaining: number; retryAfterSec: number } {
    const t = this.now();
    let h = this.hits.get(key);
    if (!h || h.resetAt <= t) {
      h = { count: 0, resetAt: t + this.windowMs };
      this.hits.delete(key);
      this.hits.set(key, h);
    }
    if (this.hits.size > this.maxKeys) {
      for (const [k, v] of this.hits) if (v.resetAt <= t) this.hits.delete(k);
      // still over: evict the oldest windows first (Map keeps insertion order; re-set above keeps fresh keys last)
      for (const k of this.hits.keys()) {
        if (this.hits.size <= this.maxKeys) break;
        if (k !== key) this.hits.delete(k);
      }
    }
    h.count++;
    const ok = h.count <= this.limit;
    return { ok, remaining: Math.max(0, this.limit - h.count), retryAfterSec: ok ? 0 : Math.ceil((h.resetAt - t) / 1000) };
  }
}

export interface ServerOptions {
  /** announcement counters for /health (PLAN-v4 0.7.6) */
  announcer?: Announcer | null;
  /** moderator token (PLAN-v4 0.7.7): X-Moderation-Token on /moderation/*; null or empty leaves those endpoints answering 403 */
  moderationToken?: string | null;
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
  /** push subscriptions for the daily reminder (0.10.4); absent, or present without VAPID keys, the push routes answer 503 */
  push?: PushStore | null;
  /** the community database (0.11.0); absent, /health says null and the deletion and export routes leave it out */
  community?: CommunityStore | null;
  /** POST /events limit per client IP per minute (default 30) */
  eventsRateLimit?: number;
  /** POST /verify limit per player id per minute when a bearer is present (default 2) */
  playerRateLimit?: number;
  /** bot-par jobs (PLAN-v1 0.4.5); null (default) means pars are never computed */
  par?: ParService | null;
  /** per-address GET limit per minute (0.8.1; /health exempt); default DEFAULT_READ_RATE_LIMIT; null disables */
  readRateLimit?: number | null;
  /** per-address limit per minute on identity, group, report and deletion calls (0.8.1); default DEFAULT_WRITE_RATE_LIMIT; null disables */
  writeRateLimit?: number | null;
  /** where a 500's exception goes as one JSON line (0.8.1); default console.error; null disables */
  errorLog?: ((line: string) => void) | null;
  /** socket timeouts (0.8.1); defaults 15 s headers, 30 s request, 5 s keep-alive */
  timeouts?: { headersMs?: number; requestMs?: number; keepAliveMs?: number };
  /** re-simulation off the event loop (0.8.2); null or absent runs the single pass inline (tests, tools) */
  verify?: VerifyService | null;
}

/** Daily-salted hash of a client address for the request log (0.8.1): one key per client within a UTC day, unlinkable across days or restarts; never the address. */
export const hashIp = (salt: string, ip: string, now = new Date()): string =>
  createHash('sha256')
    .update(`${salt}:${now.toISOString().slice(0, 10)}:${ip}`)
    .digest('hex')
    .slice(0, 16);
/** The request path as logged (0.8.1): a group code is the only membership secret and never reaches the log. */
export const redactPath = (p: string): string => p.replace(/([?&]group=)[^&]*/g, '$1~');

export interface ShutdownOptions {
  announcer?: { idle(): Promise<void> } | null;
  /** called after the server closed (0.8.2: stop the re-simulation worker) */ after?: () => void;
  log?: ((line: string) => void) | null;
  /** hard stop after this many ms */ graceMs?: number;
  exit?: (code: number) => void;
  /** signals to hook; [] for tests that call the returned function */ signals?: NodeJS.Signals[];
}
/** SIGTERM/SIGINT drain (0.8.1): stop accepting, let in-flight requests and queued announcements finish, then exit 0; a hard stop with exit 1 after graceMs. Returns the shutdown function. */
export function installShutdown(server: http.Server, o: ShutdownOptions = {}): () => Promise<void> {
  const log = o.log === null ? null : (o.log ?? ((l: string) => console.log(l)));
  const exit = o.exit ?? ((c: number) => process.exit(c));
  const grace = o.graceMs ?? 10_000;
  let started = false;
  const shutdown = async () => {
    if (started) return;
    started = true;
    log?.(JSON.stringify({ ts: new Date().toISOString(), event: 'shutdown', graceMs: grace }));
    const hard = setTimeout(() => {
      try {
        server.closeAllConnections();
      } catch {
        /* already closed */
      }
      exit(1);
    }, grace);
    hard.unref();
    await new Promise<void>((r) => {
      server.close(() => r());
      try {
        server.closeIdleConnections();
      } catch {
        /* not listening */
      }
    });
    try {
      await o.announcer?.idle();
    } catch {
      /* the announcer logs its own trouble */
    }
    try {
      o.after?.();
    } catch {
      /* best effort */
    }
    clearTimeout(hard);
    exit(0);
  };
  for (const s of o.signals ?? ['SIGTERM', 'SIGINT'])
    process.once(s, () => {
      void shutdown();
    });
  return shutdown;
}

/** The client address. Behind a proxy you control (trustProxy): X-Real-IP, else the RIGHTMOST X-Forwarded-For hop, the one your proxy appended; the leftmost is whatever the client sent (0.8.1 fixed the spoofable first-hop read). */
export function clientIp(req: http.IncomingMessage, trustProxy: boolean): string {
  if (trustProxy) {
    const real = req.headers['x-real-ip'];
    const r = (Array.isArray(real) ? real[0] : real || '').trim();
    if (r) return r;
    const xf = req.headers['x-forwarded-for'];
    const hops = (Array.isArray(xf) ? xf.join(',') : xf || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    if (hops.length) return hops[hops.length - 1];
  }
  return req.socket.remoteAddress || 'unknown';
}

export function createServer(verifier: Verifier, opts: ServerOptions = {}) {
  const rl = opts.rateLimit === null ? null : new RateLimiter(opts.rateLimit?.limit ?? 60, opts.rateLimit?.windowMs ?? 60_000, opts.now);
  const events = opts.events ?? null;
  const push = opts.push ?? null;
  const community = opts.community ?? null;
  const par = opts.par ?? null;
  const verify = opts.verify ?? null;
  const withPar = (seed: string) => {
    par?.request(seed, seed === verifier.todaySeed(new Date((opts.now ?? Date.now)())));
    return verifier.par(seed);
  }; // today's minted seed goes first; the answer never waits for the job
  const erl = events ? new RateLimiter(opts.eventsRateLimit ?? DEFAULT_EVENTS_RATE_LIMIT, 60_000, opts.now) : null;
  const prl = new RateLimiter(opts.playerRateLimit ?? DEFAULT_PLAYER_RATE_LIMIT, 60_000, opts.now); // per-player submissions (PLAN-v3 §1 abuse baseline)
  const irl = new RateLimiter(IDENTITY_RATE_LIMIT, 60_000, opts.now); // per-player identity calls
  const grl = new RateLimiter(GROUP_RATE_LIMIT, 60_000, opts.now); // per-player group calls (PLAN-v4 0.7.2)
  const rrl = new RateLimiter(REPORT_RATE_LIMIT, 60_000, opts.now); // per-player reports (PLAN-v4 0.7.7)
  const readRl = opts.readRateLimit === null ? null : new RateLimiter(opts.readRateLimit ?? DEFAULT_READ_RATE_LIMIT, 60_000, opts.now); // per-address reads (0.8.1)
  const writeRl = opts.writeRateLimit === null ? null : new RateLimiter(opts.writeRateLimit ?? DEFAULT_WRITE_RATE_LIMIT, 60_000, opts.now); // per-address writes (0.8.1)
  const logSalt = randomBytes(16).toString('hex');
  const errorLog = opts.errorLog === null ? null : (opts.errorLog ?? ((l: string) => console.error(l)));
  const modToken = opts.moderationToken || null;
  const MAX_EVENTS_BODY = 64 * 1024;
  const corsOrigin = opts.corsOrigin ?? '*';
  const log = opts.log === null ? null : (opts.log ?? ((l: string) => console.log(l)));
  const started = Date.now();
  const cors = {
    'Access-Control-Allow-Origin': corsOrigin,
    'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    Vary: 'Origin',
  }; // Authorization and DELETE: identity (PLAN-v3 0.6.0)
  const server = http.createServer((req, res) => {
    const t0 = Date.now();
    const ip = clientIp(req, !!opts.trustProxy);
    const reqId = randomBytes(4).toString('hex'); // 0.8.1: echoed as X-Request-Id, in the log line and in the error log, so a player's report and the operator's log meet
    const json = (code: number, body: unknown, extra: Record<string, string> = {}, pathForLog = req.url ?? '') => {
      if (res.writableEnded) return;
      res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Request-Id': reqId, ...cors, ...extra });
      res.end(JSON.stringify(body));
      const now = new Date((opts.now ?? Date.now)());
      log?.(
        JSON.stringify({
          ts: new Date().toISOString(),
          id: reqId,
          ip: hashIp(logSalt, ip, now),
          method: req.method,
          path: redactPath(pathForLog),
          status: code,
          ms: Date.now() - t0,
        }),
      );
    };
    const failed = (e: unknown) => {
      errorLog?.(
        JSON.stringify({
          ts: new Date().toISOString(),
          id: reqId,
          method: req.method,
          path: redactPath(req.url ?? ''),
          error: e instanceof Error ? `${e.name}: ${e.message}` : String(e),
          stack:
            e instanceof Error && e.stack
              ? e.stack
                  .split('\n')
                  .slice(1, 6)
                  .map((l) => l.trim())
              : undefined,
        }),
      );
      if (!res.writableEnded) json(500, { ok: false, error: 'internal error', requestId: reqId });
    };
    /** Asynchronous handlers (request 'end') run outside the route() try/catch: anything they throw would kill the process. Every 500 logs its exception (0.8.1). */
    const guarded = (fn: () => void) => {
      try {
        fn();
      } catch (e) {
        failed(e);
      }
    };
    /** Per-address write limit (0.8.1) on identity, group, report and deletion calls; null when allowed, else the Retry-After seconds. */
    const writeLimited = (): number | null => {
      if (!writeRl) return null;
      const r = writeRl.take(ip);
      return r.ok ? null : r.retryAfterSec;
    };
    let url: URL;
    try {
      url = new URL(req.url || '/', 'http://localhost');
    } catch {
      req.resume();
      return json(400, { ok: false, error: 'bad request: malformed URL' }, {}, '(malformed)');
    }
    const route = () => {
      if (req.method === 'OPTIONS') {
        res.writeHead(204, cors);
        return res.end();
      }
      if (req.method === 'GET' && url.pathname === '/health')
        return json(200, {
          ok: true,
          version: VERSION,
          rulesVersion: RULES_VERSION,
          protocol: PROTOCOL,
          entries: verifier.size,
          entriesAllVersions: verifier.sizeAllVersions,
          cold: { days: verifier.cold.dayCount, replays: verifier.cold.replayCount },
          push: push ? { enabled: push.enabled, subscriptions: push.count, ...push.stats } : null,
          community: community?.health() ?? null,
          ...(opts.announcer?.enabled ? { discord: opts.announcer.stats } : {}),
          uptimeSec: Math.round((Date.now() - started) / 1000),
          ...verifier.health,
          par: par ? { busy: par.busy, queued: par.queued, failures: par.failures } : null,
          resim: verify ? verify.stats : null,
          limiters: { ip: rl?.keys ?? 0, player: prl.keys, read: readRl?.keys ?? 0, write: writeRl?.keys ?? 0, events: erl?.keys ?? 0 },
          historyStart: verifier.historyStart(new Date((opts.now ?? Date.now)())),
          log: 'json',
        }); // 0.8.1: the SQLite trigger's inputs, the par queue and limiter cardinalities, visible
      if (req.method === 'GET' && readRl) {
        const r = readRl.take(ip);
        if (!r.ok)
          return json(429, { ok: false, error: `rate limited: ${readRl.limit} reads per minute per address` }, { 'Retry-After': String(r.retryAfterSec) });
      } // 0.8.1: every read but /health
      if (req.method === 'GET' && url.pathname === '/replay') {
        const r = verifier.replay(url.searchParams.get('hash') || '', new Date((opts.now ?? Date.now)()));
        if (!r) {
          const why = verifier.replayMissingReason(url.searchParams.get('hash') || '', url.searchParams.get('seed'));
          return json(
            404,
            why === 'compacted'
              ? {
                  ok: false,
                  reason: 'compacted',
                  error: `replay compacted: only the top ${COLD_REPLAYS_PER_DAY} replays of a day older than ${HOT_DAYS} days are kept; the entry and its score stay on the final board`,
                }
              : { ok: false, error: 'no verified replay with that hash' },
          );
        }
        const bearer = playerIdFromToken(bearerOf(req));
        if (req.headers.authorization && !bearer) return json(401, { ok: false, error: 'bad token' });
        const gate = verifier.revealGate(r.seed, bearer, new Date((opts.now ?? Date.now)()));
        if (gate) return json(403, { ok: false, reason: 'reveal-gate', ...gate });
        return json(200, { ok: true, ...r });
      }
      // group scope (PLAN-v4 0.7.2): ?group=<code> needs the bearer of a member; one refusal for unknown codes and non-members so codes cannot be probed
      const groupScope = ():
        { ok: true; members: ReadonlySet<string> | null; group: { code: string; name: string } | null } | { ok: false; status: number; error: string } => {
        const code = url.searchParams.get('group');
        if (!code) return { ok: true, members: null, group: null };
        const pid = playerIdFromToken(bearerOf(req));
        if (!pid) return { ok: false, status: 401, error: 'a group board needs your identity token' };
        const members = verifier.groupMembers(code, pid);
        if (!members) return { ok: false, status: 403, error: 'unknown group or not a member' };
        return { ok: true, members, group: { code, name: verifier.group(code)!.name } };
      };
      if (req.method === 'GET' && url.pathname === '/daily') {
        const gs = groupScope();
        if (!gs.ok) return json(gs.status, { ok: false, error: gs.error });
        const now = new Date((opts.now ?? Date.now)());
        const dateQ = url.searchParams.get('date');
        if (dateQ !== null && !isUtcDate(dateQ)) return json(400, { ok: false, error: 'date must be YYYY-MM-DD' });
        const d = verifier.daily(clampInt(url.searchParams.get('limit'), 10, MAX_DAILY_LIMIT), now, dateQ ?? undefined, gs.members);
        if (!d)
          return json(
            403,
            dateQ && dateQ < verifier.historyStart(now)
              ? {
                  ok: false,
                  error: `dailies are kept ${DAILY_HISTORY_DAYS} days back; ${dateQ} is before ${verifier.historyStart(now)}`,
                  historyStart: verifier.historyStart(now),
                }
              : { ok: false, error: `the daily for ${dateQ} has not opened yet (dailies open at 00:00 UTC)`, today: utcDate(now) },
          );
        return json(200, { ok: true, ...d, group: gs.group, botPar: withPar(d.seed), tieBreak: TIE_BREAK });
      }
      if (req.method === 'GET' && url.pathname === '/entry') {
        // challenge links (PLAN-v4 0.7.1): earnings, never actions
        const e = verifier.entry(
          (url.searchParams.get('hash') || '').slice(0, 64),
          (url.searchParams.get('seed') || '').slice(0, 64) || null,
          new Date((opts.now ?? Date.now)()),
        );
        if (!e) return json(404, { ok: false, error: 'no verified entry with that hash' });
        if (!e.rounds)
          return json(404, { ok: false, reason: 'no-rounds', error: 'that entry has no per-round earnings (verified before 0.7.1 without a stored replay)' });
        return json(200, { ok: true, ...e });
      }
      if (req.method === 'GET' && url.pathname === '/weekly') {
        // PLAN-v4 0.7.5: mirrors /daily by ISO week
        const gs = groupScope();
        if (!gs.ok) return json(gs.status, { ok: false, error: gs.error });
        const now = new Date((opts.now ?? Date.now)());
        const weekQ = url.searchParams.get('week');
        if (weekQ !== null && !isWeekId(weekQ)) return json(400, { ok: false, error: 'week must be an ISO week like 2030-W11' });
        const w = verifier.weekly(clampInt(url.searchParams.get('limit'), 10, MAX_DAILY_LIMIT), now, weekQ ?? undefined, gs.members);
        if (!w)
          return json(
            403,
            weekQ && isWeekId(weekQ) && weeklyWindow(weekQ)!.openDate < verifier.historyStart(now)
              ? {
                  ok: false,
                  error: `weeklies are kept ${DAILY_HISTORY_DAYS} days back; ${weekQ} opened before ${verifier.historyStart(now)}`,
                  historyStart: verifier.historyStart(now),
                }
              : { ok: false, error: `the weekly ${weekQ} has not opened yet (weeklies open Friday 18:00 UTC)`, currentWeek: currentWeekId(now) },
          );
        return json(200, { ok: true, ...w, group: gs.group, botPar: withPar(w.seed), tieBreak: TIE_BREAK });
      }
      if (req.method === 'GET' && url.pathname === '/archive') {
        const now = new Date((opts.now ?? Date.now)());
        const from = url.searchParams.get('from'),
          to = url.searchParams.get('to');
        if ((from !== null && !isUtcDate(from)) || (to !== null && !isUtcDate(to))) return json(400, { ok: false, error: 'from/to must be YYYY-MM-DD' });
        const gs = groupScope();
        if (!gs.ok) return json(gs.status, { ok: false, error: gs.error });
        return json(200, {
          ok: true,
          ...verifier.archive(
            { from: from ?? undefined, to: to ?? undefined, limit: clampInt(url.searchParams.get('limit'), 30, MAX_ARCHIVE_LIMIT) },
            now,
            gs.members,
          ),
          group: gs.group,
          tieBreak: TIE_BREAK,
        });
      }
      if (req.method === 'GET' && url.pathname === '/histogram') {
        const gs = groupScope();
        if (!gs.ok) return json(gs.status, { ok: false, error: gs.error });
        const seed = (url.searchParams.get('seed') || '').slice(0, 64);
        return json(200, {
          ok: true,
          ...verifier.histogram(seed, (url.searchParams.get('hash') || '').slice(0, 64) || undefined, gs.members, new Date((opts.now ?? Date.now)())),
          group: gs.group,
          botPar: withPar(seed),
          medals: verifier.medalsForSeed(seed, new Date((opts.now ?? Date.now)())),
          tieBreak: TIE_BREAK,
        });
      }
      if (req.method === 'GET' && url.pathname === '/board') {
        const gs = groupScope();
        if (!gs.ok) return json(gs.status, { ok: false, error: gs.error });
        const seed = (url.searchParams.get('seed') || '').slice(0, 64);
        return json(200, {
          seed,
          verified: true,
          entries: verifier.board(seed, clampInt(url.searchParams.get('limit'), 20, MAX_BOARD_LIMIT), gs.members, new Date((opts.now ?? Date.now)())),
          group: gs.group,
          botPar: withPar(seed),
          tieBreak: TIE_BREAK,
        });
      }
      // identity (PLAN-v3 0.6.0): the bearer is a device token; only its hash is used or stored
      const bearerId = playerIdFromToken(bearerOf(req));
      if (req.headers.authorization && !bearerId) return json(401, { ok: false, error: 'bad token' });
      if (url.pathname === '/identity' && req.method === 'GET') {
        if (!bearerId) return json(401, { ok: false, error: 'token required' });
        const p = verifier.player(bearerId);
        return p
          ? json(200, { ok: true, ...p, ...(verifier.hidden(bearerId, new Date((opts.now ?? Date.now)())) ? { hidden: true, hiddenLabel: HIDDEN_LABEL } : {}) })
          : json(404, { ok: false, error: 'no name claimed for this token', playerId: bearerId, tag: tagFor(bearerId) });
      }
      if (url.pathname === '/identity' && req.method === 'POST') {
        if (!bearerId) {
          req.resume();
          return json(401, { ok: false, error: 'token required' });
        }
        const r = irl.take(bearerId);
        if (!r.ok) {
          req.resume();
          return json(429, { ok: false, error: 'rate limited' }, { 'Retry-After': String(r.retryAfterSec) });
        }
        {
          const w = writeLimited();
          if (w != null) {
            req.resume();
            return json(429, { ok: false, error: 'rate limited: too many writes from this address' }, { 'Retry-After': String(w) });
          }
        }
        let body = '';
        req.on('data', (c) => {
          body += c;
          if (body.length > 4096) {
            json(413, { ok: false, error: 'too large', code: 'too-large' });
            req.destroy();
          }
        });
        req.on('end', () =>
          guarded(() => {
            if (res.writableEnded) return;
            let parsed: { name?: unknown } | null;
            try {
              parsed = JSON.parse(body) as { name?: unknown };
            } catch {
              return json(400, { ok: false, error: 'bad request' });
            }
            try {
              const out = verifier.claim(bearerId, parsed && typeof parsed === 'object' ? parsed.name : undefined, new Date((opts.now ?? Date.now)()));
              if (!out.ok)
                return json(
                  out.busy ? 503 : out.retryAfterSec ? 429 : 422,
                  { ok: false, error: out.error },
                  out.busy ? { 'Retry-After': '60' } : out.retryAfterSec ? { 'Retry-After': String(out.retryAfterSec) } : {},
                );
              json(200, { ok: true, ...out.player });
            } catch (e) {
              if (e instanceof StorageError) return json(503, { ok: false, error: 'storage unavailable; try again' }, { 'Retry-After': '5' });
              json(500, { ok: false, error: 'internal error' });
            }
          }),
        );
        return;
      }
      if (url.pathname === '/groups' && req.method === 'GET') {
        if (!bearerId) return json(401, { ok: false, error: 'token required' });
        return json(200, { ok: true, groups: verifier.groupsOf(bearerId) });
      }
      if (req.method === 'POST' && /^\/groups(\/(join|leave|rename|disband))?$/.test(url.pathname)) {
        // PLAN-v4 0.7.2
        if (!bearerId) {
          req.resume();
          return json(401, { ok: false, error: 'token required' });
        }
        const r = grl.take(bearerId);
        if (!r.ok) {
          req.resume();
          return json(429, { ok: false, error: 'rate limited' }, { 'Retry-After': String(r.retryAfterSec) });
        }
        {
          const w = writeLimited();
          if (w != null) {
            req.resume();
            return json(429, { ok: false, error: 'rate limited: too many writes from this address' }, { 'Retry-After': String(w) });
          }
        }
        const action = url.pathname.split('/')[2] ?? 'create';
        let body = '';
        req.on('data', (c) => {
          body += c;
          if (body.length > 4096) {
            json(413, { ok: false, error: 'too large', code: 'too-large' });
            req.destroy();
          }
        });
        req.on('end', () =>
          guarded(() => {
            if (res.writableEnded) return;
            let parsed: { name?: unknown; code?: unknown };
            try {
              parsed = (JSON.parse(body || '{}') ?? {}) as { name?: unknown; code?: unknown };
            } catch {
              return json(400, { ok: false, error: 'bad request' });
            }
            try {
              const now = new Date((opts.now ?? Date.now)());
              const out =
                action === 'create'
                  ? verifier.createGroup(bearerId, parsed.name, now)
                  : action === 'join'
                    ? verifier.joinGroup(bearerId, parsed.code)
                    : action === 'leave'
                      ? verifier.leaveGroup(bearerId, parsed.code)
                      : action === 'rename'
                        ? verifier.renameGroup(bearerId, parsed.code, parsed.name, now)
                        : verifier.disbandGroup(bearerId, parsed.code);
              if (!out.ok) {
                const retry = (out as { retryAfterSec?: number }).retryAfterSec;
                return json(
                  retry ? 429 : /unknown group|not a member|only the group/.test(out.error) ? 403 : 422,
                  { ok: false, error: out.error },
                  retry ? { 'Retry-After': String(retry) } : {},
                );
              }
              json(200, out);
            } catch (e) {
              if (e instanceof StorageError) return json(503, { ok: false, error: 'storage unavailable; try again' }, { 'Retry-After': '5' });
              json(500, { ok: false, error: 'internal error' });
            }
          }),
        );
        return;
      }
      if (url.pathname === '/me/export' && req.method === 'GET') {
        // 0.8.6: the access right; the read limiter above applies
        if (!bearerId) return json(401, { ok: false, error: 'token required' });
        return json(200, {
          ok: true,
          ...verifier.exportPlayer(bearerId, new Date((opts.now ?? Date.now)())),
          community: community?.exportPlayer(bearerId) ?? {},
        });
      }
      if (url.pathname === '/me' && req.method === 'DELETE') {
        if (!bearerId) return json(401, { ok: false, error: 'token required' });
        {
          const w = writeLimited();
          if (w != null) return json(429, { ok: false, error: 'rate limited: too many writes from this address' }, { 'Retry-After': String(w) });
        }
        try {
          const r = verifier.deletePlayer(bearerId);
          const pushRemoved = push?.unsubscribePlayer(bearerId) ?? 0; // 0.10.4: the reminder goes with the player
          const communityRows = community?.forget(bearerId) ?? 0; // 0.11.0: every row that names the player
          return json(200, {
            ok: true,
            anonymisedEntries: r.entries,
            coldReplaysDropped: r.coldReplays,
            pushSubscriptionsRemoved: pushRemoved,
            communityRowsRemoved: communityRows,
          });
        } catch (e) {
          if (e instanceof StorageError) return json(503, { ok: false, error: 'storage unavailable; try again' }, { 'Retry-After': '5' });
          return json(500, { ok: false, error: 'internal error' });
        }
      }
      // push for the daily (0.10.4): the public key, subscribe (upsert by endpoint, the UTC hour, the bearer's player when present), unsubscribe
      if (url.pathname === '/push/vapid' || url.pathname === '/push/subscribe' || url.pathname === '/push/unsubscribe') {
        if (!push || !push.enabled) {
          req.resume();
          return json(503, { ok: false, error: 'push is not enabled on this verifier (set VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY)' });
        }
        if (req.method === 'GET' && url.pathname === '/push/vapid') return json(200, { ok: true, publicKey: push.publicKey });
        if (req.method !== 'POST' || url.pathname === '/push/vapid') {
          req.resume();
          return json(405, { ok: false, error: 'method not allowed' });
        }
        {
          const w = writeLimited();
          if (w != null) {
            req.resume();
            return json(429, { ok: false, error: 'rate limited: too many writes from this address' }, { 'Retry-After': String(w) });
          }
        }
        let body = '';
        req.on('data', (c) => {
          body += c;
          if (body.length > 8192) {
            json(413, { ok: false, error: 'too large', code: 'too-large' });
            req.destroy();
          }
        });
        req.on('end', () =>
          guarded(() => {
            if (res.writableEnded) return;
            let parsed: { subscription?: unknown; hourUtc?: unknown; endpoint?: unknown };
            try {
              parsed = JSON.parse(body || '{}') as typeof parsed;
            } catch (e) {
              return json(400, { ok: false, error: `bad request: ${(e as Error).message}` });
            }
            if (!parsed || typeof parsed !== 'object') return json(400, { ok: false, error: 'bad request: an object is expected' });
            try {
              if (url.pathname === '/push/unsubscribe') {
                const endpoint = typeof parsed.endpoint === 'string' ? parsed.endpoint : '';
                if (!endpoint) return json(400, { ok: false, error: 'endpoint required' });
                return json(200, { ok: true, removed: push.unsubscribe(endpoint) });
              }
              const sub = validateSubscription(parsed.subscription);
              if (typeof sub === 'string') return json(422, { ok: false, error: sub });
              const hour = validateHour(parsed.hourUtc);
              if (typeof hour === 'string') return json(422, { ok: false, error: hour });
              const row = push.subscribe({ ...sub, hourUtc: hour, playerId: bearerId });
              return json(200, { ok: true, hourUtc: row.hourUtc, subscriptions: push.count });
            } catch (e) {
              if (e instanceof PushError) return json(e.statusCode, { ok: false, error: e.message });
              throw e;
            }
          }),
        );
        return;
      }
      if (req.method === 'POST' && url.pathname === '/report') {
        // name moderation (PLAN-v4 0.7.7)
        if (!bearerId) {
          req.resume();
          return json(401, { ok: false, error: 'token required' });
        }
        const r = rrl.take(bearerId);
        if (!r.ok) {
          req.resume();
          return json(429, { ok: false, error: 'rate limited' }, { 'Retry-After': String(r.retryAfterSec) });
        }
        {
          const w = writeLimited();
          if (w != null) {
            req.resume();
            return json(429, { ok: false, error: 'rate limited: too many writes from this address' }, { 'Retry-After': String(w) });
          }
        }
        let body = '';
        req.on('data', (c) => {
          body += c;
          if (body.length > 4096) {
            json(413, { ok: false, error: 'too large', code: 'too-large' });
            req.destroy();
          }
        });
        req.on('end', () =>
          guarded(() => {
            if (res.writableEnded) return;
            type ReportBody = { playerId?: unknown; hash?: unknown; reason?: unknown };
            let parsed: ReportBody | null;
            try {
              parsed = JSON.parse(body || '{}') as ReportBody | null;
            } catch {
              return json(400, { ok: false, error: 'bad request' });
            }
            if (!parsed || typeof parsed !== 'object') return json(400, { ok: false, error: 'bad request' });
            try {
              const out = verifier.report(bearerId, parsed, parsed.reason, new Date((opts.now ?? Date.now)()));
              if (!out.ok) return json(out.status, { ok: false, error: out.error });
              json(200, out);
            } catch (e) {
              if (e instanceof StorageError) return json(503, { ok: false, error: 'storage unavailable; try again' }, { 'Retry-After': '5' });
              json(500, { ok: false, error: 'internal error' });
            }
          }),
        );
        return;
      }
      if (url.pathname.startsWith('/moderation/')) {
        // moderator endpoints (PLAN-v4 0.7.7): X-Moderation-Token, never a player bearer
        if (!modToken) {
          req.resume();
          return json(403, { ok: false, error: 'moderation is not enabled on this verifier (set MODERATION_TOKEN)' });
        }
        const given = req.headers['x-moderation-token'];
        const t = Buffer.from(Array.isArray(given) ? (given[0] ?? '') : (given ?? '')),
          want = Buffer.from(modToken);
        if (t.length !== want.length || !timingSafeEqual(t, want)) {
          req.resume();
          return json(401, { ok: false, error: 'bad moderation token' });
        }
        if (req.method === 'GET' && url.pathname === '/moderation/reports')
          return json(200, {
            ok: true,
            reports: verifier.reports(new Date((opts.now ?? Date.now)())),
            reasons: REPORT_REASONS,
            hiddenLabel: HIDDEN_LABEL,
            maxHidesPerName: MAX_HIDES_PER_NAME,
            policy: verifier.reportPolicy,
          });
        const action = url.pathname.slice('/moderation/'.length);
        if (req.method !== 'POST' || !['clear', 'confirm', 'rename', 'rename-group'].includes(action)) {
          req.resume();
          return json(404, { ok: false, error: 'not found' });
        }
        let body = '';
        req.on('data', (c) => {
          body += c;
          if (body.length > 4096) {
            json(413, { ok: false, error: 'too large', code: 'too-large' });
            req.destroy();
          }
        });
        req.on('end', () =>
          guarded(() => {
            if (res.writableEnded) return;
            type ModBody = { playerId?: unknown; code?: unknown; name?: unknown };
            let parsed: ModBody | null;
            try {
              parsed = JSON.parse(body || '{}') as ModBody | null;
            } catch {
              return json(400, { ok: false, error: 'bad request' });
            }
            if (!parsed || typeof parsed !== 'object') return json(400, { ok: false, error: 'bad request' });
            try {
              const now = new Date((opts.now ?? Date.now)());
              const out =
                action === 'clear'
                  ? verifier.clearReports(parsed.playerId, now)
                  : action === 'confirm'
                    ? verifier.confirmHide(parsed.playerId, now)
                    : action === 'rename'
                      ? verifier.forceRename(parsed.playerId, parsed.name, now)
                      : verifier.forceRenameGroup(parsed.code, parsed.name, now);
              if (!out.ok) return json(out.status, { ok: false, error: out.error });
              json(200, out);
            } catch (e) {
              if (e instanceof StorageError) return json(503, { ok: false, error: 'storage unavailable; try again' }, { 'Retry-After': '5' });
              json(500, { ok: false, error: 'internal error' });
            }
          }),
        );
        return;
      }
      if (req.method === 'POST' && url.pathname === '/verify') {
        if (rl) {
          const r = rl.take(ip);
          if (!r.ok) {
            req.resume();
            return json(
              429,
              { ok: false, error: `rate limited: ${rl.limit} submissions per ${rl.windowMs / 1000}s`, code: 'rate-limited' },
              { 'Retry-After': String(r.retryAfterSec) },
            );
          }
        }
        if (bearerId) {
          const r = prl.take(bearerId);
          if (!r.ok) {
            req.resume();
            return json(
              429,
              { ok: false, error: `rate limited: ${prl.limit} submissions per minute per player`, code: 'rate-limited' },
              { 'Retry-After': String(r.retryAfterSec) },
            );
          }
        }
        let body = '';
        req.on('data', (c) => {
          body += c;
          if (body.length > MAX_BODY) {
            json(413, { ok: false, error: 'too large', code: 'too-large' });
            req.destroy();
          }
        });
        req.on('end', () =>
          guarded(() => {
            if (res.writableEnded) return;
            let parsed: { replay: unknown; player?: string };
            try {
              parsed = JSON.parse(body) as { replay: unknown; player?: string };
            } catch (e) {
              return json(400, { ok: false, error: `bad request: ${(e as Error).message}`, code: 'bad-request' });
            }
            if (!parsed || typeof parsed !== 'object') return json(400, { ok: false, error: 'bad request: body is not an object', code: 'bad-request' });
            const prep = verifier.prepare(JSON.stringify(parsed.replay ?? null)); // cheap refusals before any simulation (0.8.2)
            if (!prep.ok) return json(422, { ok: false, error: prep.error, code: prep.code });
            const player = typeof parsed.player === 'string' ? parsed.player : undefined;
            const finish = (sim: Resim) =>
              guarded(() => {
                try {
                  const result = verifier.record(prep.replay, prep.replayHash, sim, player, bearerId, new Date((opts.now ?? Date.now)()));
                  if (result.ok && result.entry) par?.request(result.entry.seed);
                  json(result.ok ? 200 : 422, result);
                } catch (e) {
                  if (e instanceof StorageError)
                    return json(503, { ok: false, error: 'storage unavailable, nothing was recorded; try again', code: 'storage' }, { 'Retry-After': '5' });
                  throw e;
                }
              });
            if (!verify) return finish(verifier.resimulate(prep.replay)); // no worker service: inline, still one pass
            verify.verify(prep.replay).then(finish, (e: unknown) => {
              if (e instanceof QueueFullError)
                return json(503, { ok: false, error: 'verifier busy; try again in a moment', code: 'busy' }, { 'Retry-After': '5' });
              if (e instanceof ResimTimeoutError) return json(422, { ok: false, error: `rejected: ${e.message}`, code: 'resim-timeout' });
              failed(e);
            });
          }),
        );
        return;
      }
      if (req.method === 'GET' && url.pathname === '/funnel' && events) return json(200, { ok: true, ...events.funnel() });
      if (req.method === 'POST' && url.pathname === '/events' && events && erl) {
        const r = erl.take(ip);
        if (!r.ok) {
          req.resume();
          return json(429, { ok: false, error: 'rate limited' }, { 'Retry-After': String(r.retryAfterSec) });
        }
        let body = '';
        req.on('data', (c) => {
          body += c;
          if (body.length > MAX_EVENTS_BODY) {
            json(413, { ok: false, error: 'too large', code: 'too-large' });
            req.destroy();
          }
        });
        req.on('end', () =>
          guarded(() => {
            if (res.writableEnded) return;
            let parsed: unknown;
            try {
              parsed = JSON.parse(body);
            } catch (e) {
              return json(400, { ok: false, error: `bad request: ${(e as Error).message}` });
            }
            let batch: ReturnType<typeof validateBatch>;
            try {
              batch = validateBatch(parsed);
            } catch {
              batch = 'unreadable batch';
            } // validation is meant to be total; a surprise still answers 4xx
            if (typeof batch === 'string') return json(422, { ok: false, error: `rejected: ${batch}`.slice(0, 200) });
            try {
              json(200, { ok: true, stored: events.append(batch, ip) });
            } catch (e) {
              if (e instanceof StorageError)
                return json(503, { ok: false, error: 'storage unavailable, nothing was recorded; try again' }, { 'Retry-After': '5' });
              json(500, { ok: false, error: 'internal error' });
            }
          }),
        );
        return;
      }
      json(404, { ok: false, error: 'not found' });
    };
    try {
      route();
    } catch (e) {
      failed(e);
    }
  });
  // malformed HTTP at the socket level (not a parsable request): answer 400 and close instead of letting the parser error propagate
  server.on('clientError', (_err, socket) => {
    if (socket.writable) socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');
    socket.destroy();
  });
  // 0.8.1: a slow or silent client holds a socket for seconds, not minutes (Node's defaults are 60 s / 300 s)
  server.headersTimeout = opts.timeouts?.headersMs ?? 15_000;
  server.requestTimeout = opts.timeouts?.requestMs ?? 30_000;
  server.keepAliveTimeout = opts.timeouts?.keepAliveMs ?? 5_000;
  return server;
}

const isMain = isMainThread && process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const args = process.argv.slice(2);
  const flag = (k: string) => {
    const i = args.indexOf(`--${k}`);
    return i >= 0 ? args[i + 1] : undefined;
  };
  const host = flag('host') || process.env.HOST || '127.0.0.1';
  const port = Number(flag('port') || process.env.PORT || 4400);
  // default relative to the working directory so `npm run verifier` and `node server/dist/verify.mjs` agree on server/data
  const dataDir = flag('data-dir') || process.env.DATA_DIR || path.join(process.cwd(), 'server', 'data');
  const file = process.env.BOARD_FILE || path.join(dataDir, 'board.json');
  const corsOrigin = flag('cors-origin') || process.env.CORS_ORIGIN || '*';
  const limit = Number(flag('rate-limit') || process.env.RATE_LIMIT || DEFAULT_RATE_LIMIT);
  const trustProxy = process.env.TRUST_PROXY === '1';
  const playerRateLimit = Number(process.env.PLAYER_RATE_LIMIT || DEFAULT_PLAYER_RATE_LIMIT); // POST /verify per player id per minute (PLAN-v3 §1)
  // 0.8.1: per-address read and write limits, the identity cap and the report-to-hide policy
  const readRateLimit = Number(process.env.READ_RATE_LIMIT || DEFAULT_READ_RATE_LIMIT),
    writeRateLimit = Number(process.env.WRITE_RATE_LIMIT || DEFAULT_WRITE_RATE_LIMIT);
  const maxPlayers = Number(process.env.MAX_PLAYERS || DEFAULT_MAX_PLAYERS);
  const reportPolicy: ReportPolicy = {
    reporters: Number(process.env.REPORT_HIDE_REPORTERS || DEFAULT_REPORT_POLICY.reporters),
    establishedDays:
      process.env.REPORTER_ESTABLISHED_DAYS != null && process.env.REPORTER_ESTABLISHED_DAYS !== ''
        ? Number(process.env.REPORTER_ESTABLISHED_DAYS)
        : DEFAULT_REPORT_POLICY.establishedDays,
    expiryHours: Number(process.env.HIDE_EXPIRY_HOURS || DEFAULT_REPORT_POLICY.expiryHours),
  };
  // opt-in funnel events live next to the board (EVENTS_FILE overrides); retention is enforced at start and hourly
  const events = new EventStore(
    process.env.EVENTS_FILE || path.join(path.dirname(file), 'events.jsonl'),
    Number(process.env.EVENTS_RETENTION_DAYS || DEFAULT_EVENTS_RETENTION_DAYS),
  );
  const pruned = events.prune();
  if (pruned) console.log(`events: pruned ${pruned} rows older than ${events.retentionDays} days`);
  setInterval(() => {
    try {
      events.prune();
    } catch {
      /* next hour */
    }
  }, 3_600_000).unref();
  // daily secret (PLAN-v3 0.6.1): DAILY_SECRET / --daily-secret, else a generated one kept next to the board so restarts mint the same days
  const secretFile = path.join(path.dirname(file), 'daily-secret');
  let dailySecret = flag('daily-secret') || process.env.DAILY_SECRET || '';
  if (!dailySecret) {
    try {
      dailySecret = fs.readFileSync(secretFile, 'utf8').trim();
    } catch {
      /* none yet */
    }
  }
  if (!dailySecret) {
    dailySecret = randomBytes(32).toString('hex');
    fs.mkdirSync(path.dirname(secretFile), { recursive: true });
    fs.writeFileSync(secretFile, dailySecret + '\n', { mode: 0o600 });
    console.log(`daily secret generated at ${secretFile}: back it up (DAILY_SECRET overrides it)`);
  }
  // Discord announcements (PLAN-v4 0.7.6): DISCORD_WEBHOOK_URL / --discord-webhook; DISCORD_DRY_RUN=1 / --discord-dry-run prints instead of posting
  const webhookUrl = flag('discord-webhook') || process.env.DISCORD_WEBHOOK_URL || null;
  const dryRun = args.includes('--discord-dry-run') || process.env.DISCORD_DRY_RUN === '1';
  const announcer = new Announcer({ url: webhookUrl, dryRun });
  if (announcer.enabled)
    console.log(`discord announcements ${dryRun ? 'in dry run (printed, not posted)' : 'on'}: seed openings, new #1 on open events, freezes with medals`);
  // name moderation (PLAN-v4 0.7.7): MODERATION_TOKEN / --moderation-token enables /moderation/*; the audit log sits next to the board (MODERATION_FILE overrides)
  const moderationToken = flag('moderation-token') || process.env.MODERATION_TOKEN || null;
  const auditFile = process.env.MODERATION_FILE || path.join(path.dirname(file), 'moderation.jsonl');
  console.log(
    `moderation: POST /report on; moderator endpoints ${moderationToken ? 'on (X-Moderation-Token)' : 'off (set MODERATION_TOKEN)'}; audit ${auditFile}`,
  );
  const verifier = new Verifier(file, { dailySecret, announce: (ev) => announcer.announce(ev), auditFile, reportPolicy, maxPlayers });
  console.log(
    `reports hide a name after ${reportPolicy.reporters} established reporter(s) (entry ≥ ${reportPolicy.establishedDays} day(s) old${reportPolicy.establishedDays <= 0 ? ': any claimed player' : ''}) or a moderator's confirm; unconfirmed hides expire after ${reportPolicy.expiryHours} h; identities capped at ${maxPlayers}; reads ${readRateLimit}/min/address, writes ${writeRateLimit}/min/address; log: one JSON line per request with a daily-salted address hash`,
  );
  // cold storage (PLAN-v4 0.7.0): closed dailies older than HOT_DAYS leave the hot board at startup and once an hour
  try {
    const { moved } = verifier.splitCold(new Date());
    if (moved.length) console.log(`cold: moved ${moved.length} closed day(s) to ${path.join(path.dirname(file), 'cold')}`);
  } catch (e) {
    console.error(`cold split failed: ${(e as Error).message}`);
  }
  setInterval(() => {
    try {
      verifier.splitCold(new Date());
    } catch {
      /* next hour */
    }
  }, 3_600_000).unref();
  const par = process.env.BOT_PAR === '0' ? null : new ParService(verifier, (s) => computeParInWorker(s, Number(process.env.BOT_PAR_CAP_MS || 20_000)));
  const verify =
    process.env.RESIM_INLINE === '1'
      ? null
      : new VerifyService(null, { capMs: Number(process.env.RESIM_CAP_MS || 10_000), maxQueue: Number(process.env.RESIM_QUEUE || 32) }); // 0.8.2: one re-simulation at a time in a worker; RESIM_INLINE=1 keeps it on the loop (debugging)
  console.log(
    verify
      ? `re-simulation: one job at a time in a worker thread, ${verify.capMs} ms cap, ${verify.maxQueue} waiting at most`
      : 're-simulation: inline on the event loop (RESIM_INLINE=1)',
  );
  // push for the daily (0.10.4): VAPID_PUBLIC_KEY + VAPID_PRIVATE_KEY turn it on (`npx web-push generate-vapid-keys`); the subscriptions live next to the board
  const vapidPublic = process.env.VAPID_PUBLIC_KEY || '',
    vapidPrivate = process.env.VAPID_PRIVATE_KEY || '';
  const push = new PushStore(process.env.PUSH_FILE || path.join(path.dirname(file), 'push.json'), {
    vapid:
      vapidPublic && vapidPrivate
        ? { publicKey: vapidPublic, privateKey: vapidPrivate, subject: process.env.VAPID_SUBJECT || 'mailto:contact@junkyarddraft.com' }
        : null,
  });
  console.log(
    push.enabled
      ? `push: on, ${push.count} subscription(s), one message a day at each subscriber's hour (${push.file})`
      : 'push: off (set VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY to send the daily reminder)',
  );
  if (push.enabled)
    setInterval(() => {
      push.tick().catch((e) => console.error(`push tick failed: ${(e as Error).message}`));
    }, 60_000).unref();
  // the community database (0.11.0): next to the board, migrated here, so a bad migration stops the start instead of half-running
  const community = new CommunityStore(process.env.COMMUNITY_DB || path.join(path.dirname(file), COMMUNITY_DB));
  console.log(`community store: schema ${community.version} of ${community.migrations.length} (${community.file})`);
  const server = createServer(verifier, {
    rateLimit: { limit, windowMs: 60_000 },
    playerRateLimit,
    readRateLimit,
    writeRateLimit,
    corsOrigin,
    trustProxy,
    log: process.env.VERIFIER_LOG === '0' ? null : undefined,
    events,
    push,
    community,
    par,
    verify,
    announcer,
    moderationToken,
  });
  server.listen(port, host, () =>
    console.log(
      `replay verifier v${VERSION} → http://${host}:${port}/  (board: ${file}, events: ${events.file}, rules v${RULES_VERSION}, ${limit} submissions/min/IP, ${playerRateLimit}/min/player, CORS ${corsOrigin}${trustProxy ? ', trusting the rightmost X-Forwarded-For hop / X-Real-IP' : ''})`,
    ),
  );
  installShutdown(server, {
    announcer,
    after: () => {
      verify?.close();
      community.close();
    },
  }); // 0.8.1: SIGTERM/SIGINT stop accepting, finish in-flight requests and queued announcements, exit 0 (hard stop after 10 s)
}
