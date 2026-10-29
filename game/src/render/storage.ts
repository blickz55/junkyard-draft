import { isValidSeed, validateAction, type Action } from '../sim/run';
import { RULES_VERSION } from '../sim/types';
import { dailySeed } from '../sim/daily';
import { cleanPlayer } from './share';

export { dailySeed };

const K = { settings: 'jd.settings.v1', save: 'jd.save.v1', bests: 'jd.bests.v1', onboarded: 'jd.onboarded.v1', player: 'jd.player', submissions: 'jd.submissions.v1', tips: 'jd.tips.v1' };

export type RenderQuality = 'auto' | 'high' | 'low';
/** renderQuality: 'auto' until the first run measures frame times at high resolution, then 'high' or 'low' (DPR 1); the title button sets it too. */
export interface Settings { volume: number; muted: boolean; reducedMotion: boolean; textScale: number; renderQuality: RenderQuality }
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
  };
}
export function validateSave(raw: unknown): SaveGame | null {
  if (!isObj(raw)) return null;
  if (!Number.isInteger(raw.rulesVersion) || !isValidSeed(raw.seed) || !Array.isArray(raw.actions) || !raw.actions.every(validateAction)) return null;
  return { rulesVersion: raw.rulesVersion as number, seed: raw.seed, actions: raw.actions as Action[], savedAt: isStr(raw.savedAt) ? raw.savedAt : '' };
}
export function validateBests(raw: unknown): Bests {
  const out: Bests = { overall: null, bySeed: {}, runs: 0 };
  if (!isObj(raw)) return out;
  if (isObj(raw.overall) && isFiniteNum(raw.overall.score) && isStr(raw.overall.seed)) out.overall = { score: raw.overall.score, seed: raw.overall.seed, at: isStr(raw.overall.at) ? raw.overall.at : '' };
  if (isObj(raw.bySeed)) for (const [seed, v] of Object.entries(raw.bySeed)) if (isObj(v) && isFiniteNum(v.score)) out.bySeed[seed] = { score: v.score, at: isStr(v.at) ? v.at : '' };
  if (Number.isInteger(raw.runs) && (raw.runs as number) >= 0) out.runs = raw.runs as number;
  return out;
}
export function validateSubmissions(raw: unknown): Record<string, Submission> {
  const out: Record<string, Submission> = {};
  if (!isObj(raw)) return out;
  for (const [seed, v] of Object.entries(raw)) if (isObj(v) && isFiniteNum(v.score) && isStr(v.replayHash)) out[seed] = { score: v.score, replayHash: v.replayHash, verifiedAt: isStr(v.verifiedAt) ? v.verifiedAt : '', player: isStr(v.player) ? v.player : '' };
  return out;
}

/** Parse a key; a missing key, unparsable JSON or storage access failure yields `undefined` for the validator to turn into a fallback. */
function readRaw(key: string): unknown {
  try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : undefined; } catch { return undefined; }
}
function write(key: string, value: unknown) { try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage unavailable */ } }

export const loadSettings = (): Settings => validateSettings(readRaw(K.settings), { volume: 0.7, muted: false, reducedMotion: systemReducedMotion(), textScale: 1, renderQuality: 'auto' });
export const saveSettings = (s: Settings) => write(K.settings, s);
/** Read-modify-write so audio and accessibility settings never clobber each other. */
export const updateSettings = (p: Partial<Settings>): Settings => { const s = { ...loadSettings(), ...p }; saveSettings(s); return s; };

/** The saved run, or null when there is none, it is damaged, or it belongs to another rules version. */
export const loadSave = (): SaveGame | null => { const s = validateSave(readRaw(K.save)); return s && s.rulesVersion === RULES_VERSION ? s : null; };
/** True when a save key exists but cannot be used (lets the UI explain the reset instead of silently starting over). */
export const hasUnusableSave = (): boolean => { try { return localStorage.getItem(K.save) != null && loadSave() == null; } catch { return false; } };
export const writeSave = (seed: string, actions: Action[]) => write(K.save, { rulesVersion: RULES_VERSION, seed, actions, savedAt: new Date().toISOString() } satisfies SaveGame);
export const clearSave = () => { try { localStorage.removeItem(K.save); } catch { /* ignore */ } };

export const loadBests = (): Bests => validateBests(readRaw(K.bests));
/** Records a finished run locally. Returns which records were beaten. */
export function recordBest(seed: string, score: number): { newOverall: boolean; newSeed: boolean } {
  const b = loadBests();
  const at = new Date().toISOString();
  const newSeed = !b.bySeed[seed] || score > b.bySeed[seed].score;
  if (newSeed) b.bySeed[seed] = { score, at };
  const newOverall = !b.overall || score > b.overall.score;
  if (newOverall) b.overall = { score, seed, at };
  b.runs++;
  write(K.bests, b);
  return { newOverall, newSeed };
}

/** Display name sent with verified submissions (shown publicly on boards). Empty until the player chooses one. */
export const loadPlayer = (): string => { try { return cleanPlayer(localStorage.getItem(K.player)); } catch { return ''; } };
export const savePlayer = (name: string) => { try { const n = cleanPlayer(name); if (n) localStorage.setItem(K.player, n); else localStorage.removeItem(K.player); } catch { /* ignore */ } };

/** Verified submissions this device made, by seed: lets the title screen look up its own rank without trusting names. */
export const loadSubmissions = (): Record<string, Submission> => validateSubmissions(readRaw(K.submissions));
export const recordSubmission = (seed: string, s: Submission) => { const all = loadSubmissions(); if (!all[seed] || s.score >= all[seed].score) { all[seed] = s; write(K.submissions, all); } };

/** Tips the player has opened (PLAN-v1 0.3.6); anything but an array of strings reads as none. */
export const loadReadTips = (): string[] => { const raw = readRaw(K.tips); return Array.isArray(raw) ? raw.filter((x): x is string => typeof x === 'string') : []; };
export const markTipRead = (id: string) => { const all = loadReadTips(); if (!all.includes(id)) { all.push(id); write(K.tips, all); } };

export const isOnboarded = () => { try { return localStorage.getItem(K.onboarded) === '1'; } catch { return true; } };
export const setOnboarded = () => { try { localStorage.setItem(K.onboarded, '1'); } catch { /* ignore */ } };

export function randomSeed(): string {
  const words = ['rust', 'bolt', 'gear', 'weld', 'spark', 'scrap', 'ingot', 'belt', 'crate', 'forge', 'piston', 'rivet'];
  return `${words[Math.floor(Math.random() * words.length)]}-${words[Math.floor(Math.random() * words.length)]}-${Math.floor(Math.random() * 900 + 100)}`;
}
