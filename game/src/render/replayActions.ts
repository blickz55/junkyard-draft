/**
 * What a watched recording offers (production roadmap 0.9.4, extracted from GameScene): continuing it as a practice try
 * (PLAN-v4 0.7.3) and reporting its player's name (PLAN-v4 0.7.7).
 */
import type Phaser from 'phaser';
import type { Action, RunState } from '../sim/run';
import { RULES } from '../sim/rules';
import { t } from '../content/strings';
import { dialog, alertText } from '../ui/dom';
import { reportName } from './verified';
import { verifierUrl as resolveVerifierUrl } from './config';
import { REPORT_REASONS } from '../identity/identity';

/** The watched replay's identity, so a try can name its origin. */
export interface ReplayOrigin {
  hash: string | null;
  player: string;
  actions: Action[];
}

/** The Game scene's data for a try from after the round just finished; null when nothing was watched, no round is done yet, or the game is over. */
export function forkPayload(run: RunState, origin: ReplayOrigin | null) {
  const n = run.rounds.length;
  if (!origin || n < 1 || n >= RULES.rounds) return null;
  return { seed: run.seed, fresh: false, fork: { origin: { hash: origin.hash, player: origin.player }, actions: origin.actions, round: n } };
}

/** Report the watched replay's player name: one reason from the fixed list, no free text; the server's answer in a dialog. */
export function reportPlayer(scene: Phaser.Scene, origin: ReplayOrigin) {
  const hash = origin.hash;
  if (!hash) return;
  const verifierUrl = resolveVerifierUrl();
  void dialog(scene, {
    title: t('report.title', { player: origin.player }),
    label: t('report.label'),
    value: '',
    readonly: true,
    ok: t('common.closeShort'),
    cancel: null,
    extra: REPORT_REASONS.map((reason) => ({
      label: reason,
      tid: `report-${reason}`,
      onClick: () => {
        void reportName(verifierUrl, hash, reason).then((line) => alertText(scene, t('report.result'), line));
      },
    })),
  });
}
