/**
 * Email sign-in from the client's side (0.11.1; server/link.ts has the rules). The link carries its token in the fragment; Home
 * takes it off the address bar and asks before anything happens. This device's own key stays as it is: the server now reads it as
 * the signed-in player, and the player's id, name and tag are cached in its place.
 */
import { authHeaders, setPlayer } from './identity';
import { loadLinked, readSyncData, saveLinked, validateSync, writeSyncData, type SyncData } from './storage';
import { mergeSync, sameProgress } from './sync';

/** The token a link arrived with, once: it leaves the address bar, so reloading or sharing the page cannot use it again. */
export function takeLinkToken(): string | null {
  const m = /^#link=([\w-]{20,100})$/.exec(location.hash);
  if (!m) return null;
  history.replaceState(null, '', location.pathname + location.search);
  return m[1];
}

const send = (verifierUrl: string, path: string, body: unknown) =>
  fetch(`${verifierUrl}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeaders(verifierUrl) }, body: JSON.stringify(body) });

export type StartResult = 'sent' | 'bad-email' | 'rate-limited' | 'email-off' | 'failed';
export async function startLink(verifierUrl: string, email: string): Promise<StartResult> {
  try {
    const res = await send(verifierUrl, '/link/start', { email });
    if (res.ok) return 'sent';
    const { code } = (await res.json()) as { code?: string };
    return code === 'bad-email' || code === 'rate-limited' || code === 'email-off' ? code : 'failed';
  } catch {
    return 'failed';
  }
}

export type VerifyResult = { ok: true; joined: boolean } | { ok: false; code: 'link-gone' | 'linked-elsewhere' | 'failed' };
export async function verifyLink(verifierUrl: string, token: string): Promise<VerifyResult> {
  try {
    const res = await send(verifierUrl, '/link/verify', { token });
    const b = (await res.json()) as { ok?: boolean; code?: string; joined?: boolean; playerId?: string; tag?: string; name?: string | null; blob?: unknown };
    if (!res.ok || !b.ok || !b.playerId || !b.tag) return { ok: false, code: b.code === 'link-gone' || b.code === 'linked-elsewhere' ? b.code : 'failed' };
    setPlayer(b.playerId, b.name ?? null, b.tag);
    saveLinked(true);
    const remote = validateSync(b.blob);
    if (remote) writeSyncData(mergeSync(readSyncData(), remote), b.joined ? remote.settings : null);
    return { ok: true, joined: !!b.joined };
  } catch {
    return { ok: false, code: 'failed' };
  }
}

export async function unlinkEmail(verifierUrl: string): Promise<boolean> {
  try {
    const res = await send(verifierUrl, '/link/unlink', {});
    if (res.ok || res.status === 403) saveLinked(false);
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Bring this device and the account level: what the server holds comes in, what this device earned goes up. Returns whether this
 * device learnt anything, so Home can redraw. A device signed out from elsewhere finds out here.
 */
export async function syncNow(verifierUrl: string): Promise<boolean> {
  if (!loadLinked()) return false;
  try {
    const res = await fetch(`${verifierUrl}/me/sync`, { headers: authHeaders(verifierUrl) });
    if (res.status === 403) saveLinked(false);
    if (!res.ok) return false;
    const remote = validateSync(((await res.json()) as { blob?: unknown }).blob);
    const local = readSyncData();
    const merged: SyncData = remote ? mergeSync(local, remote) : local;
    const learnt = !sameProgress(merged, local);
    if (learnt) writeSyncData(merged, null);
    if (!remote || !sameProgress(merged, remote) || JSON.stringify(remote.settings) !== JSON.stringify(merged.settings))
      await send(verifierUrl, '/me/sync', { blob: merged });
    return learnt;
  } catch {
    return false;
  }
}
