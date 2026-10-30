/**
 * Push for the daily (production roadmap 0.10.4). A player who turns the reminder on gives the verifier the push
 * subscription their browser issued (an endpoint at the browser maker's push service and two keys) and the UTC hour they
 * chose; once a day at that hour the verifier sends one message, "The yard is open", the same for everyone, encrypted to
 * the browser with web-push (the first runtime dependency, recorded in server/README.md). Nothing else is ever sent through
 * it (the social notifications are 0.11.7). A subscription the push service reports gone (404, 410) is dropped, as is one
 * that fails MAX_FAILURES times; unsubscribe and DELETE /me remove rows. Rows live in push.json next to the board.
 * The sender is injectable so the daily rule runs under a fake clock in tests; the default sender builds the request with
 * web-push and posts it itself, so a loopback http endpoint stands in for a push service in a test.
 */
import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import path from 'node:path';

// web-push is loaded on first use, through a specifier the bundler does not see: the verifier stays one small file
// (tests/verifier.test.ts bundles it without node_modules) and the image installs the dependency beside it (Dockerfile);
// a verifier without VAPID keys never loads it at all.
type WebPush = typeof import('web-push');
let webPushModule: Promise<WebPush> | null = null;
export const loadWebPush = (): Promise<WebPush> => {
  if (!webPushModule) {
    const specifier = 'web-push';
    webPushModule = import(specifier).then((m: WebPush & { default?: WebPush }) => m.default ?? m);
  }
  return webPushModule;
};

export interface PushKeys {
  p256dh: string;
  auth: string;
}
export interface PushSubscriptionRow {
  endpoint: string;
  keys: PushKeys;
  /** the UTC hour (0–23) the message goes out */
  hourUtc: number;
  /** the claimed player, when the subscription came with a bearer (DELETE /me removes it) */
  playerId: string | null;
  createdAt: string;
  /** the UTC day (YYYY-MM-DD) of the last message, so a day gets one */
  lastSentDay: string | null;
  failures: number;
}
export interface PushMessage {
  title: string;
  body: string;
  url: string;
  tag: string;
}
/** the one message (the service worker shows it; the texts are what the roadmap fixed) */
export const DAILY_MESSAGE: PushMessage = { title: 'Junkyard Draft', body: 'The yard is open.', url: './', tag: 'jd-daily' };
export const MAX_SUBSCRIPTIONS = 50_000;
export const MAX_FAILURES = 5;
export const PUSH_TTL_SEC = 3600;

export interface VapidDetails {
  publicKey: string;
  privateKey: string;
  subject: string;
}
export class PushError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string,
  ) {
    super(message);
    this.name = 'PushError';
  }
}
export type Sender = (sub: { endpoint: string; keys: PushKeys }, payload: string) => Promise<void>;

const B64URL = /^[A-Za-z0-9_-]+$/;
const LOOPBACK = /^(127\.0\.0\.1|localhost|\[::1\])$/i;
/** A browser's PushSubscription JSON: an https endpoint (http only on the loopback, for tests) and the two keys. */
export function validateSubscription(raw: unknown): { endpoint: string; keys: PushKeys } | string {
  if (!raw || typeof raw !== 'object') return 'subscription required';
  const o = raw as { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown } };
  if (typeof o.endpoint !== 'string' || o.endpoint.length > 2048) return 'subscription.endpoint must be a URL';
  let u: URL;
  try {
    u = new URL(o.endpoint);
  } catch {
    return 'subscription.endpoint must be a URL';
  }
  if (!(u.protocol === 'https:' || (u.protocol === 'http:' && LOOPBACK.test(u.hostname)))) return 'subscription.endpoint must be https';
  const k = o.keys;
  if (!k || typeof k !== 'object') return 'subscription.keys required';
  if (typeof k.p256dh !== 'string' || !B64URL.test(k.p256dh) || k.p256dh.length < 60 || k.p256dh.length > 100) return 'subscription.keys.p256dh malformed';
  if (typeof k.auth !== 'string' || !B64URL.test(k.auth) || k.auth.length < 16 || k.auth.length > 32) return 'subscription.keys.auth malformed';
  return { endpoint: o.endpoint, keys: { p256dh: k.p256dh, auth: k.auth } };
}
export function validateHour(raw: unknown): number | string {
  return Number.isInteger(raw) && (raw as number) >= 0 && (raw as number) <= 23 ? (raw as number) : 'hourUtc must be an integer from 0 to 23';
}
export const dayOf = (d: Date) => d.toISOString().slice(0, 10);

/** web-push builds the VAPID-signed, aes128gcm-encrypted request; posting it here lets a loopback http endpoint stand in for a push service. */
export function webPushSender(vapid: VapidDetails): Sender {
  return async (sub, payload) => {
    const webpush = await loadWebPush();
    let d: ReturnType<WebPush['generateRequestDetails']>;
    try {
      d = webpush.generateRequestDetails({ endpoint: sub.endpoint, keys: sub.keys }, payload, { vapidDetails: vapid, TTL: PUSH_TTL_SEC });
    } catch (e) {
      throw new PushError(0, `request could not be built: ${(e as Error).message}`);
    }
    await new Promise<void>((resolve, reject) => {
      const mod = new URL(d.endpoint).protocol === 'http:' ? http : https;
      const req = mod.request(d.endpoint, { method: d.method, headers: d.headers as Record<string, string>, timeout: 10_000 }, (res) => {
        res.resume();
        res.on('end', () => {
          const code = res.statusCode ?? 0;
          if (code >= 200 && code < 300) resolve();
          else reject(new PushError(code, `push service answered ${code}`));
        });
      });
      req.on('error', (e) => reject(new PushError(0, e.message)));
      req.on('timeout', () => req.destroy(new Error('timeout')));
      if (d.body) req.write(d.body);
      req.end();
    });
  };
}
export const generateVapidKeys = async () => (await loadWebPush()).generateVAPIDKeys();

