/**
 * The fairness policy, the legal texts and a division's board are long or rarely opened, so they load on first use as chunks of
 * their own instead of weighing on every first visit. The service worker caches the chunks with the rest of the build, so they still open offline.
 */
import type Phaser from 'phaser';
import { alertText } from './dom';
import { t } from '../content/strings';

function opening<M>(scene: Phaser.Scene, load: () => Promise<M>, open: (m: M) => void) {
  load().then(open, () => void alertText(scene, t('common.cantOpenTitle'), t('common.cantOpen')));
}
export const openPolicy = (scene: Phaser.Scene) =>
  opening(
    scene,
    () => import('./PolicyPanel'),
    (m) => m.openPolicy(scene),
  );
export const openPrivacy = (...args: Parameters<typeof import('./PrivacyPanel').openPrivacy>) =>
  opening(
    args[0],
    () => import('./PrivacyPanel'),
    (m) => m.openPrivacy(...args),
  );
export const openDivision = (...args: Parameters<typeof import('./DivisionPanel').openDivision>) =>
  opening(
    args[0],
    () => import('./DivisionPanel'),
    (m) => m.openDivision(...args),
  );
