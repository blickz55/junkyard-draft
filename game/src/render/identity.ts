/**
 * Client side of identity (PLAN-v3 0.6.0): the device token lives in version-independent storage (`jd.identity.v1`),
 * the player id is its SHA-256 computed with WebCrypto once and cached beside it, and the claimed name/tag the verifier
 * confirmed are cached too. The token leaves the device only as a bearer header on POSTs. Recovery = the token as a code.
 */
import { tagFor, recoveryCodeFor, tokenFromRecoveryCode, TOKEN_HEX } from '../identity/identity';
import { markStorageFailure } from './storage';

export interface Identity { token: string; playerId: string | null; name: string | null; tag: string | null }
const KEY = 'jd.identity.v1';

function randomToken(): string {
  const bytes = new Uint8Array(16);
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) crypto.getRandomValues(bytes); else for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}
function read(): Identity | null {
  try { const raw = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Partial<Identity> | null; if (!raw || typeof raw.token !== 'string' || !TOKEN_HEX.test(raw.token)) return null; return { token: raw.token, playerId: typeof raw.playerId === 'string' ? raw.playerId : null, name: typeof raw.name === 'string' ? raw.name : null, tag: typeof raw.tag === 'string' ? raw.tag : null }; } catch { return null; }
}
function write(id: Identity) { try { localStorage.setItem(KEY, JSON.stringify(id)); } catch (e) { markStorageFailure(e); /* the identity lives for this session only; the banner says so (0.8.0) */ } }

/** The device identity, created on first use. */
export function loadIdentity(): Identity {
  const cur = read(); if (cur) return cur;
  const id: Identity = { token: randomToken(), playerId: null, name: null, tag: null };
  write(id); return id;
}
/** SHA-256 of the token as hex (WebCrypto); cached. */
export async function playerIdOf(id: Identity = loadIdentity()): Promise<string> {
  if (id.playerId) return id.playerId;
  const data = new TextEncoder().encode(id.token);
  const d = await crypto.subtle.digest('SHA-256', data);
  const hex = Array.from(new Uint8Array(d), (b) => b.toString(16).padStart(2, '0')).join('');
  write({ ...id, playerId: hex }); return hex;
}
/** Tag derived locally from the player id (the verifier derives the same one). */
export async function localTag(): Promise<string> { return tagFor(await playerIdOf()); }
export function setClaimed(name: string, tag: string, playerId?: string) { const id = loadIdentity(); write({ ...id, name, tag, playerId: playerId ?? id.playerId }); }
export function clearClaimed() { const id = loadIdentity(); write({ ...id, name: null, tag: null }); }
/** The token travels only over TLS or to a loopback verifier (PLAN-v3 §1). */
export const bearerAllowed = (verifierUrl: string): boolean => /^https:\/\//i.test(verifierUrl) || /^http:\/\/(127\.0\.0\.1|localhost|\[::1\])(:\d+)?(\/|$)/i.test(verifierUrl);
export const authHeaders = (verifierUrl: string): Record<string, string> => (bearerAllowed(verifierUrl) ? { Authorization: `Bearer ${loadIdentity().token}` } : {});
/** GET /identity: the name this token has claimed, or null (none, offline, refused). Caches a found claim. */
export async function fetchClaimed(verifierUrl: string): Promise<{ name: string; tag: string; hidden: boolean } | null> {
  try {
    const res = await fetch(`${verifierUrl}/identity`, { headers: authHeaders(verifierUrl) });
    const body = await res.json() as { ok: boolean; name?: string; tag?: string; playerId?: string; hidden?: boolean };
    if (!res.ok || !body.ok || !body.name || !body.tag) { if (res.status === 404) clearClaimed(); return null; }
    setClaimed(body.name, body.tag, body.playerId); return { name: body.name, tag: body.tag, hidden: body.hidden === true }; // hidden: reported, pending review (PLAN-v4 0.7.7)
  } catch { return null; }
}
export const recoveryCode = (): string => recoveryCodeFor(loadIdentity().token);
/** Replace the device identity with the one a recovery code names; false when the code is invalid. The claimed name is fetched again later. */
export function restoreIdentity(code: string): boolean {
  const token = tokenFromRecoveryCode(code); if (!token) return false;
  write({ token, playerId: null, name: null, tag: null }); return true;
}
/** GET /me/export (production roadmap 0.8.6): everything the verifier stores under this device's player id, or an error line. */
export async function exportMyData(verifierUrl: string): Promise<{ ok: true; data: Record<string, unknown>; entries: number; replays: number } | { ok: false; error: string }> {
  if (!bearerAllowed(verifierUrl)) return { ok: false, error: 'the verifier is not https, so the key cannot be sent' };
  try {
    const res = await fetch(`${verifierUrl}/me/export`, { headers: authHeaders(verifierUrl) });
    const body = await res.json() as { ok: boolean; error?: string; entries?: { replay: unknown }[] };
    if (!res.ok || !body.ok) return { ok: false, error: body.error ?? `export refused (${res.status})` };
    const entries = Array.isArray(body.entries) ? body.entries : [];
    return { ok: true, data: body as Record<string, unknown>, entries: entries.length, replays: entries.filter((e) => e.replay).length };
  } catch { return { ok: false, error: 'the verifier did not answer' }; }
}
/** Replace the device key with a fresh one (after a deletion: nothing may link the anonymised entries to this device again). */
export function resetIdentity(): void { write({ token: randomToken(), playerId: null, name: null, tag: null }); }
/**
 * DELETE /me (0.8.6, the in-game button): the verifier forgets the player, then the device forgets the key. The local
 * half runs only after the server confirmed (a key rotated before the server answered would orphan the server's copy).
 */
export async function deleteMyData(verifierUrl: string): Promise<{ ok: true; anonymisedEntries: number; coldReplaysDropped: number } | { ok: false; error: string }> {
  if (!bearerAllowed(verifierUrl)) return { ok: false, error: 'the verifier is not https, so the key cannot be sent' };
  try {
    const res = await fetch(`${verifierUrl}/me`, { method: 'DELETE', headers: authHeaders(verifierUrl) });
    const body = await res.json() as { ok: boolean; error?: string; anonymisedEntries?: number; coldReplaysDropped?: number };
    if (!res.ok || !body.ok) return { ok: false, error: body.error ?? `deletion refused (${res.status})` };
    resetIdentity();
    return { ok: true, anonymisedEntries: body.anonymisedEntries ?? 0, coldReplaysDropped: body.coldReplaysDropped ?? 0 };
  } catch { return { ok: false, error: 'the verifier did not answer; nothing was deleted' }; }
}
/** Claim or confirm the display name with the verifier; resolves with the label or null when the server is unreachable or refused. */
export async function claimName(verifierUrl: string, name: string): Promise<{ name: string; tag: string } | { error: string } | null> {
  try {
    if (!bearerAllowed(verifierUrl)) return { error: 'the verifier is not https' };
    const res = await fetch(`${verifierUrl}/identity`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeaders(verifierUrl) }, body: JSON.stringify({ name }) });
    const body = await res.json() as { ok: boolean; name?: string; tag?: string; playerId?: string; error?: string };
    if (!res.ok || !body.ok || !body.name || !body.tag) return { error: body.error ?? `identity refused (${res.status})` };
    setClaimed(body.name, body.tag, body.playerId); return { name: body.name, tag: body.tag };
  } catch { return null; }
}
