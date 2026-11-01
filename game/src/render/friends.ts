/** Friends and the feed as the client sees them (0.11.8). A friend is a handle only this device can use: no player id reaches the game. */
import { authHeaders } from './identity';
import type { DivisionMedal } from '../daily/divisions';

export interface FriendRow {
  handle: string;
  player: string;
  since: number;
}
export interface FriendLists {
  friends: FriendRow[];
  incoming: FriendRow[];
  sent: FriendRow[];
  blocked: FriendRow[];
}
export type FeedItem = { id: number; player: string; at: number } & (
  | { kind: 'run'; hash: string; seed: string; score: number }
  | { kind: 'post'; key: string; thread: string; excerpt: string }
  | { kind: 'division'; period: string; division: number; name: string; place: number; size: number; medal: DivisionMedal | null }
);
/** Reached through a run or a post, known afterwards by a handle. */
export type FriendTarget = { hash: string } | { postId: number } | { handle: string };

const get = async <T>(verifierUrl: string, path: string): Promise<T | null> => {
  try {
    const res = await fetch(`${verifierUrl}${path}`, { headers: authHeaders(verifierUrl) });
    return res.ok ? ((await res.json()) as T) : null;
  } catch {
    return null;
  }
};
export const loadFriends = (verifierUrl: string): Promise<FriendLists | null> => get<FriendLists>(verifierUrl, '/friends');
export const loadFeed = async (verifierUrl: string): Promise<FeedItem[] | null> => (await get<{ items: FeedItem[] }>(verifierUrl, '/feed'))?.items ?? null;

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
/** Ask to be friends. 'asked' covers a request sent and a friendship made: the player sees the same word for both until they look. */
export async function askFriend(verifierUrl: string, target: FriendTarget): Promise<'asked' | 'no-name' | 'failed'> {
  const res = await post(verifierUrl, '/friends/request', target);
  if (!res) return 'failed';
  if (res.ok) return 'asked';
  const code = ((await res.json().catch(() => ({}))) as { code?: string }).code;
  return code === 'no-name' ? 'no-name' : 'failed';
}
export const answerFriend = async (verifierUrl: string, handle: string, accept: boolean): Promise<boolean> =>
  !!(await post(verifierUrl, '/friends/answer', { handle, accept }))?.ok;
export const removeFriend = async (verifierUrl: string, handle: string): Promise<boolean> => !!(await post(verifierUrl, '/friends/remove', { handle }))?.ok;
export const blockPlayer = async (verifierUrl: string, target: FriendTarget): Promise<boolean> => !!(await post(verifierUrl, '/friends/block', target))?.ok;
export const unblockPlayer = async (verifierUrl: string, handle: string): Promise<boolean> => !!(await post(verifierUrl, '/friends/unblock', { handle }))?.ok;
