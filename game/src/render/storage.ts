import type { MachineKind } from '../sim/types';
import type { MedalName } from '../daily/medals';
import { MACHINE_KINDS } from '../sim/rules';
import { isValidSeed, validateAction, type Action } from '../sim/run';
import type { ReplayFile } from '../sim/replay';
import { RULES_VERSION } from '../sim/types';
import { dailySeed } from '../sim/daily';
import { normaliseDates, streakOf } from '../daily/streak';
import { cleanPlayer } from './share';

export { dailySeed };

/** Every record written before 0.5.0 was made under rules version 2; the one-time migration files them there, whatever version runs now. */
const LEGACY_RECORDS_VERSION = 2;
const K = {
  settings: 'jd.settings.v1',
  save: 'jd.save.v1',
  bests: 'jd.bests.v2',
  bestsLegacy: 'jd.bests.v1',
  onboarded: 'jd.onboarded.v1',
  player: 'jd.player',
  submissions: 'jd.submissions.v2',
  submissionsLegacy: 'jd.submissions.v1',
  tips: 'jd.tips.v1',
  telemetry: 'jd.telemetry.v1',
  days: 'jd.days.v1',
  dailyStreak: 'jd.dailystreak.v1',
  forkBests: 'jd.forkbests.v1',
  history: 'jd.history.v1',
  pending: 'jd.pending.v1',
  firsts: 'jd.firsts.v1',
  standings: 'jd.standings.v1',
  medals: 'jd.medals.v1',
  kinds: 'jd.kinds.v1',
  stars: 'jd.stars.v1',
  watched: 'jd.watched.v1',
  trophies: 'jd.trophies.v1',
};
/**
 * Score records are partitioned by rules version (PLAN-v2 0.5.0): `jd.bests.v2` / `jd.submissions.v2` hold
 * `{ byVersion: { "2": …, "3": … } }`. Readers take the current RULES_VERSION; the other versions are archived for the
 * title's "Under rules vN" block. The pre-0.5.0 keys (`jd.bests.v1`, `jd.submissions.v1`) migrate once into the slot of the
 * rules-2 slot (every pre-0.5.0 record was made under rules 2, whatever version runs at migration time) and are then removed. Settings,
 * player name, onboarding, read tips and days played are version-independent.
 */

