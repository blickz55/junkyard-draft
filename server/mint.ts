/**
 * Minting the daily seed (PLAN-v3 0.6.1), the pure, Node-only part shared by the verifier, the rehearsal script and
 * `tools/mint-check.ts`:
 *   seed(date) = "daily-" + date + "-" + base32(HMAC-SHA256(secret, date))[0:8]
 *   commitment(date) = SHA-256(seed(date + 1 day)) hex, published with day `date` so the next seed is provably fixed
 *   before anyone can play it. The client never sees the secret; it recognises the format (game/src/sim/daily.ts).
 */
import { createHash, createHmac } from 'node:crypto';
import { isWeekId } from '../game/src/sim/weekly';

/** How long a day's seed accepts submissions after 00:00 UTC of its date (0.6.2 adds freeze and archive). */
export const DAILY_WINDOW_MS = 48 * 3_600_000;
const B32 = 'abcdefghijklmnopqrstuvwxyz234567';

export function base32Lower(bytes: Uint8Array): string {
  let bits = 0, acc = 0, out = '';
  for (const b of bytes) { acc = ((acc << 8) | b) >>> 0; bits += 8; while (bits >= 5) { bits -= 5; out += B32[(acc >>> bits) & 31]; } }
  if (bits > 0) out += B32[(acc << (5 - bits)) & 31];
  return out;
}
export const isUtcDate = (s: unknown): s is string => { if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false; const t = Date.parse(`${s}T00:00:00Z`); return Number.isFinite(t) && new Date(t).toISOString().slice(0, 10) === s; };
export const utcDate = (now: Date): string => now.toISOString().slice(0, 10);
export const dayStartMs = (date: string): number => Date.parse(`${date}T00:00:00Z`);
export const shiftDate = (date: string, days: number): string => new Date(dayStartMs(date) + days * 86_400_000).toISOString().slice(0, 10);

export function mintSeed(secret: string, date: string): string {
  if (!secret) throw new Error('daily secret required');
  if (!isUtcDate(date)) throw new Error(`bad date ${String(date)}`);
  return `daily-${date}-${base32Lower(createHmac('sha256', secret).update(date).digest()).slice(0, 8)}`;
}
export const commitmentFor = (seed: string): string => createHash('sha256').update(seed).digest('hex');
/** The weekly seed for an ISO week id (PLAN-v4 0.7.5): the same secret, a distinct domain so a daily never equals a weekly. */
export function mintWeeklySeed(secret: string, week: string): string {
  if (!secret) throw new Error('daily secret required');
  if (!isWeekId(week)) throw new Error(`bad week ${String(week)}`);
  return `weekly-${week}-${base32Lower(createHmac('sha256', secret).update(`weekly:${week}`).digest()).slice(0, 8)}`;
}
