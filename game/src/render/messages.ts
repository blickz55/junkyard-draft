/** Direct messages as the client sees them (0.11.9): a friend's handle, never an id. */
import { authHeaders } from './identity';
import type { ReportReason } from '../identity/identity';

export interface DirectMessage {
  id: number;
  mine: boolean;
  at: number;
  removed: boolean;
  body: string;
}
export interface Conversation {
  player: string;
  messages: DirectMessage[];
  next: number | null;
  friends: boolean;
}
export async function loadConversation(verifierUrl: string, handle: string, before?: number): Promise<Conversation | null> {
  try {
    const res = await fetch(`${verifierUrl}/messages/with?handle=${encodeURIComponent(handle)}${before ? `&before=${before}` : ''}`, {
      headers: authHeaders(verifierUrl),
    });
    return res.ok ? ((await res.json()) as Conversation) : null;
  } catch {
    return null;
  }
}
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
type Sent = { ok: true; message: DirectMessage } | { ok: false; code: string };
export async function sendMessage(verifierUrl: string, handle: string, body: string): Promise<Sent> {
  const res = await post(verifierUrl, '/messages/send', { handle, body });
  if (!res) return { ok: false, code: 'failed' };
  if (res.status === 429) return { ok: false, code: 'rate-limited' };
  const json = (await res.json().catch(() => ({}))) as { ok?: boolean; code?: string; message?: DirectMessage };
  return json.ok && json.message ? { ok: true, message: json.message } : { ok: false, code: json.code ?? 'failed' };
}
export const reportMessage = async (verifierUrl: string, id: number, reason: ReportReason): Promise<boolean> =>
  !!(await post(verifierUrl, '/messages/report', { id, reason }))?.ok;
