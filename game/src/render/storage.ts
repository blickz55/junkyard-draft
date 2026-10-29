import { isValidSeed, validateAction, type Action } from '../sim/run';
import { RULES_VERSION } from '../sim/types';
import { dailySeed } from '../sim/daily';
import { cleanPlayer } from './share';

export { dailySeed };

const K = { settings: 'jd.settings.v1', save: 'jd.save.v1', bests: 'jd.bests.v2', bestsLegacy: 'jd.bests.v1', onboarded: 'jd.onboarded.v1', player: 'jd.player', submissions: 'jd.submissions.v2', submissionsLegacy: 'jd.submissions.v1', tips: 'jd.tips.v1', telemetry: 'jd.telemetry.v1', days: 'jd.days.v1' };
/**
 * Score records are partitioned by rules version (PLAN-v2 0.5.0): `jd.bests.v2` / `jd.submissions.v2` hold
 * `{ byVersion: { "2": …, "3": … } }`. Readers take the current RULES_VERSION; the other versions are archived for the
 * title's "Under rules vN" block. The pre-0.5.0 keys (`jd.bests.v1`, `jd.submissions.v1`) migrate once into the slot of the
 * version current at migration time (every pre-0.5.0 record was made under rules 2) and are then removed. Settings,
 * player name, onboarding, read tips and days played are version-independent.
 */

export type RenderQuality = 'auto' | 'high' | 'low';
/** renderQuality: 'auto' until the first run measures frame times at high resolution, then 'high' or 'low' (DPR 1); the title button sets it too. */
/** telemetry: opt-in anonymous funnel events (PLAN-v1 0.3.7); false until the player turns it on */
/** per-bus levels 0..1 (DOSSIER-v1 0.4.9) */
export interface Buses { ui: number; factory: number; music: number }
export interface Settings { volume: number; muted: boolean; reducedMotion: boolean; textScale: number; renderQuality: RenderQuality; telemetry: boolean; buses: Buses; reducedAudio: boolean }
/** Default for reduced motion follows the OS preference until the player chooses. */
const systemReducedMotion = () => { try { return typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches; } catch { return false; } };
export interface SaveGame { rulesVersion: number; seed: string; actions: Action[]; savedAt: string }
export interface Bests { overall: { score: number; seed: string; at: string } | null; bySeed: Record<string, { score: number; at: string }>; runs: number }
export interface Submission { score: number; replayHash: string; verifiedAt: string; player: string }

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
    telemetry: raw.telemetry === true, // anything but an explicit true is off
    buses: (() => { const b = isObj(raw.buses) ? raw.buses : {}; const lvl = (k: keyof Buses) => (isFiniteNum(b[k]) ? Math.min(1, Math.max(0, b[k] as number)) : fallback.buses[k]); return { ui: lvl('ui'), factory: lvl('factory'), music: lvl('music') }; })(),
    reducedAudio: typeof raw.reducedAudio === 'boolean' ? raw.reducedAudio : fallback.reducedAudio,
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
  if (isObj(raw.overall) && isFiniteNum(raw.overall.score) && isStr(raw.overall.seed)) out.overall = { score: raw.overall.score, seed: raw.overall.seed, at: isStr(raw.overall.at) ? raw.overall.at : '' };
  if (isObj(raw.bySeed)) for (const [seed, v] of Object.entries(raw.bySeed)) if (isObj(v) && isFiniteNum(v.score) && isValidSeed(seed)) out.bySeed[seed] = { score: v.score, at: isStr(v.at) ? v.at : '' };
  if (Number.isInteger(raw.runs) && (raw.runs as number) >= 0) out.runs = raw.runs as number;
  return out;
}
export interface BestsByVersion { byVersion: Record<string, Bests> }
export interface SubmissionsByVersion { byVersion: Record<string, Record<string, Submission>> }
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
  for (const [seed, v] of Object.entries(raw)) if (isObj(v) && isFiniteNum(v.score) && isStr(v.replayHash) && isValidSeed(seed)) out[seed] = { score: v.score, replayHash: v.replayHash, verifiedAt: isStr(v.verifiedAt) ? v.verifiedAt : '', player: isStr(v.player) ? v.player : '' };
  return out;
}

