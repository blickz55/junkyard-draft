/**
 * The sound list (docs/SOUND.md says what each one is meant to be). Row order is render order: what a first tap needs comes first, the long
 * beds last. `kind` is the loudness class tests/sound.test.ts holds a recipe to. The ids are what the Sound test list hands the owner;
 * labels, if any, belong to the string table.
 */
import { BED_RATE, RECIPES } from './recipes';
import { SR } from './dsp';
import type { Recipe } from './recipes';
import type { Sound } from './dsp';

export type Bus = 'ui' | 'factory' | 'music';
export type Kind = 'tick' | 'touch' | 'machine' | 'note' | 'sting' | 'bed' | 'room';
export interface SoundEntry {
  id: string;
  bus: Bus;
  kind: Kind;
  seed: number;
  /** samples per second; 0 means the audio context's own */
  rate: number;
  recipe: Recipe;
}

const rows = (bus: Bus, kind: Kind, ids: string): SoundEntry[] =>
  ids.split(' ').map((id) => ({
    id,
    bus,
    kind,
    seed: [...id].reduce((h, c) => (h * 31 + c.charCodeAt(0)) | 0, 7),
    rate: kind === 'room' ? 0 : kind === 'bed' ? BED_RATE : SR,
    recipe: RECIPES[id],
  }));

export const CATALOG: readonly SoundEntry[] = [
  ...rows('ui', 'tick', 'click'),
  ...rows('ui', 'touch', 'place rotate invalid pick swap lock'),
  ...rows('music', 'room', 'room'),
  ...rows('factory', 'note', 'wood-low wood-high bar-low bar-high'),
  ...rows('factory', 'machine', 'crush press smelt slag jam'),
  ...rows('factory', 'sting', 'stall'),
  ...rows('music', 'sting', 'run settle round-good round-flat star-1 star-2 star-3 job-done'),
  ...rows('music', 'bed', 'pad belt'),
];

/** The mix: send levels into the shared room per bus and the steady levels of the ambient bed, used alike by audio.ts and the offline shift. */
export const MIX = {
  send: { ui: 0.12, factory: 0.24, music: 0.32 } as Record<Bus, number>,
  machine: 0.8,
  pad: 0.9,
  belt: 0.8,
};

/** Renders the catalog a slice at a time and keeps what it made. One step is one plain recipe, or one stage of a long one. A recipe that fails is skipped: its sound stays silent. */
export class Bank<B> {
  #ready = new Map<string, B>();
  #queue: SoundEntry[];
  #entry: SoundEntry | undefined;
  #job: Generator<void, Sound> | null = null;
  #make: (s: Sound, rate: number, e: SoundEntry) => B;
  #rate: number;
  failed = 0;

  constructor(entries: readonly SoundEntry[], make: (s: Sound, rate: number, e: SoundEntry) => B, contextRate = SR) {
    this.#queue = [...entries];
    this.#make = make;
    this.#rate = contextRate;
  }
  get size() {
    return this.#ready.size;
  }
  get(id: string) {
    return this.#ready.get(id);
  }
  #keep(e: SoundEntry, s: Sound) {
    this.#ready.set(e.id, this.#make(s, e.rate || this.#rate, e));
  }
  /** One unit of work; false when nothing is left. */
  step(): boolean {
    try {
      if (this.#job) {
        const s = this.#job.next();
        if (s.done) {
          this.#job = null;
          this.#keep(this.#entry!, s.value);
        }
      } else {
        const e = (this.#entry = this.#queue.shift());
        if (!e) return false;
        const r = e.recipe(e.seed, e.rate || this.#rate);
        if ('next' in r) this.#job = r;
        else this.#keep(e, r);
      }
    } catch {
      this.#job = null;
      this.failed++;
    }
    return !!this.#job || this.#queue.length > 0;
  }
  /** Work until `budget` ms have gone by `clock`, always at least one step; true while more is left. */
  pump(budget: number, clock: () => number) {
    const t = clock();
    let more = this.step();
    while (more && clock() - t < budget) more = this.step();
    return more;
  }
}

/** The whole catalog, rendered at once: Node's way. */
export function renderAll(contextRate = SR) {
  const out = new Map<string, { sound: Sound; rate: number; entry: SoundEntry }>();
  const bank = new Bank(CATALOG, (sound, rate, entry) => out.set(entry.id, { sound, rate, entry }), contextRate);
  while (bank.step());
  return out;
}
