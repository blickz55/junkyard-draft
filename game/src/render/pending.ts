/**
 * Submissions that could not reach the verifier (production roadmap 0.8.7). When the results screen's "Submit" finds no
 * connection, the replay is kept on the device (`storage.savePending`); the title screen calls `flushPending` on every
 * load and reports what became of each saved run. A run that verified is recorded exactly as a live submission would be
 * (the device's submission record, the daily streak); a refused one is dropped (it would never verify); an unreachable or
 * busy verifier keeps it for the next load. The device key goes along as on a live submission, so the entry is the
 * player's own and keep-best applies.
 *
 * A finished daily the player never sent (the consultant panel, 2026-11-06) is kept the same way, flagged `unsent`: the flush
 * skips it, because nothing goes on a board without the player's tap. Home offers the tap (`openUnsent`, then `sendPending`,
 * the same path a flush takes) until the game is on the board or its day has closed. It offers nothing keep-best would refuse
 * (this device's checked game on the yard ranks at least as well) and nothing on its way to our server from the results right now.
 */
import { authHeaders } from './identity';
import {
  recordSubmission,
  recordDailyDate,
  loadPending,
  loadUnsent,
  loadSubmissions,
  forgetUnsent,
  removePending,
  saveUnsent,
  loadPlayer,
  type PendingSubmission,
} from './storage';
import { isMintedDailySeed, dailyDateOf } from '../sim/daily';
import { dailyClosed } from './daily';
import { exportReplay } from '../sim/replay';
import type { RunState } from '../sim/run';
import { groupHeaders, groupParam } from './groups';
import type { Rank } from './share';
import { telemetry } from './telemetry';
import { t } from '../content/strings';
import { money, int } from '../content/format';

export type FlushStatus = 'verified' | 'late' | 'keep-best' | 'rejected' | 'offline' | 'busy';
export interface FlushOutcome {
  seed: string;
  savedAt: string;
  status: FlushStatus;
  score?: number;
  rank?: Rank | null;
  player?: string;
  error?: string;
  closesAt?: string;
}

/** Try every submission the player asked to send once, oldest first; resolves with one outcome per saved run (kept ones say so). An unsent game is never among them. */
export async function flushPending(verifierUrl: string, fetchFn: typeof fetch = fetch): Promise<FlushOutcome[]> {
  const out: FlushOutcome[] = [];
  for (const p of loadPending()) out.push(await sendPending(verifierUrl, p, fetchFn));
  return out;
}

/** This device's checked game on a yard ranks at least as well as a score: keep-best would refuse the game, so nothing offers it (review, 2026-11-06). */
const checkedStands = (seed: string, score: number): boolean => (loadSubmissions()[seed]?.score ?? -Infinity) >= score;
/** The yards whose game is on its way to our server from the results right now (review, 2026-11-06): Home, mounted before the answer, does not offer one of those. */
const onItsWay = new Set<string>();
export function sendingNow(seed: string, on: boolean): void {
  if (on) onItsWay.add(seed);
  else onItsWay.delete(seed);
}

/**
 * Keep a finished daily of the player's own that is not on the board (2026-11-06), so Home can offer it: never a recording (the caller's
 * check), a try, a yard that is no minted daily, a day already closed, or a game this device's checked one on that yard ranks at least as
 * well as (keep-best would refuse it, and the results have said the earlier game stands). The caller leaves out the tester build, where
 * nothing can be sent.
 */
export function keepUnsent(run: RunState, build?: string, origin: Pick<PendingSubmission, 'origin'> = {}, now = new Date()): void {
  if (run.forkedFrom || run.phase !== 'finished' || !isMintedDailySeed(run.seed) || dailyClosed(run.seed, now) || checkedStands(run.seed, run.score)) return;
  saveUnsent({ seed: run.seed, rulesVersion: run.rulesVersion, replay: exportReplay(run, build), player: loadPlayer(), savedAt: now.toISOString(), ...origin });
}
/**
 * The unsent games Home offers, oldest first: those whose day is still open and that no checked game of this device's on the yard already
 * ranks at least as well as. A day that closed, or a game a checked one covers, is dropped on the way: nothing can put it on the board now.
 * A game on its way from the results stays kept and is not offered until the answer is in.
 */
export function openUnsent(now = new Date()): PendingSubmission[] {
  const out: PendingSubmission[] = [];
  for (const p of loadUnsent()) {
    if (!isMintedDailySeed(p.seed) || dailyClosed(p.seed, now) || checkedStands(p.seed, p.replay.claimedScore)) forgetUnsent(p.seed);
    else if (!onItsWay.has(p.seed)) out.push(p);
  }
  return out;
}

