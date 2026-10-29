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

export const HOT_DAYS = 30;
export const COLD_REPLAYS_PER_DAY = 10;

export interface ColdDay { record: DailyRecord; entries: BoardEntry[]; replays: Record<string, StoredReplay>; par: BotPar | null }
export interface ColdMonth { days: Record<string, ColdDay> }
export interface ColdIndex { seeds: Record<string, string>; replays: Record<string, string> }

const monthOf = (date: string) => date.slice(0, 7);

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
  /** All cold dates, ascending. */
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
  put(day: ColdDay) {
    const date = day.record.date, m = monthOf(date);
    const month = this.month(date) ?? { days: {} };
    month.days[date] = day;
    this.writeJson(path.join(this.dir, `${m}.json`), month);
    this.cache.delete(m); this.cache.set(m, month);
    this.index.seeds[day.record.seed] = date;
    for (const h of Object.keys(this.index.replays)) if (this.index.replays[h] === date) delete this.index.replays[h];
    for (const h of Object.keys(day.replays)) this.index.replays[h] = date;
    this.writeJson(path.join(this.dir, 'index.json'), this.index);
  }
  /** Bytes on disk across month files and the index (for /health and the measurement tool). */
  bytes(): number {
    try { return fs.readdirSync(this.dir).filter((f) => f.endsWith('.json')).reduce((n, f) => n + fs.statSync(path.join(this.dir, f)).size, 0); } catch { return 0; }
  }
}