export type RenderQuality = 'auto' | 'high' | 'low';
/** renderQuality: 'auto' until the first run measures frame times at high resolution, then 'high' or 'low' (DPR 1); the title button sets it too. */
/** telemetry: the player's choice on anonymous play data: true, false, or null while they have not chosen (on, unless the browser asks not to be tracked; render/telemetry.ts) */
/** per-bus levels 0..1 (DOSSIER-v1 0.4.9) */
export interface Buses {
  ui: number;
  factory: number;
  music: number;
}
export interface Settings {
  volume: number;
  muted: boolean;
  reducedMotion: boolean;
  textScale: number;
  renderQuality: RenderQuality;
  telemetry: boolean | null;
  buses: Buses;
  reducedAudio: boolean;
  /** the foreman (0.9.1): every line, or the teaching lines only */ chatter: 'full' | 'less';
}
/** Default for reduced motion follows the OS preference until the player chooses. */
const systemReducedMotion = () => {
  try {
    return typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
};
export interface SaveGame {
  rulesVersion: number;
  seed: string;
  actions: Action[];
  savedAt: string;
}
export interface Bests {
  overall: { score: number; seed: string; at: string } | null;
  bySeed: Record<string, { score: number; at: string }>;
  runs: number;
}
export interface Submission {
  score: number;
  replayHash: string;
  verifiedAt: string;
  player: string;
}

// ---- runtime validators: localStorage is untrusted input (another tab, an older build, a hand edit).
// Valid JSON with the wrong shape used to pass the fallback and crash the title screen; every reader now
// checks shapes and primitive types and discards what does not fit, field by field.
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const isFiniteNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isStr = (v: unknown): v is string => typeof v === 'string';

const TEXT_SCALES = new Set([1, 1.15, 1.3]);
export function validateSettings(raw: unknown, fallback: Settings): Settings {
  if (!isObj(raw)) return fallback;
  return {
    volume: isFiniteNum(raw.volume) ? Math.min(1, Math.max(0, raw.volume)) : fallback.volume,
    muted: typeof raw.muted === 'boolean' ? raw.muted : fallback.muted,
    reducedMotion: typeof raw.reducedMotion === 'boolean' ? raw.reducedMotion : fallback.reducedMotion,
    textScale: isFiniteNum(raw.textScale) && TEXT_SCALES.has(raw.textScale) ? raw.textScale : fallback.textScale,
    renderQuality: raw.renderQuality === 'high' || raw.renderQuality === 'low' || raw.renderQuality === 'auto' ? raw.renderQuality : fallback.renderQuality,
    telemetry: raw.telemetry === true ? true : raw.telemetry === false ? false : null,
    buses: (() => {
      const b = isObj(raw.buses) ? raw.buses : {};
      const lvl = (k: keyof Buses) => (isFiniteNum(b[k]) ? Math.min(1, Math.max(0, b[k] as number)) : fallback.buses[k]);
      return { ui: lvl('ui'), factory: lvl('factory'), music: lvl('music') };
    })(),
    reducedAudio: typeof raw.reducedAudio === 'boolean' ? raw.reducedAudio : fallback.reducedAudio,
    chatter: raw.chatter === 'less' ? 'less' : fallback.chatter,
  };
}
export function validateSave(raw: unknown): SaveGame | null {
  if (!isObj(raw)) return null;
  if (!Number.isInteger(raw.rulesVersion) || !isValidSeed(raw.seed) || !Array.isArray(raw.actions) || !raw.actions.every(validateAction)) return null;
  return { rulesVersion: raw.rulesVersion as number, seed: raw.seed, actions: raw.actions as Action[], savedAt: isStr(raw.savedAt) ? raw.savedAt : '' };
}
/** Dictionaries keyed by player-typed seeds use null prototypes and own-property checks: '__proto__', 'constructor' or 'toString' are valid seeds (review F14). */
const dict = <T>(): Record<string, T> => Object.create(null) as Record<string, T>;
const own = (o: object, k: string) => Object.prototype.hasOwnProperty.call(o, k);
export function validateBests(raw: unknown): Bests {
  const out: Bests = { overall: null, bySeed: dict(), runs: 0 };
  if (!isObj(raw)) return out;
  if (isObj(raw.overall) && isFiniteNum(raw.overall.score) && isStr(raw.overall.seed))
    out.overall = { score: raw.overall.score, seed: raw.overall.seed, at: isStr(raw.overall.at) ? raw.overall.at : '' };
  if (isObj(raw.bySeed))
    for (const [seed, v] of Object.entries(raw.bySeed))
      if (isObj(v) && isFiniteNum(v.score) && isValidSeed(seed)) out.bySeed[seed] = { score: v.score, at: isStr(v.at) ? v.at : '' };
  if (Number.isInteger(raw.runs) && (raw.runs as number) >= 0) out.runs = raw.runs as number;
  return out;
}
export interface BestsByVersion {
  byVersion: Record<string, Bests>;
}
export interface SubmissionsByVersion {
  byVersion: Record<string, Record<string, Submission>>;
}
const isVersionKey = (k: string) => /^\d+$/.test(k);
export function validateBestsByVersion(raw: unknown): BestsByVersion | null {
  if (!isObj(raw) || !isObj(raw.byVersion)) return null;
  const byVersion = dict<Bests>();
  for (const [k, v] of Object.entries(raw.byVersion)) if (isVersionKey(k)) byVersion[k] = validateBests(v);
  return { byVersion };
}
export function validateSubmissionsByVersion(raw: unknown): SubmissionsByVersion | null {
  if (!isObj(raw) || !isObj(raw.byVersion)) return null;
  const byVersion = dict<Record<string, Submission>>();
  for (const [k, v] of Object.entries(raw.byVersion)) if (isVersionKey(k)) byVersion[k] = validateSubmissions(v);
  return { byVersion };
}
export function validateSubmissions(raw: unknown): Record<string, Submission> {
  const out = dict<Submission>();
  if (!isObj(raw)) return out;
  for (const [seed, v] of Object.entries(raw))
    if (isObj(v) && isFiniteNum(v.score) && isStr(v.replayHash) && isValidSeed(seed))
      out[seed] = { score: v.score, replayHash: v.replayHash, verifiedAt: isStr(v.verifiedAt) ? v.verifiedAt : '', player: isStr(v.player) ? v.player : '' };
  return out;
}

/**
 * Storage health (production roadmap 0.8.0): the first failed read or write flips this and tells listeners once, so the
 * UI can say that progress is not being saved (a full quota, a private window, a blocked origin) instead of losing saves,
 * bests and the name silently. Unparsable JSON is not a storage failure.
 */
let storageBroken = false;
let storageReason = '';
const storageListeners: ((reason: string) => void)[] = [];
export const storageFailed = (): boolean => storageBroken;
export function onStorageFailure(cb: (reason: string) => void): void {
  storageListeners.push(cb);
  if (storageBroken) cb(storageReason);
}
export function markStorageFailure(err: unknown): void {
  if (storageBroken) return;
  storageBroken = true;
  storageReason = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
  for (const cb of storageListeners) {
    try {
      cb(storageReason);
    } catch {
      /* a listener must not break storage */
    }
  }
}
/** Parse a key; a missing key or unparsable JSON yields `undefined` for the validator to turn into a fallback; a storage access failure does too and is announced. */
function readRaw(key: string): unknown {
  let v: string | null;
  try {
    v = localStorage.getItem(key);
  } catch (e) {
    markStorageFailure(e);
    return undefined;
  }
  try {
    return v ? JSON.parse(v) : undefined;
  } catch {
    return undefined;
  }
}
function write(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (e) {
    markStorageFailure(e);
  }
}

/** A small JSON record by key (the web-app state, 0.10.3); undefined when absent or unreadable. */
export function readJson<T>(key: string): T | undefined {
  return readRaw(key) as T | undefined;
}
export function writeJson<T>(key: string, value: T): void {
  write(key, value);
}
/** How many own runs this device has finished under the current rules, over every yard (the install offer waits for the second). */
export function countRuns(version: number = RULES_VERSION): number {
  const cur = validateHistory(readRaw(K.history)).byVersion[String(version)];
  if (!cur) return 0;
  let n = 0;
  for (const seed of Object.keys(cur)) if (own(cur, seed)) n += cur[seed].length;
  return n;
}

export const loadSettings = (): Settings =>
  validateSettings(readRaw(K.settings), {
    volume: 0.7,
    muted: false,
    reducedMotion: systemReducedMotion(),
    textScale: 1,
    renderQuality: 'auto',
    telemetry: null,
    buses: { ui: 1, factory: 1, music: 1 },
    reducedAudio: false,
    chatter: 'full',
  });
export const saveSettings = (s: Settings) => write(K.settings, s);
/** Read-modify-write so audio and accessibility settings never clobber each other. */
export const updateSettings = (p: Partial<Settings>): Settings => {
  const s = { ...loadSettings(), ...p };
  saveSettings(s);
  return s;
};

/** The saved run, or null when there is none, it is damaged, or it belongs to another rules version. */
export const loadSave = (): SaveGame | null => {
  const s = validateSave(readRaw(K.save));
  return s && s.rulesVersion === RULES_VERSION ? s : null;
};
/** True when a save key exists but cannot be used (lets the UI explain the reset instead of silently starting over). */
export const hasUnusableSave = (): boolean => {
  try {
    return localStorage.getItem(K.save) != null && loadSave() == null;
  } catch {
    return false;
  }
};
export const writeSave = (seed: string, actions: Action[]) =>
  write(K.save, { rulesVersion: RULES_VERSION, seed, actions, savedAt: new Date().toISOString() } satisfies SaveGame);
export const clearSave = () => {
  try {
    localStorage.removeItem(K.save);
  } catch {
    /* ignore */
  }
};

const emptyBests = (): Bests => ({ overall: null, bySeed: dict(), runs: 0 });
/** Every version's bests; migrates the pre-0.5.0 key once (idempotent: the new key's presence ends migration). */
export function loadBestsAll(): BestsByVersion {
  const cur = validateBestsByVersion(readRaw(K.bests));
  if (cur) return cur;
  const legacy = readRaw(K.bestsLegacy);
  const out: BestsByVersion = { byVersion: dict() };
  if (legacy !== undefined) {
    const b = validateBests(legacy);
    if (b.overall || b.runs || Object.keys(b.bySeed).length) out.byVersion[String(LEGACY_RECORDS_VERSION)] = b;
  }
  write(K.bests, out);
  try {
    localStorage.removeItem(K.bestsLegacy);
  } catch {
    /* ignore */
  }
  return out;
}
/** The current rules version's bests (or another version's when asked). */
export const loadBests = (version: number = RULES_VERSION): Bests => loadBestsAll().byVersion[String(version)] ?? emptyBests();
/** Bests kept under other rules versions (newest version first), for the title's archived block. */
export const loadArchivedBests = (): { version: number; bests: Bests }[] =>
  Object.entries(loadBestsAll().byVersion)
    .filter(([k, b]) => Number(k) !== RULES_VERSION && (b.overall || b.runs > 0))
    .map(([k, bests]) => ({ version: Number(k), bests }))
    .sort((a, b) => b.version - a.version);
/** Records a finished run locally under `version` (the current rules by default). Returns which records were beaten. */
/** Records a finished run; `prevSeedBest` is this device's best on the seed before this run (null on the first game there), for the results card's delta (0.9.2). */
export function recordBest(
  seed: string,
  score: number,
  version: number = RULES_VERSION,
): { newOverall: boolean; newSeed: boolean; prevSeedBest: number | null } {
  const all = loadBestsAll();
  const b = all.byVersion[String(version)] ?? emptyBests();
  const at = new Date().toISOString();
  const prevSeedBest = own(b.bySeed, seed) ? b.bySeed[seed].score : null;
  const newSeed = prevSeedBest == null || score > prevSeedBest;
  if (newSeed) b.bySeed[seed] = { score, at };
  const newOverall = !b.overall || score > b.overall.score;
  if (newOverall) b.overall = { score, seed, at };
  b.runs++;
  all.byVersion[String(version)] = b;
  write(K.bests, all);
  return { newOverall, newSeed, prevSeedBest };
}

/** Display name sent with verified submissions (shown publicly on boards). Empty until the player chooses one. */
export const loadPlayer = (): string => {
  try {
    return cleanPlayer(localStorage.getItem(K.player));
  } catch {
    return '';
  }
};
export const savePlayer = (name: string) => {
  try {
    const n = cleanPlayer(name);
    if (n) localStorage.setItem(K.player, n);
    else localStorage.removeItem(K.player);
  } catch (e) {
    markStorageFailure(e);
  }
};

/** Every version's submissions; migrates the pre-0.5.0 key once. */
export function loadSubmissionsAll(): SubmissionsByVersion {
  const cur = validateSubmissionsByVersion(readRaw(K.submissions));
  if (cur) return cur;
  const legacy = readRaw(K.submissionsLegacy);
  const out: SubmissionsByVersion = { byVersion: dict() };
  if (legacy !== undefined) {
    const s = validateSubmissions(legacy);
    if (Object.keys(s).length) out.byVersion[String(LEGACY_RECORDS_VERSION)] = s;
  }
  write(K.submissions, out);
  try {
    localStorage.removeItem(K.submissionsLegacy);
  } catch {
    /* ignore */
  }
  return out;
}
/** Verified submissions this device made under the current rules, by seed: lets the title screen look up its own rank without trusting names. */
export const loadSubmissions = (version: number = RULES_VERSION): Record<string, Submission> =>
  loadSubmissionsAll().byVersion[String(version)] ?? dict<Submission>();
export const recordSubmission = (seed: string, s: Submission, version: number = RULES_VERSION) => {
  const all = loadSubmissionsAll();
  const cur = all.byVersion[String(version)] ?? dict<Submission>();
  if (!own(cur, seed) || s.score >= cur[seed].score) {
    cur[seed] = s;
    all.byVersion[String(version)] = cur;
    write(K.submissions, all);
  }
};

/** Opt-in funnel state (PLAN-v1 0.3.7): the random install id, once-per-install events already sent, games started. Exists only while consent is on. */
export interface TelemetryState {
  installId: string | null;
  firsts: string[];
  games: number;
  /** unsent events, so a page navigation never loses a batch */ pending: unknown[];
}
export const loadTelemetryState = (): TelemetryState => {
  const raw = readRaw(K.telemetry);
  if (!isObj(raw)) return { installId: null, firsts: [], games: 0, pending: [] };
  return {
    pending: Array.isArray(raw.pending) ? raw.pending.slice(0, 200) : [],
    installId: typeof raw.installId === 'string' && /^[0-9a-f]{32}$/.test(raw.installId) ? raw.installId : null,
    firsts: Array.isArray(raw.firsts) ? raw.firsts.filter((x): x is string => typeof x === 'string') : [],
    games: isFiniteNum(raw.games) && raw.games >= 0 ? Math.floor(raw.games) : 0,
  };
};
export const saveTelemetryState = (s: TelemetryState) => write(K.telemetry, s);
export const clearTelemetryState = () => {
  try {
    localStorage.removeItem(K.telemetry);
  } catch {
    /* ignore */
  }
};

/** Best score per seed among practice forks (PLAN-v4 0.7.3): kept apart so a fork never masquerades as the player's own run. */
// ---- production roadmap 0.8.7: this device's run history per seed (what the results board shows when the verifier is away) and
// submissions that could not reach the verifier (sent on the next title load). Both partitioned by rules version like the bests.
export interface RunRecord {
  score: number;
  at: string;
}
export const HISTORY_PER_SEED = 10;
export interface HistoryByVersion {
  byVersion: Record<string, Record<string, RunRecord[]>>;
}
export function validateHistory(raw: unknown): HistoryByVersion {
  const byVersion = dict<Record<string, RunRecord[]>>();
  if (isObj(raw) && isObj(raw.byVersion))
    for (const [k, seeds] of Object.entries(raw.byVersion)) {
      if (!isVersionKey(k) || !isObj(seeds)) continue;
      const out = dict<RunRecord[]>();
      for (const [seed, runs] of Object.entries(seeds))
        if (isValidSeed(seed) && Array.isArray(runs)) {
          const ok = runs
            .filter((r): r is RunRecord => isObj(r) && isFiniteNum(r.score) && isStr(r.at))
            .map((r) => ({ score: r.score, at: r.at }))
            .slice(-HISTORY_PER_SEED);
          if (ok.length) out[seed] = ok;
        }
      byVersion[k] = out;
    }
  return { byVersion };
}
/** This device's finished runs on a seed under the current rules, oldest first (at most HISTORY_PER_SEED). */
export const loadHistory = (seed: string, version: number = RULES_VERSION): RunRecord[] => {
  const v = validateHistory(readRaw(K.history)).byVersion[String(version)];
  return v && own(v, seed) ? v[seed] : [];
};
/** Record a finished own run (never a replay or a fork); the oldest beyond the cap falls off. */
export function recordRun(seed: string, score: number, version: number = RULES_VERSION, now = new Date()): RunRecord[] {
  const all = validateHistory(readRaw(K.history));
  const cur = all.byVersion[String(version)] ?? dict<RunRecord[]>();
  const runs = [...(own(cur, seed) ? cur[seed] : []), { score, at: now.toISOString() }].slice(-HISTORY_PER_SEED);
  cur[seed] = runs;
  all.byVersion[String(version)] = cur;
  write(K.history, all);
  return runs;
}
export interface PendingSubmission {
  seed: string;
  rulesVersion: number;
  replay: ReplayFile;
  player: string;
  savedAt: string;
}
export const PENDING_MAX = 5;
export function validatePending(raw: unknown): PendingSubmission[] {
  if (!Array.isArray(raw)) return [];
  const out: PendingSubmission[] = [];
  for (const p of raw) {
    if (!isObj(p) || !isObj(p.replay)) continue;
    const r = p.replay;
    if (
      !Number.isInteger(p.rulesVersion) ||
      !isValidSeed(p.seed) ||
      !Number.isInteger(r.format) ||
      r.rulesVersion !== p.rulesVersion ||
      r.seed !== p.seed ||
      !Array.isArray(r.actions) ||
      !r.actions.every(validateAction) ||
      !isFiniteNum(r.claimedScore)
    )
      continue;
    out.push({
      seed: p.seed,
      rulesVersion: p.rulesVersion as number,
      replay: {
        format: r.format as number,
        rulesVersion: r.rulesVersion as number,
        seed: r.seed as string,
        actions: r.actions as Action[],
        claimedScore: r.claimedScore,
        createdAt: isStr(r.createdAt) ? r.createdAt : '',
        ...(isStr(r.build) ? { build: r.build } : {}),
      },
      player: isStr(p.player) ? p.player : '',
      savedAt: isStr(p.savedAt) ? p.savedAt : '',
    });
  }
  return out.slice(-PENDING_MAX);
}
/** Submissions waiting for a connection, oldest first; only those under the current rules can still verify. */
export const loadPending = (): PendingSubmission[] => validatePending(readRaw(K.pending)).filter((p) => p.rulesVersion === RULES_VERSION);
/** Keep a run for later: one per seed (the newest wins), at most PENDING_MAX (the oldest falls off). */
/** Writers also drop runs from other rules versions: they can never verify, so they are not worth keeping. */
const livePending = (): PendingSubmission[] => validatePending(readRaw(K.pending)).filter((q) => q.rulesVersion === RULES_VERSION);
export function savePending(p: PendingSubmission): PendingSubmission[] {
  const next = [...livePending().filter((q) => q.seed !== p.seed), p].slice(-PENDING_MAX);
  write(K.pending, next);
  return next;
}
export function removePending(seed: string, savedAt: string): void {
  const next = livePending().filter((q) => !(q.seed === seed && q.savedAt === savedAt));
  if (next.length) write(K.pending, next);
  else {
    try {
      localStorage.removeItem(K.pending);
    } catch {
      /* ignore */
    }
  }
}

/** Once-only moments the foreman comments on (0.9.1): the first share, the first crew. True the first time a key is seen. */
export function firstTime(key: string): boolean {
  const raw = readRaw(K.firsts);
  const seen = Array.isArray(raw) ? raw.filter((x): x is string => typeof x === 'string') : [];
  if (seen.includes(key)) return false;
  write(K.firsts, [...seen, key].slice(-50));
  return true;
}

export const loadForkBests = (): Record<string, { score: number; at: string }> => {
  const raw = readRaw(K.forkBests);
  const out = dict<{ score: number; at: string }>();
  if (isObj(raw))
    for (const [seed, v] of Object.entries(raw))
      if (isObj(v) && isFiniteNum(v.score) && isValidSeed(seed)) out[seed] = { score: v.score, at: isStr(v.at) ? v.at : '' };
  return out;
};
export const recordForkBest = (seed: string, score: number): { newFork: boolean } => {
  const all = loadForkBests();
  const newFork = !own(all, seed) || score > all[seed].score;
  if (newFork) {
    all[seed] = { score, at: new Date().toISOString() };
    write(K.forkBests, all);
  }
  return { newFork };
};
/** UTC dates with at least one finished run on this device (PLAN-v1 0.4.3 share line; the streak of 0.6.4 builds on it). Bounded, validated. */
export const loadDaysPlayed = (): string[] => {
  const raw = readRaw(K.days);
  return Array.isArray(raw) ? raw.filter((x): x is string => typeof x === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(x)).slice(-400) : [];
};
export const recordDayPlayed = (now = new Date()): number => {
  const d = now.toISOString().slice(0, 10);
  const all = loadDaysPlayed();
  if (!all.includes(d)) {
    all.push(d);
    write(K.days, all.slice(-400));
  }
  return all.length;
};
export const daysPlayed = (): number => loadDaysPlayed().length;
/** UTC dates of the dailies this device submitted and had verified (by the daily's date, PLAN-v3 0.6.3). Distinct, sorted, bounded. */
export const loadDailyDates = (): string[] => {
  const raw = readRaw(K.dailyStreak);
  return Array.isArray(raw) ? normaliseDates(raw.filter((x): x is string => typeof x === 'string')).slice(-400) : [];
};
export const recordDailyDate = (date: string): string[] => {
  const all = normaliseDates([...loadDailyDates(), date]).slice(-400);
  write(K.dailyStreak, all);
  return all;
};
/** Consecutive verified dailies ending today or yesterday (grace: yesterday's daily is still open); 0 once the chain is older. */
export const currentStreak = (now = new Date()): number => streakOf(loadDailyDates(), now).streak;

/** Tips the player has opened (PLAN-v1 0.3.6); anything but an array of strings reads as none. */
export const loadReadTips = (): string[] => {
  const raw = readRaw(K.tips);
  return Array.isArray(raw) ? raw.filter((x): x is string => typeof x === 'string') : [];
};
export const markTipRead = (id: string) => {
  const all = loadReadTips();
  if (!all.includes(id)) {
    all.push(id);
    write(K.tips, all);
  }
};

/** False when storage fails: a browser that cannot remember the flag should see the onboarding, not skip it (0.8.0). */
export const isOnboarded = () => {
  try {
    return localStorage.getItem(K.onboarded) === '1';
  } catch (e) {
    markStorageFailure(e);
    return false;
  }
};
export const setOnboarded = () => {
  try {
    localStorage.setItem(K.onboarded, '1');
  } catch (e) {
    markStorageFailure(e);
  }
};

export function randomSeed(): string {
  const words = ['rust', 'bolt', 'gear', 'weld', 'spark', 'scrap', 'ingot', 'belt', 'crate', 'forge', 'piston', 'rivet'];
  return `${words[Math.floor(Math.random() * words.length)]}-${words[Math.floor(Math.random() * words.length)]}-${Math.floor(Math.random() * 900 + 100)}`;
}

// ---- production roadmap 0.9.7: the record page's memory, local only and by rules version: the standing of each checked game, the medals
// seen on closed days, the machines drafted. Written where the game learns the fact; read by render/record.ts. ----
const isSeedStr = (v: unknown): v is string => isStr(v) && v.length > 0 && v.length <= 64;
function byVersionList<T>(key: string, version: number, guard: (v: unknown) => v is T, cap: number): T[] {
  const raw = readRaw(key);
  const list = isObj(raw) && isObj(raw.byVersion) ? (raw.byVersion as Record<string, unknown>)[String(version)] : null;
  return Array.isArray(list) ? list.filter(guard).slice(-cap) : [];
}
function writeByVersion(key: string, version: number, value: unknown) {
  const raw = readRaw(key);
  const all: Record<string, unknown> = isObj(raw) && isObj(raw.byVersion) ? { ...(raw.byVersion as Record<string, unknown>) } : {};
  all[String(version)] = value;
  write(key, { byVersion: all });
}
/** Where one of this device's checked games stood when the results screen learnt it. */
export interface Standing {
  seed: string;
  at: string;
  score: number;
  percentile: number;
  n: number;
  rank: number;
}
export const STANDINGS_MAX = 100;
const isStanding = (v: unknown): v is Standing =>
  isObj(v) && isSeedStr(v.seed) && isStr(v.at) && isFiniteNum(v.score) && isFiniteNum(v.percentile) && isFiniteNum(v.n) && isFiniteNum(v.rank);
/** Chronological (by the time the standing was learnt). */
export const loadStandings = (version: number = RULES_VERSION): Standing[] =>
  byVersionList(K.standings, version, isStanding, STANDINGS_MAX).sort((a, b) => a.at.localeCompare(b.at));
/** One standing per yard (a later checked game on the same yard replaces it); the oldest beyond the cap falls off. */
export function recordStanding(s: Standing, version: number = RULES_VERSION): Standing[] {
  const list = loadStandings(version).filter((x) => x.seed !== s.seed);
  list.push(s);
  list.sort((a, b) => a.at.localeCompare(b.at));
  const kept = list.slice(-STANDINGS_MAX);
  writeByVersion(K.standings, version, kept);
  return kept;
}
/** The trophies this device last heard about (0.11.11). They belong to the player, not to a rules version, and never decay. */
export function loadTrophies(): Record<string, number> {
  const raw = readRaw(K.trophies);
  return isObj(raw) ? Object.fromEntries(Object.entries(raw).filter((e): e is [string, number] => isFiniteNum(e[1]))) : {};
}
export const recordTrophies = (trophies: Record<string, number>) => write(K.trophies, trophies);

/** Who watched a checked game of this device (0.11.4), as last learnt on its results. */
export interface WatchedRecord {
  seed: string;
  score: number;
  times: number;
  players: number;
  at: string;
}
const isWatched = (v: unknown): v is WatchedRecord =>
  isObj(v) && isSeedStr(v.seed) && isFiniteNum(v.score) && isFiniteNum(v.times) && isFiniteNum(v.players) && isStr(v.at);
export const loadWatched = (version: number = RULES_VERSION): WatchedRecord[] => byVersionList(K.watched, version, isWatched, STANDINGS_MAX);
/** One line per yard, the latest count replacing it; the oldest beyond the cap falls off. */
export function recordWatched(w: WatchedRecord, version: number = RULES_VERSION): WatchedRecord[] {
  const kept = [...loadWatched(version).filter((x) => x.seed !== w.seed), w].slice(-STANDINGS_MAX);
  writeByVersion(K.watched, version, kept);
  return kept;
}
export interface MedalRecord {
  seed: string;
  medal: MedalName;
  score: number;
  at: string;
}
const isMedalRecord = (v: unknown): v is MedalRecord =>
  isObj(v) && isSeedStr(v.seed) && (v.medal === 'gold' || v.medal === 'silver' || v.medal === 'bronze') && isFiniteNum(v.score) && isStr(v.at);
export const loadMedals = (version: number = RULES_VERSION): MedalRecord[] => byVersionList(K.medals, version, isMedalRecord, 400);
/** A medal this device's own checked game earned on a closed day; one per yard. */
export function recordMedal(seed: string, medal: MedalName, score: number, version: number = RULES_VERSION, now = new Date()): MedalRecord[] {
  const list = loadMedals(version).filter((m) => m.seed !== seed);
  list.push({ seed, medal, score, at: now.toISOString() });
  const kept = list.slice(-400);
  writeByVersion(K.medals, version, kept);
  return kept;
}
// ---------- stars (rules v4): the best stars of each yard; their sum is the career rank (content/ranks.ts), local only ----------
export const loadStars = (version: number = RULES_VERSION): Record<string, number> => {
  const all = readRaw(K.stars) as Record<string, Record<string, number>> | null;
  const mine = all && typeof all === 'object' ? all[String(version)] : null;
  return mine && typeof mine === 'object' ? mine : {};
};
export const totalStars = (version: number = RULES_VERSION): number => Object.values(loadStars(version)).reduce((a, b) => a + (Number(b) || 0), 0);
/** Keep the best stars of a yard; returns the total before and after, so a new rank can be announced. */
export function recordStars(seed: string, stars: number, version: number = RULES_VERSION): { before: number; after: number } {
  const before = totalStars(version);
  const mine = loadStars(version);
  if (stars > (mine[seed] ?? 0)) {
    const all = (readRaw(K.stars) as Record<string, Record<string, number>> | null) ?? {};
    write(K.stars, { ...all, [String(version)]: { ...mine, [seed]: stars } });
  }
  return { before, after: totalStars(version) };
}

export type KindCounts = Partial<Record<MachineKind, number>>;
export const loadKinds = (version: number = RULES_VERSION): KindCounts => {
  const raw = readRaw(K.kinds);
  const v = isObj(raw) && isObj(raw.byVersion) ? (raw.byVersion as Record<string, unknown>)[String(version)] : null;
  const out: KindCounts = {};
  if (isObj(v)) for (const k of MACHINE_KINDS) if (isFiniteNum(v[k]) && (v[k] as number) >= 0) out[k] = Math.floor(v[k] as number);
  return out;
};
/** The machines a finished own run drafted, added to the device's totals. */
export function recordKinds(picks: readonly MachineKind[], version: number = RULES_VERSION): KindCounts {
  const counts = loadKinds(version);
  for (const p of picks) if (MACHINE_KINDS.includes(p)) counts[p] = (counts[p] ?? 0) + 1;
  writeByVersion(K.kinds, version, counts);
  return counts;
}
