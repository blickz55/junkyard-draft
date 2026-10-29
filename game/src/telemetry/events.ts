/**
 * Opt-in first-session funnel events (PLAN-v1 0.3.7). This is the whole vocabulary: a fixed list with the
 * allowed property keys per event, shared by the client (game/src/render/telemetry.ts) and the verifier
 * (server/verify.ts, POST /events), so nothing outside it can be recorded. Add an event only by editing this
 * list (and docs/PLAN-v1.md's Measurement plan). No event carries a layout or a seed: the only seed-like
 * strings allowed anywhere are `daily-*` and `tutorial-*` labels.
 */
export const EVENTS = {
  app_start: [],
  consent_set: ['on'],
  tutorial_step_start: ['n'],
  tutorial_step_complete: ['n'],
  first_draft_pick: [],
  first_place_attempt: [],
  first_place_rejected: ['reason'],
  first_rotate: [],
  undo_used: [],
  reroll_used: ['n'],
  first_run_start: [],
  first_run_complete: ['money'],
  round_complete: ['n'],
  game_complete: ['mode'],
  second_game_start: [],
  daily_start: [],
  daily_submit_result: ['result'],
  share_copied: ['variant'],
  clip_exported: ['format'],
  histogram_around_me_opened: [],
  challenge_opened: [],
  fork_started: [],
  tip_opened: ['id'],
  settings_changed: ['key'],
  session_end: ['minutes'],
} as const satisfies Record<string, readonly string[]>;

export type EventName = keyof typeof EVENTS;
export type Props = Record<string, string | number | boolean>;
export interface TelemetryEvent { name: EventName; props?: Props; at: string }
export interface EventBatch { installId: string; consent: true; events: TelemetryEvent[] }

/** Events recorded at most once per install (the client enforces it; the server just stores). */
export const ONCE_EVENTS: ReadonlySet<EventName> = new Set<EventName>(['first_draft_pick', 'first_place_attempt', 'first_place_rejected', 'first_rotate', 'undo_used', 'first_run_start', 'first_run_complete', 'second_game_start']);

export const MAX_BATCH = 100;
export const MAX_STRING = 64;
const INSTALL_ID = /^[0-9a-f]{32}$/;
const SEED_LABEL = /^(daily|tutorial)-/;

export const isEventName = (n: unknown): n is EventName => typeof n === 'string' && Object.prototype.hasOwnProperty.call(EVENTS, n);

/** Validate one event against the vocabulary; returns the clean event or a reason string. */
export function validateEvent(raw: unknown): TelemetryEvent | string {
  if (!raw || typeof raw !== 'object') return 'event is not an object';
  const e = raw as { name?: unknown; props?: unknown; at?: unknown };
  if (!isEventName(e.name)) return `unknown event ${String(JSON.stringify(e.name) ?? typeof e.name).slice(0, 40)}`; // stringify(undefined) is undefined: never .slice() on it
  const allowed = EVENTS[e.name] as readonly string[];
  const props: Props = {};
  if (e.props != null) {
    if (typeof e.props !== 'object' || Array.isArray(e.props)) return `${e.name}: props must be an object`;
    for (const [k, v] of Object.entries(e.props as Record<string, unknown>)) {
      if (k === 'seed') { if (!(typeof v === 'string' && SEED_LABEL.test(v))) return `${e.name}: seed strings are not recorded`; props.seed = v; continue; } // only daily-*/tutorial-* labels, on any event
      if (!allowed.includes(k)) return `${e.name}: property ${k} is not in the vocabulary`;
      if (typeof v === 'string') { if (v.length > MAX_STRING) return `${e.name}: ${k} too long`; props[k] = v; }
      else if (typeof v === 'number') { if (!Number.isFinite(v)) return `${e.name}: ${k} not finite`; props[k] = v; }
      else if (typeof v === 'boolean') props[k] = v;
      else return `${e.name}: ${k} has an unsupported type`;
    }
  }
  const at = typeof e.at === 'string' && !Number.isNaN(Date.parse(e.at)) ? e.at : null;
  if (!at) return `${e.name}: missing timestamp`;
  return { name: e.name, props, at };
}

/** Validate a POST /events body: consent must be explicit, the install id opaque, the batch bounded. */
export function validateBatch(raw: unknown): EventBatch | string {
  if (!raw || typeof raw !== 'object') return 'body is not an object';
  const b = raw as { installId?: unknown; consent?: unknown; events?: unknown };
  if (b.consent !== true) return 'no consent: events are only accepted from installs that opted in';
  if (typeof b.installId !== 'string' || !INSTALL_ID.test(b.installId)) return 'installId must be 32 hex characters';
  if (!Array.isArray(b.events) || b.events.length === 0) return 'events must be a non-empty array';
  if (b.events.length > MAX_BATCH) return `at most ${MAX_BATCH} events per batch`;
  const events: TelemetryEvent[] = [];
  for (const e of b.events) { const v = validateEvent(e); if (typeof v === 'string') return v; events.push(v); }
  return { installId: b.installId, consent: true, events };
}

/** The first-session funnel, in order, for tools/funnel.ts and GET /funnel. */
export const FUNNEL: readonly EventName[] = ['app_start', 'first_draft_pick', 'first_place_attempt', 'first_run_start', 'first_run_complete', 'second_game_start', 'game_complete'];
