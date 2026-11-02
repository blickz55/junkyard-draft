/**
 * What a belt is worth (the owner's second playtest, 2026-11-01): are conveyors a real constraint, or friction? The autoplayer
 * plays the same yards with the shelf opening on fewer or more belts, and the study reports what that does to the score and the
 * job, how many belts the final line uses and how many are left unused. Read it knowing what the autoplayer is: a local search
 * that keeps a move only when the move pays by itself, so it undersells anything that pays after several moves, and a long
 * branch of belts is exactly that.
 *   node --import tsx tools/belt-study.ts [--seeds 30] [--tries 12] [--only name,name] [--json out.json]
 */
import fs from 'node:fs';
import { newRun, replay, runStars, shippedTotal } from '../game/src/sim/run';
import { RULES } from '../game/src/sim/rules';
import { RULES_VERSION, type MachineKind } from '../game/src/sim/types';
import { Rng } from '../game/src/sim/rng';
import { playSeed, type SearchPolicy } from './autoplay-lib';

const args = process.argv.slice(2);
const opt = (k: string, d: string) => {
  const i = args.indexOf(`--${k}`);
  return i >= 0 ? args[i + 1] : d;
};
const SEEDS = Number(opt('seeds', '30'));
const TRIES = Number(opt('tries', '12'));
const JSON_OUT = opt('json', '');
const ONLY = opt('only', '').split(',').filter(Boolean);

interface Variant {
  name: string;
  shelf: number;
}
const ALL: Variant[] = [
  { name: 'shelf-0', shelf: 0 },
  { name: 'shelf-2', shelf: 2 },
  { name: 'rules-v6', shelf: 4 },
  { name: 'shelf-8', shelf: 8 },
  { name: 'shelf-16', shelf: 16 },
];
const variants = ALL.filter((v) => !ONLY.length || ONLY.includes(v.name));

const rules = RULES as unknown as { yard: { shelf: MachineKind[] } };
const original = rules.yard.shelf;

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const median = (xs: number[]) => {
  const a = xs.slice().sort((x, y) => x - y);
  return a.length ? a[Math.floor(a.length / 2)] : 0;
};

const out: Record<string, unknown>[] = [];
for (const v of variants) {
  rules.yard.shelf = Array.from({ length: v.shelf }, () => 'conveyor' as MachineKind);
  for (const policy of ['greedy', 'neutral'] as SearchPolicy[]) {
    const rows: {
      score: number;
      stars: number;
      shipped: number;
      beltsOnYard: number;
      beltsLeft: number;
      belts: number;
    }[] = [];
    const t0 = Date.now();
    for (let i = 0; i < SEEDS; i++) {
      const seed = `belts-${i}`;
      const { actions } = playSeed(seed, new Rng(`${seed}:search:${policy}`), TRIES, { policy });
      const s = replay(seed, actions, RULES_VERSION);
      const shipped = s.job ? shippedTotal(s, s.job.material) : 0;
      const start = newRun(seed);
      rows.push({
        score: s.score,
        stars: runStars(s),
        shipped,
        beltsOnYard: s.layout.machines.filter((m) => m.kind === 'conveyor').length,
        beltsLeft: s.bin.filter((m) => m.kind === 'conveyor').length,
        belts: start.layout.machines.filter((m) => m.kind === 'conveyor').length + start.bin.length,
      });
    }
    const line = {
      variant: v.name,
      policy,
      seeds: SEEDS,
      meanScore: Math.round(mean(rows.map((r) => r.score))),
      medianScore: median(rows.map((r) => r.score)),
      meanShipped: +mean(rows.map((r) => r.shipped)).toFixed(1),
      threeStars: rows.filter((r) => r.stars === 3).length,
      twoStars: rows.filter((r) => r.stars === 2).length,
      meanBeltsOnYardAtEnd: +mean(rows.map((r) => r.beltsOnYard)).toFixed(1),
      meanBeltsUnused: +mean(rows.map((r) => r.beltsLeft)).toFixed(1),
      gamesWithNoBeltLeft: rows.filter((r) => r.beltsLeft === 0).length,
      seconds: Math.round((Date.now() - t0) / 1000),
    };
    out.push(line);
    console.log(JSON.stringify(line));
  }
}
rules.yard.shelf = original;
if (JSON_OUT) fs.writeFileSync(JSON_OUT, JSON.stringify({ tries: TRIES, rulesVersion: RULES_VERSION, rows: out }, null, 2) + '\n');
