// Fetch a verified replay from the verifier by hash, re-verify it locally, and hand it to the Game scene
// as a labelled playback. The client never trusts the server's score either: the replay must re-simulate
// to the stated score here before it plays.
import Phaser from 'phaser';
import { REPLAY_FORMAT, verifyReplay } from '../sim/replay';
import type { Action } from '../sim/run';

export interface VerifiedReplay { hash: string; seed: string; player: string; score: number; rulesVersion: number; actions: Action[]; verifiedAt: string }

export async function fetchVerifiedReplay(url: string, hash: string): Promise<VerifiedReplay> {
  const res = await fetch(`${url}/replay?hash=${encodeURIComponent(hash)}`);
  if (!res.ok) throw new Error(`replay ${hash} not available (${res.status})`);
  const r = await res.json() as VerifiedReplay & { ok: boolean };
  const v = verifyReplay({ format: REPLAY_FORMAT, rulesVersion: r.rulesVersion, seed: r.seed, actions: r.actions, claimedScore: r.score, createdAt: r.verifiedAt });
  if (!v.ok) throw new Error(`replay ${hash} failed local re-verification: ${v.error ?? `score ${v.score} ≠ ${r.score}`}`);
  return r;
}

export const replayLabel = (r: Pick<VerifiedReplay, 'player' | 'score'>) => `verified replay by ${r.player} ($${r.score})`;

/** Start playback. Playback never records bests or submits (the Game/Results scenes check `replay`). */
export function playVerifiedReplay(scene: Phaser.Scene, r: VerifiedReplay) {
  scene.scene.start('Game', { seed: r.seed, fresh: true, replay: r.actions, replayLabel: replayLabel(r) });
}
