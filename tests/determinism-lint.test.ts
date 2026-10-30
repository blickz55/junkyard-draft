// Production roadmap 0.8.11: the sim's determinism lint is clean over game/src/sim, and it fails on injected offenders.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { lintDir, lintSource, CALENDAR_MODULES } from '../tools/determinism-lint';
import { sha256Hex, canonical } from '../game/src/sim/digest';

test('determinism lint: game/src/sim is clean (Date only in the calendar modules, one marked metadata timestamp)', () => {
  assert.deepEqual(lintDir(path.resolve('game/src/sim')), []);
  assert.deepEqual(CALENDAR_MODULES, ['daily.ts', 'weekly.ts']);
});

test('determinism lint: an injected Math.sin and a bare sort() fail; comparators, exact Math, comments, the calendar modules and the allow marker pass', () => {
  const hit = (src: string, file = 'game/src/sim/thing.ts') => lintSource(file, src).map((h) => h.rule);
  assert.deepEqual(hit('const y = Math.sin(x);'), ['Math.random or a transcendental function']);
  assert.deepEqual(hit('const r = Math.random();'), ['Math.random or a transcendental function']);
  assert.deepEqual(hit('const z = Math.pow(2, k) + Math.log(k);'), ['Math.random or a transcendental function']);
  assert.deepEqual(hit('xs.sort();'), ['sort without a comparator']);
  assert.deepEqual(hit('const ys = xs.toSorted( );'), ['sort without a comparator']);
  assert.deepEqual(hit('const t = Date.now(); const d = new Date();'), ['Date (the clock)']);
  assert.deepEqual(hit('const n = new Intl.NumberFormat();'), ['Intl (the locale)']);
  assert.deepEqual(hit('const s = x.toLocaleString();'), ['toLocale* (the locale)']);
  assert.deepEqual(hit('const t0 = performance.now();'), ['performance.now (the clock)']);
  assert.deepEqual(hit('xs.sort((a, b) => a - b); const k = Math.floor(Math.max(1, Math.imul(a, b)) / 2);'), [], 'a comparator and exact Math are fine');
  assert.deepEqual(hit('// a Date is mentioned here, Math.sin too\n/* and Intl\n   across lines */ const ok = 1;'), [], 'comments are not code');
  assert.deepEqual(hit('const d = new Date(Date.UTC(2030, 0, 1));', 'game/src/sim/daily.ts'), [], 'the calendar modules may use Date');
  assert.deepEqual(hit('const d = Math.sin(1);', 'game/src/sim/daily.ts'), ['Math.random or a transcendental function'], 'but nothing else');
  assert.deepEqual(hit('createdAt: new Date().toISOString(), // determinism: metadata only'), [], 'a marked line is allowed');
  assert.deepEqual(hit('createdAt: new Date().toISOString(), // determinism:'), ['Date (the clock)'], 'the marker needs a reason');
  const multi = lintSource('game/src/sim/x.ts', 'a();\nMath.cos(1);\nb();\nxs.sort();\n');
  assert.deepEqual(
    multi.map((h) => [h.line, h.rule]),
    [
      [2, 'Math.random or a transcendental function'],
      [4, 'sort without a comparator'],
    ],
  );
});

test('digest primitives: the SHA-256 vectors and a canonical JSON that ignores key order and undefined', () => {
  assert.equal(sha256Hex(''), 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  assert.equal(sha256Hex('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  assert.equal(sha256Hex('The quick brown fox jumps over the lazy dog'), 'd7a8fbb307d7809469ca9abcb0082e4f8d5651e46d3cdb762d02d0bf37c9e592');
  assert.equal(sha256Hex('a'.repeat(1000)), '41edece42d63e8d9bf515a9ba6932e1c20cbc9f5a5d134645adb5db1b9737ea3');
  assert.equal(sha256Hex('héllo → ✓'), sha256Hex('héllo → ✓'), 'UTF-8 bytes, the same from either spelling');
  assert.equal(canonical({ b: 1, a: [3, { d: undefined, c: 'x' }], e: undefined }), '{"a":[3,{"c":"x"}],"b":1}');
  assert.equal(canonical({ a: 1, b: 2 }), canonical({ b: 2, a: 1 }));
  assert.equal(canonical([undefined, null, 1.5, 'q']), '[null,null,1.5,"q"]');
});
