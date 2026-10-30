/**
 * Voice allocation for the synth (DOSSIER-v1 §3.1, 0.4.9). Pure and clock-driven so it is unit-tested in Node:
 *   - polyphony caps per group with value priority (a louder/higher-value request steals from the lowest active voice),
 *   - same-tick ships coalesce into one chord (distinct values, highest first, capped),
 *   - transforms keep at most CAPS.transform voices, dropping the lowest tier first,
 *   - reduced audio: at most one sound per tick (ship > transform > jam), never a chord.
 */
export type Group = 'ship' | 'transform' | 'ui' | 'jam' | 'misc';
export const CAPS: Record<Group, number> = { ship: 8, transform: 4, ui: 4, jam: 1, misc: 2 };

interface Voice {
  group: Group;
  priority: number;
  until: number;
}

export class VoiceAllocator {
  private voices: Voice[] = [];
  constructor(private readonly caps: Record<Group, number> = CAPS) {}
  private expire(now: number) {
    this.voices = this.voices.filter((v) => v.until > now);
  }
  /** Active voices in a group at `now`. */
  active(group: Group, now: number): number {
    this.expire(now);
    return this.voices.filter((v) => v.group === group).length;
  }
  /** Ask for a voice; true when it may play (a lower-priority active voice is stolen if the group is full). */
  acquire(group: Group, priority: number, now: number, durMs: number): boolean {
    this.expire(now);
    const mine = this.voices.filter((v) => v.group === group);
    if (mine.length >= this.caps[group]) {
      const lowest = mine.reduce((a, b) => (b.priority < a.priority ? b : a));
      if (lowest.priority >= priority) return false;
      this.voices.splice(this.voices.indexOf(lowest), 1);
    }
    this.voices.push({ group, priority, until: now + durMs });
    return true;
  }
}

export interface TickSounds {
  ships: number[];
  transforms: number[];
  jams: number;
}
export interface TickPlan {
  chord: number[];
  transforms: number[];
  jam: boolean;
  count: number;
}

/** Distinct ship values, highest first, capped: the notes of this tick's chord. */
export function coalesceShips(values: number[], cap = CAPS.ship): number[] {
  return [...new Set(values)].sort((a, b) => b - a).slice(0, cap);
}
/** Transform tiers (1 shard, 2 plate, 3 ingot, 0 slag) kept highest first, capped. */
export function capTransforms(tiers: number[], cap = CAPS.transform): number[] {
  return tiers
    .slice()
    .sort((a, b) => b - a)
    .slice(0, cap);
}
/** What one simulation tick should sound like. Reduced audio collapses it to a single highest-priority sound. */
export function planTick(t: TickSounds, reducedAudio: boolean): TickPlan {
  if (reducedAudio) {
    if (t.ships.length) return { chord: [Math.max(...t.ships)], transforms: [], jam: false, count: 1 };
    if (t.transforms.length) return { chord: [], transforms: [Math.max(...t.transforms)], jam: false, count: 1 };
    return { chord: [], transforms: [], jam: t.jams > 0, count: t.jams > 0 ? 1 : 0 };
  }
  const chord = coalesceShips(t.ships);
  const transforms = capTransforms(t.transforms);
  const jam = t.jams > 0;
  return { chord, transforms, jam, count: (chord.length ? 1 : 0) + transforms.length + (jam ? 1 : 0) };
}

// ---------- throughput hum (DOSSIER-v1 §3.2, 0.4.10) ----------
export const HUM_BASE_HZ = 130.81; // C3
export const HUM_RESOLVE_HZ = 261.63; // C4: the fanfare's root, an octave below its first note
const PENTATONIC = [0, 2, 4, 7, 9, 12];
/** Root for a round (1-based): up a major pentatonic scale from C3; round 6 lands on the octave. */
export function humRoot(round: number): number {
  const i = Math.max(0, Math.min(PENTATONIC.length - 1, Math.round(round) - 1));
  return HUM_BASE_HZ * Math.pow(2, PENTATONIC[i] / 12);
}
/** Low-pass cutoff for items in flight: 0 → 300 Hz, 12+ → 2 kHz, exponential between so each item is audible. */
export function humCutoff(inFlight: number): number {
  const x = Math.max(0, Math.min(1, inFlight / 12));
  return 300 * Math.pow(2000 / 300, x);
}
export interface HumInput {
  inFlight: number;
  jammed: boolean;
  tick: number;
  ticksPerRound: number;
}
export interface HumTarget {
  freq: number;
  cutoff: number;
  detuned: boolean;
  rise: number;
}
/** What the drone should do this tick: a jam detunes it a quarter tone; the last ten ticks rise one octave. */
export function humTarget(root: number, i: HumInput): HumTarget {
  const rise = Math.max(0, Math.min(1, (i.tick - (i.ticksPerRound - 10)) / 10));
  const detuned = i.jammed;
  const freq = root * Math.pow(2, rise + (detuned ? 0.5 / 12 : 0));
  return { freq, cutoff: humCutoff(i.inFlight), detuned, rise };
}
