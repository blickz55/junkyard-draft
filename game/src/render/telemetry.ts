/**
 * Client side of the opt-in funnel (PLAN-v1 0.3.7). Off by default; nothing is queued, stored or sent until
 * the player turns "Share anonymous play statistics" on. When on: a random 128-bit install id is created,
 * events from the fixed vocabulary (game/src/telemetry/events.ts) are batched and POSTed to the verifier's
 * /events every few seconds; the unsent queue is persisted with the install state so a page navigation never
 * loses a batch (the next boot sends it; every event carries a random id and the server counts an id once per install, so a batch
 * delivered twice is not double-counted, 0.9.7); once-per-install
 * events are deduplicated locally; a 'seed' property is never sent. Turning it off deletes everything.
 */
import { EVENTS, ONCE_EVENTS, MAX_BATCH, validateEvent, type EventName, type Props, type TelemetryEvent } from '../telemetry/events';
import { loadSettings, updateSettings, loadTelemetryState, saveTelemetryState, clearTelemetryState } from './storage';

export type Sender = (url: string, body: string, beacon: boolean) => Promise<boolean>;

const FLUSH_MS = 8000;
const MAX_QUEUE = 200;

const defaultSender: Sender = async (url, body, beacon) => {
  try {
    if (beacon && typeof navigator !== 'undefined' && navigator.sendBeacon) return navigator.sendBeacon(url, new Blob([body], { type: 'application/json' }));
    const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, keepalive: beacon });
    return r.ok;
  } catch {
    return false;
  }
};

function randomId(): string {
  const bytes = new Uint8Array(16);
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) crypto.getRandomValues(bytes);
  else for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

class Telemetry {
  private queue: TelemetryEvent[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;
  private startedAt = Date.now();
  private sent = 0;
  private dropped = 0;
  private sender: Sender = defaultSender;
  private urlProvider: () => string = () => '';
  private flushing: Promise<boolean> | null = null;
  /** bumped on every opt-out: completions from an older generation must not touch the queue or counters (review F12) */
  private generation = 0;

  /** Mirror the in-memory queue into the persisted state (bounded). */
  private persistQueue() {
    const st = loadTelemetryState();
    if (st.installId) saveTelemetryState({ ...st, pending: this.queue.slice(-MAX_QUEUE) });
  }
  /** Wire the transport (the game sets the verifier URL provider; tests inject a sender). */
  configure(o: { url?: () => string; sender?: Sender }) {
    if (o.url) this.urlProvider = o.url;
    if (o.sender) this.sender = o.sender;
  }

  get enabled(): boolean {
    return loadSettings().telemetry === true;
  }
  get installId(): string | null {
    return this.enabled ? loadTelemetryState().installId : null;
  }
  /** Counters for the dev API / tests. */
  stats() {
    return {
      enabled: this.enabled,
      hasInstallId: !!loadTelemetryState().installId,
      queued: this.queue.length,
      sent: this.sent,
      dropped: this.dropped,
      firsts: loadTelemetryState().firsts.length,
      games: loadTelemetryState().games,
    };
  }

  /** Opt in or out. In: create the install id and record consent. Out: forget everything, send nothing further. */
  setEnabled(on: boolean) {
    if (on) {
      updateSettings({ telemetry: true });
      const st = loadTelemetryState();
      if (!st.installId) saveTelemetryState({ ...st, installId: randomId() });
      this.track('consent_set', { on: true });
      void this.flush();
    } else {
      updateSettings({ telemetry: false });
      this.generation++;
      this.flushing = null; // an in-flight send may still complete: its events never come back
      this.queue.length = 0;
      if (this.timer) {
        clearTimeout(this.timer);
        this.timer = null;
      }
      clearTelemetryState();
    }
  }

  /** Record an event (no-op unless enabled; once-per-install events are deduplicated; invalid events are dropped). */
  track(name: EventName, props?: Props): boolean {
    if (!this.enabled) return false;
    if (ONCE_EVENTS.has(name)) {
      const st = loadTelemetryState();
      if (st.firsts.includes(name)) return false;
      saveTelemetryState({ ...st, firsts: [...st.firsts, name] });
    }
    const v = validateEvent({ name, props, at: new Date().toISOString(), id: randomId().slice(0, 16) }); // the id travels with the event through retries, so a batch the server took but the client never heard about counts once
    if (typeof v === 'string') {
      this.dropped++;
      return false;
    }
    if (this.queue.length >= MAX_QUEUE) this.queue.shift();
    this.queue.push(v);
    this.persistQueue();
    if (this.queue.length >= 20) void this.flush();
    else if (!this.timer)
      this.timer = setTimeout(() => {
        this.timer = null;
        void this.flush();
      }, FLUSH_MS);
    return true;
  }

  /** A new game (fresh run, not playback) started: counts toward second_game_start and daily_start. */
  gameStart(seed: string) {
    if (!this.enabled) return;
    const st = loadTelemetryState();
    const games = st.games + 1;
    saveTelemetryState({ ...st, games });
    if (games === 2) this.track('second_game_start');
    if (seed.startsWith('daily-')) this.track('daily_start');
  }

  /** Send the queue as one batch. Keeps the queue on failure (bounded). */
  flush(beacon = false): Promise<boolean> {
    if (this.flushing) return this.flushing;
    const st = loadTelemetryState();
    if (!this.enabled || !st.installId || this.queue.length === 0) return Promise.resolve(true);
    const events = this.queue.splice(0, MAX_BATCH);
    const body = JSON.stringify({ installId: st.installId, consent: true, events });
    const url = `${this.urlProvider().replace(/\/$/, '')}/events`;
    const gen = this.generation;
    this.flushing = this.sender(url, body, beacon).then((ok) => {
      if (gen !== this.generation) return ok; // consent was withdrawn meanwhile: discard the outcome, restore nothing
      if (ok) this.sent += events.length;
      else this.queue.unshift(...events.slice(0, MAX_QUEUE - this.queue.length));
      this.persistQueue();
      this.flushing = null;
      return ok;
    });
    return this.flushing;
  }

  /** Call once at boot in the browser: resend what an earlier page left unsent, record app_start, and queue session_end on page hide (sent by the next boot). */
  init() {
    this.startedAt = Date.now();
    if (this.enabled) {
      const st = loadTelemetryState();
      for (const raw of st.pending) {
        const v = validateEvent(raw);
        if (typeof v !== 'string') this.queue.push(v);
      }
    }
    this.track('app_start');
    if (this.queue.length) void this.flush();
    if (typeof window !== 'undefined') {
      window.addEventListener('pagehide', () => {
        if (!this.enabled) return;
        this.track('session_end', { minutes: Math.round((Date.now() - this.startedAt) / 60000) });
      });
    }
  }
}

export const telemetry = new Telemetry();
export const EVENT_NAMES = Object.keys(EVENTS) as EventName[];
