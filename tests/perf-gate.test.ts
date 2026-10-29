import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compare, type GateReport } from '../tools/perf-gate';

const baseline: GateReport = { samples: [
  { label: 'device B webgl', frames: 200, dropped: 0, scriptMsPerFrame: 3.0 },
  { label: 'device B canvas', frames: 200, dropped: 4, scriptMsPerFrame: 2.0 },
] };
const report = (script: number, dropped = 0, label = 'device B webgl'): GateReport => ({ samples: [{ label, frames: 200, dropped, scriptMsPerFrame: script }] });

test('perf gate: a 30 % script-time regression fails, 10 % passes, and dropped frames gate against the baseline plus slack', () => {
  assert.equal(compare(report(3.9), baseline).ok, false, '30 % slower than baseline fails');
  assert.equal(compare(report(3.3), baseline).ok, true, '10 % slower passes');
  assert.equal(compare(report(3.75), baseline).ok, true, 'exactly the tolerance passes');
  assert.equal(compare(report(2.0, 11), baseline).ok, false, '11 dropped of 200 exceeds baseline 0 + 5 % (10)');
  assert.equal(compare(report(2.0, 10), baseline).ok, true, '10 dropped is within slack');
  assert.equal(compare(report(2.0, 14, 'device B canvas'), baseline).ok, true, 'canvas: 14 dropped within baseline 4 + 10');
  assert.equal(compare(report(2.0, 15, 'device B canvas'), baseline).ok, false);
  const unknown = compare(report(99, 150, 'electron packaged'), baseline);
  assert.equal(unknown.ok, true, 'a sample without a baseline label is reported, not failed');
  assert.equal(unknown.verdicts[0].baseline, null);
  const v = compare(report(3.9, 20), baseline).verdicts[0];
  assert.equal(v.reasons.length, 2, 'both reasons are listed');
  assert.equal(compare(report(3.9), baseline, { tolerance: 0.5 }).ok, true, 'tolerance is configurable');
});
