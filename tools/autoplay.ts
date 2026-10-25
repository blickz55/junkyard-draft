/**
 * Automated player: explores seeds with a bounded search per round and reports score
 * distributions, dead-end seeds and suspicious scores. Diagnostic evidence only.
 *
 *   node --import tsx tools/autoplay.ts [--seeds 50] [--tries 60] [--prefix auto] [--json out.json]
 */
import fs from 'node:fs';
import { newRun } from '../game/src/sim/run';
import { RULES } from '../game/src/sim/rules';
import { Rng } from '../game/src/sim/rng';
import { playSeed, score, type SeedReport } from './autoplay-lib';

const args = process.argv.slice(2);
const opt = (k: string, d: string) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };
const SEEDS = Number(opt('seeds', '50'));
const TRIES = Number(opt('tries', '60'));
const PREFIX = opt('prefix', 'auto');
const JSON_OUT = opt('json', '');

const reports: SeedReport[] = [];
const t0 = Date.now();
for (let i = 0; i < SEEDS; i++) {
  const seed = `${PREFIX}-${i}`;
  const { report } = playSeed(seed, new Rng(`${seed}:search`), TRIES);
  reports.push(report);
}
const scores = reports.map((r) => r.score).sort((a, b) => a - b);
const q = (p: number) => scores[Math.min(scores.length - 1, Math.floor(p * scores.length))];
const starter = score(newRun('x').layout) * RULES.rounds;
const summary = {
  seeds: SEEDS, triesPerRound: TRIES, ms: Date.now() - t0,
  starterOnlyScore: starter,
  min: scores[0], p25: q(0.25), median: q(0.5), p75: q(0.75), max: scores[scores.length - 1],
  deadEndSeeds: reports.filter((r) => r.deadEnd).map((r) => r.seed),
  flatRoundsTotal: reports.reduce((a, r) => a + r.flatRounds, 0),
  noIngotSeeds: reports.filter((r) => r.ingots === 0).map((r) => r.seed),
  pickFrequency: reports.flatMap((r) => r.picks).reduce((a, p) => ({ ...a, [p]: (a[p] || 0) + 1 }), {} as Record<string, number>),
  suspicious: reports.filter((r) => r.score > 6 * 40 * RULES.value.ingot * 2).map((r) => r.seed), // > 2× the theoretical single-hopper ingot cap
  top: reports.slice().sort((a, b) => b.score - a.score).slice(0, 3),
  bottom: reports.slice().sort((a, b) => a.score - b.score).slice(0, 3),
};
console.log(JSON.stringify(summary, null, 1));
if (JSON_OUT) fs.writeFileSync(JSON_OUT, JSON.stringify({ summary, reports }, null, 1));
