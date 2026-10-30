/**
 * Backups and the restore drill (production roadmap 0.8.3). `backup()` archives a verifier data directory (board, cold
 * months, moderation audit, opt-in events, anything else the service writes) into one `jd-backup-<utc>.tar.gz` with a
 * manifest of SHA-256 hashes, never the daily secret and never a half-written temp file, and copies it to a local directory
 * or an rclone remote. `restoreDrill()` unpacks an archive somewhere temporary, checks every hash, starts a verifier on it
 * and proves the restored service answers with the archive's counts and serves a sample of its entries. Both need the `tar`
 * on the PATH (GNU tar on Linux, bsdtar on Windows 10+ and macOS). No dependencies.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { createHash } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
/** Never archived: the daily secret (kept offline by the operator; a leak lets anyone pre-play future days) and temp files of atomic writes. */
export const EXCLUDED = (name: string): boolean => name === 'daily-secret' || /\.tmp$/.test(name) || /^\.board-.*\.tmp$/.test(name);
export const BACKUP_PREFIX = 'jd-backup-';
export interface ManifestFile { path: string; bytes: number; sha256: string }
export interface Manifest { format: 1; createdAt: string; dataDir: string; host: string; files: ManifestFile[]; totalBytes: number }
export interface BackupReport { archive: string; bytes: number; files: number; totalBytes: number; target: string; pruned: string[]; createdAt: string }

const sha256File = (file: string): string => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
/** Every regular file under `dir` (relative, forward slashes), excluding what EXCLUDED names, sorted. */
export function listDataFiles(dir: string): string[] {
  const out: string[] = [];
  const walk = (rel: string) => {
    for (const ent of fs.readdirSync(path.join(dir, rel), { withFileTypes: true })) {
      const r = rel ? `${rel}/${ent.name}` : ent.name;
      if (EXCLUDED(ent.name)) continue;
      if (ent.isDirectory()) walk(r); else if (ent.isFile()) out.push(r);
    }
  };
  walk('');
  return out.sort();
}
export function buildManifest(dataDir: string, now = new Date()): Manifest {
  const files = listDataFiles(dataDir).map((p) => { const abs = path.join(dataDir, p); return { path: p, bytes: fs.statSync(abs).size, sha256: sha256File(abs) }; });
  return { format: 1, createdAt: now.toISOString(), dataDir: path.resolve(dataDir), host: os.hostname(), files, totalBytes: files.reduce((n, f) => n + f.bytes, 0) };
}
const stamp = (d: Date) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
export const archiveNameFor = (now: Date) => `${BACKUP_PREFIX}${stamp(now)}.tar.gz`;
/** An rclone remote looks like `remote:path`; a Windows drive letter (`C:\…`) is a local path. */
export const isRcloneTarget = (target: string): boolean => /^[A-Za-z0-9_-]+:/.test(target) && !/^[A-Za-z]:[\\/]/.test(target);
/** GNU tar reads `C:\\…` as a remote host, so archives are always named relative to `cwd` (the stage, or the archive's own directory). */
function tar(args: string[], cwd: string): void {
  const r = spawnSync('tar', args, { cwd, encoding: 'utf8' });
  if (r.error) throw new Error(`tar not available: ${r.error.message}`);
  if (r.status !== 0) throw new Error(`tar ${args[0]} failed (${r.status}): ${(r.stderr || r.stdout || '').trim()}`);
}

