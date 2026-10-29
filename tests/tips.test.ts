import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TIPS, runTip, tipForMachine } from '../game/src/sim/tips';
import { validateLayout } from '../game/src/sim/sim';

test('tips: every demo layout is legal and its one loop shows what the tip claims', () => {
  for (const tip of TIPS) {
    if (!tip.layout) continue;
    assert.deepEqual(validateLayout(tip.layout), [], `${tip.id}: layout valid`);
    for (const m of tip.layout.machines) assert.ok(m.x >= 0 && m.y >= 0 && m.x < tip.layout.width && m.y < tip.layout.height, `${tip.id}: ${m.kind} inside the grid`);
    const res = runTip(tip)!;
    assert.ok(tip.check(res), `${tip.id}: ${tip.title} — shipped ${JSON.stringify(res.shipped)}, absorbed ${res.absorbed}, cells ${JSON.stringify(res.cellStats)}`);
  }
  assert.equal(new Set(TIPS.map((t) => t.id)).size, TIPS.length, 'ids are unique');
  assert.equal(runTip(TIPS.find((t) => t.id === 'sell')!), null, 'text-only tips have no demo');
});

test('tips: the first draft of a machine suggests its tip once; read tips are never suggested again', () => {
  assert.equal(tipForMachine('press', [])?.id, 'press');
  assert.equal(tipForMachine('press', ['press']), null);
  assert.equal(tipForMachine('conveyor', [])?.id, 'sideload');
  assert.equal(tipForMachine('hopper', []), null, 'no tip is tied to the hopper');
  assert.equal(tipForMachine('dock', []), null);
});
