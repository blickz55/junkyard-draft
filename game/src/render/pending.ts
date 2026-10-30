/**
 * Submissions that could not reach the verifier (production roadmap 0.8.7). When the results screen's "Submit" finds no
 * connection, the replay is kept on the device (`storage.savePending`); the title screen calls `flushPending` on every
 * load and reports what became of each saved run. A run that verified is recorded exactly as a live submission would be
 * (the device's submission record, the daily streak); a refused one is dropped (it would never verify); an unreachable or
 * busy verifier keeps it for the next load. The device key goes along as on a live submission, so the entry is the
 * player's own and keep-best applies.
 */
import { authHeaders } from './identity';
import { recordSubmission, recordDailyDate, loadPending, removePending, type PendingSubmission } from './storage';
import { isMintedDailySeed, dailyDateOf } from '../sim/daily';
import { groupHeaders, groupParam } from './groups';
import type { Rank } from './share';
import { telemetry } from './telemetry';
import { t } from '../content/strings';
import { money, int } from '../content/format';

export type FlushStatus = 'verified' | 'late' | 'keep-best' | 'rejected' | 'offline' | 'busy';
export interface FlushOutcome { seed: string; savedAt: string; status: FlushStatus; score?: number; rank?: Rank | null; player?: string; error?: string; closesAt?: string }

/** Try every saved submission once, oldest first; resolves with one outcome per saved run (kept ones say so). */
export async function flushPending(verifierUrl: string, fetchFn: typeof fetch = fetch): Promise<FlushOutcome[]> {
  const out: FlushOutcome[] = [];
  for (const p of loadPending()) out.push(await flushOne(verifierUrl, p, fetchFn));
  return out;
}

async function flushOne(verifierUrl: string, p: PendingSubmission, fetchFn: typeof fetch): Promise<FlushOutcome> {
  const base = { seed: p.seed, savedAt: p.savedAt };
  let body: { ok: boolean; score?: number; error?: string; entry?: { replayHash: string; verifiedAt: string; score?: number }; recorded?: boolean; player?: string; late?: boolean; closesAt?: string };
  let status: number;
  try {
    const res = await fetchFn(`${verifierUrl}/verify`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeaders(verifierUrl) }, body: JSON.stringify({ replay: p.replay, player: p.player || 'anonymous' }) });
    status = res.status; body = await res.json() as typeof body;
  } catch { return { ...base, status: 'offline' }; }
  if (status === 503 || status === 429) return { ...base, status: 'busy', error: body.error };
  if (body.ok && isMintedDailySeed(p.seed)) { const dd = dailyDateOf(p.seed); if (dd && !body.late) recordDailyDate(dd); } // a verified daily counts for the streak by its date, late ones not (PLAN-v3 0.6.3)
  if (body.ok && body.late) { removePending(p.seed, p.savedAt); telemetry.track('daily_submit_result', { result: 'late' }); return { ...base, status: 'late', score: body.score, closesAt: body.closesAt }; }
  if (!body.ok || !body.entry) { removePending(p.seed, p.savedAt); telemetry.track('daily_submit_result', { result: 'rejected' }); return { ...base, status: 'rejected', error: body.error ?? 'rejected' }; }
  const player = body.player || p.player;
  if (body.recorded === false) { removePending(p.seed, p.savedAt); telemetry.track('daily_submit_result', { result: 'verified' }); return { ...base, status: 'keep-best', score: body.score, player }; }
  recordSubmission(p.seed, { score: body.score ?? p.replay.claimedScore, replayHash: body.entry.replayHash, verifiedAt: body.entry.verifiedAt, player });
  removePending(p.seed, p.savedAt);
  telemetry.track('daily_submit_result', { result: 'verified' });
  let rank: Rank | null = null;
  try {
    const res = await fetchFn(`${verifierUrl}/board?seed=${encodeURIComponent(p.seed)}&limit=100${groupParam(verifierUrl)}`, { headers: groupHeaders(verifierUrl) });
    const b = await res.json() as { entries: { replayHash: string }[] };
    const i = b.entries.findIndex((e) => e.replayHash === body.entry!.replayHash);
    rank = { n: i >= 0 ? i + 1 : null, of: b.entries.length };
  } catch { /* the rank is decoration; the verification is recorded */ }
  return { ...base, status: 'verified', score: body.score, rank, player };
}

/** One line for the title screen about what happened to the saved games; '' when there is nothing to say. */
export function describeOutcomes(outcomes: FlushOutcome[]): string {
  if (!outcomes.length) return '';
  const short = (seed: string) => (seed.length > 26 ? `${seed.slice(0, 24)}…` : seed);
  const parts = outcomes.map((o) => {
    switch (o.status) {
      case 'verified': return t('pending.checked', { seed: short(o.seed), score: money(o.score ?? 0), rank: o.rank ? t('pending.rankSuffix', { rank: o.rank.n != null ? t('common.rankOf', { n: int(o.rank.n), of: int(o.rank.of) }) : t('common.beyondTop', { of: int(o.rank.of) }) }) : '', player: o.player ? t('pending.asSuffix', { player: o.player }) : '' });
      case 'keep-best': return t('pending.keepBest', { seed: short(o.seed), score: money(o.score ?? 0) });
      case 'late': return t('pending.late', { seed: short(o.seed), score: money(o.score ?? 0) });
      case 'rejected': return t('pending.rejected', { seed: short(o.seed), error: o.error ?? '' });
      case 'busy': return t('pending.busy', { seed: short(o.seed) });
      default: return t('pending.offline', { seed: short(o.seed) });
    }
  });
  return `${parts.map((p, i) => (i === 0 ? p.charAt(0).toUpperCase() + p.slice(1) : p)).join('. ')}.`;
}