/** Parse a key; a missing key, unparsable JSON or storage access failure yields `undefined` for the validator to turn into a fallback. */
function readRaw(key: string): unknown {
  try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : undefined; } catch { return undefined; }
}
function write(key: string, value: unknown) { try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage unavailable */ } }

export const loadSettings = (): Settings => validateSettings(readRaw(K.settings), { volume: 0.7, muted: false, reducedMotion: systemReducedMotion(), textScale: 1, renderQuality: 'auto', telemetry: false, buses: { ui: 1, factory: 1, music: 1 }, reducedAudio: false });
export const saveSettings = (s: Settings) => write(K.settings, s);
/** Read-modify-write so audio and accessibility settings never clobber each other. */
export const updateSettings = (p: Partial<Settings>): Settings => { const s = { ...loadSettings(), ...p }; saveSettings(s); return s; };

/** The saved run, or null when there is none, it is damaged, or it belongs to another rules version. */
export const loadSave = (): SaveGame | null => { const s = validateSave(readRaw(K.save)); return s && s.rulesVersion === RULES_VERSION ? s : null; };
/** True when a save key exists but cannot be used (lets the UI explain the reset instead of silently starting over). */
export const hasUnusableSave = (): boolean => { try { return localStorage.getItem(K.save) != null && loadSave() == null; } catch { return false; } };
export const writeSave = (seed: string, actions: Action[]) => write(K.save, { rulesVersion: RULES_VERSION, seed, actions, savedAt: new Date().toISOString() } satisfies SaveGame);
export const clearSave = () => { try { localStorage.removeItem(K.save); } catch { /* ignore */ } };

const emptyBests = (): Bests => ({ overall: null, bySeed: dict(), runs: 0 });
/** Every version's bests; migrates the pre-0.5.0 key once (idempotent: the new key's presence ends migration). */
export function loadBestsAll(): BestsByVersion {
  const cur = validateBestsByVersion(readRaw(K.bests));
  if (cur) return cur;
  const legacy = readRaw(K.bestsLegacy);
  const out: BestsByVersion = { byVersion: dict() };
  if (legacy !== undefined) { const b = validateBests(legacy); if (b.overall || b.runs || Object.keys(b.bySeed).length) out.byVersion[String(RULES_VERSION)] = b; }
  write(K.bests, out);
  try { localStorage.removeItem(K.bestsLegacy); } catch { /* ignore */ }
  return out;
}
/** The current rules version's bests (or another version's when asked). */
export const loadBests = (version: number = RULES_VERSION): Bests => loadBestsAll().byVersion[String(version)] ?? emptyBests();
/** Bests kept under other rules versions (newest version first), for the title's archived block. */
export const loadArchivedBests = (): { version: number; bests: Bests }[] => Object.entries(loadBestsAll().byVersion).filter(([k, b]) => Number(k) !== RULES_VERSION && (b.overall || b.runs > 0)).map(([k, bests]) => ({ version: Number(k), bests })).sort((a, b) => b.version - a.version);
/** Records a finished run locally under `version` (the current rules by default). Returns which records were beaten. */
export function recordBest(seed: string, score: number, version: number = RULES_VERSION): { newOverall: boolean; newSeed: boolean } {
  const all = loadBestsAll();
  const b = all.byVersion[String(version)] ?? emptyBests();
  const at = new Date().toISOString();
  const newSeed = !own(b.bySeed, seed) || score > b.bySeed[seed].score;
  if (newSeed) b.bySeed[seed] = { score, at };
  const newOverall = !b.overall || score > b.overall.score;
  if (newOverall) b.overall = { score, seed, at };
  b.runs++;
  all.byVersion[String(version)] = b;
  write(K.bests, all);
  return { newOverall, newSeed };
}

/** Display name sent with verified submissions (shown publicly on boards). Empty until the player chooses one. */
export const loadPlayer = (): string => { try { return cleanPlayer(localStorage.getItem(K.player)); } catch { return ''; } };
export const savePlayer = (name: string) => { try { const n = cleanPlayer(name); if (n) localStorage.setItem(K.player, n); else localStorage.removeItem(K.player); } catch { /* ignore */ } };

