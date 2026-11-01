/**
 * The community hub (production roadmap 0.11.10): four fixed categories, in the order they show. Hub v1 opens with one pinned thread
 * in each, so the hub never looks dead; v2 lets players start topics once enough of them are posting. Both sides read this.
 */
export const HUB_CATEGORIES = ['strategies', 'yards', 'help', 'offshift'] as const;
export type HubCategory = (typeof HUB_CATEGORIES)[number];
export const isHubCategory = (c: unknown): c is HubCategory => (HUB_CATEGORIES as readonly unknown[]).includes(c);
/** A category's own thread, and a topic started in one. */
export const categoryKey = (c: HubCategory): string => `hub:${c}`;
export const isTopicKey = (key: string): boolean => /^topic:[0-9a-f]{12}$/.test(key);
export const categoryOf = (key: string): HubCategory | null => {
  const c = key.startsWith('hub:') ? key.slice(4) : null;
  return isHubCategory(c) ? c : null;
};
/** People posting in a week before players can start topics of their own. */
export const HUB_V2_POSTERS = 50;
/** The longest topic title. */
export const TOPIC_TITLE_MAX = 80;
