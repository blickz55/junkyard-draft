/**
 * Headless simulation CLI.
 *   node --import tsx tools/sim-cli.ts verify <replay.json>      → re-simulate and print the verdict (exit 1 on reject)
 *   node --import tsx tools/sim-cli.ts offers <seed>             → print the draft offers for every round
 *   node --import tsx tools/sim-cli.ts starter                   → run the starter layout and print the result
 */
import fs from 'node:fs';
import { decodeReplay, verifyReplay } from '../game/src/sim/replay';
import { draftOffers, starterLayout } from '../game/src/sim/run';
import { runLayout } from '../game/src/sim/sim';
import { RULES } from '../game/src/sim/rules';

const [cmd, arg] = process.argv.slice(2);
if (cmd === 'verify' && arg) {
  const v = verifyReplay(decodeReplay(fs.readFileSync(arg, 'utf8')));
  console.log(JSON.stringify(v));
  process.exit(v.ok ? 0 : 1);
} else if (cmd === 'offers' && arg) {
  for (let r = 1; r <= RULES.rounds; r++) console.log(`round ${r}: ${draftOffers(arg, r).join(', ')}`);
} else if (cmd === 'starter') {
  const r = runLayout(starterLayout().layout);
  console.log(JSON.stringify({ earned: r.earned, shipped: r.shipped, spawned: r.spawned, ticks: r.ticks }));
} else {
  console.error('usage: sim-cli.ts verify <replay.json> | offers <seed> | starter');
  process.exit(2);
}
