/**
 * What the testers on the private link did and said: `npm run playtest:report`. Reads the link's D1 database through wrangler, with the
 * Cloudflare login on this machine, and prints how far they got, where they stopped, which lesson steps held them up and the survey.
 * Uses .test-link.json, which is not in Git (deploy/README.md).
 *   npm run playtest:report [-- --json out.json] [--wipe]
 * --wipe deletes every row after printing them: the promise the test version makes is that nothing outlives the test.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { render, summarize, type EventRow, type FeedbackRow } from './playtest-lib';

const args = process.argv.slice(2);
const jsonOut = args.includes('--json') ? args[args.indexOf('--json') + 1] : '';
const { database } = JSON.parse(fs.readFileSync('.test-link.json', 'utf8')) as { database: string };
const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'jd-playtest-'));

function query<T>(sql: string): T[] {
  const out = execFileSync('npx', ['--yes', 'wrangler@3', 'd1', 'execute', database, '--remote', '--json', '--command', `"${sql}"`], {
    cwd,
    shell: true,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
    maxBuffer: 256 * 1024 * 1024,
  });
  return (JSON.parse(out.slice(out.indexOf('['))) as { results: T[] }[])[0].results;
}

const events = query<EventRow>('SELECT install, name, props, at FROM events ORDER BY install, at');
const feedback = query<FeedbackRow>('SELECT code, install, tester, answers, received FROM feedback ORDER BY received');
const summary = summarize(events, feedback);
console.log(render(summary));
if (jsonOut) fs.writeFileSync(jsonOut, JSON.stringify(summary, null, 2) + '\n');
if (args.includes('--wipe')) {
  query('DELETE FROM events');
  query('DELETE FROM feedback');
  console.log('\nDeleted every row.');
}
fs.rmSync(cwd, { recursive: true, force: true });
