/**
 * Discord webhook announcements (PLAN-v4 0.7.6). Optional: with DISCORD_WEBHOOK_URL set, the verifier posts one short
 * message when a daily or weekly seed opens, when an open event gets a new #1, and when an event freezes (with its medal
 * thresholds). Everything posted is already public on the board: the seed, a player's label and score, the thresholds.
 * One message per event type per seed (a new leader counts per leader); a 429 is retried after Retry-After; any other
 * failure is logged and dropped. Posting is fire-and-forget: a submission never waits for Discord and never fails on it.
 */
import type { BoardEntry, DailyRecord } from './verify'; // types only: no runtime cycle with the verifier

export type AnnounceEvent =
  | { kind: 'seed'; record: DailyRecord }
  | { kind: 'lead'; record: DailyRecord; entry: BoardEntry; previous: BoardEntry | null }
  | { kind: 'freeze'; record: DailyRecord; n: number; top: BoardEntry[] };

export const eventLabel = (r: DailyRecord): string => (r.kind === 'weekly' ? `Weekly ${r.week}` : `Daily ${r.date}`);
const when = (iso: string) => iso.replace('T', ' ').replace(/:\d{2}\.\d{3}Z$/, ' UTC');

/** The text of one announcement: pure, so a test can pin every wording. */
export function formatAnnouncement(ev: AnnounceEvent): string {
  const label = eventLabel(ev.record);
  switch (ev.kind) {
    case 'seed':
      return `${label} is open — seed \`${ev.record.seed}\` · closes ${when(ev.record.closesAt)} · commitment to the next ${ev.record.kind === 'weekly' ? 'week' : 'day'}: ${ev.record.commitment.slice(0, 16)}…`;
    case 'lead':
      return `New #1 on ${label}: ${ev.entry.player} with $${ev.entry.score}${ev.previous ? ` (was ${ev.previous.player}, $${ev.previous.score})` : ''}`;
    case 'freeze': {
      const m = ev.record.medals;
      const lead = ev.top[0] ? ` · #1 ${ev.top[0].player} $${ev.top[0].score}` : '';
      const medals = m ? ` · medals: gold ≥ $${m.gold} · silver ≥ $${m.silver} · bronze ≥ $${m.bronze}` : ' · fewer than five runs: no medals';
      return `${label} is final: ${ev.n} verified run${ev.n === 1 ? '' : 's'}${lead}${medals}`;
    }
  }
}

/** The dedupe key: one message per event type per seed, and per leader for a new #1. */
export const announceKey = (ev: AnnounceEvent): string => `${ev.kind}:${ev.record.kind === 'weekly' ? ev.record.week : ev.record.date}${ev.kind === 'lead' ? `:${ev.entry.replayHash}` : ''}`;

export interface AnnouncerOptions {
  /** the webhook URL; null disables posting entirely (events are still deduplicated and counted) */
  url: string | null;
  /** print each message to `log` instead of posting it */
  dryRun?: boolean;
  fetch?: typeof fetch;
  log?: ((line: string) => void) | null;
  sleep?: (ms: number) => Promise<void>;
  /** retries after a 429 before the message is dropped */
  maxRetries?: number;
}

export class Announcer {
  private readonly sent = new Set<string>();
  private queue: Promise<void> = Promise.resolve();
  private readonly f: typeof fetch; private readonly log: (line: string) => void; private readonly sleep: (ms: number) => Promise<void>; private readonly maxRetries: number;
  /** messages posted (2xx), dropped (non-429 failure or retries exhausted) and skipped as duplicates, for /health and tests */
  readonly stats = { posted: 0, dropped: 0, deduped: 0, retried: 0 };
  constructor(private readonly opts: AnnouncerOptions) {
    this.f = opts.fetch ?? fetch; this.log = opts.log === null ? () => {} : opts.log ?? ((l) => console.log(l)); this.sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms))); this.maxRetries = opts.maxRetries ?? 3;
  }
  get enabled(): boolean { return !!this.opts.url || !!this.opts.dryRun; }
  /** Queue one announcement; returns at once. Duplicates (same key) are skipped. */
  announce(ev: AnnounceEvent): void {
    if (!this.enabled) return;
    const key = announceKey(ev);
    if (this.sent.has(key)) { this.stats.deduped++; return; }
    this.sent.add(key);
    const text = formatAnnouncement(ev);
    this.queue = this.queue.then(() => this.post(text, key)).catch(() => { /* post() never throws; belt and braces so the chain survives */ });
  }
  /** Resolves when every queued message has been posted or dropped (tests, shutdown). */
  idle(): Promise<void> { return this.queue; }
  private async post(text: string, key: string): Promise<void> {
    if (this.opts.dryRun || !this.opts.url) { this.log(`discord (dry run) ${key}: ${text}`); this.stats.posted++; return; }
    for (let attempt = 0; ; attempt++) {
      let res: Response;
      try { res = await this.f(this.opts.url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content: text, allowed_mentions: { parse: [] } }) }); }
      catch (e) { this.log(`discord ${key}: dropped, request failed: ${(e as Error).message}`); this.stats.dropped++; return; }
      if (res.ok) { this.stats.posted++; return; }
      if (res.status === 429 && attempt < this.maxRetries) {
        const ms = await retryAfterMs(res);
        this.stats.retried++; this.log(`discord ${key}: rate limited, retrying in ${ms} ms (${attempt + 1}/${this.maxRetries})`);
        await this.sleep(ms); continue;
      }
      this.log(`discord ${key}: dropped, HTTP ${res.status}${res.status === 429 ? ' after retries' : ''}`); this.stats.dropped++; return;
    }
  }
}

/** Retry-After as milliseconds: a delay in seconds, an HTTP date, or Discord's JSON `retry_after` (seconds); 1 s when absent. */
export async function retryAfterMs(res: Response, now = Date.now()): Promise<number> {
  const h = res.headers.get('retry-after');
  if (h) { const s = Number(h); if (Number.isFinite(s)) return Math.max(0, Math.round(s * 1000)); const t = Date.parse(h); if (Number.isFinite(t)) return Math.max(0, t - now); }
  try { const b = await res.json() as { retry_after?: number }; if (typeof b.retry_after === 'number') return Math.max(0, Math.round(b.retry_after * 1000)); } catch { /* no body */ }
  return 1000;
}
