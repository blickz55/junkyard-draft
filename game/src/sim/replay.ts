import { MAX_REPLAY_ACTIONS, MAX_SEED_LENGTH, replay, validateAction, type Action, type RunState } from './run';
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

/** The same action with its fields in canonical order (`t` first), so two equal actions serialise identically whatever key order they arrived in (review F03). */
export function canonicalAction(a: Action): Action {
  switch (a.t) {
    case 'pick': return { t: 'pick', i: a.i };
    case 'place': return { t: 'place', id: a.id, x: a.x, y: a.y, dir: a.dir };
    case 'rotate': return { t: 'rotate', id: a.id };
    case 'unplace': return { t: 'unplace', id: a.id };
    case 'sell': return { t: 'sell', id: a.id };
    case 'run': return { t: 'run' };
    case 'next': return { t: 'next' };
  }
}

/**
 * Structural validation shared by every replay entry point (files pasted by the player, verifier
 * submissions, replays fetched from the verifier). Returns the same object narrowed to ReplayFile or throws.
 * The rules version must be present and an integer; whether it is the *current* version is decided by
 * verifyReplay / the verifier, so the error message can say which version it was.
 */
export function validateReplayFile(raw: unknown): ReplayFile {
  if (!raw || typeof raw !== 'object') throw new Error('malformed replay');
  const r = raw as Record<string, unknown>;
  if (r.format !== REPLAY_FORMAT) throw new Error(`unsupported replay format ${String(r.format)}`);
  if (typeof r.seed !== 'string' || !r.seed.length || r.seed.length > MAX_SEED_LENGTH) throw new Error('malformed replay: bad seed');
  if (!Number.isInteger(r.rulesVersion)) throw new Error('malformed replay: missing rules version');
  if (!Array.isArray(r.actions)) throw new Error('malformed replay: actions');
  if (typeof r.claimedScore !== 'number' || !Number.isFinite(r.claimedScore)) throw new Error('malformed replay: claimed score');
  if (r.actions.length > MAX_REPLAY_ACTIONS) throw new Error('replay too long');
  if (!r.actions.every(validateAction)) throw new Error('replay contains a malformed action');
  return { format: REPLAY_FORMAT, rulesVersion: r.rulesVersion as number, seed: r.seed, actions: (r.actions as Action[]).map(canonicalAction), claimedScore: r.claimedScore, createdAt: typeof r.createdAt === 'string' ? r.createdAt : '', build: typeof r.build === 'string' ? r.build : undefined };
}

export function decodeReplay(text: string): ReplayFile {
  return validateReplayFile(JSON.parse(text));
}

export interface VerifyResult { ok: boolean; score: number; claimed: number; finished: boolean; error?: string }

/** Re-simulates a replay. ok is true only if the rules version is explicit and current, every action was legal and the score matches the claim. */
export function verifyReplay(r: ReplayFile): VerifyResult {
  try {
    if (!Number.isInteger(r.rulesVersion)) throw new Error('rules version missing');
    if (r.rulesVersion !== RULES_VERSION) throw new Error(`rules version ${r.rulesVersion} unsupported (have ${RULES_VERSION})`);
    const s = replay(r.seed, r.actions, r.rulesVersion);
    return { ok: s.score === r.claimedScore && s.phase === 'finished', score: s.score, claimed: r.claimedScore, finished: s.phase === 'finished' };
  } catch (e) {
    return { ok: false, score: 0, claimed: r.claimedScore, finished: false, error: (e as Error).message };
  }
}
