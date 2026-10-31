/**
 * Job calibration (rules v4): plays generated yards with the autoplayer and a plain-line player and reports how many units
 * of each job's product they ship, against the star marks in RULES.job.stars. The star marks are meant to read:
 *   one star   a first-timer who got the recipe running by shift 3 or 4;
 *   two stars  the plain recipe, running from shift 2, with no mistakes;
 *   three      a line that was widened: more than the plain recipe can carry.
 * The plain player is the recipe and nothing else: the crusher and the job's machine dropped on the belt, parts after that
 * ignored. A mean of the autoplayer's scores over yards also shows how far yards spread.
 *   node --import tsx tools/job-study.ts [--seeds 60] [--tries 120] [--json docs/baselines/0.11/job-study.json]
 */
import fs from 'node:fs';
import { apply, newRun, type RunState } from '../game/src/sim/run';
import { JOB_MACHINE, starsFor, yardFor } from '../game/src/sim/yard';
import { DIR_DX, DIR_DY, RULES } from '../game/src/sim/rules';
import { outputDirs } from '../game/src/sim/advice';
import type { Machine } from '../game/src/sim/types';
import { Rng } from '../game/src/sim/rng';
import { playSeed } from './autoplay-lib';

const args = process.argv.slice(2);
const opt = (k: string, d: string) => {
  const i = args.indexOf(`--${k}`);
  return i >= 0 ? args[i + 1] : d;
};
const SEEDS = Number(opt('seeds', '60'));
const TRIES = Number(opt('tries', '120'));
const JSON_OUT = opt('json', '');

/** The plain recipe: each shift take the recipe's next part, drop it on the first straight conveyors of the belt, in order; `delay` shifts wasted first. */
export function plainLine(seed: string, delay = 0): { shipped: number; score: number } {
  const s: RunState = newRun(seed);
  const job = s.job!;
  const recipe = ['crusher', JOB_MACHINE[job.material]];
  let step = 0;
  while (s.phase !== 'finished') {
    if (s.phase === 'draft') {
      const want = s.round - 1 >= delay ? recipe[step] : undefined;
      const i = want ? s.offers.indexOf(want as never) : -1;
      apply(s, { t: 'pick', i: i >= 0 ? i : 0 });
      if (i >= 0) {
        const part = s.bin[s.bin.length - 1];
        // the first conveyor still fed from behind: a machine cannot sit on a corner
        const fedFromBehind = (m: Machine) => {
          const b = s.layout.machines.find((o) => o.x === m.x - DIR_DX[m.dir] && o.y === m.y - DIR_DY[m.dir]);
          return !!b && outputDirs(b.kind, b.dir).includes(m.dir);
        };
        const belt = s.layout.machines.filter((m) => m.kind === 'conveyor' && fedFromBehind(m)).sort((a, b) => a.id - b.id);
        const slot = belt[0];
        if (slot) {
          const { x, y, dir } = slot;
          apply(s, { t: 'unplace', id: slot.id });
          apply(s, { t: 'place', id: part.id, x, y, dir });
        }
        step++;
      }
    }
    apply(s, { t: 'run' });
    apply(s, { t: 'next' });
  }
  return { shipped: s.rounds.reduce((n, r) => n + r.result.shipped[job.material], 0), score: s.score };
}

const isMain = process.argv[1] && /job-study\.(ts|mjs|js)$/.test(process.argv[1]);
interface Row {
  seed: string;
  material: string;
  shape: number;
  rubble: number;
  auto: number;
  autoScore: number;
  plain: number;
  late: number;
  plainScore: number;
  stars: { auto: number; plain: number; late: number };
}
const rows: Row[] = [];
const t0 = Date.now();
for (let i = 0; isMain && i < SEEDS; i++) {
  const seed = `job-${i}`;
  const job = yardFor(seed).job!;
  const { report } = playSeed(seed, new Rng(`${seed}:search`), TRIES);
  const auto = job.material === 'ingot' ? report.ingots : report.plates;
  const plain = plainLine(seed, 0);
  const late = plainLine(seed, 2);
  rows.push({
    seed,
    material: job.material,
    shape: yardFor(seed).machines.length,
    rubble: yardFor(seed).rubble.length,
    auto,
    autoScore: report.score,
    plain: plain.shipped,
    late: late.shipped,
    plainScore: plain.score,
    stars: { auto: starsFor(job, auto), plain: starsFor(job, plain.shipped), late: starsFor(job, late.shipped) },
  });
}
const q = (xs: number[], p: number) => {
  const s = xs.slice().sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(p * s.length))];
};
const summary: Record<string, unknown> = { seeds: SEEDS, tries: TRIES, ms: Date.now() - t0, stars: RULES.job.stars };
for (const mat of ['ingot', 'plate']) {
  const r = rows.filter((x) => x.material === mat);
  if (!r.length) continue;
  const dist = (k: 'auto' | 'plain' | 'late') => [0, 1, 2, 3].map((n) => r.filter((x) => x.stars[k] === n).length);
  const pct = (xs: number[]) => ({ min: q(xs, 0), p25: q(xs, 0.25), median: q(xs, 0.5), p75: q(xs, 0.75), max: q(xs, 1) });
  summary[mat] = {
    yards: r.length,
    autoShipped: pct(r.map((x) => x.auto)),
    plainShipped: pct(r.map((x) => x.plain)),
    lateShipped: pct(r.map((x) => x.late)),
    autoScore: pct(r.map((x) => x.autoScore)),
    plainScore: pct(r.map((x) => x.plainScore)),
    starsAuto0123: dist('auto'),
    starsPlain0123: dist('plain'),
    starsLate0123: dist('late'),
  };
}
if (isMain) console.log(JSON.stringify(summary, null, 1));
if (isMain && JSON_OUT) fs.writeFileSync(JSON_OUT, JSON.stringify({ summary, rows }, null, 1));