export interface PushStoreOptions {
  /** the VAPID keys and subject; without them the store is disabled (routes answer 503) */
  vapid?: VapidDetails | null;
  /** how a message is delivered (tests inject one); default: web-push to the endpoint */
  send?: Sender;
  now?: () => number;
  log?: ((line: string) => void) | null;
}

export class PushStore {
  private rows: PushSubscriptionRow[] = [];
  readonly enabled: boolean;
  readonly publicKey: string | null;
  private readonly send: Sender;
  private readonly now: () => number;
  private readonly log: ((line: string) => void) | null;
  readonly stats = { sent: 0, removed: 0, failed: 0 };

  constructor(
    readonly file: string,
    opts: PushStoreOptions = {},
  ) {
    this.enabled = !!opts.vapid;
    this.publicKey = opts.vapid?.publicKey ?? null;
    this.send = opts.send ?? (opts.vapid ? webPushSender(opts.vapid) : async () => Promise.reject(new PushError(503, 'push disabled')));
    this.now = opts.now ?? Date.now;
    this.log = opts.log === null ? null : (opts.log ?? ((l) => console.log(l)));
    this.rows = this.load();
  }
  private load(): PushSubscriptionRow[] {
    try {
      const raw = JSON.parse(fs.readFileSync(this.file, 'utf8')) as { subscriptions?: unknown };
      const list = Array.isArray(raw.subscriptions) ? raw.subscriptions : [];
      return list.filter((r): r is PushSubscriptionRow => {
        const x = r as PushSubscriptionRow;
        return !!x && typeof x.endpoint === 'string' && typeof validateSubscription(x) === 'object' && typeof validateHour(x.hourUtc) === 'number';
      });
    } catch {
      return [];
    }
  }
  private persist() {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify({ subscriptions: this.rows }, null, 1));
    fs.renameSync(tmp, this.file);
  }
  get count() {
    return this.rows.length;
  }
  list(): readonly PushSubscriptionRow[] {
    return this.rows;
  }
  /** Add or replace (by endpoint) a subscription; 507 when the store is full. */
  subscribe(input: { endpoint: string; keys: PushKeys; hourUtc: number; playerId: string | null }): PushSubscriptionRow {
    const i = this.rows.findIndex((r) => r.endpoint === input.endpoint);
    if (i < 0 && this.rows.length >= MAX_SUBSCRIPTIONS) throw new PushError(507, 'no room for more subscriptions');
    const prev = i >= 0 ? this.rows[i] : null;
    const row: PushSubscriptionRow = {
      endpoint: input.endpoint,
      keys: input.keys,
      hourUtc: input.hourUtc,
      playerId: input.playerId ?? prev?.playerId ?? null,
      createdAt: prev?.createdAt ?? new Date(this.now()).toISOString(),
      lastSentDay: prev?.lastSentDay ?? null,
      failures: 0,
    };
    if (i >= 0) this.rows[i] = row;
    else this.rows.push(row);
    this.persist();
    return row;
  }
  unsubscribe(endpoint: string): boolean {
    const before = this.rows.length;
    this.rows = this.rows.filter((r) => r.endpoint !== endpoint);
    if (this.rows.length !== before) this.persist();
    return this.rows.length !== before;
  }
  /** DELETE /me: every subscription that came with this player's bearer. */
  unsubscribePlayer(playerId: string): number {
    const before = this.rows.length;
    this.rows = this.rows.filter((r) => r.playerId !== playerId);
    if (this.rows.length !== before) this.persist();
    return before - this.rows.length;
  }
  /** The rows whose hour it is and that have not had today's message. */
  due(now: Date): PushSubscriptionRow[] {
    const day = dayOf(now),
      hour = now.getUTCHours();
    return this.rows.filter((r) => r.hourUtc === hour && r.lastSentDay !== day);
  }
  /** Run once a minute: one message a day per subscription at its hour; gone subscriptions dropped. */
  async tick(now = new Date(this.now())): Promise<{ sent: number; removed: number; failed: number }> {
    const out = { sent: 0, removed: 0, failed: 0 };
    if (!this.enabled) return out;
    const day = dayOf(now);
    const payload = JSON.stringify(DAILY_MESSAGE);
    let changed = false;
    for (const row of this.due(now)) {
      try {
        await this.send({ endpoint: row.endpoint, keys: row.keys }, payload);
        row.lastSentDay = day;
        row.failures = 0;
        out.sent++;
      } catch (e) {
        const code = e instanceof PushError ? e.statusCode : 0;
        out.failed++;
        row.failures++;
        if (code === 404 || code === 410 || row.failures >= MAX_FAILURES) {
          this.rows = this.rows.filter((r) => r !== row);
          out.removed++;
        }
        this.log?.(`push: ${row.endpoint.slice(0, 40)}… failed (${code || 'network'}): ${(e as Error).message}${this.rows.includes(row) ? '' : '; dropped'}`);
      }
      changed = true;
    }
    if (changed) this.persist();
    this.stats.sent += out.sent;
    this.stats.removed += out.removed;
    this.stats.failed += out.failed;
    return out;
  }
}
