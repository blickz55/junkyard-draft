// Golden replay corpus (review F13): every checked-in replay must still verify with the exact recorded score under the
// current rules. A failing file means behaviour changed for an existing replay: bump RULES_VERSION and regenerate the
// corpus deliberately (node --import tsx tools/make-golden.ts), never let it drift silently.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { decodeReplay, verifyReplay } from '../game/src/sim/replay';
import { RULES_VERSION } from '../game/src/sim/types';
import { isTutorialSeed } from '../game/src/sim/run';

const DIR = path.resolve(process.cwd(), 'tests', 'golden');
const index = JSON.parse(fs.readFileSync(path.join(DIR, 'INDEX.json'), 'utf8')) as { rulesVersion: number; entries: { file: string; seed: string; score: number; actions: number }[] };

test('golden corpus: recorded under the current rules version and complete', () => {
  assert.equal(index.rulesVersion, RULES_VERSION, 'the corpus belongs to the current rules; regenerate it when the version is bumped');
  assert.ok(index.entries.length >= 7);
  const kinds = { ordinary: 0, tutorial: 0, daily: 0 };
  for (const e of index.entries) { if (isTutorialSeed(e.seed)) kinds.tutorial++; else if (/^daily-/.test(e.seed)) kinds.daily++; else kinds.ordinary++; }
  assert.ok(kinds.ordinary >= 4 && kinds.tutorial >= 1 && kinds.daily >= 1, `ordinary, scenario and daily seeds are all covered: ${JSON.stringify(kinds)}`);
  assert.ok(index.entries.some((e) => e.seed === 'tutorialish'), 'a tutorial-looking name that is not a scenario');
});

for (const e of index.entries) {
  test(`golden replay ${e.file} re-simulates to $${e.score} with ${e.actions} actions`, () => {
    const r = decodeReplay(fs.readFileSync(path.join(DIR, e.file), 'utf8'));
    assert.equal(r.seed, e.seed); assert.equal(r.rulesVersion, RULES_VERSION); assert.equal(r.actions.length, e.actions);
    const v = verifyReplay(r);
    assert.equal(v.ok, true, `${e.file}: ${v.error ?? `score ${v.score} vs claimed ${v.claimed}`}`);
    assert.equal(v.score, e.score); assert.equal(v.finished, true);
  });
}
