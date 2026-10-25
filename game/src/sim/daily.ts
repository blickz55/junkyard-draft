// Daily challenge seed. Pure and browser-free so the client and the verifier agree on it.
// One seed per UTC day: everyone who plays "Today's challenge" gets identical draft offers.

export const DAILY_PREFIX = 'daily-';

export function dailySeedFor(date: Date): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  return `${DAILY_PREFIX}${y}-${m}-${d}`;
}

export const dailySeed = (): string => dailySeedFor(new Date());

export const isDailySeed = (seed: string): boolean => /^daily-\d{4}-\d{2}-\d{2}$/.test(seed);
