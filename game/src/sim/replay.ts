import { MAX_REPLAY_ACTIONS, replay, validateAction, type Action, type RunState } from './run';
import { RULES_VERSION } from './types';

export const REPLAY_FORMAT = 1;

export interface ReplayFile {
  format: number;
  rulesVersion: number;
  seed: string;
  actions: Action[];
  /** score claimed by the client that produced the replay; must be re-derived, never trusted */
  claimedScore: number;
  createdAt: string;
  build?: string;
}

export function exportReplay(s: RunState, build?: string): ReplayFile {
  return { format: REPLAY_FORMAT, rulesVersion: s.rulesVersion, seed: s.seed, actions: s.actions.slice(), claimedScore: s.score, createdAt: new Date().toISOString(), build };
}

export function encodeReplay(r: ReplayFile): string { return JSON.stringify(r); }

export function decodeReplay(text: string): ReplayFile {
  const r = JSON.parse(text) as ReplayFile;
  if (r.format !== REPLAY_FORMAT) throw new Error(`unsupported replay format ${r.format}`);
  if (typeof r.seed !== 'string' || !Array.isArray(r.actions) || !Number.isInteger(r.rulesVersion) || typeof r.claimedScore !== 'number') throw new Error('malformed replay');
  if (r.actions.length > MAX_REPLAY_ACTIONS) throw new Error('replay too long');
  if (!r.actions.every(validateAction)) throw new Error('replay contains a malformed action');
  return r;
}

export interface VerifyResult { ok: boolean; score: number; claimed: number; finished: boolean; error?: string }

/** Re-simulates a replay. ok is true only if every action was legal and the score matches the claim. */
export function verifyReplay(r: ReplayFile): VerifyResult {
  try {
    const s = replay(r.seed, r.actions, r.rulesVersion ?? RULES_VERSION);
    return { ok: s.score === r.claimedScore && s.phase === 'finished', score: s.score, claimed: r.claimedScore, finished: s.phase === 'finished' };
  } catch (e) {
    return { ok: false, score: 0, claimed: r.claimedScore, finished: false, error: (e as Error).message };
  }
}
