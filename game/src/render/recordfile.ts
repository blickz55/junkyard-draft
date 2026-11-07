/**
 * A copy of the record as one file: what the record page saves and opens on the web ("Save a copy", "Open a copy"), and what the
 * desktop shell keeps under its userData folder on its own (desktop/record-file.cjs; Steam Auto-Cloud carries that folder with no
 * Steam code). The file holds exactly what an email account carries between devices (SyncData, render/storage.ts), packed with a
 * format number and the game's name, and it is read with the same validator and merged with the same merge as the account copy, so
 * nothing a device earned is lost: a best is the higher of the two, days are the union, a yard's standing is the newest. The device
 * key never enters it: SyncData has no identity in it, and the shell keeps the record's keys only.
 *
 * The desktop part: `desktopRecordSync` runs once per page, from Home, where the shell starts: the file comes in and merges, and from
 * then on every change of the record (`onRecordChange`) goes back to the file, a little later, so a run of writes is one save.
 */
import { RULES_VERSION } from '../sim/types';
import { DAYS_KEPT, onRecordChange, readSyncData, validateSync, writeSyncData, type SyncData } from './storage';
import { mergeSync, sameProgress } from './sync';

export const RECORD_FORMAT = 1;
export const RECORD_GAME = 'junkyard-draft';
/** What the web saves the copy as. */
export const RECORD_FILE_NAME = 'junkyard-record.json';
const EMPTY = validateSync({})!;

export interface RecordFile {
  format: number;
  game: string;
  savedAt: string;
  rules: number;
  record: SyncData;
}

/** The record as a file. */
export const packRecord = (record: SyncData, now = new Date()): RecordFile => ({
  format: RECORD_FORMAT,
  game: RECORD_GAME,
  savedAt: now.toISOString(),
  rules: RULES_VERSION,
  record,
});

/** What a file holds as this game can use it, or null when it is not a copy of a record of this game. Each part keeps what fits. */
export function unpackRecord(raw: unknown): SyncData | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  if (r.format !== RECORD_FORMAT || r.game !== RECORD_GAME) return null;
  const copy = validateSync(r.record);
  if (!copy) return null;
  // a copy saved under other rules: its days and checked days are days whatever the rules; its scores, stars, medals, standings
  // and machine counts were earned under those rules and would land in this version's slot (the device archives old versions apart)
  if (otherRules(raw)) return { ...copy, bests: EMPTY.bests, stars: {}, medals: [], standings: [], watched: [], kinds: {} };
  return copy;
}

/** Whether a file was saved under other rules than this game's (a version behind or ahead); such a copy brings its days only. */
export function otherRules(raw: unknown): boolean {
  if (!raw || typeof raw !== 'object') return false;
  const rules = (raw as Record<string, unknown>).rules;
  return typeof rules === 'number' && rules !== RULES_VERSION;
}

/** What merging a copy added to this device's record: the counts the record page shows, and whether anything at all changed. */
export interface Additions {
  days: number;
  dailies: number;
  medals: number;
  bests: number;
  standings: number;
  /** stars, machine counts, who watched, the game count: changed, but not one of the counts above */
  other: boolean;
  any: boolean;
}
const sortedEntries = (o: object) => Object.entries(o).sort(([x], [y]) => x.localeCompare(y));
export function additions(before: SyncData, after: SyncData): Additions {
  const medals = after.medals.filter(
    (m) => !before.medals.some((x) => x.seed === m.seed && x.medal === m.medal && x.score === m.score && x.at === m.at),
  ).length;
  const bests = Object.entries(after.bests.bySeed).filter(([seed, b]) => !before.bests.bySeed[seed] || b.score > before.bests.bySeed[seed].score).length;
  const standings = after.standings.filter((s) => !before.standings.some((x) => x.seed === s.seed && x.at === s.at)).length;
  const rest = (d: SyncData) => JSON.stringify([sortedEntries(d.stars), sortedEntries(d.kinds), d.watched, d.bests.runs, d.bests.overall]);
  return {
    days: after.days.length - before.days.length,
    dailies: after.dailies.length - before.dailies.length,
    medals,
    bests,
    standings,
    other: rest(before) !== rest(after),
    any: !sameProgress(before, after),
  };
}

/** Whether a record holds any progress: a device with none takes a copy's settings too, as a device joining an account does. */
export const hasProgress = (d: SyncData): boolean => !sameProgress(d, EMPTY);

/** What writeSyncData keeps of a record (the newest days), so what is counted is what lands. */
const kept = (d: SyncData): SyncData => ({ ...d, days: d.days.slice(-DAYS_KEPT), dailies: d.dailies.slice(-DAYS_KEPT) });

/** Merge a copy into this device's record and say what it added; nothing this device earned is lost, and nothing is written when nothing changes. */
export function takeRecord(copy: SyncData): Additions {
  const local = readSyncData();
  const merged = kept(mergeSync(local, copy));
  const added = additions(local, merged);
  if (added.any) writeSyncData(merged, hasProgress(local) ? null : copy.settings);
  return added;
}

// ---- the desktop shell's file ----
interface DesktopRecord {
  load(): Promise<unknown>;
  save(data: unknown): Promise<unknown>;
}
const bridge = (): DesktopRecord | null => (window as unknown as { jdDesktop?: { record?: DesktopRecord } }).jdDesktop?.record ?? null;
/** How long after the last change the file is written: a game's end writes several keys at once, and that is one save. */
export const SAVE_DELAY_MS = 300;

let started = false;
/**
 * Once per page, in the shell: the file comes in and merges, and from then on the record goes back to the file whenever it changes.
 * Resolves whether this device learnt anything from the file, so Home can redraw. Without a shell, or on a second call, false.
 */
export async function desktopRecordSync(): Promise<boolean> {
  const shell = bridge();
  if (!shell || started) return false;
  started = true;
  let learnt = false;
  let onFile = '';
  try {
    const raw = await shell.load();
    const copy = unpackRecord(raw);
    if (copy) {
      learnt = takeRecord(copy).any;
      onFile = JSON.stringify(copy);
    }
  } catch {
    /* a file that cannot be read is no file */
  }
  let timer: ReturnType<typeof setTimeout> | null = null;
  const flush = () => {
    if (timer) clearTimeout(timer);
    timer = null;
    const record = readSyncData();
    const text = JSON.stringify(record);
    if (text === onFile) return;
    onFile = text;
    const failed = () => {
      onFile = ''; // the next change tries again
    };
    try {
      Promise.resolve(shell.save(packRecord(record))).catch(failed); // sent now, not on a later tick: on pagehide there may be none
    } catch {
      failed();
    }
  };
  const schedule = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(flush, SAVE_DELAY_MS);
  };
  onRecordChange(schedule);
  window.addEventListener('pagehide', flush);
  flush(); // what this device holds beyond the file goes to the file now
  return learnt;
}