/** Every version's submissions; migrates the pre-0.5.0 key once. */
export function loadSubmissionsAll(): SubmissionsByVersion {
  const cur = validateSubmissionsByVersion(readRaw(K.submissions));
  if (cur) return cur;
  const legacy = readRaw(K.submissionsLegacy);
  const out: SubmissionsByVersion = { byVersion: dict() };
  if (legacy !== undefined) { const s = validateSubmissions(legacy); if (Object.keys(s).length) out.byVersion[String(RULES_VERSION)] = s; }
  write(K.submissions, out);
  try { localStorage.removeItem(K.submissionsLegacy); } catch { /* ignore */ }
  return out;
}
/** Verified submissions this device made under the current rules, by seed: lets the title screen look up its own rank without trusting names. */
export const loadSubmissions = (version: number = RULES_VERSION): Record<string, Submission> => loadSubmissionsAll().byVersion[String(version)] ?? dict<Submission>();
export const recordSubmission = (seed: string, s: Submission, version: number = RULES_VERSION) => { const all = loadSubmissionsAll(); const cur = all.byVersion[String(version)] ?? dict<Submission>(); if (!own(cur, seed) || s.score >= cur[seed].score) { cur[seed] = s; all.byVersion[String(version)] = cur; write(K.submissions, all); } };

/** Opt-in funnel state (PLAN-v1 0.3.7): the random install id, once-per-install events already sent, games started. Exists only while consent is on. */
export interface TelemetryState { installId: string | null; firsts: string[]; games: number; /** unsent events, so a page navigation never loses a batch */ pending: unknown[] }
export const loadTelemetryState = (): TelemetryState => {
  const raw = readRaw(K.telemetry);
  if (!isObj(raw)) return { installId: null, firsts: [], games: 0, pending: [] };
  return { pending: Array.isArray(raw.pending) ? raw.pending.slice(0, 200) : [], installId: typeof raw.installId === 'string' && /^[0-9a-f]{32}$/.test(raw.installId) ? raw.installId : null, firsts: Array.isArray(raw.firsts) ? raw.firsts.filter((x): x is string => typeof x === 'string') : [], games: isFiniteNum(raw.games) && raw.games >= 0 ? Math.floor(raw.games) : 0 };
};
export const saveTelemetryState = (s: TelemetryState) => write(K.telemetry, s);
export const clearTelemetryState = () => { try { localStorage.removeItem(K.telemetry); } catch { /* ignore */ } };

/** UTC dates with at least one finished run on this device (PLAN-v1 0.4.3 share line; the streak of 0.6.4 builds on it). Bounded, validated. */
export const loadDaysPlayed = (): string[] => { const raw = readRaw(K.days); return Array.isArray(raw) ? raw.filter((x): x is string => typeof x === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(x)).slice(-400) : []; };
export const recordDayPlayed = (now = new Date()): number => { const d = now.toISOString().slice(0, 10); const all = loadDaysPlayed(); if (!all.includes(d)) { all.push(d); write(K.days, all.slice(-400)); } return all.length; };
export const daysPlayed = (): number => loadDaysPlayed().length;

/** Tips the player has opened (PLAN-v1 0.3.6); anything but an array of strings reads as none. */
export const loadReadTips = (): string[] => { const raw = readRaw(K.tips); return Array.isArray(raw) ? raw.filter((x): x is string => typeof x === 'string') : []; };
export const markTipRead = (id: string) => { const all = loadReadTips(); if (!all.includes(id)) { all.push(id); write(K.tips, all); } };

export const isOnboarded = () => { try { return localStorage.getItem(K.onboarded) === '1'; } catch { return true; } };
export const setOnboarded = () => { try { localStorage.setItem(K.onboarded, '1'); } catch { /* ignore */ } };

export function randomSeed(): string {
  const words = ['rust', 'bolt', 'gear', 'weld', 'spark', 'scrap', 'ingot', 'belt', 'crate', 'forge', 'piston', 'rivet'];
  return `${words[Math.floor(Math.random() * words.length)]}-${words[Math.floor(Math.random() * words.length)]}-${Math.floor(Math.random() * 900 + 100)}`;
}
