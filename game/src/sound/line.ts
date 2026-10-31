/**
 * The line makes music (docs/SOUND.md). Pure note choice: audio.ts feeds it what shipped and when, the offline shift in shift.ts feeds it the
 * same way, so what the tests measure is what a player hears. The pulse is the 1x tick: at 2x and 4x the ticks only subdivide the same
 * 170 ms step, so the melody keeps its pace at every speed and a busy line sounds fuller, never faster.
 */
import { rng } from './dsp';

export const STEP_MS = 170;
const STEP_S = STEP_MS / 1000;
const PULSE = 2; // two notes are at least this many steps apart: about 2.9 notes a second at the very most

/** The six shifts climb a major pentatonic of roots; each shift has its own five-note scale over its root, all with a perfect fifth for the pad. */
const ROOTS = [0, 2, 4, 7, 9, 12];
const SCALES = [
  [0, 2, 4, 7, 9],
  [0, 2, 5, 7, 9],
  [0, 3, 5, 7, 10],
  [0, 2, 4, 7, 9],
  [0, 2, 5, 7, 10],
  [0, 2, 4, 7, 11],
];
const shift = (round: number) => Math.max(0, Math.min(ROOTS.length - 1, Math.round(round) - 1));
/** MIDI root of a shift (1-based): C3 up to C4. */
export const rootMidi = (round: number) => 48 + ROOTS[shift(round)];
/** The shift's root folded to the nearest octave of C: how far a sting moves so it sits in the shift's key without leaving its register. */
export const stingRate = (round: number) => {
  const r = ROOTS[shift(round)] % 12;
  return 2 ** ((r > 6 ? r - 12 : r) / 12);
};

export interface LineNote {
  midi: number;
  value: number;
  vel: number;
}
export interface MachineHit {
  tier: number;
  gain: number;
  rate: number;
}

const classOf = (value: number) => (value >= 12 ? 3 : value >= 8 ? 2 : value >= 3 ? 1 : 0);
const TOP = 5; // each walk stays on degrees 0..5, a little over an octave
/** How many of sixteen steps may sound at a shipping rate (ships a second): 0 means any step, past that the euclidean pattern keeps a groove while it thins. */
const openSteps = (rate: number) => (rate < 6 ? 0 : rate < 16 ? 7 : 6);

export class LineComposer {
  /** ships a second, smoothed over about three seconds */
  #rate = 0;
  /** transforms a second, smoothed the same way */
  #busy = 0;
  #rand: () => number;
  #tonic: number;
  #scale: number[];
  // two players, so a mix of goods is two smooth lines and not one that leaps about: wood below for cheap goods, the metal bars an octave up
  #deg = [2, 2];
  #dir = [1, -1];
  #prev = -1;
  #same = 0;
  #step = -1;
  #last = -9;
  #shipped = 0;
  #made = 0;
  #queue: number[] = [];
  #machines: number[] = [];
  #lastHit = -1;

