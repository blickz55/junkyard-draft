/**
 * Restore drill (production roadmap 0.8.3): unpack a backup somewhere temporary, check every hash against its manifest,
 * start a verifier on the restored directory, and prove it answers with the archive's counts and serves a sample of its
 * entries at their archived scores. With --live, also report how far the live service has moved since the archive.
 *   node --import tsx tools/restore-drill.ts <archive.tar.gz> [--live http://127.0.0.1:4400] [--sample 5] [--keep-dir]
 * Exit 0 when the drill passes, 1 otherwise; a JSON report is printed either way. The live service is never touched.
 */
import { restoreDrill } from './backup-lib';

const args = process.argv.slice(2);
const flag = (k: string) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : undefined; };
const archive = args.find((a, i) => !a.startsWith('--') && (i === 0 || !args[i - 1].startsWith('--') || args[i - 1] === '--keep-dir'));
if (!archive) { console.error('usage: restore-drill <archive.tar.gz> [--live <url>] [--sample 5] [--keep-dir]'); process.exit(2); }
restoreDrill(archive, { live: flag('live'), sample: flag('sample') != null ? Number(flag('sample')) : 5, keepDir: args.includes('--keep-dir') }).then((r) => {
  console.log(JSON.stringify(r, null, 2));
  console.log(r.ok ? `OK   restored ${r.archiveEntries} entries, ${r.sampled.length} sampled and served, ${r.manifestFiles} files verified in ${r.ms} ms` : `FAIL ${r.problems.join('; ')}`);
  process.exitCode = r.ok ? 0 : 1;
}, (e) => { console.error(`FAIL ${String(e)}`); process.exitCode = 1; });
