// Is "New offers" worth its price? Sal's way of playing (render/sal.ts) never dealing again, dealing again when no card fits (what Sal and the
// coach do), and dealing again whenever the best card adds little. docs/DESIGN.md has the result: node --import tsx tools/reroll-study.ts 60
import { apply, canReroll, cardParts, newRun, type Action } from '../game/src/sim/run';
import { runLayout } from '../game/src/sim/sim';
import { cardGain, type Placed } from '../game/src/render/estimate';
import { dropActions } from '../game/src/render/placement';
import { salGame } from '../game/src/render/sal';

type Policy = 'never' | 'none-fits' | 'little';
const stats = { used: 0, found: 0 };
function play(seed: string, policy: Policy): number {
  const s = newRun(seed);
  const act = (a: Action) => apply(s, a);
  while (s.phase !== 'finished') {
    if (s.phase === 'draft') {
      const belts = s.bin.filter((m) => m.kind === 'conveyor').length;
      const judge = () => s.offers.map((k) => cardGain(s.layout, cardParts(k, s.job, s.seed), belts));
      const value = (g: { gain: number; room?: boolean }) => g.gain || (g.room ? 0.5 : 0);
      let gains = judge();
      const top = Math.max(...gains.map(value));
      const line = runLayout(s.layout).earned;
      const want = policy === 'none-fits' ? top <= 0 : policy === 'little' ? top < Math.max(40, line * 0.05) : false;
      if (want && canReroll(s) === null) {
        act({ t: 'reroll' });
        stats.used++;
        gains = judge();
        if (Math.max(...gains.map(value)) > top) stats.found++;
      }
      let best = 0;
      let bestV = -1;
      let plan: Placed[] = [];
      gains.forEach((g, i) => {
        if (value(g) > bestV) [best, bestV, plan] = [i, value(g), g.plan];
      });
      act({ t: 'pick', i: best });
      for (const p of plan) {
        const part = s.bin.find((m) => m.kind === p.kind);
        if (!part) break;
        dropActions(s, part, p.x, p.y, p.dir).forEach(act);
      }
      for (const m of s.bin.filter((q) => q.kind !== 'conveyor')) act({ t: 'sell', id: m.id });
    }
    act({ t: 'run' });
    act({ t: 'next' });
  }
  return s.score;
}
const N = Number(process.argv[2] ?? '60');
const med = (xs: number[]) => xs.slice().sort((a, b) => a - b)[Math.floor(xs.length / 2)];
const base = Array.from({ length: N }, (_, i) => play(`tune-${i}`, 'never'));
console.log(`never: median ${med(base)}`);
for (const policy of ['none-fits', 'little'] as Policy[]) {
  stats.used = stats.found = 0;
  const scores = base.map((_, i) => play(`tune-${i}`, policy));
  if (policy === 'none-fits') console.log(`none-fits is Sal's own game on ${scores.filter((x, i) => x === salGame(`tune-${i}`).score).length}/${N} yards`);
  const d = scores.map((x, i) => x - base[i]);
  const mean = d.reduce((a, b) => a + b, 0) / N;
  console.log(
    `${policy}: rerolls ${stats.used} (${(stats.used / N).toFixed(2)} a game), a better card after ${stats.found}; delta mean ${mean.toFixed(0)}, median ${med(d)}, better ${d.filter((x) => x > 0).length}, worse ${d.filter((x) => x < 0).length}, min ${Math.min(...d)}, max ${Math.max(...d)}`,
  );
}
