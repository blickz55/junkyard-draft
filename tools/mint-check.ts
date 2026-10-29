/**
 * Verify a running verifier's daily minting (PLAN-v3 0.6.1): the seed served for a day must hash to the commitment the
 * verifier published with the previous day, so nobody (operator included) could have swapped the seed after the fact.
 *   node --import tsx tools/mint-check.ts <verifier-url> [--date YYYY-MM-DD] [--secret S]
 * With --secret the seeds are also recomputed locally from the secret (operator-side check that the deployment uses
 * the backed-up secret). Exit 0 when every check passes, 1 on a failed check, 2 on usage.
 */
import { commitmentFor, isUtcDate, mintSeed, shiftDate, utcDate } from '../server/mint';

const args = process.argv.slice(2);
const url = args.find((a) => /^https?:\/\//.test(a));
const flag = (k: string) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : undefined; };
if (!url) { console.error('usage: mint-check <url> [--date YYYY-MM-DD] [--secret S]'); process.exit(2); }
const date = flag('date') ?? utcDate(new Date());
if (!isUtcDate(date)) { console.error(`bad --date ${date}`); process.exit(2); }
const secret = flag('secret');
class CheckFailed extends Error {}
const fail = (msg: string): never => { throw new CheckFailed(msg); }; // exit code is set in main(): process.exit() during an open fetch trips a libuv assertion on Windows

interface Daily { ok?: boolean; date?: string; seed?: string; commitment?: string; issuedAt?: string; closesAt?: string; minted?: boolean; error?: string }
const get = async (d: string): Promise<Daily> => { const r = await fetch(`${url}/daily?date=${d}&limit=1`); return (await r.json()) as Daily; };

async function main() {
  const prev = shiftDate(date, -1);
  const [today, yesterday] = await Promise.all([get(date), get(prev)]);
  if (!today.minted || !today.seed || !today.commitment) fail(`no minted daily for ${date}: ${JSON.stringify(today)}`);
  if (!yesterday.minted || !yesterday.seed || !yesterday.commitment) fail(`no minted daily for ${prev}: ${JSON.stringify(yesterday)}`);
  if (commitmentFor(today.seed!) !== yesterday.commitment) fail(`the seed for ${date} (${today.seed}) does not match the commitment published on ${prev} (${yesterday.commitment})`);
  console.log(`OK   ${date}: seed ${today.seed} matches the commitment published on ${prev}`);
  if (secret) {
    for (const [d, got] of [[date, today.seed], [prev, yesterday.seed]] as const) { const want = mintSeed(secret, d); if (want !== got) fail(`seed for ${d} is ${got}, the secret mints ${want}`); }
    if (commitmentFor(mintSeed(secret, shiftDate(date, 1))) !== today.commitment) fail(`the commitment published on ${date} is not the hash of what the secret mints for ${shiftDate(date, 1)}`);
    console.log(`OK   both seeds and today's commitment re-derive from the given secret`);
  }
}
main().then(() => { process.exitCode = 0; }, (e: unknown) => { console.error(e instanceof CheckFailed ? `FAIL ${e.message}` : `FAIL ${String(e)}`); process.exitCode = 1; });
