/** What this device knows of the paint shop (0.11.12). The server decides what is earned and what is worn; local storage keeps the last look, so a game starts in it at once. */
import { lookFrom, type Look, type Progress } from '../content/cosmetics';
import { authHeaders } from './identity';
import { loadLook, recordLook } from './storage';

export interface Shop {
  owned: string[];
  look: Look;
  progress: Progress;
}
const heard = (raw: unknown): Look => {
  const look = lookFrom(Object.values((raw ?? {}) as Record<string, unknown>));
  recordLook(look);
  return look;
};

/** What is on the shelves for this player. A device with no key yet has earned nothing; null when the server cannot be reached. */
export async function loadShop(verifierUrl: string): Promise<Shop | null> {
  try {
    const res = await fetch(`${verifierUrl}/me/cosmetics`, { headers: authHeaders(verifierUrl) });
    if (res.status === 401) return { owned: [], look: loadLook(), progress: { days: 0, trophies: {} } };
    if (!res.ok) return null;
    const b = (await res.json()) as { owned?: string[]; look?: unknown; progress?: Progress };
    return { owned: b.owned ?? [], look: heard(b.look), progress: b.progress ?? { days: 0, trophies: {} } };
  } catch {
    return null;
  }
}
/** Wear one or take it off; the new look, or null when that did not go through. */
export async function wearLook(verifierUrl: string, id: string, on: boolean): Promise<Look | null> {
  try {
    const res = await fetch(`${verifierUrl}/me/cosmetics`, {
      method: 'POST',
      headers: { ...authHeaders(verifierUrl), 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, on }),
    });
    return res.ok ? heard(((await res.json()) as { look?: unknown }).look) : null;
  } catch {
    return null;
  }
}
