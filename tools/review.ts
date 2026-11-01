/**
 * What the verifier noted about games on days and weeks, read for a person (production roadmap 0.12.5). It changes nothing and accuses nobody: each
 * line is something to look at, and a recording to watch. A verdict is a decision made with `tools/moderate.ts`.
 *   node --import tsx tools/review.ts <data-dir> [--json out]
 * Exit 0 either way, 2 on usage.
 */
import fs from 'node:fs';
import path from 'node:path';
import { CommunityStore } from '../server/community';
import { reviewSignals } from '../server/review';

const args = process.argv.slice(2);
const dir = args.find((a) => !a.startsWith('--') && args[args.indexOf(a) - 1] !== '--json');
if (!dir) {
  console.error('usage: review <data-dir> [--json out]');
  process.exit(2);
}
const store = new CommunityStore(path.join(dir, 'community.db'));
const rows = store.signals();
store.close();
const findings = reviewSignals(rows);
console.log(`${rows.length} signals, ${findings.length} to look at`);
for (const f of findings) console.log(`${f.kind.padEnd(10)} ${f.seed}  ${f.player.slice(0, 12)}  ${f.hash.slice(0, 12)}  ${f.why}`);
const json = args.indexOf('--json');
if (json >= 0) fs.writeFileSync(args[json + 1], JSON.stringify({ signals: rows.length, findings }, null, 2));
