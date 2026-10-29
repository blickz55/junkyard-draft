import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decideQuality, QUALITY_PROBE_FRAMES } from '../game/src/render/quality';

test('adaptive resolution: a smooth first run keeps high resolution, a struggling one drops to standard', () => {
  const smooth = Array.from({ length: QUALITY_PROBE_FRAMES }, () => 16.7);
  assert.equal(decideQuality(smooth), 'high');
  const oneHitch = smooth.slice(); oneHitch[40] = 90; // a single long frame is below the 95th percentile
  assert.equal(decideQuality(oneHitch), 'high');
  const struggling = smooth.map((d, i) => (i % 10 === 0 ? 34 : d)); // 10 % of frames miss two vsyncs
  assert.equal(decideQuality(struggling), 'low');
  const software = Array.from({ length: QUALITY_PROBE_FRAMES }, () => 50); // the headless device-D preset measured p95 66 ms
  assert.equal(decideQuality(software), 'low');
  assert.equal(decideQuality([]), 'high', 'no evidence keeps the default');
});
