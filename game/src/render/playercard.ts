/** A player's profile, the card the server keeps for them (0.11.13). It is reached through a game or a post; no id comes back. */
import { authHeaders } from './identity';

export interface PlayerCard {
  player: string;
  /** only their name reached this viewer */ private: boolean;
  /** this viewer's own card */ own?: boolean;
  /** this viewer's own card, and the others see only the name */ hidden?: boolean;
  /** "2026-11" */ joined?: string;
  /** the title they wear */ badge?: string | null;
  trophies?: Record<string, number>;
  best?: { hash: string; seed: string; score: number }[];
  friendable: boolean;
}
export type CardTarget = { hash: string } | { postId: number };

export async function loadPlayerCard(verifierUrl: string, target: CardTarget): Promise<PlayerCard | null> {
  const q = 'hash' in target ? `hash=${encodeURIComponent(target.hash)}` : `postId=${target.postId}`;
  try {
    const res = await fetch(`${verifierUrl}/card?${q}`, { headers: authHeaders(verifierUrl) });
    return res.ok ? ((await res.json()) as PlayerCard) : null;
  } catch {
    return null;
  }
}
/** Whether this device's card is hidden; null when the server cannot be reached. */
export async function cardHidden(verifierUrl: string): Promise<boolean | null> {
  try {
    const res = await fetch(`${verifierUrl}/me/card`, { headers: authHeaders(verifierUrl) });
    return res.ok ? ((await res.json()) as { private: boolean }).private : null;
  } catch {
    return null;
  }
}
export async function setCardHidden(verifierUrl: string, hidden: boolean): Promise<boolean> {
  try {
    const res = await fetch(`${verifierUrl}/me/card`, {
      method: 'POST',
      headers: { ...authHeaders(verifierUrl), 'Content-Type': 'application/json' },
      body: JSON.stringify({ private: hidden }),
    });
    return res.ok;
  } catch {
    return false;
  }
}
