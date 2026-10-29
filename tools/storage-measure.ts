/**
 * Storage measurement (PLAN-v3 0.6.7): how big does board.json get and how long does one commit take as players and days
 * grow, measured against the policy trigger for moving to SQLite (5 MB on disk or 50 ms per commit).
 *
 * The verifier's retention caps bound the file: at most DEFAULT_MAX_ENTRIES_PER_SEED entries and DEFAULT_REPLAYS_PER_SEED
 * stored replays per seed, DEFAULT_MAX_SEEDS seeds, one identity per player, one record per issued day, one par per seed.
 * So the tool synthesises the *post-retention* shape directly: for D days and P players, min(P, cap) entries per day,
 * min(P, replay cap) replays per day with real finished-run action lists, P identities, D dailies with medals, D pars.
 * It then writes the file, loads it through loadBoard (the startup path), constructs a Verifier, and times the real
 * commit path (setPar: stringify + temp file + rename) and a board read. Numbers go to docs/baselines/0.6/storage.json.
 *
 *   node --import tsx tools/storage-measure.ts [--players 100,1000,10000] [--days 30] [--out docs/baselines/0.6/storage.json]
 * Exit 0; the JSON says whether any scenario crossed the trigger (the README reads it, nothing fails automatically).
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { createHash } from 'node:crypto';
import { apply, newRun } from '../game/src/sim/run';
import { exportReplay } from '../game/src/sim/replay';
import { RULES } from '../game/src/sim/rules';
import { RULES_VERSION } from '../game/src/sim/types';
import { Verifier, loadBoard, mintSeed, commitmentFor, shiftDate, DEFAULT_MAX_ENTRIES_PER_SEED, DEFAULT_REPLAYS_PER_SEED, DEFAULT_MAX_SEEDS, medalThresholds, type Board, type BoardEntry, type StoredReplay, type DailyRecord, type Player } from '../server/verify';
import { tagFor } from '../game/src/identity/identity';

const args = process.argv.slice(2);
const opt = (k: string, d: string) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };
const PLAYERS = opt('players', '100,1000,10000').split(',').map(Number);
const DAYS = Number(opt('days', '30'));
const OUT = opt('out', 'docs/baselines/0.6/storage.json');
export const TRIGGER = { bytes: 5 * 1024 * 1024, commitMs: 50 } as const;

/** A few distinct real finished runs on a seed (different machine counts) so replays carry realistic action lists. */
function runsFor(seed: string, n: number) {
  const park: [number, number][] = [[6, 0], [6, 5], [0, 5], [6, 2], [0, 0]];
  const out = [] as ReturnType<typeof exportReplay>[];
  for (let k = 0; k < n; k++) {
    const s = newRun(seed);
    for (let r = 1; r <= RULES.rounds; r++) { apply(s, { t: 'pick', i: 0 }); if (r === RULES.rounds) for (let p = 0; p < k % park.length && s.bin[p]; p++) { try { apply(s, { t: 'place', id: s.bin[p].id, x: park[p][0], y: park[p][1], dir: 0 }); } catch { /* cell taken on this seed: a variant with fewer extra parts is fine */ } } if (k >= park.length && r === 1 && s.bin[0]) apply(s, { t: 'rotate', id: s.bin[0].id }); apply(s, { t: 'run' }); apply(s, { t: 'next' }); }
    out.push(exportReplay(s));
  }
  return out;
}

export function synthesise(players: number, days: number, secret = 'measure-secret', startDate = '2027-01-01'): Board {
  const entries: BoardEntry[] = []; const replays: Record<string, StoredReplay> = {}; const dailies: Record<string, DailyRecord> = {}; const pars: Board['pars'] = {}; const playersRec: Record<string, Player> = {};
  const ids = Array.from({ length: players }, (_, i) => createHash('sha256').update(`player-${i}`).digest('hex'));
  for (const [i, id] of ids.entries()) playersRec[id] = { name: `Player ${i}`, tag: tagFor(id), createdAt: `${startDate}T00:00:00.000Z`, renamedAt: `${startDate}T00:00:00.000Z` };
  const perDay = Math.min(players, DEFAULT_MAX_ENTRIES_PER_SEED), replaysPerDay = Math.min(players, DEFAULT_REPLAYS_PER_SEED);
  for (let d = 0; d < Math.min(days, DEFAULT_MAX_SEEDS); d++) {
    const date = shiftDate(startDate, d); const seed = mintSeed(secret, date);
    const variants = runsFor(seed, 6);
    const scores: number[] = [];
    for (let p = 0; p < perDay; p++) {
      const v = variants[p % variants.length]; const score = v.claimedScore + (p % 7) * 10; scores.push(score); // spread scores so ranks and medals are not degenerate
      const hash = createHash('sha256').update(`${seed}:${p}`).digest('hex');
      entries.push({ seed, score, player: `${playersRec[ids[p]].name}#${playersRec[ids[p]].tag}`, verifiedAt: `${date}T${String(p % 24).padStart(2, '0')}:${String(p % 60).padStart(2, '0')}:00.000Z`, rulesVersion: RULES_VERSION, actions: v.actions.length, replayHash: hash, finalMachines: 5 + (p % 3), playerId: ids[p] });
      if (p < replaysPerDay) replays[hash] = { seed, rulesVersion: RULES_VERSION, actions: v.actions, score, player: entries[entries.length - 1].player, verifiedAt: entries[entries.length - 1].verifiedAt };
    }
    const closesAt = `${shiftDate(date, 2)}T00:00:00.000Z`;
    dailies[date] = { date, seed, commitment: commitmentFor(mintSeed(secret, shiftDate(date, 1))), issuedAt: `${date}T00:00:00.500Z`, closesAt, rulesVersion: RULES_VERSION, build: '0.6.0', frozenAt: closesAt, medals: medalThresholds(scores) };
    pars[seed] = { par: variants[0].claimedScore, runs: 5, tries: 40, rulesVersion: RULES_VERSION, computedAt: `${date}T00:01:00.000Z` };
  }
  return { entries, replays, pars, players: playersRec, dailies };
}