/** One saved run to our server, with what became of it: a flush does this for each row; Home does it for an unsent game when the player taps. */
export async function sendPending(verifierUrl: string, p: PendingSubmission, fetchFn: typeof fetch = fetch): Promise<FlushOutcome> {
  const base = { seed: p.seed, savedAt: p.savedAt };
  let body: {
    ok: boolean;
    score?: number;
    error?: string;
    entry?: { replayHash: string; verifiedAt: string; score?: number };
    recorded?: boolean;
    player?: string;
    late?: boolean;
    closesAt?: string;
  };
  let status: number;
  try {
    const res = await fetchFn(`${verifierUrl}/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders(verifierUrl) },
      body: JSON.stringify({ replay: p.replay, player: p.player || 'anonymous', ...(p.origin ? { origin: p.origin } : {}) }),
    });
    status = res.status;
    body = (await res.json()) as typeof body;
  } catch {
    return { ...base, status: 'offline' };
  }
  if (status === 503 || status === 429) return { ...base, status: 'busy', error: body.error };
  if (body.ok && isMintedDailySeed(p.seed)) {
    const dd = dailyDateOf(p.seed);
    if (dd && !body.late) recordDailyDate(dd);
  } // a verified daily counts for the streak by its date, late ones not (PLAN-v3 0.6.3)
  if (body.ok && body.late) {
    removePending(p.seed, p.savedAt);
    telemetry.track('daily_submit_result', { result: 'late' });
    return { ...base, status: 'late', score: body.score, closesAt: body.closesAt };
  }
  if (!body.ok || !body.entry) {
    removePending(p.seed, p.savedAt);
    telemetry.track('daily_submit_result', { result: 'rejected' });
    return { ...base, status: 'rejected', error: body.error ?? 'rejected' };
  }
  const player = body.player || p.player;
  if (body.recorded === false) {
    removePending(p.seed, p.savedAt);
    telemetry.track('daily_submit_result', { result: 'verified' });
    return { ...base, status: 'keep-best', score: body.score, player };
  }
  recordSubmission(p.seed, { score: body.score ?? p.replay.claimedScore, replayHash: body.entry.replayHash, verifiedAt: body.entry.verifiedAt, player });
  removePending(p.seed, p.savedAt);
  telemetry.track('daily_submit_result', { result: 'verified' });
  let rank: Rank | null = null;
  try {
    const res = await fetchFn(`${verifierUrl}/board?seed=${encodeURIComponent(p.seed)}&limit=100${groupParam(verifierUrl)}`, {
      headers: groupHeaders(verifierUrl),
    });
    const b = (await res.json()) as { entries: { replayHash: string }[] };
    const i = b.entries.findIndex((e) => e.replayHash === body.entry!.replayHash);
    rank = { n: i >= 0 ? i + 1 : null, of: b.entries.length };
  } catch {
    /* the rank is decoration; the verification is recorded */
  }
  return { ...base, status: 'verified', score: body.score, rank, player };
}

/**
 * One line for the title screen about what happened to the saved games; '' when there is nothing to say. A flush names the yard; a game
 * Home offered is named by `game` ("today's game", review 2026-11-06), never by the yard's code, and it was never a saved game.
 */
export function describeOutcomes(outcomes: FlushOutcome[], game?: (seed: string) => string): string {
  if (!outcomes.length) return '';
  const short = (seed: string) => (seed.length > 26 ? `${seed.slice(0, 24)}…` : seed);
  const parts = outcomes.map((o) => {
    const who = { seed: short(o.seed), game: game?.(o.seed) ?? '' };
    const score = money(o.score ?? 0);
    switch (o.status) {
      case 'verified':
        return t(game ? 'title.unsentChecked' : 'pending.checked', {
          ...who,
          score,
          rank: o.rank
            ? t('pending.rankSuffix', {
                rank: o.rank.n != null ? t('common.rankOf', { n: int(o.rank.n), of: int(o.rank.of) }) : t('common.beyondTop', { of: int(o.rank.of) }),
              })
            : '',
          player: o.player ? t('pending.asSuffix', { player: o.player }) : '',
        });
      case 'keep-best':
        return t(game ? 'title.unsentKeepBest' : 'pending.keepBest', { ...who, score });
      case 'late':
        return t(game ? 'title.unsentLate' : 'pending.late', { ...who, score });
      case 'rejected':
        return t(game ? 'title.unsentRejected' : 'pending.rejected', { ...who, error: o.error ?? '' });
      case 'busy':
        return t(game ? 'title.unsentBusy' : 'pending.busy', who);
      default:
        return t(game ? 'title.unsentOffline' : 'pending.offline', who);
    }
  });
  return `${parts.map((p, i) => (i === 0 ? p.charAt(0).toUpperCase() + p.slice(1) : p)).join('. ')}.`;
}
