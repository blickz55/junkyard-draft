/**
 * Golden replay corpus (review F13): legal finished replays recorded under the current RULES_VERSION and checked in under
 * tests/golden/. tests/golden.test.ts re-simulates every file and compares the score, so any change to rules, drafting,
 * scenario seeds or action validation that alters an existing replay's outcome fails the suite until the version is bumped
 * and the corpus is regenerated on purpose. Covers: ordinary seeds (autoplayer lines), a sold part, a press, undo-style
 * unplace/re-place churn, the tutorial scenario, a tutorial-looking name that is NOT a scenario, and a daily seed.
 *   node --import tsx tools/make-golden.ts          # rewrites tests/golden/*.json (deterministic)
 */
import fs from 'node:fs';
import path from 'node:path';
import { apply, newRun, draftOffers, TUTORIAL_SEED, type RunState } from '../game/src/sim/run';
import { exportReplay } from '../game/src/sim/replay';
import { RULES } from '../game/src/sim/rules';
import { RULES_VERSION } from '../game/src/sim/types';
import { playSeed } from './autoplay-lib';
import { Rng } from '../game/src/sim/rng';

const OUT = path.resolve(process.cwd(), 'tests', 'golden');

/** Finish a run with a simple policy: pick the preferred kind when offered, otherwise the first offer; `shape` edits round 1. */
function finish(seed: string, prefer: string[], shape?: (s: RunState) => void): RunState {
  const s = newRun(seed);
  for (let r = 1; r <= RULES.rounds; r++) {
    const i = prefer.map((k) => s.offers.indexOf(k as never)).find((x) => x >= 0) ?? 0;
    apply(s, { t: 'pick', i });
    if (r === 1 && shape) shape(s);
    apply(s, { t: 'run' }); apply(s, { t: 'next' });
  }
  return s;
}
/** Put the most recent pick at (x, y), sending whatever was there back to the bin (the pick is captured before the unplace pushes the old machine). */
const swapIn = (s: RunState, x: number, y: number) => { const pick = s.bin[s.bin.length - 1]; const old = s.layout.machines.find((m) => m.x === x && m.y === y); if (old) apply(s, { t: 'unplace', id: old.id }); apply(s, { t: 'place', id: pick.id, x, y, dir: 0 }); };

const corpus: { name: string; run: RunState; note: string }[] = [];
for (const seed of ['golden-ordinary-1', 'golden-ordinary-2']) { const { actions } = playSeed(seed, new Rng(`${seed}:golden`), 40); const s = newRun(seed); for (const a of actions) apply(s, a); corpus.push({ name: seed, run: s, note: 'autoplayer line (bounded search, fixed rng stream)' }); }
// a run that sells every pick after the first: picks are sold immediately each round
{
  const s = newRun('golden-sell');
  for (let r = 1; r <= RULES.rounds; r++) {
    const i = Math.max(0, s.offers.indexOf('crusher'));
    apply(s, { t: 'pick', i });
    if (r === 1) swapIn(s, 2, 2); else apply(s, { t: 'sell', id: s.bin[s.bin.length - 1].id });
    apply(s, { t: 'run' }); apply(s, { t: 'next' });
  }
  corpus.push({ name: 'golden-sell', run: s, note: 'crusher placed in round 1, every later pick sold ($' + RULES.sellValue + ' each)' });
}
// a press line: find a seed whose round-2 offers include a press, put the crusher at (2,2) in round 1 and the press at (3,2) in round 2
{
  let seed = ''; for (let i = 0; i < 500 && !seed; i++) if (draftOffers(`golden-press-${i}`, 2).includes('press')) seed = `golden-press-${i}`;
  const s = newRun(seed);
  for (let r = 1; r <= RULES.rounds; r++) {
    const want = r === 1 ? 'crusher' : r === 2 ? 'press' : 'crusher';
    apply(s, { t: 'pick', i: Math.max(0, s.offers.indexOf(want)) });
    if (r === 1) swapIn(s, 2, 2); else if (r === 2) swapIn(s, 3, 2);
    apply(s, { t: 'run' }); apply(s, { t: 'next' });
  }
  if (!s.rounds.some((rd) => rd.result.shipped.plate > 0)) throw new Error('golden-press: no plate shipped; pick another seed');
  corpus.push({ name: 'golden-press', run: s, note: 'crusher at (2,2) then a press at (3,2): shards become plates from round 2' });
}
corpus.push({ name: 'golden-churn', run: finish('golden-churn', ['crusher'], (s) => { swapIn(s, 2, 2); const m = s.layout.machines.find((x) => x.x === 2 && x.y === 2)!; for (let k = 0; k < 6; k++) { apply(s, { t: 'rotate', id: m.id }); } apply(s, { t: 'unplace', id: m.id }); apply(s, { t: 'place', id: m.id, x: 2, y: 2, dir: 0 }); apply(s, { t: 'unplace', id: m.id }); apply(s, { t: 'place', id: m.id, x: 2, y: 2, dir: 0 }); }), note: 'rotate/unplace/re-place churn in round 1 (what undo/redo records)' });
// a reroll in round 2 (affordable after a crusher round), then the usual play; the corpus pins that rerolled offers and the deduction replay exactly
{
  const s = newRun('golden-reroll');
  for (let r = 1; r <= RULES.rounds; r++) {
    if (r === 2) apply(s, { t: 'reroll' });
    apply(s, { t: 'pick', i: Math.max(0, s.offers.indexOf('crusher')) });
    if (r === 1) swapIn(s, 2, 2);
    apply(s, { t: 'run' }); apply(s, { t: 'next' });
  }
  if (s.rerolls !== 1) throw new Error('golden-reroll: expected one reroll');
  corpus.push({ name: 'golden-reroll', run: s, note: 'crusher at (2,2) in round 1, a reroll (−$' + RULES.rerollCost + ') before the round-2 pick' });
}
corpus.push({ name: 'tutorial-1', run: finish(TUTORIAL_SEED, ['crusher', 'furnace', 'splitter'], (s) => swapIn(s, 2, 2)), note: 'the tutorial scenario (constrained drafts, spare conveyors); scenario semantics are versioned with RULES_VERSION from 0.4.1 on' });
corpus.push({ name: 'tutorialish', run: finish('tutorialish', ['crusher']), note: 'a tutorial-looking name without the dash: an ordinary seed, never a scenario' });
corpus.push({ name: 'daily-2026-10-29', run: finish('daily-2026-10-29', ['crusher'], (s) => swapIn(s, 2, 2)), note: 'a daily seed label' });

fs.mkdirSync(OUT, { recursive: true });
for (const f of fs.readdirSync(OUT)) if (f.endsWith('.json')) fs.rmSync(path.join(OUT, f));
const index: { file: string; seed: string; score: number; actions: number; note: string }[] = [];
for (const c of corpus) {
  const rep = exportReplay(c.run, `golden-${RULES_VERSION}`);
  const file = `${c.name}.json`;
  fs.writeFileSync(path.join(OUT, file), JSON.stringify(rep, null, 0) + '\n');
  index.push({ file, seed: c.run.seed, score: c.run.score, actions: rep.actions.length, note: c.note });
  console.log(`${file}  seed=${c.run.seed}  $${c.run.score}  ${rep.actions.length} actions`);
}
fs.writeFileSync(path.join(OUT, 'INDEX.json'), JSON.stringify({ rulesVersion: RULES_VERSION, generatedBy: 'tools/make-golden.ts', entries: index }, null, 1) + '\n');
console.log(`wrote ${corpus.length} replays under tests/golden (rules v${RULES_VERSION})`);
