/**
 * What a panel of agents said, added up: `node tools/panel/tally.mjs r1`. Agents are not people. These numbers steer the work and are never
 * quoted as what customers think (docs/GOALS.md).
 */
import fs from 'node:fs';
import path from 'node:path';

const round = process.argv[2] ?? 'r1';
const root = path.join('tools', 'scratch', 'panel');
const reports = fs
  .readdirSync(root)
  .filter((d) => d.startsWith(`${round}-`) && fs.existsSync(path.join(root, d, 'report.json')))
  .map((d) => ({ session: d, ...JSON.parse(fs.readFileSync(path.join(root, d, 'report.json'), 'utf8')) }));
const median = (xs) => xs.slice().sort((a, b) => a - b)[Math.floor(xs.length / 2)];
const count = (f) => reports.filter(f).length;
console.log(`${reports.length} agents in ${round}`);
console.log(`median fun ${median(reports.map((r) => r.fun))}, median clear ${median(reports.map((r) => r.clear))}`);
console.log(`finished a game: ${count((r) => r.gamesFinished >= 1)}, played another by choice: ${count((r) => r.playedAnotherByChoice)}`);
console.log(
  `come back tomorrow: yes ${count((r) => r.comeBackTomorrow === 'yes')}, maybe ${count((r) => r.comeBackTomorrow === 'maybe')}, no ${count((r) => r.comeBackTomorrow === 'no')}`,
);
console.log(`would pay: yes ${count((r) => r.wouldPay === 'yes')}, maybe ${count((r) => r.wouldPay === 'maybe')}, no ${count((r) => r.wouldPay === 'no')}`);
console.log(`stuck at least once: ${count((r) => r.stuck?.length)}`);
for (const r of reports) {
  console.log(
    `\n${r.persona} (${r.device}): fun ${r.fun}, clear ${r.clear}, lessons ${r.lessonsFinished}, games ${r.gamesFinished}, best ${r.bestStars}★ $${r.bestMoney}, again ${r.playedAnotherByChoice}`,
  );
  console.log(`  goal: ${r.goalInOwnWords}`);
  console.log(`  stopped: ${r.stoppedWhy}`);
  console.log(`  one change: ${r.oneChange}`);
}
