/**
 * Back up a verifier data directory (production roadmap 0.8.3): one tar.gz with a hash manifest, never the daily secret,
 * copied to a local directory or an rclone remote, older local archives pruned.
 *   node --import tsx tools/backup.ts <data-dir> --out <dir | remote:path> [--keep 14]
 * Exit 0 with a JSON summary on success, 1 on any failure, 2 on usage. Nightly cron line: deploy/backup.cron.
 */
import { backup } from './backup-lib';

const args = process.argv.slice(2);
const flag = (k: string) => {
  const i = args.indexOf(`--${k}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const dataDir = args.find((a, i) => !a.startsWith('--') && (i === 0 || !args[i - 1].startsWith('--')));
const out = flag('out');
if (!dataDir || !out) {
  console.error('usage: backup <data-dir> --out <dir | remote:path> [--keep 14]');
  process.exit(2);
}
try {
  const report = backup(dataDir, { target: out, keep: flag('keep') != null ? Number(flag('keep')) : 14 });
  console.log(JSON.stringify(report, null, 2));
} catch (e) {
  console.error(`FAIL ${(e as Error).message}`);
  process.exitCode = 1;
}