export interface BackupOptions { /** local directory (created) or rclone `remote:path` */ target: string; /** keep at most this many archives in a local target directory (oldest removed); 0 keeps all */ keep?: number; now?: Date; /** stage archives here before copying (default: the OS temp dir) */ tmp?: string }
/** Archive `dataDir` and place the archive in `target`. Returns what was written. Throws on any failure (nothing half-copied is left behind in a local target). */
export function backup(dataDir: string, o: BackupOptions): BackupReport {
  if (!fs.existsSync(path.join(dataDir, 'board.json'))) throw new Error(`${dataDir} has no board.json: not a verifier data directory`);
  const now = o.now ?? new Date();
  const manifest = buildManifest(dataDir, now);
  const stage = fs.mkdtempSync(path.join(o.tmp ?? os.tmpdir(), 'jd-backup-stage-'));
  try {
    fs.writeFileSync(path.join(stage, 'manifest.json'), JSON.stringify(manifest, null, 1));
    const name = archiveNameFor(now); const archive = path.join(stage, name);
    // two -C groups: the data files from the data directory, the manifest from the stage; excluded names are simply not listed
    tar(['-czf', name, '-C', path.resolve(dataDir), ...manifest.files.map((f) => f.path), '-C', stage, 'manifest.json'], stage);
    const bytes = fs.statSync(archive).size;
    let pruned: string[] = [];
    if (isRcloneTarget(o.target)) {
      const r = spawnSync('rclone', ['copyto', archive, `${o.target.replace(/\/+$/, '')}/${name}`], { encoding: 'utf8' });
      if (r.error) throw new Error(`rclone not available: ${r.error.message}`);
      if (r.status !== 0) throw new Error(`rclone copyto failed (${r.status}): ${(r.stderr || '').trim()}`);
    } else {
      fs.mkdirSync(o.target, { recursive: true });
      const tmpDest = path.join(o.target, `.${name}.part`); fs.copyFileSync(archive, tmpDest); fs.renameSync(tmpDest, path.join(o.target, name));
      if (o.keep && o.keep > 0) {
        const all = fs.readdirSync(o.target).filter((f) => f.startsWith(BACKUP_PREFIX) && f.endsWith('.tar.gz')).sort();
        pruned = all.slice(0, Math.max(0, all.length - o.keep));
        for (const f of pruned) fs.rmSync(path.join(o.target, f), { force: true });
      }
    }
    return { archive: isRcloneTarget(o.target) ? `${o.target}/${name}` : path.join(o.target, name), bytes, files: manifest.files.length, totalBytes: manifest.totalBytes, target: o.target, pruned, createdAt: manifest.createdAt };
  } finally { fs.rmSync(stage, { recursive: true, force: true }); }
}

export interface DrillOptions { /** a live verifier to compare counts with (informational) */ live?: string; /** entries to fetch back from the restored service (default 5) */ sample?: number; /** keep the restored directory (default: removed) */ keepDir?: boolean; /** how long to wait for the restored verifier (ms) */ startMs?: number; tmp?: string }
export interface DrillReport { ok: boolean; archive: string; restoredTo: string | null; manifestFiles: number; hashMismatches: string[]; archiveEntries: number; restoredHealth: Record<string, unknown> | null; restoredEntries: number | null; sampled: { hash: string; seed: string; score: number; served: boolean; scoreMatches: boolean }[]; live: Record<string, unknown> | null; liveDelta: { entries: number; players: number } | null; problems: string[]; ms: number }

