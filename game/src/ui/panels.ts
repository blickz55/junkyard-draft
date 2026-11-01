/**
 * The fairness policy, the legal texts, a division's board, the inbox, friends, the day's talk and email sign-in are long or rarely opened,
 * so they load on first use, all together, instead of weighing on every first visit. One chunk on purpose: each separate import()
 * cuts what it shares with the game into small files of its own, and a first visit pays for every one of those. The two long texts
 * come apart from it with an import() of their own, which shares nothing. The service worker caches the chunks with the rest of the
 * build, so they still open offline.
 */
import type Phaser from 'phaser';
import { alertText } from './dom';
import { t } from '../content/strings';

type Panels = typeof import('./lazy');
function opening(scene: Phaser.Scene, open: (m: Panels) => unknown) {
  import('./lazy').then(open).catch(() => void alertText(scene, t('common.cantOpenTitle'), t('common.cantOpen')));
}
export const openPolicy = (scene: Phaser.Scene) => opening(scene, (m) => m.openPolicy(scene));
export const openPrivacy = (...args: Parameters<Panels['openPrivacy']>) => opening(args[0], (m) => m.openPrivacy(...args));
export const openDivision = (...args: Parameters<Panels['openDivision']>) => opening(args[0], (m) => m.openDivision(...args));
export const openInbox = (...args: Parameters<Panels['openInbox']>) => opening(args[0], (m) => m.openInbox(...args));
export const openThread = (...args: Parameters<Panels['openThread']>) => opening(args[0], (m) => m.openThread(...args));
export const openHub = (...args: Parameters<Panels['openHub']>) => opening(args[0], (m) => m.openHub(...args));
export const openPlayerCard = (...args: Parameters<Panels['openPlayerCard']>) => opening(args[0], (m) => m.openPlayerCard(...args));
export const openPaint = (...args: Parameters<Panels['openPaint']>) => opening(args[0], (m) => m.openPaint(...args));
export const openKeys = (...args: Parameters<Panels['openKeys']>) => opening(args[0], (m) => m.openKeys(...args));
export const openSettings = (...args: Parameters<Panels['openSettings']>) => opening(args[0], (m) => m.openSettings(...args));
export const openRecord = (...args: Parameters<Panels['openRecord']>) => opening(args[0], (m) => m.openRecord(...args));
export const openGroups = (...args: Parameters<Panels['openGroups']>) => opening(args[0], (m) => m.openGroups(...args));
export const openArchive = (...args: Parameters<Panels['openArchive']>) => opening(args[0], (m) => m.openArchive(...args));
export const openReminder = (...args: Parameters<Panels['openReminder']>) => opening(args[0], (m) => m.openReminder(...args));
export const openFriends = (...args: Parameters<Panels['openFriends']>) => opening(args[0], (m) => m.openFriends(...args));
export const openMessages = (...args: Parameters<Panels['openMessages']>) => opening(args[0], (m) => m.openMessages(...args));
export const openEmailLink = (...args: Parameters<Panels['openEmailLink']>) => opening(args[0], (m) => m.openEmailLink(...args));
export const openLinkLanding = (...args: Parameters<Panels['openLinkLanding']>) => opening(args[0], (m) => m.openLinkLanding(...args));