  constructor(round = 1, seed = round) {
    const r = shift(round);
    const pc = ROOTS[r] % 12;
    this.#tonic = 60 + (pc > 6 ? pc - 12 : pc); // G3 to F#4: the same register every shift
    this.#scale = SCALES[r];
    this.#rand = rng(seed * 2654435761);
  }
  #pitch(d: number) {
    const n = this.#scale.length;
    return this.#tonic + 12 * Math.floor(d / n) + this.#scale[((d % n) + n) % n];
  }
  /** The next scale degree: a walk with a direction that turns now and then, resting on the root or fifth on the strong steps. */
  #walk(player: number, step: number) {
    if (this.#rand() < 0.28) this.#dir[player] *= -1;
    let d = this.#deg[player] + this.#dir[player] * (this.#rand() < 0.72 ? 1 : 2);
    if (d < 0 || d > TOP) {
      this.#dir[player] *= -1;
      d = this.#deg[player] + this.#dir[player];
    }
    if (step % 16 === 0) d = d >= 2 ? 3 : 0;
    return (this.#deg[player] = d);
  }
  /** One simulation tick at `step` (a whole number of STEP_MS since the shift began). Returns the notes to play now: none, one, or a dyad. */
  tick(chord: readonly number[], shipped: number, step: number, reduced = false): LineNote[] {
    this.#queue = [...new Set(reduced ? chord : [...this.#queue, ...chord])].sort((a, b) => b - a).slice(0, 2); // nothing waits under reduced audio, so nothing lands on a later tick's sound
    this.#shipped += shipped;
    if (step <= this.#step) return [];
    const gone = step - this.#step,
      k = Math.min(1, gone * 0.06);
    this.#step = step;
    this.#rate += (this.#shipped / (gone * STEP_S) - this.#rate) * k;
    this.#busy += (this.#made / (gone * STEP_S) - this.#busy) * k;
    this.#shipped = this.#made = 0;
    const open = openSteps(this.#rate),
      free = step - this.#last >= PULSE && (!open || (step * open) % 16 < open);
    if (!this.#queue.length || !free) return [];
    const [top, next] = this.#queue;
    this.#queue = [];
    this.#last = step;
    const cls = classOf(top),
      player = cls >> 1;
    let d = this.#walk(player, step) + player * 5 + (cls & 1); // the better good of a pair sits a degree higher
    if (this.#pitch(d) === this.#prev && ++this.#same >= 2) d += this.#deg[player] < TOP ? 1 : -1;
    const midi = this.#pitch(d);
    if (midi !== this.#prev) this.#same = 0;
    this.#prev = midi;
    // accents on the bar, a slow breath over two bars, a little human unevenness
    const accent = step % 16 === 0 ? 0.22 : step % 8 === 0 ? 0.14 : step % 4 === 0 ? 0.06 : 0,
      vel = 0.56 + accent + 0.08 * Math.sin((step * Math.PI) / 16) + (this.#rand() - 0.5) * 0.16;
    const notes = [{ midi, value: top, vel: Math.min(1, vel + cls * 0.04) }];
    if (!reduced && (top >= 20 || (next !== undefined && step % 8 === 0))) notes.push({ midi: this.#pitch(d - 3), value: next ?? top, vel: vel * 0.62 }); // richest goods and strong steps get a second bar
    return notes;
  }
  /** Which transform of a tick gets heard: one a step, the same machine at most every two pulses, and the busier the floor the softer each hit. */
  machine(tiers: readonly number[], made: number, step: number): MachineHit | null {
    this.#made += made;
    for (const tier of tiers)
      if (step - (this.#machines[tier] ?? -9) >= PULSE * 2 && step !== this.#lastHit) {
        this.#machines[tier] = this.#lastHit = step;
        return { tier, gain: Math.max(0.45, Math.min(1, Math.sqrt(2 / (this.#busy || 1)))) * (0.86 + this.#rand() * 0.14), rate: 0.96 + this.#rand() * 0.08 };
      }
    return null;
  }
}

/** The sound a note plays through: wood for cheap goods, the metal bar from plates up; the rendered note nearest in pitch, moved by playback rate. */
export function voiceOf(n: LineNote) {
  const bar = n.value >= 8,
    high = n.midi >= (bar ? 78 : 66),
    base = bar ? (high ? 84 : 72) : high ? 72 : 60;
  return {
    id: (bar ? 'bar-' : 'wood-') + (high ? 'high' : 'low'),
    rate: 2 ** ((n.midi - base) / 12),
    gain: n.vel,
    pan: Math.max(-0.35, Math.min(0.35, (n.midi - 70) / 40)), // low left, high right, as a player stands at the bars
    cutoff: 900 + 5200 * n.vel * n.vel, // a soft stroke wakes fewer overtones
  };
}

/** Where a note scheduled now belongs in audio time: the next step on the wall-clock grid, a touch ahead so frame jitter does not reach the ear. */
export const LOOKAHEAD = 0.03;
export function gridDelay(now: number, origin: number, step: number) {
  return Math.max(0.002, (origin + step * STEP_MS - now) / 1000 + LOOKAHEAD);
}
