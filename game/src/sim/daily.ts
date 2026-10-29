// Daily challenge seeds. Pure and browser-free so the client and the verifier agree on the formats.
// Two kinds (PLAN-v3 0.6.1):
//   - the practice seed `daily-YYYY-MM-DD`: derivable by anyone from the UTC date; unranked, works offline;
//   - the minted seed `daily-YYYY-MM-DD-xxxxxxxx`: the verifier derives the 8 base32 characters from a server secret
//     (HMAC-SHA256(secret, date)) and publishes the seed only once the day has opened, together with a commitment
//     (SHA-256) to the next day's seed; it is the ranked daily. Only the verifier can mint; the client only recognises.

export const DAILY_PREFIX = 'daily-';

export function dailySeedFor(date: Date): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  return `${DAILY_PREFIX}${y}-${m}-${d}`;
}

/** The practice seed for now (unranked; what the client plays when no verifier minted today's seed). */
export const dailySeed = (): string => dailySeedFor(new Date());

/** The practice format. */
export const isDailySeed = (seed: string): boolean => /^daily-\d{4}-\d{2}-\d{2}$/.test(seed);

/** The minted (ranked) format: date plus 8 lower-case base32 characters. */
export const MINTED_DAILY = /^daily-(\d{4}-\d{2}-\d{2})-([a-z2-7]{8})$/;
export const isMintedDailySeed = (seed: string): boolean => MINTED_DAILY.test(seed);
/** The UTC date a daily seed (either format) is for; null for any other seed. */
export function dailyDateOf(seed: string): string | null {
  const m = MINTED_DAILY.exec(seed); if (m) return m[1];
  return isDailySeed(seed) ? seed.slice(DAILY_PREFIX.length) : null;
}
