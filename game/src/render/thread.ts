/** A day's talk as the client sees it (0.11.5). Names, never ids; only the author of a post hears what state it is in. */
import { authHeaders } from './identity';
import type { ReportReason } from '../identity/identity';

export interface ThreadPost {
  id: number;
  author: string;
  body: string;
  createdAt: number;
  edited: boolean;
  hash: string | null;
  own: boolean;
  /** what stands between this reader and the author */ friend: 'requested' | 'friend' | 'blocked' | null;
  state?: 'published' | 'queued' | 'hidden' | 'deleted';
  waiting?: boolean;
  reason?: string | null;
  editable?: boolean;
}
export type WriteState = 'ok' | 'not-linked' | 'no-name' | 'muted' | 'banned';
export interface ThreadView {
  key: string;
  kind: 'daily' | 'weekly' | 'run';
  seed: string;
  closed: boolean;
  /** the game a thread is about (0.11.6) */ run: { player: string; score: number } | null;
  foreman: { open: string | null; close: string | null };
  posts: ThreadPost[];
  next: number | null;
  count: number;
  write: WriteState;
  until?: number;
}
/** The talk, 'gate' when this device has no game on an open yard, null when the server cannot be reached. */
export async function loadThread(verifierUrl: string, key: string, after = 0): Promise<ThreadView | 'gate' | null> {
  try {
    const res = await fetch(`${verifierUrl}/thread?key=${encodeURIComponent(key)}${after ? `&after=${after}` : ''}`, { headers: authHeaders(verifierUrl) });
    if (res.status === 403) return 'gate';
    return res.ok ? ((await res.json()) as ThreadView) : null;
  } catch {
    return null;
  }
}
export type Sent = { ok: true; post: ThreadPost } | { ok: false; code: string };
const post = async (verifierUrl: string, path: string, body: unknown): Promise<Response | null> => {
  try {
    return await fetch(`${verifierUrl}${path}`, {
      method: 'POST',
      headers: { ...authHeaders(verifierUrl), 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch {
    return null;
  }
};
const sent = async (res: Response | null): Promise<Sent> => {
  if (!res) return { ok: false, code: 'failed' };
  if (res.status === 429) return { ok: false, code: 'rate-limited' };
  const json = (await res.json().catch(() => ({}))) as { ok?: boolean; code?: string; post?: ThreadPost };
  return json.ok && json.post ? { ok: true, post: json.post } : { ok: false, code: json.code ?? 'failed' };
};
export const sendPost = async (verifierUrl: string, key: string, body: string, hash: string | null): Promise<Sent> =>
  sent(await post(verifierUrl, '/posts', { key, body, ...(hash ? { hash } : {}) }));
export const changePost = async (verifierUrl: string, id: number, body: string): Promise<Sent> => sent(await post(verifierUrl, '/posts/edit', { id, body }));
export const takeBackPost = async (verifierUrl: string, id: number): Promise<boolean> => !!(await post(verifierUrl, '/posts/delete', { id }))?.ok;
/** 'no-name' when this device has no name to report under. */
export async function reportPost(verifierUrl: string, postId: number, reason: ReportReason): Promise<'sent' | 'no-name' | 'failed'> {
  const res = await post(verifierUrl, '/report', { postId, reason });
  return res?.ok ? 'sent' : res?.status === 401 || res?.status === 422 ? 'no-name' : 'failed';
}
