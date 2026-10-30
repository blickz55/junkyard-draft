import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { compare, type GateReport } from '../tools/perf-gate';

const baseline: GateReport = {
  samples: [
    { label: 'device B webgl', frames: 200, dropped: 0, scriptMsPerFrame: 3.0 },
    { label: 'device B canvas', frames: 200, dropped: 4, scriptMsPerFrame: 2.0 },
  ],
};
const report = (script: number, dropped = 0, label = 'device B webgl'): GateReport => ({
  samples: [{ label, frames: 200, dropped, scriptMsPerFrame: script }],
});

test('perf gate --strict (review): an empty report, a sample without metrics, or no matching label fails instead of passing by omission', () => {
  const baseline = { samples: [{ label: 'device B webgl', frames: 200, dropped: 3, scriptMsPerFrame: 2.5 }] };
  assert.equal(compare({ samples: [] }, baseline).ok, true, 'lenient: nothing to compare passes (local runs)');
  const empty = compare({ samples: [] }, baseline, { strict: true });
  assert.equal(empty.ok, false);
  assert.match(empty.problems.join(' '), /empty report/);
  const unmatched = compare({ samples: [{ label: 'other', frames: 200, dropped: 0, scriptMsPerFrame: 1 }] }, baseline, { strict: true });
  assert.equal(unmatched.ok, false);
  assert.match(unmatched.problems.join(' '), /no sample matches/);
  const broken = compare({ samples: [{ label: 'device B webgl', frames: 0, dropped: NaN, scriptMsPerFrame: null }] }, baseline, { strict: true });
  assert.equal(broken.ok, false);
  assert.match(broken.problems.join(' '), /no usable metrics/);
  const fine = compare({ samples: [{ label: 'device B webgl', frames: 200, dropped: 3, scriptMsPerFrame: 2.6 }] }, baseline, { strict: true });
  assert.equal(fine.ok, true);
  assert.deepEqual(fine.problems, []);
  assert.equal(compare({ samples: undefined as unknown as never }, baseline, { strict: true }).ok, false, 'a malformed report is not evidence');
});

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

// 0.8.4: the gate is armed with the CI baseline (docs/baselines/ci/perf-ci.json), whose WebGL sample on the software-GL runner
// dropped all 34 of its frames; the dropped rule compares rates, so a longer run that drops at the same rate passes and a run
// that drops a higher share fails
test("perf gate: dropped frames gate by rate, not count, so frame-count differences between runs do not fail a run at the baseline's rate", () => {
  const allDropped = { samples: [{ label: 'device B webgl', frames: 34, dropped: 34, scriptMsPerFrame: 15.45 }] };
  assert.equal(
    compare({ samples: [{ label: 'device B webgl', frames: 60, dropped: 60, scriptMsPerFrame: 15.45 }] }, allDropped, { strict: true }).ok,
    true,
    'all dropped against an all-dropped baseline is the same rate',
  );
  const clean = { samples: [{ label: 'device B webgl', frames: 34, dropped: 0, scriptMsPerFrame: 15.45 }] };
  assert.equal(
    compare({ samples: [{ label: 'device B webgl', frames: 60, dropped: 60, scriptMsPerFrame: 15.45 }] }, clean, { strict: true }).ok,
    false,
    'all dropped against a clean baseline fails',
  );
  assert.equal(
    compare({ samples: [{ label: 'device B webgl', frames: 60, dropped: 3, scriptMsPerFrame: 15.45 }] }, clean, { strict: true }).ok,
    true,
    '3 of 60 is within the 5 % slack',
  );
  assert.equal(
    compare({ samples: [{ label: 'device B webgl', frames: 60, dropped: 4, scriptMsPerFrame: 15.45 }] }, clean, { strict: true }).ok,
    false,
    '4 of 60 is over it',
  );
  // the committed CI baseline itself: identical report passes, a 30 % script regression fails on both samples
  const ci = JSON.parse(fs.readFileSync('docs/baselines/ci/perf-ci.json', 'utf8')) as GateReport;
  assert.equal(compare(ci, ci, { strict: true }).ok, true);
  const slow = { samples: ci.samples.map((s) => ({ ...s, scriptMsPerFrame: (s.scriptMsPerFrame ?? 0) * 1.3 })) };
  const verdict = compare(slow, ci, { strict: true });
  assert.equal(verdict.ok, false);
  assert.equal(verdict.verdicts.filter((v) => !v.ok).length, 2);
});

test('perf gate --p95 (production roadmap 0.10.2): an absolute frame-time budget fails a sample over it, baseline or not, and a sample without p95', () => {
  const d: GateReport = { samples: [{ label: 'device D canvas 915x412@2.6 cpu×4 @1×', frames: 300, dropped: 2, scriptMsPerFrame: 4, p95: 31.2 }] };
  assert.equal(compare(d, { samples: [] }, { strict: true, p95Budget: 33 }).ok, true, 'under the budget with no baseline passes');
  const over = compare({ samples: [{ ...d.samples[0], p95: 35 }] }, { samples: [] }, { strict: true, p95Budget: 33 });
  assert.equal(over.ok, false);
  assert.match(over.verdicts[0].reasons.join(' '), /p95 35 ms > budget 33 ms/);
  const none = compare({ samples: [{ label: 'x', frames: 10, dropped: 0, scriptMsPerFrame: 1 }] }, { samples: [] }, { p95Budget: 33 });
  assert.equal(none.ok, false, 'a sample that reports no p95 cannot pass an absolute budget');
  assert.equal(compare(report(3.1), baseline).ok, true, 'without --p95 the budget is not applied');
});
