// Fetch a verified replay from the verifier by hash, re-verify it locally, and hand it to the Game scene
// as a labelled playback. The client never trusts the server's score either: the replay must re-simulate
// to the stated score here before it plays.
import Phaser from 'phaser';
import { withArt } from '../ui/opening';
import { t } from '../content/strings';
import { money } from '../content/format';
import { REPLAY_FORMAT, validateReplayFile, verifyReplay } from '../sim/replay';
import { authHeaders } from './identity';
import type { Action } from '../sim/run';
import type { ReportReason } from '../identity/identity';

export interface VerifiedReplay {
  hash: string;
  seed: string;
  player: string;
  score: number;
  rulesVersion: number;
  actions: Action[];
  verifiedAt: string;
}

export async function fetchVerifiedReplay(url: string, hash: string, seed?: string): Promise<VerifiedReplay> {
  const res = await fetch(`${url}/replay?hash=${encodeURIComponent(hash)}${seed ? `&seed=${encodeURIComponent(seed)}` : ''}`, { headers: authHeaders(url) }); // the bearer lets the verifier see this player's own entry on an open daily (PLAN-v3 0.6.6)
  if (res.status === 403) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error || t('recording.notRevealed'));
  }
  if (res.status === 404) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error || t('recording.notAvailable', { hash: hash.slice(0, 8), status: 404 }));
  }
  if (!res.ok) throw new Error(t('recording.notAvailable', { hash: hash.slice(0, 8), status: res.status }));
  const raw = (await res.json()) as Partial<VerifiedReplay> & { ok?: boolean };
  // the server's JSON goes through the same structural validation as a pasted replay file before anything trusts it
  const file = validateReplayFile({
    format: REPLAY_FORMAT,
    rulesVersion: raw.rulesVersion,
    seed: raw.seed,
    actions: raw.actions,
    claimedScore: raw.score,
    createdAt: raw.verifiedAt,
  });
  const v = verifyReplay(file);
  if (!v.ok)
    throw new Error(
      t('recording.failedCheck', { hash: hash.slice(0, 8), error: v.error ?? t('recording.scoreMismatch', { score: v.score, claimed: file.claimedScore }) }),
    );
  const player = typeof raw.player === 'string' ? raw.player.slice(0, 32) : t('recording.unknownPlayer');
  return { hash, seed: file.seed, player, score: file.claimedScore, rulesVersion: file.rulesVersion, actions: file.actions, verifiedAt: file.createdAt };
}

/** Report the name behind a verified replay (PLAN-v4 0.7.7): the verifier hides it as "player" pending review. Resolves with one line for the player. */
export async function reportName(url: string, hash: string, reason: ReportReason): Promise<string> {
  try {
    const res = await fetch(`${url}/report`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders(url) },
      body: JSON.stringify({ hash, reason }),
    });
    const body = (await res.json()) as { ok: boolean; hidden?: boolean; duplicate?: boolean; error?: string };
    if (res.status === 401) return t('report.needsKey');
    if (!res.ok || !body.ok) return t('report.notTaken', { error: body.error ?? res.status });
    if (body.duplicate) return t('report.already');
    return body.hidden ? t('report.hidden') : body.duplicate ? t('report.already') : t('report.recorded');
  } catch {
    return t('report.noAnswer');
  }
}
export const replayLabel = (r: Pick<VerifiedReplay, 'player' | 'score'>) => t('recording.label', { player: r.player, score: money(r.score) });

/** Start playback. Playback never records bests or submits (the Game/Results scenes check `replay`). */
export function playVerifiedReplay(scene: Phaser.Scene, r: VerifiedReplay) {
  withArt(scene, () =>
    scene.scene.start('Game', { seed: r.seed, fresh: true, replay: r.actions, replayLabel: replayLabel(r), replayHash: r.hash, replayPlayer: r.player }),
  );
}
