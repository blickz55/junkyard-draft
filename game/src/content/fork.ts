/** The label of a try (a fork of someone's recording, PLAN-v4 0.7.3) as the player reads it (0.9.0). */
import type { ForkOrigin } from '../sim/run';
import { t } from './strings';

export const forkLabel = (f: ForkOrigin): string => t('recording.tryLabel', { player: f.player, round: f.round });
