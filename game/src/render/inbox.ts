/** The inbox as the client sees it (0.11.7): what happened to this player's runs while they were away. */
import { authHeaders, bearerAllowed } from './identity';
import { loadLinked, loadSubmissions } from './storage';

export interface InboxLine {
  id: number;
  kind: string;
  payload: Record<string, unknown>;
  createdAt: number;
  read: boolean;
}
export interface Inbox {
  unread: number;
  items: InboxLine[];
}

/** Whether the server can have anything for this device: it put a game on a board, or it signed in as someone who may have. */
export const hasInbox = (verifierUrl: string): boolean => bearerAllowed(verifierUrl) && (loadLinked() || Object.keys(loadSubmissions()).length > 0);

/** Null when the server cannot be reached. */
export async function loadInbox(verifierUrl: string): Promise<Inbox | null> {
  try {
    const res = await fetch(`${verifierUrl}/me/inbox`, { headers: authHeaders(verifierUrl) });
    return res.ok ? ((await res.json()) as Inbox) : null;
  } catch {
    return null;
  }
}
export type AppealResult = 'sent' | 'empty' | 'refused' | 'closed' | 'failed';
/** Ask a person to look at a decision again (0.11.2). */
export async function sendAppeal(verifierUrl: string, action: number, body: string): Promise<AppealResult> {
  if (!body.trim()) return 'empty';
  try {
    const res = await fetch(`${verifierUrl}/me/appeal`, {
      method: 'POST',
      headers: { ...authHeaders(verifierUrl), 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, body }),
    });
    return res.ok ? 'sent' : res.status === 422 ? 'refused' : res.status === 409 || res.status === 404 ? 'closed' : 'failed';
  } catch {
    return 'failed';
  }
}
export const markInboxRead = (verifierUrl: string): Promise<unknown> =>
  fetch(`${verifierUrl}/me/inbox/read`, { method: 'POST', headers: authHeaders(verifierUrl) }).catch(() => null);
