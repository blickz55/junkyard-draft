/**
 * The daily reminder (production roadmap 0.10.4): one push notification a day, "The yard is open", at the hour the
 * player chose, through the browser's push service and our server. Turning it on subscribes this browser (the browser
 * asks for permission) and tells the verifier the subscription and the UTC hour; turning it off unsubscribes here and
 * there. Nothing is remembered on the device but the endpoint and the hour (`jd.push.v1`). `localToUtcHour` is pure.
 */
import { authHeaders } from './identity';
import { readJson, writeJson } from './storage';

export const PUSH_KEY = 'jd.push.v1';
export interface Reminder {
  endpoint: string;
  hourLocal: number;
  hourUtc: number;
}

export const pushSupported = (): boolean =>
  typeof navigator !== 'undefined' && 'serviceWorker' in navigator && typeof window !== 'undefined' && 'PushManager' in window && 'Notification' in window;

/** The UTC hour a local hour falls in (a half-hour zone rounds down: 22:30 UTC is hour 22). */
export function localToUtcHour(hourLocal: number, offsetMinutes: number = new Date().getTimezoneOffset()): number {
  const minutes = (((hourLocal * 60 + offsetMinutes) % 1440) + 1440) % 1440;
  return Math.floor(minutes / 60);
}
export const loadReminder = (): Reminder | null => {
  const r = readJson<Reminder | null>(PUSH_KEY);
  return r && typeof r.endpoint === 'string' && Number.isInteger(r.hourLocal) ? r : null;
};

/** base64url → the bytes `applicationServerKey` wants */
export function urlBase64ToUint8Array(s: string): Uint8Array {
  const padded = (s + '='.repeat((4 - (s.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(padded);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

/** Subscribe this browser and register the hour with our server. Throws with a plain reason when it cannot. */
export async function enableReminder(verifierUrl: string, hourLocal: number): Promise<Reminder> {
  const keyRes = await fetch(`${verifierUrl}/push/vapid`);
  if (!keyRes.ok) throw new Error(keyRes.status === 503 ? 'our server does not send reminders yet' : `our server answered ${keyRes.status}`);
  const { publicKey } = (await keyRes.json()) as { publicKey: string };
  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(publicKey) as BufferSource });
  const hourUtc = localToUtcHour(hourLocal);
  const res = await fetch(`${verifierUrl}/push/subscribe`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders(verifierUrl) },
    body: JSON.stringify({ subscription: sub.toJSON(), hourUtc }),
  });
  if (!res.ok) {
    await sub.unsubscribe().catch(() => {});
    throw new Error(`our server answered ${res.status}`);
  }
  const r: Reminder = { endpoint: sub.endpoint, hourLocal, hourUtc };
  writeJson(PUSH_KEY, r);
  return r;
}
/** Unsubscribe here and at our server; the local record goes either way. */
export async function disableReminder(verifierUrl: string): Promise<void> {
  const r = loadReminder();
  let endpoint = r?.endpoint ?? null;
  try {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if (sub) {
      endpoint = sub.endpoint;
      await sub.unsubscribe();
    }
  } catch {
    /* no worker or no subscription: the server row still goes */
  }
  writeJson(PUSH_KEY, null);
  if (endpoint)
    await fetch(`${verifierUrl}/push/unsubscribe`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders(verifierUrl) },
      body: JSON.stringify({ endpoint }),
    }).catch(() => {});
}
