/** The community hub as the client sees it (0.11.10). Its threads read and write like any other, through render/thread.ts. */
import { authHeaders } from './identity';
import type { HubCategory } from '../content/hub';

export interface HubTopic {
  key: string;
  title: string;
  posts: number;
  pinned: boolean;
  locked: boolean;
}
export interface Hub {
  /** whether players can start topics: enough of them are posting */ open: boolean;
  categories: { key: HubCategory; posts: number; topics: HubTopic[] }[];
  days: { key: string; kind: 'daily' | 'weekly'; posts: number }[];
}
export async function loadHub(verifierUrl: string): Promise<Hub | null> {
  try {
    const res = await fetch(`${verifierUrl}/hub`, { headers: authHeaders(verifierUrl) });
    return res.ok ? ((await res.json()) as Hub) : null;
  } catch {
    return null;
  }
}
export async function startTopic(
  verifierUrl: string,
  category: HubCategory,
  title: string,
  body: string,
): Promise<{ ok: true; key: string } | { ok: false; code: string }> {
  try {
    const res = await fetch(`${verifierUrl}/hub/topic`, {
      method: 'POST',
      headers: { ...authHeaders(verifierUrl), 'Content-Type': 'application/json' },
      body: JSON.stringify({ category, title, body }),
    });
    if (res.status === 429) return { ok: false, code: 'rate-limited' };
    const json = (await res.json().catch(() => ({}))) as { ok?: boolean; code?: string; key?: string };
    return json.ok && json.key ? { ok: true, key: json.key } : { ok: false, code: json.code ?? 'failed' };
  } catch {
    return { ok: false, code: 'failed' };
  }
}
