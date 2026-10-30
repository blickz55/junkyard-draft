// production roadmap 0.9.6: the late-round offer guarantee is a rules knob, inert under rules v3; switched on for the study it
// changes only the rounds it names, and only drafts that offered none of its kinds.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RULES } from '../game/src/sim/rules';
import { draftOffers } from '../game/src/sim/run';

test('late offer guarantee: off in rules v3; on, the listed rounds always carry a hopper or a crusher, other rounds and already-fine drafts are byte-identical', () => {
  assert.deepEqual(RULES.lateOfferGuarantee.rounds, [], 'rules v3 ships without the guarantee');
  assert.deepEqual(RULES.lateOfferGuarantee.kinds, ['hopper', 'crusher']);
  const seeds = Array.from({ length: 200 }, (_, i) => `guarantee-${i}`);
  const base = new Map<string, string[][]>();
  for (const s of seeds)
    base.set(
      s,
      Array.from({ length: RULES.rounds }, (_, r) => draftOffers(s, r + 1)),
    );
  const lacking = (o: string[]) => !o.includes('hopper') && !o.includes('crusher');
  const lackingBefore = seeds.reduce((n, s) => n + [4, 5].filter((r) => lacking(base.get(s)![r - 1])).length, 0);
  assert.ok(lackingBefore > 0, `some round-4/5 drafts offer neither kind under v3 (${lackingBefore} of ${seeds.length * 2}), so the guarantee has work to do`);
  const knob = RULES.lateOfferGuarantee as { rounds: number[] };
  knob.rounds = [4, 5];
  try {
    let swapped = 0;
    for (const s of seeds) {
      for (let r = 1; r <= RULES.rounds; r++) {
        const before = base.get(s)![r - 1];
        const after = draftOffers(s, r);
        assert.equal(after.length, 3);
        assert.equal(new Set(after).size, 3, `${s} round ${r}: three different cards`);
        if (r === 4 || r === 5) {
          assert.ok(!lacking(after), `${s} round ${r}: a hopper or a crusher is on offer`);
          if (lacking(before)) swapped++;
          else assert.deepEqual(after, before, `${s} round ${r}: a draft that already had one is untouched`);
        } else assert.deepEqual(after, before, `${s} round ${r}: rounds outside the list are untouched`);
      }
    }
    assert.equal(swapped, lackingBefore, 'exactly the lacking drafts changed');
  } finally {
    knob.rounds = [];
  }
  for (const s of seeds.slice(0, 20))
    for (let r = 1; r <= RULES.rounds; r++) assert.deepEqual(draftOffers(s, r), base.get(s)![r - 1], 'off again: identical to the baseline');
});
