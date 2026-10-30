/**
 * Groups (PLAN-v4 0.7.2): a code scopes the boards to its members' verified entries. The selection is per device
 * (`jd.group.v1`); every board read adds `group=<code>` and the bearer when a group is selected, and the verifier
 * recomputes ranks and percentiles over the members only. No chat, no invitations beyond sharing the code.
 */
import { authHeaders, bearerAllowed } from './identity';
import { t } from '../content/strings';

export interface GroupInfo { code: string; name: string; members: number; creator: boolean }
export interface GroupSelection { code: string; name: string }
const KEY = 'jd.group.v1';

export function loadGroup(): GroupSelection | null {
  try { const raw = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Partial<GroupSelection> | null; return raw && typeof raw.code === 'string' && /^[a-z2-7]{8}$/.test(raw.code) && typeof raw.name === 'string' ? { code: raw.code, name: raw.name } : null; } catch { return null; }
}
export function saveGroup(g: GroupSelection | null) { try { if (g) localStorage.setItem(KEY, JSON.stringify(g)); else localStorage.removeItem(KEY); } catch { /* session only */ } }

/** Query-string suffix for board reads: `&group=<code>` when a group is selected and the verifier may see the bearer. */
export const groupParam = (verifierUrl: string): string => { const g = loadGroup(); return g && bearerAllowed(verifierUrl) ? `&group=${encodeURIComponent(g.code)}` : ''; };
/** Headers for board reads: the bearer when a group is selected (the verifier checks membership). */
export const groupHeaders = (verifierUrl: string): Record<string, string> => (loadGroup() && bearerAllowed(verifierUrl) ? authHeaders(verifierUrl) : {});

type Outcome<T> = ({ ok: true } & T) | { ok: false; error: string } | null;
async function post<T>(verifierUrl: string, path: string, body: unknown): Promise<Outcome<T>> {
  if (!bearerAllowed(verifierUrl)) return { ok: false, error: t('crews.insecure') };
  try {
    const res = await fetch(`${verifierUrl}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeaders(verifierUrl) }, body: JSON.stringify(body) });
    const j = await res.json() as { ok: boolean; error?: string } & T;
    return j.ok ? ({ ...j, ok: true } as { ok: true } & T) : { ok: false, error: j.error ?? `refused (${res.status})` };
  } catch { return null; }
}
export const fetchGroups = async (verifierUrl: string): Promise<GroupInfo[] | null> => {
  if (!bearerAllowed(verifierUrl)) return null;
  try { const res = await fetch(`${verifierUrl}/groups`, { headers: authHeaders(verifierUrl) }); const j = await res.json() as { ok: boolean; groups?: GroupInfo[] }; return j.ok && Array.isArray(j.groups) ? j.groups : null; } catch { return null; }
};
export const createGroup = (verifierUrl: string, name: string) => post<{ group: GroupInfo }>(verifierUrl, '/groups', { name });
export const joinGroup = (verifierUrl: string, code: string) => post<{ group: GroupInfo }>(verifierUrl, '/groups/join', { code: code.trim().toLowerCase() });
export const leaveGroup = (verifierUrl: string, code: string) => post<{ left: string }>(verifierUrl, '/groups/leave', { code });
