import { test } from 'node:test';
import assert from 'node:assert/strict';
import { auditContrast, auditCvd, MATERIALS } from '../tools/a11y-audit';
import { contrast, deltaE, hexToRgb, simulate } from '../tools/a11y-lib';

test('every text/background pair the UI draws meets WCAG AA contrast', () => {
  const results = auditContrast();
  const fails = results.filter((r) => !r.ok).map((r) => `${r.name}: ${r.ratio}:1 < ${r.required}:1`);
  assert.deepEqual(fails, []);
  assert.ok(results.length >= 18, 'the audit covers the known pairs');
});

test('materials and semantic colours stay apart under protanopia, deuteranopia and tritanopia', () => {
  const results = auditCvd();
  const fails = results.filter((r) => !r.ok).map((r) => `${r.group} ${r.a}/${r.b} @${r.kind}: ΔE ${r.deltaE}, ΔL* ${r.deltaL}`);
  assert.deepEqual(fails, []);
  // shards vs plate are the two light greys: keep them clearly apart in every simulation
  for (const kind of ['normal', 'protanopia', 'deuteranopia', 'tritanopia'] as const) {
    const d = deltaE(simulate(MATERIALS.shards, kind), simulate(MATERIALS.plate, kind));
    assert.ok(d >= 20, `shards vs plate under ${kind}: ΔE ${d.toFixed(1)} < 20`);
  }
});

test('colour math sanity: black/white contrast is 21:1, identity simulation is a no-op', () => {
  assert.equal(+contrast(hexToRgb('#000000'), hexToRgb('#ffffff')).toFixed(0), 21);
  const c = hexToRgb('#f0a830');
  assert.ok(deltaE(simulate(c, 'normal'), c) < 0.5);
});
