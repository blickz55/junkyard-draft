// The wall a player who follows the lights meets (rules v10, docs/DESIGN.md): on many yards, Sal's game (the lights' own), how often no card
// fits at a pick, by shift, how often the last shifts go flat, and what he makes. Rule knobs from the command line:
//   node --import tsx tools/walls.ts 60 tune job.buyerPct.plate=200
import { override } from './balance-lib';
const [n, prefix, ...kv] = process.argv.slice(2);
if (kv.length) override(Object.fromEntries(kv.map((s) => s.split('=')).map(([k, v]) => [k, Number(v)])));
const { salGame } = await import('../game/src/render/sal');
const { apply, cardParts, newRun } = await import('../game/src/sim/run');
const { cardGain } = await import('../game/src/render/estimate');
type Action = Parameters<typeof apply>[1];
const N = Number(n ?? '60');
const stuck = [0, 0, 0, 0, 0, 0];
let flat = 0;
const scores: number[] = [];
const stars = [0, 0, 0, 0];
for (let i = 0; i < N; i++) {
  const seed = `${prefix ?? 'tune'}-${i}`;
  const g = salGame(seed);
  scores.push(g.score);
  stars[g.stars]++;
  if (g.rounds[5] <= g.rounds[3] * 1.02) flat++;
  const s = newRun(seed);
  for (const a of g.actions as Action[]) {
    if (s.phase === 'draft' && a.t === 'pick') {
      const belts = s.bin.filter((m) => m.kind === 'conveyor').length;
      if (
        s.offers.every((k) => {
          const w = cardGain(s.layout, cardParts(k, s.job, s.seed), belts);
          return w.gain <= 0 && !w.room;
        })
      )
        stuck[s.round - 1]++;
    }
    apply(s, a);
  }
}
const med = (xs: number[]) => xs.slice().sort((a, b) => a - b)[Math.floor(xs.length / 2)];
console.log(
  `${kv.join(' ') || 'as it stands'}: nothing fits, by shift ${stuck.map((x) => `${Math.round((100 * x) / N)}%`).join(' ')}; flat last shifts ${flat}/${N}; Sal median $${med(scores)}, stars 0-3 ${stars.join('/')}`,
);
