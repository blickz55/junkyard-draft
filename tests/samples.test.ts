import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { SampleBank, impactsForTick, IMPACT_FILES } from '../game/src/render/samples';
import { planTick } from '../game/src/render/mixer';

/** A stub of the AudioContext slice the bank uses: decodes any buffer whose first byte is not 0xff, records starts. */
function stubContext() {
  const started: { buffer: unknown; when: number; gain: number }[] = [];
  const ctx = {
    currentTime: 1.25,
    async decodeAudioData(data: ArrayBuffer) {
      if (new Uint8Array(data)[0] === 0xff) throw new Error('bad bytes');
      return { duration: data.byteLength / 44100, length: data.byteLength } as unknown as AudioBuffer;
    },
    createBufferSource() {
      const src = {
        buffer: null as unknown,
        dest: null as unknown,
        connect(n: unknown) {
          src.dest = n;
        },
        start(when: number) {
          started.push({ buffer: src.buffer, when, gain: (src.dest as { gain: { value: number } }).gain.value });
        },
      };
      return src as unknown as AudioBufferSourceNode;
    },
    createGain() {
      const g = {
        gain: { value: 1 },
        connect() {
          /* noop */
        },
      };
      return g as unknown as GainNode;
    },
  };
  return { ctx, started };
}
const bytes = (first: number, n = 400) => {
  const b = new Uint8Array(n);
  b[0] = first;
  return b.buffer;
};

test('sample bank: provided bytes decode once a context exists, a bad file fails quietly, a missing kind falls back to synth-only, plays are counted', async () => {
  const bank = new SampleBank();
  assert.deepEqual(bank.stats(), { loaded: 0, played: 0, missing: ['ship', 'press'], failed: [], decoding: false });
  bank.provide('ship', bytes(0x52));
  bank.provide('press', bytes(0xff)); // undecodable
  const { ctx, started } = stubContext();
  const dest = {} as AudioNode;
  assert.equal(bank.trigger('ship', ctx, dest), false, 'nothing plays before decoding');
  const p = bank.decode(ctx);
  assert.equal(bank.stats().decoding, true);
  await p;
  assert.deepEqual({ ...bank.stats() }, { loaded: 1, played: 0, missing: [], failed: ['press'], decoding: false });
  assert.equal(bank.trigger('ship', ctx, dest, 0.4), true);
  assert.equal(bank.trigger('press', ctx, dest), false, 'the failed sample leaves the beat to the synth');
  assert.equal(started.length, 1);
  assert.equal(started[0].when, 1.25);
  assert.equal(started[0].gain, 0.4);
  assert.equal(bank.stats().played, 1);
  await bank.decode(ctx); // idempotent: nothing pending, no re-decode of the failed one
  assert.deepEqual(bank.stats().failed, ['press']);
  const empty = new SampleBank();
  empty.provide('ship', bytes(0x52, 10)); // too small to be a WAV: ignored
  assert.deepEqual(empty.stats().missing, ['ship', 'press']);
});

test('impacts per tick follow the tick plan: a ship whenever the chord sounds, a press only for a plate, none under reduced audio', () => {
  assert.deepEqual(impactsForTick(planTick({ ships: [3, 12], transforms: [1, 2], jams: 0 }, false), false), ['ship', 'press']);
  assert.deepEqual(impactsForTick(planTick({ ships: [], transforms: [3, 1, 0], jams: 1 }, false), false), [], 'ingot, shards and slag are tones only');
  assert.deepEqual(impactsForTick(planTick({ ships: [1], transforms: [], jams: 0 }, false), false), ['ship']);
  assert.deepEqual(impactsForTick(planTick({ ships: [1], transforms: [2], jams: 0 }, true), true), [], 'reduced audio is synth-only');
});

test('authored WAVs exist, are mono 22 kHz 16-bit PCM and small', () => {
  for (const [kind, rel] of Object.entries(IMPACT_FILES)) {
    const file = path.resolve(process.cwd(), 'game/public', rel);
    assert.ok(fs.existsSync(file), `${rel} is checked in`);
    const b = fs.readFileSync(file);
    assert.ok(b.length <= 20 * 1024, `${kind}: ${b.length} bytes ≤ 20 KB`);
    assert.equal(b.toString('ascii', 0, 4), 'RIFF');
    assert.equal(b.toString('ascii', 8, 12), 'WAVE');
    assert.deepEqual(
      [b.readUInt16LE(20), b.readUInt16LE(22), b.readUInt32LE(24), b.readUInt16LE(34)],
      [1, 1, 22050, 16],
      `${kind}: PCM, mono, 22050 Hz, 16-bit`,
    );
    assert.equal(b.toString('ascii', 36, 40), 'data');
    assert.equal(b.readUInt32LE(40), b.length - 44);
    const ms = ((b.length - 44) / 2 / 22050) * 1000;
    assert.ok(ms >= 80 && ms <= 300, `${kind}: ${ms | 0} ms`);
  }
});