const freePort = (): Promise<number> => new Promise((resolve, reject) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = (s.address() as net.AddressInfo).port; s.close(() => resolve(p)); }); s.on('error', reject); });
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Unpack, verify every hash, start a verifier on the restored directory, compare and sample. Never touches the archive or any live service's data. */
export async function restoreDrill(archive: string, o: DrillOptions = {}): Promise<DrillReport> {
  const t0 = Date.now(); const problems: string[] = []; const sampleN = o.sample ?? 5;
  const report: DrillReport = { ok: false, archive: path.resolve(archive), restoredTo: null, manifestFiles: 0, hashMismatches: [], archiveEntries: 0, restoredHealth: null, restoredEntries: null, sampled: [], live: null, liveDelta: null, problems, ms: 0 };
  if (!fs.existsSync(archive)) { problems.push(`archive not found: ${archive}`); report.ms = Date.now() - t0; return report; }
  const dir = fs.mkdtempSync(path.join(o.tmp ?? os.tmpdir(), 'jd-restore-')); report.restoredTo = dir;
  let child: ReturnType<typeof spawn> | null = null;
  try {
    tar(['-xzf', path.basename(archive), '-C', dir], path.dirname(path.resolve(archive)));
    const manifestFile = path.join(dir, 'manifest.json');
    if (!fs.existsSync(manifestFile)) { problems.push('archive carries no manifest.json'); return report; }
    const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8')) as Manifest;
    report.manifestFiles = manifest.files.length;
    for (const f of manifest.files) { const abs = path.join(dir, f.path); if (!fs.existsSync(abs)) { report.hashMismatches.push(`${f.path}: missing`); continue; } const h = sha256File(abs); if (h !== f.sha256) report.hashMismatches.push(`${f.path}: ${h.slice(0, 12)} ≠ ${f.sha256.slice(0, 12)}`); }
    if (report.hashMismatches.length) { problems.push(`${report.hashMismatches.length} file(s) differ from the manifest`); return report; }
    if (fs.existsSync(path.join(dir, 'daily-secret'))) problems.push('the archive carries the daily secret: it must never be backed up');
    // what the archive holds, read directly (the same loader the service uses)
    const { loadBoard } = await import('../server/verify');
    const { RULES_VERSION } = await import('../game/src/sim/types');
    const board = loadBoard(fs.readFileSync(path.join(dir, 'board.json'), 'utf8'));
    const current = board.entries.filter((e) => e.rulesVersion === RULES_VERSION);
    report.archiveEntries = current.length;
    // a verifier on the restored directory: no par jobs, a throwaway secret (the real one lives offline, never in an archive), quiet log
    const port = await freePort();
    child = spawn(process.execPath, ['--import', 'tsx', path.join(ROOT, 'server', 'verify.ts')], { cwd: ROOT, env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', BOARD_FILE: path.join(dir, 'board.json'), BOT_PAR: '0', DAILY_SECRET: 'restore-drill', VERIFIER_LOG: '0', RESIM_INLINE: '1' }, stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = ''; child.stderr?.on('data', (c) => { stderr += String(c); });
    const base = `http://127.0.0.1:${port}`;
    const deadline = Date.now() + (o.startMs ?? 30_000); let health: Record<string, unknown> | null = null;
    while (Date.now() < deadline && !health) { try { const r = await fetch(`${base}/health`); if (r.ok) health = await r.json() as Record<string, unknown>; } catch { /* starting */ } if (!health) await wait(250); }
    if (!health) { problems.push(`the restored verifier did not answer /health within ${o.startMs ?? 30_000} ms${stderr ? `: ${stderr.trim().slice(0, 300)}` : ''}`); return report; }
    report.restoredHealth = health; report.restoredEntries = typeof health.entries === 'number' ? health.entries : null;
    if (report.restoredEntries !== report.archiveEntries) problems.push(`restored service counts ${report.restoredEntries} current entries, the archive holds ${report.archiveEntries}`);
    // sample: spread across the board, fetched through /entry (never gated, cold or hot)
    const step = Math.max(1, Math.floor(current.length / Math.max(1, sampleN)));
    for (let i = 0; i < current.length && report.sampled.length < sampleN; i += step) {
      const e = current[i];
      try { const r = await fetch(`${base}/entry?hash=${encodeURIComponent(e.replayHash)}&seed=${encodeURIComponent(e.seed)}`); const j = r.ok ? await r.json() as { score?: number } : null; report.sampled.push({ hash: e.replayHash, seed: e.seed, score: e.score, served: r.ok, scoreMatches: !!j && j.score === e.score }); }
      catch { report.sampled.push({ hash: e.replayHash, seed: e.seed, score: e.score, served: false, scoreMatches: false }); }
    }
    const bad = report.sampled.filter((s) => !s.served || !s.scoreMatches); if (bad.length) problems.push(`${bad.length} of ${report.sampled.length} sampled entries not served with the archived score`);
    if (o.live) {
      try { const r = await fetch(`${o.live.replace(/\/+$/, '')}/health`); report.live = await r.json() as Record<string, unknown>; const n = (k: string) => (typeof report.live![k] === 'number' ? report.live![k] as number : 0); report.liveDelta = { entries: n('entries') - report.archiveEntries, players: n('players') - (typeof health.players === 'number' ? health.players : 0) }; }
      catch (e) { problems.push(`live verifier unreachable: ${(e as Error).message}`); }
    }
    report.ok = problems.length === 0;
    return report;
  } catch (e) { problems.push((e as Error).message); return report; }
  finally {
    if (child) { child.kill(); await new Promise<void>((r) => { child!.once('exit', () => r()); setTimeout(r, 3000); }); }
    report.ms = Date.now() - t0;
    if (!o.keepDir) { try { fs.rmSync(dir, { recursive: true, force: true }); report.restoredTo = null; } catch { /* a handle may linger briefly on Windows */ } }
  }
}
