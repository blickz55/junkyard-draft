import type { Action } from '../sim/run';
import { RULES_VERSION } from '../sim/types';

const K = { settings: 'jd.settings.v1', save: 'jd.save.v1', bests: 'jd.bests.v1', onboarded: 'jd.onboarded.v1' };

export interface Settings { volume: number; muted: boolean }
export interface SaveGame { rulesVersion: number; seed: string; actions: Action[]; savedAt: string }
export interface Bests { overall: { score: number; seed: string; at: string } | null; bySeed: Record<string, { score: number; at: string }>; runs: number }

function read<T>(key: string, fallback: T): T {
  try { const v = localStorage.getItem(key); return v ? { ...fallback, ...JSON.parse(v) } : fallback; } catch { return fallback; }
}
function write(key: string, value: unknown) { try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage unavailable */ } }

export const loadSettings = (): Settings => read(K.settings, { volume: 0.7, muted: false });
export const saveSettings = (s: Settings) => write(K.settings, s);

export const loadSave = (): SaveGame | null => { const s = read<SaveGame | null>(K.save, null); return s && s.rulesVersion === RULES_VERSION ? s : null; };
export const writeSave = (seed: string, actions: Action[]) => write(K.save, { rulesVersion: RULES_VERSION, seed, actions, savedAt: new Date().toISOString() } satisfies SaveGame);
export const clearSave = () => { try { localStorage.removeItem(K.save); } catch { /* ignore */ } };

export const loadBests = (): Bests => read(K.bests, { overall: null, bySeed: {}, runs: 0 });
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

export const isOnboarded = () => { try { return localStorage.getItem(K.onboarded) === '1'; } catch { return true; } };
export const setOnboarded = () => { try { localStorage.setItem(K.onboarded, '1'); } catch { /* ignore */ } };

export function dailySeed(): string {
  const d = new Date();
  return `daily-${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}
export function randomSeed(): string {
  const words = ['rust', 'bolt', 'gear', 'weld', 'spark', 'scrap', 'ingot', 'belt', 'crate', 'forge', 'piston', 'rivet'];
  return `${words[Math.floor(Math.random() * words.length)]}-${words[Math.floor(Math.random() * words.length)]}-${Math.floor(Math.random() * 900 + 100)}`;
}