interface Scenario { players: number; days: number; entries: number; replays: number; bytes: number; mb: number; loadMs: number; constructMs: number; commitMs: { median: number; max: number; samples: number[] }; boardReadMs: number; archiveMs: number; overTrigger: boolean }

function median(xs: number[]) { const s = xs.slice().sort((a, b) => a - b); return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2; }

export function measure(players: number, days: number, dir: string): Scenario {
  const board = synthesise(players, days);
  const file = path.join(dir, `board-${players}x${days}.json`);
  const text = JSON.stringify(board);
  fs.writeFileSync(file, text);
  const bytes = Buffer.byteLength(text);
  let t = performance.now(); const loaded = loadBoard(fs.readFileSync(file, 'utf8')); const loadMs = performance.now() - t;
  if (loaded.entries.length !== board.entries.length) throw new Error('loadBoard dropped rows');
  t = performance.now(); const v = new Verifier(file, { dailySecret: 'measure-secret' }); const constructMs = performance.now() - t;
  const samples: number[] = [];
  for (let i = 0; i < 7; i++) { t = performance.now(); v.setPar(`probe-${i}`, 100 + i, 5, 40); samples.push(performance.now() - t); } // the real commit: stringify, temp file, rename
  const firstSeed = board.entries[0].seed;
  t = performance.now(); v.board(firstSeed, 100); const boardReadMs = performance.now() - t;
  t = performance.now(); v.archive({ limit: 30 }, new Date('2027-03-01T00:00:00Z')); const archiveMs = performance.now() - t;
  const commit = { median: Math.round(median(samples) * 100) / 100, max: Math.round(Math.max(...samples) * 100) / 100, samples: samples.map((x) => Math.round(x * 100) / 100) };
  fs.rmSync(file, { force: true });
  return { players, days, entries: board.entries.length, replays: Object.keys(board.replays ?? {}).length, bytes, mb: Math.round((bytes / 1048576) * 100) / 100, loadMs: Math.round(loadMs * 10) / 10, constructMs: Math.round(constructMs * 10) / 10, commitMs: commit, boardReadMs: Math.round(boardReadMs * 100) / 100, archiveMs: Math.round(archiveMs * 100) / 100, overTrigger: bytes > TRIGGER.bytes || commit.median > TRIGGER.commitMs };
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1').replace(/\//g, path.sep);
if (isMain || process.argv[1]?.endsWith('storage-measure.ts')) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jd-storage-'));
  const started = performance.now();
  const scenarios = PLAYERS.map((p) => { const s = measure(p, DAYS, dir); console.log(`${String(p).padStart(6)} players × ${DAYS} days: ${s.entries} entries, ${s.replays} replays, ${s.mb} MB, load ${s.loadMs} ms, commit median ${s.commitMs.median} ms (max ${s.commitMs.max}), board read ${s.boardReadMs} ms, archive ${s.archiveMs} ms${s.overTrigger ? '  ← OVER TRIGGER' : ''}`); return s; });
  const report = { at: new Date().toISOString(), node: process.version, platform: `${os.platform()} ${os.release()}`, cpu: os.cpus()[0]?.model ?? 'unknown', trigger: TRIGGER, caps: { entriesPerSeed: DEFAULT_MAX_ENTRIES_PER_SEED, replaysPerSeed: DEFAULT_REPLAYS_PER_SEED, seeds: DEFAULT_MAX_SEEDS }, days: DAYS, scenarios, anyOverTrigger: scenarios.some((s) => s.overTrigger), elapsedSec: Math.round((performance.now() - started) / 100) / 10 };
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(report, null, 1) + '\n');
  fs.rmSync(dir, { recursive: true, force: true });
  console.log(`${report.anyOverTrigger ? 'TRIGGER CROSSED' : 'within trigger'} · wrote ${OUT} in ${report.elapsedSec} s`);
}
