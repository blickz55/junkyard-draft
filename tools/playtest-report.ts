/**
 * What the testers on the private link did and said: `npm run playtest:report`. Reads the link's D1 database through wrangler, with the
 * Cloudflare login on this machine, and prints how far they got, where they stopped, which lesson steps held them up and the survey.
 * Uses .test-link.json, which is not in Git (deploy/README.md).
 *   npm run playtest:report [-- --json out.json] [--wipe]
 * --wipe deletes every row after printing them: the promise the test version makes is that nothing outlives the test.
 */
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { render, summarize, type EventRow, type FeedbackRow } from './playtest-lib';

const args = process.argv.slice(2);
const jsonOut = args.includes('--json') ? args[args.indexOf('--json') + 1] : '';
const { database } = JSON.parse(fs.readFileSync('.test-link.json', 'utf8')) as { database: string };
const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'jd-playtest-'));

function query<T>(sql: string): T[] {
  // wrangler's complaints stay on screen: an expired Cloudflare login has to say so
  const out = execSync(`npx --yes wrangler@3 d1 execute ${database} --remote --json --command "${sql}"`, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'inherit'],
    maxBuffer: 256 * 1024 * 1024,
  });
  return (JSON.parse(out.slice(out.indexOf('['))) as { results: T[] }[])[0].results;
}

let events: EventRow[];
let feedback: FeedbackRow[];
try {
  events = query<EventRow>('SELECT install, name, props, at FROM events ORDER BY install, at');
  feedback = query<FeedbackRow>('SELECT code, install, tester, answers, received FROM feedback ORDER BY received');
} catch {
  console.error('Could not read the test link. If the Cloudflare login has expired, run this and try again:\n  npx wrangler@3 login');
  process.exit(1);
}
const summary = summarize(events, feedback);
console.log(render(summary));
if (jsonOut) fs.writeFileSync(jsonOut, JSON.stringify(summary, null, 2) + '\n');
if (args.includes('--wipe')) {
  query('DELETE FROM events');
  query('DELETE FROM feedback');
  console.log('\nDeleted every row.');
}
fs.rmSync(cwd, { recursive: true, force: true });
