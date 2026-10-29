// Fetch a verified replay from the verifier by hash, re-verify it locally, and hand it to the Game scene
// as a labelled playback. The client never trusts the server's score either: the replay must re-simulate
// to the stated score here before it plays.
import Phaser from 'phaser';
import { REPLAY_FORMAT, validateReplayFile, verifyReplay } from '../sim/replay';
import { authHeaders } from './identity';
import type { Action } from '../sim/run';

export interface VerifiedReplay { hash: string; seed: string; player: string; score: number; rulesVersion: number; actions: Action[]; verifiedAt: string }

export async function fetchVerifiedReplay(url: string, hash: string, seed?: string): Promise<VerifiedReplay> {
  const res = await fetch(`${url}/replay?hash=${encodeURIComponent(hash)}${seed ? `&seed=${encodeURIComponent(seed)}` : ''}`, { headers: authHeaders(url) }); // the bearer lets the verifier see this player's own entry on an open daily (PLAN-v3 0.6.6)
  if (res.status === 403) { const body = await res.json().catch(() => ({})) as { error?: string }; throw new Error(body.error || 'this replay is not revealed yet'); }
  if (res.status === 404) { const body = await res.json().catch(() => ({})) as { error?: string }; throw new Error(body.error || `replay ${hash} not available (404)`); }
  if (!res.ok) throw new Error(`replay ${hash} not available (${res.status})`);
  const raw = await res.json() as Partial<VerifiedReplay> & { ok?: boolean };
  // the server's JSON goes through the same structural validation as a pasted replay file before anything trusts it
  const file = validateReplayFile({ format: REPLAY_FORMAT, rulesVersion: raw.rulesVersion, seed: raw.seed, actions: raw.actions, claimedScore: raw.score, createdAt: raw.verifiedAt });
  const v = verifyReplay(file);
  if (!v.ok) throw new Error(`replay ${hash} failed local re-verification: ${v.error ?? `score ${v.score} ≠ ${file.claimedScore}`}`);
  const player = typeof raw.player === 'string' ? raw.player.slice(0, 32) : 'unknown';
  return { hash, seed: file.seed, player, score: file.claimedScore, rulesVersion: file.rulesVersion, actions: file.actions, verifiedAt: file.createdAt };
}

export const replayLabel = (r: Pick<VerifiedReplay, 'player' | 'score'>) => `verified replay by ${r.player} ($${r.score})`;

/** Start playback. Playback never records bests or submits (the Game/Results scenes check `replay`). */
export function playVerifiedReplay(scene: Phaser.Scene, r: VerifiedReplay) {
  scene.scene.start('Game', { seed: r.seed, fresh: true, replay: r.actions, replayLabel: replayLabel(r) });
}
