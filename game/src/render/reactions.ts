/** What other players made of a run, as the client sees it: the reactions (0.11.3), the one this device left, whether the run is its own, and who watched it (0.11.4). */
import type { ReactionCounts, ReactionId } from '../content/reactions';
import { authHeaders } from './identity';

export interface RunReactions {
  reactions: ReactionCounts;
  mine: ReactionId | null;
  own: boolean;
  seen: { times: number; players: number };
}

/** Null when the server cannot be reached or does not know the run: the screens then show nothing. */
export async function loadReactions(verifierUrl: string, hash: string): Promise<RunReactions | null> {
  try {
    const res = await fetch(`${verifierUrl}/entry?hash=${encodeURIComponent(hash)}`, { headers: authHeaders(verifierUrl) });
    if (!res.ok) return null;
    const b = (await res.json()) as Partial<RunReactions>;
    return { reactions: b.reactions ?? {}, mine: b.mine ?? null, own: !!b.own, seen: b.seen ?? { times: 0, players: 0 } };
  } catch {
    return null;
  }
}

/** Leave a reaction, or take it back with null. Null when it did not go through. */
export async function sendReaction(verifierUrl: string, hash: string, emote: ReactionId | null): Promise<Pick<RunReactions, 'reactions' | 'mine'> | null> {
  try {
    const res = await fetch(`${verifierUrl}/react`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders(verifierUrl) },
      body: JSON.stringify({ hash, emote }),
    });
    if (!res.ok) return null;
    const b = (await res.json()) as Partial<RunReactions>;
    return { reactions: b.reactions ?? {}, mine: b.mine ?? null };
  } catch {
    return null;
  }
}
