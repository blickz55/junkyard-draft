/**
 * Export the sound library for reference (docs/SOUND.md): every recipe as a 16-bit WAV, a spectrogram PNG (ffmpeg on PATH) and a line of
 * measurements, plus two simulated busy shifts through the real note choice. Nothing here feeds the game: the browser renders the same
 * recipes itself. Usage: node --import tsx tools/make-sfx.ts [--out dir] [--only id,id] [--no-png] [--no-shift]
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SR } from '../game/src/sound/dsp';
import type { Sound } from '../game/src/sound/dsp';
import { renderAll } from '../game/src/sound/catalog';
import { attack, centroid, channels, db, energyAbove, flatness, inharmonicity, loudness, mono, truePeak, wav } from '../game/src/sound/measure';
import { renderShift } from '../game/src/sound/shift';

const args = process.argv.slice(2);
const opt = (k: string, d: string) => {
  const i = args.indexOf(`--${k}`);
  return i >= 0 ? args[i + 1] : d;
};
const out = path.resolve(opt('out', path.join(os.tmpdir(), 'junkyard-draft-sfx')));
const only = opt('only', '').split(',').filter(Boolean);
const png = !args.includes('--no-png');
fs.mkdirSync(out, { recursive: true });

function spectrogram(name: string) {
  if (!png) return;
  const r = spawnSync(
    'ffmpeg',
    [
      '-y',
      '-v',
      'error',
      '-i',
      path.join(out, `${name}.wav`),
      '-lavfi',
      'showspectrumpic=s=900x300:legend=1:fscale=log:scale=log:drange=100:win_func=blackman',
      path.join(out, `${name}.png`),
    ],
    { encoding: 'utf8' },
  );
  if (r.status !== 0) console.warn(`no spectrogram for ${name}: ${r.error?.message ?? r.stderr}`);
}
function save(name: string, s: Sound, rate: number) {
  fs.writeFileSync(path.join(out, `${name}.wav`), wav(s, rate));
  spectrogram(name); // no zoom: ffmpeg's start/stop options draw lines that are not in the signal
}

const bank = renderAll(SR);
console.log('id          kind     bus     sec  peak dB  loud dB  attack ms  centroid  >6k %  flatness  inharm c');
for (const [id, { sound, rate, entry }] of bank) {
  if (only.length && !only.includes(id)) continue;
  const m = mono(sound);
  save(id, sound, rate);
  console.log(
    id.padEnd(11),
    entry.kind.padEnd(8),
    entry.bus.padEnd(7),
    (m.length / rate).toFixed(2).padStart(4),
    db(Math.max(...channels(sound).map(truePeak)))
      .toFixed(1)
      .padStart(7),
    db(loudness(m, rate)).toFixed(1).padStart(8),
    (attack(m, 0.5, rate) * 1000).toFixed(1).padStart(10),
    centroid(m, rate).toFixed(0).padStart(9),
    (energyAbove(m, 6000, rate) * 100).toFixed(2).padStart(6),
    flatness(m, rate).toExponential(1).padStart(9),
    inharmonicity(m, rate).toFixed(0).padStart(9),
  );
}
if (!args.includes('--no-shift') && !only.length)
  for (const speed of [1, 4] as const) {
    const s = renderShift({ speed, seconds: 60, round: 1, seed: 7, shipsPerSecond: 5 }, bank),
      [l, r] = s.out;
    save(`shift-${speed}x`, s.out, SR);
    console.log(
      `shift ${speed}x  ${s.notes.length} notes (${(s.notes.length / 60).toFixed(1)} a second), ${s.hits} machine hits, before the limiter ${db(s.before).toFixed(1)} dBFS, ` +
        `true peak ${db(Math.max(truePeak(l), truePeak(r))).toFixed(1)} dBFS, mean level ${db(Math.hypot(...[l, r].map((c) => Math.sqrt(c.reduce((a, v) => a + v * v, 0) / c.length))) / Math.SQRT2).toFixed(1)} dBFS`,
    );
  }
console.log(`written to ${out}`);
