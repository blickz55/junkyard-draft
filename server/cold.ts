/**
 * Cold storage for closed dailies (PLAN-v4 0.7.0). The live board.json ("hot") keeps open seeds and the last HOT_DAYS of
 * frozen dailies; older frozen days move to monthly files `cold/YYYY-MM.json`, each day with its record, every entry,
 * its par and only the top COLD_REPLAYS_PER_DAY stored replays. A small `cold/index.json` maps seed → date and kept
 * replay hash → date so lookups never scan months; month files load lazily through a tiny LRU. Writes are atomic
 * (temp file + rename) like the hot board. Final boards never change, so cold files are written once per day moved
 * and only re-written when a later split adds another day to the same month.
 */
import fs from 'node:fs';
import path from 'node:path';
import type { BoardEntry, StoredReplay, DailyRecord, BotPar } from './verify';
import { isWeekId, weeklyWindow } from '../game/src/sim/weekly';

export const HOT_DAYS = 30;
export const COLD_REPLAYS_PER_DAY = 10;

export interface ColdDay { record: DailyRecord; entries: BoardEntry[]; replays: Record<string, StoredReplay>; par: BotPar | null }
export interface ColdMonth { days: Record<string, ColdDay> }
export interface ColdIndex { seeds: Record<string, string>; replays: Record<string, string> }

/** The month file a record key lives in: its date's month, or for a week id (PLAN-v4 0.7.5) the month of the Friday it opened. */
const monthOf = (key: string) => (isWeekId(key) ? weeklyWindow(key)!.openDate : key).slice(0, 7);

export class ColdStore {
  private index: ColdIndex;
  private cache = new Map<string, ColdMonth>(); // insertion order = LRU order
  constructor(readonly dir: string, private readonly lruSize = 3) {
    this.index = this.readJson<ColdIndex>(path.join(dir, 'index.json')) ?? { seeds: {}, replays: {} };
    if (!this.index.seeds || typeof this.index.seeds !== 'object') this.index.seeds = {};
    if (!this.index.replays || typeof this.index.replays !== 'object') this.index.replays = {};
  }
  private readJson<T>(file: string): T | null { try { return JSON.parse(fs.readFileSync(file, 'utf8')) as T; } catch { return null; } }
  private writeJson(file: string, value: unknown) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
    try { fs.writeFileSync(tmp, JSON.stringify(value)); fs.renameSync(tmp, file); } catch (e) { try { fs.rmSync(tmp, { force: true }); } catch { /* best effort */ } throw e; }
  }
  get dayCount(): number { return new Set(Object.values(this.index.seeds)).size; }
  get replayCount(): number { return Object.keys(this.index.replays).length; }
  /** All cold keys (dates, and week ids for weeklies), ascending. */
  dates(): string[] { return [...new Set(Object.values(this.index.seeds))].sort(); }
  dateOfSeed(seed: string): string | null { return this.index.seeds[seed] ?? null; }
  dateOfReplay(hash: string): string | null { return this.index.replays[hash] ?? null; }
  hasDate(date: string): boolean { return Object.values(this.index.seeds).includes(date); }
  month(date: string): ColdMonth | null {
    const m = monthOf(date);
    const cached = this.cache.get(m);
    if (cached) { this.cache.delete(m); this.cache.set(m, cached); return cached; }
    const loaded = this.readJson<ColdMonth>(path.join(this.dir, `${m}.json`));
    if (!loaded || typeof loaded.days !== 'object') return null;
    this.cache.set(m, loaded);
    while (this.cache.size > this.lruSize) { const oldest = this.cache.keys().next().value as string; this.cache.delete(oldest); }
    return loaded;
  }
  day(date: string): ColdDay | null { return this.month(date)?.days[date] ?? null; }
  /** Add (or overwrite, idempotently) one day; the month file and the index are rewritten atomically. */
  put(day: ColdDay, key = day.record.date) {
    const date = key, m = monthOf(key);
    const month = this.month(date) ?? { days: {} };
    month.days[date] = day;
    this.writeJson(path.join(this.dir, `${m}.json`), month);
    this.cache.delete(m); this.cache.set(m, month);
    this.index.seeds[day.record.seed] = key;
    for (const h of Object.keys(this.index.replays)) if (this.index.replays[h] === date) delete this.index.replays[h];
    for (const h of Object.keys(day.replays)) this.index.replays[h] = date;
    this.writeJson(path.join(this.dir, 'index.json'), this.index);
  }
  /** Every month file name in the directory. */
  private monthFiles(): string[] { try { return fs.readdirSync(this.dir).filter((f) => /^\d{4}-\d{2}\.json$/.test(f)); } catch { return []; } }
  /** A deleted player's kept replays leave every month file and the index; their entries stay anonymised as "deleted" (production roadmap 0.8.1: the policy's deletion promise now holds cold too). Returns the number of replays dropped. */
  dropPlayer(playerId: string): number {
    let dropped = 0; let indexChanged = false;
    for (const f of this.monthFiles()) {
      const m = this.readJson<ColdMonth>(path.join(this.dir, f)); if (!m || typeof m.days !== 'object') continue;
      let changed = false;
      for (const day of Object.values(m.days)) {
        if (!day.entries.some((e) => e.playerId === playerId)) continue;
        for (const e of day.entries) if (e.playerId === playerId) { if (day.replays[e.replayHash]) { delete day.replays[e.replayHash]; dropped++; } if (this.index.replays[e.replayHash]) { delete this.index.replays[e.replayHash]; indexChanged = true; } }
        day.entries = day.entries.map((e) => (e.playerId === playerId ? { ...e, player: 'deleted', playerId: undefined } : e));
        changed = true;
      }
      if (changed) { this.writeJson(path.join(this.dir, f), m); this.cache.delete(f.slice(0, 7)); }
    }
    if (indexChanged) this.writeJson(path.join(this.dir, 'index.json'), this.index);
    return dropped;
  }
  /** Everything cold that belongs to a player: their entries and the kept replays among them (GET /me/export, production roadmap 0.8.6). */
  playerData(playerId: string): { entries: BoardEntry[]; replays: Record<string, StoredReplay> } {
    const entries: BoardEntry[] = []; const replays: Record<string, StoredReplay> = {};
    for (const f of this.monthFiles()) {
      const m = this.readJson<ColdMonth>(path.join(this.dir, f)); if (!m || typeof m.days !== 'object') continue;
      for (const day of Object.values(m.days)) for (const e of day.entries) if (e.playerId === playerId) { entries.push(e); if (day.replays[e.replayHash]) replays[e.replayHash] = day.replays[e.replayHash]; }
    }
    return { entries, replays };
  }
  /** Bytes on disk across month files and the index (for /health and the measurement tool). */
  bytes(): number {
    try { return fs.readdirSync(this.dir).filter((f) => f.endsWith('.json')).reduce((n, f) => n + fs.statSync(path.join(this.dir, f)).size, 0); } catch { return 0; }
  }
}
