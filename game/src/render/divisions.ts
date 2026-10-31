/** Where this device finished when a day closed (0.11.11). Home asks once; the trophies go to local storage for Your record, which never fetches. */
import type { DivisionMedal } from '../daily/divisions';
import { weeklyWindow } from '../sim/weekly';
import { authHeaders, bearerAllowed } from './identity';
import { loadSubmissions, recordTrophies } from './storage';

export interface Placement {
  period: string;
  division: number;
  name: string;
  place: number;
  size: number;
  score: number;
  medal: DivisionMedal | null;
}

/** The latest placement, null when there is none or the server cannot be reached. A device that never put a game on a board asks nothing. */
export async function latestPlacement(verifierUrl: string): Promise<Placement | null> {
  if (!bearerAllowed(verifierUrl) || !Object.keys(loadSubmissions()).length) return null;
  try {
    const res = await fetch(`${verifierUrl}/me/divisions?limit=1`, { headers: authHeaders(verifierUrl) });
    if (!res.ok) return null;
    const b = (await res.json()) as { divisions?: Placement[]; trophies?: Record<string, number> };
    recordTrophies(b.trophies ?? {});
    return b.divisions?.[0] ?? null;
  } catch {
    return null;
  }
}

const SHOWN_FOR_MS = 7 * 24 * 3_600_000;
/** Home mentions a placement for a week after the day closed. */
export function isFresh(period: string, now = new Date()): boolean {
  const opened = weeklyWindow(period)?.closesAt ?? period;
  return now.getTime() - Date.parse(opened) < SHOWN_FOR_MS;
}

export interface DivisionBoard {
  name: string;
  rows: { place: number; score: number; medal: DivisionMedal | null; player: string; you: boolean }[];
}
export async function loadDivisionBoard(verifierUrl: string, p: Pick<Placement, 'period' | 'division'>): Promise<DivisionBoard | null> {
  try {
    const res = await fetch(`${verifierUrl}/division?period=${encodeURIComponent(p.period)}&division=${p.division}`, { headers: authHeaders(verifierUrl) });
    return res.ok ? ((await res.json()) as DivisionBoard) : null;
  } catch {
    return null;
  }
}
