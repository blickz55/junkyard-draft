/**
 * The game's sound (docs/SOUND.md). Everything is rendered from recipes in game/src/sound after the first gesture, a slice at a time, and
 * played from AudioBuffers through three buses into one shared room:
 *   ui      — touches of the yard: click, place, rotate, swap, invalid, pick, lock-in
 *   factory — the line: one call per tick; shipped goods play a walking mallet melody (sound/line.ts), machines their own hits, a jam a muted
 *             rattle; a stall a two-note cue
 *   music   — shift start, settle, round end, star marks, job done, and the ambient bed from run start to the settle: a warm pad on the shift's
 *             root and a very quiet belt rumble that follows the items in flight
 * Buses and the room meet at the master, then a soft limiter that nothing passes. Per-bus levels live in settings; reduced audio plays at
 * most one sound per simulation tick, never a chord, and no bed. Anything not yet rendered is silent, and nothing throws. Counters are kept
 * even while the context is suspended or muted, so tests can observe the allocator. A hidden tab fades and suspends.
 * Private members use # because the bundler shortens those names and the bundle has a budget.
 */
import { loadSettings, updateSettings, type Buses } from './storage';
import { VoiceAllocator, planTick, humRoot, humTarget, type TickSounds, type TickPlan, type HumInput } from './mixer';
import { Bank, CATALOG, MIX } from '../sound/catalog';
import { LineComposer, STEP_MS, gridDelay, stingRate, voiceOf, type LineNote } from '../sound/line';
import { limitCurve } from '../sound/dsp';
import { PAD_HZ } from '../sound/recipes';

export type BusName = keyof Buses;
const MACHINES = ['slag', 'crush', 'press', 'smelt']; // by transform tier
const SLICE_MS = 4; // rendering takes at most about this much of a frame
const PREVIEW_LOOP_S = 4;

interface VoiceOptions {
  gain?: number;
  rate?: number;
  /** seconds from now */
  delay?: number;
  pan?: number;
  cutoff?: number;
  loop?: boolean;
}

class Synth {
  #ctx: AudioContext | null = null;
  #master: GainNode | null = null;
  #fader: GainNode | null = null;
  #bus: Partial<Record<BusName, GainNode>> = {};
  #bank: Bank<AudioBuffer> | null = null;
  #rendering = false;
  #maxSliceMs = 0;
  #lastJam = 0;
  #alloc = new VoiceAllocator();
  #line = new LineComposer();
  #round = 1;
  #origin = 0; // when this shift's step grid began (performance.now)
  #stats = { sounds: 0, chords: 0, maxPerTick: 0, ticks: 0, played: 0 };
  #bed: { pad: Voice; belt: Voice } | null = null;
  #loops = 0;
  #hum = { on: false, round: 0, root: 0, freq: 0, cutoff: 0, detuned: false, starts: 0 };
  #held = false; // the game paused: only resume() may wake the context, not a stray gesture
  #sleepTimer: ReturnType<typeof setTimeout> | undefined;
  #preview: Voice | null = null;
  volume = 0.7;
  muted = false;
  buses: Buses;
  reducedAudio: boolean;

  constructor() {
    const s = loadSettings();
    this.volume = s.volume;
    this.muted = s.muted;
    this.buses = { ...s.buses };
    this.reducedAudio = s.reducedAudio;
  }
  #ensure() {
    if (this.#ctx) return this.#ctx;
    try {
      const c = new window.AudioContext({ sampleRate: 48000 }); // whatever the hardware runs at: the room and every node cost less, and the impulse has one rate
      const master = gainNode(c, this.muted ? 0 : this.volume);
      const limiter = c.createWaveShaper();
      const fader = gainNode(c, 1);
      const verb = c.createConvolver();
      verb.normalize = false; // the impulse is scaled to unit energy, so a send level means what it says
      limiter.curve = limitCurve();
      master.connect(limiter).connect(fader).connect(c.destination);
      verb.connect(master);
      for (const b of ['ui', 'factory', 'music'] as BusName[]) {
        const g = gainNode(c, this.buses[b]);
        g.connect(master);
        g.connect(gainNode(c, MIX.send[b])).connect(verb);
        this.#bus[b] = g;
      }
      this.#ctx = c;
      this.#master = master;
      this.#fader = fader;
      this.#bank = new Bank(
        CATALOG,
        (s, rate, e) => {
          const ch = Array.isArray(s) ? s : [s];
          const buf = c.createBuffer(ch.length, ch[0].length, rate);
          ch.forEach((x, i) => buf.copyToChannel(x as Float32Array<ArrayBuffer>, i));
          if (e.kind === 'room') verb.buffer = buf;
          return buf;
        },
        c.sampleRate,
      );
      document.addEventListener('visibilitychange', this.#onVisibility);
      if (document.visibilityState === 'hidden') this.#sleep();
    } catch {
      this.#ctx = null;
    }
    return this.#ctx;
  }
  /** Render a slice, then give the frame back: at most about SLICE_MS in every 16 ms. */
  #slice = () => {
    const t = performance.now();
    const more = this.#bank?.pump(SLICE_MS, () => performance.now());
    this.#maxSliceMs = Math.max(this.#maxSliceMs, performance.now() - t);
    if (more) setTimeout(this.#slice, 16);
  };
  /** how many gestures asked for the context (the touch e2e checks the first tap on the yard asks) */
  unlockAttempts = 0;
  /** Call from a user gesture so the context can start; the first one also starts rendering the sounds. */
  unlock() {
    this.unlockAttempts++;
    const c = this.#ensure();
    if (!c) return;
    if (!this.#held && document.visibilityState !== 'hidden') this.#wake();
    if (!this.#rendering) {
      this.#rendering = true;
      this.#slice();
    }
  }
  #level() {
    if (this.#master) this.#master.gain.value = this.muted ? 0 : this.volume;
    updateSettings({ volume: this.volume, muted: this.muted });
  }
  setVolume(v: number) {
    this.volume = Math.max(0, Math.min(1, v));
    this.#level();
  }
  setMuted(m: boolean) {
    this.muted = m;
    this.#level();
  }
  /** Per-bus level 0..1, persisted. */
  setBus(name: BusName, v: number) {
    this.buses = { ...this.buses, [name]: Math.max(0, Math.min(1, v)) };
    const g = this.#bus[name];
    if (g) g.gain.value = this.buses[name];
    updateSettings({ buses: this.buses });
  }
  setReducedAudio(on: boolean) {
    this.reducedAudio = on;
    updateSettings({ reducedAudio: on });
  }
  /** Fade out, then let the context stop: nothing keeps sounding where nobody is looking. */
  #sleep() {
    const c = this.#ctx;
    if (!c) return;
    this.#fader?.gain.setTargetAtTime(0, c.currentTime, 0.03);
    clearTimeout(this.#sleepTimer);
    this.#sleepTimer = setTimeout(() => void c.suspend(), 150);
  }
  #wake() {
    const c = this.#ctx;
    if (!c) return;
    clearTimeout(this.#sleepTimer);
    void c.resume();
    this.#fader?.gain.setTargetAtTime(1, c.currentTime, 0.05);
  }
  #onVisibility = () => {
    if (document.visibilityState === 'hidden') this.#sleep();
    else if (!this.#held) this.#wake();
  };
  suspend() {
    this.#held = true;
    this.#sleep();
  }
  resume() {
    this.#held = false;
    if (this.#ctx && document.visibilityState !== 'hidden') this.#wake();
  }
  /** Counters for the dev API / tests: sounds requested, chords played, the most sounds in one tick, ticks seen. */
  info() {
    return {
      ...this.#stats,
      reducedAudio: this.reducedAudio,
      buses: { ...this.buses },
      muted: this.muted,
      volume: this.volume,
      unlockAttempts: this.unlockAttempts,
      contextState: this.#ctx?.state ?? null,
      hum: { ...this.#hum, loops: this.#loops },
      bank: { rendered: this.#bank?.size ?? 0, total: CATALOG.length, failed: this.#bank?.failed ?? 0, maxSliceMs: this.#maxSliceMs },
    };
  }

  /** One voice. Counted even when it cannot sound; silent while its sound is not rendered, the context sleeps or the game is muted. */
  #play(id: string, v: VoiceOptions = {}): Voice | null {
    this.#stats.sounds++;
    const c = this.#ensure();
    const buf = this.#bank?.get(id);
    const dest = this.#bus[CATALOG.find((e) => e.id === id)?.bus ?? 'ui'];
    if (!c || !buf || !dest || this.muted || c.state !== 'running') return null;
    const src = c.createBufferSource();
    const gain = gainNode(c, v.gain ?? 1);
    src.buffer = buf;
    src.playbackRate.value = v.rate ?? 1;
    src.loop = !!v.loop;
    let filter: BiquadFilterNode | undefined;
    if (v.cutoff) {
      filter = c.createBiquadFilter();
      filter.frequency.value = v.cutoff;
      src.connect(filter).connect(gain);
    } else src.connect(gain);
    if (v.pan === undefined) gain.connect(dest);
    else {
      const p = c.createStereoPanner();
      p.pan.value = v.pan;
      gain.connect(p).connect(dest);
    }
    if (v.loop) {
      this.#loops++;
      src.onended = () => this.#loops--;
    }
    src.start(c.currentTime + (v.delay ?? 0));
    this.#stats.played++;
    return { src, gain: gain.gain, filter };
  }
  /** A one-shot in the shift's key. */
  #sting(id: string, priority: number) {
    if (this.#alloc.acquire('misc', priority, performance.now(), 300)) this.#play(id, { rate: stingRate(this.#round) });
  }
  /** A touch of the yard, never twice quite the same. */
  #touch(id: string, priority: number, ms: number) {
    if (this.#alloc.acquire('ui', priority, performance.now(), ms)) this.#play(id, { rate: 0.985 + Math.random() * 0.03, gain: 0.92 + Math.random() * 0.08 });
  }
  /** Factory bus −6 dB for `ms`, then back (a phrase speaks over the line). */
  #duck(ms = 600) {
    const g = this.#bus.factory;
    const c = this.#ctx;
    if (!g || !c) return;
    g.gain.cancelScheduledValues(c.currentTime);
    g.gain.setValueAtTime(this.buses.factory * 0.5, c.currentTime);
    g.gain.linearRampToValueAtTime(this.buses.factory, c.currentTime + ms / 1000);
  }

  // ---------- ui bus ----------
  click() {
    this.#touch('click', 1, 50);
  }
  /** a card taken from the draft */
  pick() {
    this.#touch('pick', 2, 120);
  }
  place() {
    this.#touch('place', 2, 90);
  }
  rotate() {
    this.#touch('rotate', 1, 60);
  }
  /** a placed machine traded places with another */
  swap() {
    this.#touch('swap', 2, 200);
  }
  invalid() {
    this.#touch('invalid', 3, 240);
  }
  /** draft lock-in: a machine joins the bin */
  lockIn() {
    this.#touch('lock', 3, 150);
  }

  // ---------- factory bus: one call per simulation tick ----------
  /** Play what one tick sounds like: the melody's next note if it is due, one machine, a rattle; reduced audio keeps one sound. */
  tickSounds(t: TickSounds): TickPlan {
    const plan = planTick(t, this.reducedAudio);
    const stats = this.#stats;
    stats.ticks++;
    stats.maxPerTick = Math.max(stats.maxPerTick, plan.count);
    const now = performance.now();
    this.#origin ||= now;
    const step = Math.round((now - this.#origin) / STEP_MS);
    const notes = this.#line.tick(plan.chord, t.ships.length, step, this.reducedAudio);
    if (notes.length > 1) stats.chords++;
    for (const n of notes) if (this.#alloc.acquire('ship', n.value, now, 600)) this.#note(n, gridDelay(now, this.#origin, step));
    const hit = this.#line.machine(plan.transforms, t.transforms.length, step);
    if (hit && this.#alloc.acquire('transform', hit.tier, now, 200)) this.#play(MACHINES[hit.tier], { gain: hit.gain * MIX.machine, rate: hit.rate });
    if (plan.jam && now - this.#lastJam >= 900 && this.#alloc.acquire('jam', 1, now, 360)) {
      this.#lastJam = now;
      this.#play('jam', { gain: 0.7 + Math.random() * 0.3, rate: 0.92 + Math.random() * 0.16 });
    }
    return plan;
  }
  #note(n: LineNote, delay: number) {
    const { id, ...v } = voiceOf(n);
    return this.#play(id, { ...v, delay });
  }
  /** A single ship outside the tick path (kept for callers such as selling a part). */
  ship(value: number) {
    this.tickSounds({ ships: [value], transforms: [], jams: 0 });
  }
  /** A stall began (nothing shipped for a while): two soft falling notes. */
  stall() {
    this.#sting('stall', 2);
  }

  // ---------- music bus ----------
  roundEnd(good: boolean) {
    this.#duck();
    this.#sting(good ? 'round-good' : 'round-flat', 5);
  }
  run() {
    this.#sting('run', 3);
  }
  /** round settle: the line comes to rest after the last tick */
  settle() {
    this.#sting('settle', 3);
  }
  /** a star mark reached during the shift: each brighter than the last */
  star(n: 1 | 2 | 3) {
    this.#sting(`star-${n}`, 4 + n);
  }
  /** all three stars, or the job finished */
  jobDone() {
    this.#duck();
    this.#sting('job-done', 8);
  }

  // ---------- the ambient bed (music bus) ----------
  /** Start a shift: its scale, its step grid, and the bed on its root. No bed under reduced audio. */
  humStart(round: number) {
    this.humStop(false);
    this.#round = round;
    this.#line = new LineComposer(round, this.#hum.starts + round);
    this.#origin = 0;
    if (this.reducedAudio) return;
    const root = humRoot(round);
    this.#hum = { on: true, round, root, freq: root, cutoff: 300, detuned: false, starts: this.#hum.starts + 1 };
    this.#startBed();
  }
  /** Bring up the bed; while its loops are still rendering, or the context is asleep, the next tick tries again. */
  #startBed() {
    const c = this.#ctx;
    if (!c || this.muted || c.state !== 'running' || !this.#bank?.get('pad') || !this.#bank.get('belt')) return; // both or neither: a lone loop would run on unowned
    const pad = this.#play('pad', { loop: true, rate: this.#hum.root / PAD_HZ, gain: 0 });
    const belt = this.#play('belt', { loop: true, cutoff: this.#hum.cutoff, gain: 0 });
    if (!pad || !belt) return;
    pad.gain.setTargetAtTime(MIX.pad, c.currentTime, 0.4);
    belt.gain.setTargetAtTime(MIX.belt * 0.3, c.currentTime, 0.4);
    this.#bed = { pad, belt };
  }
  /** Follow the line once per tick: the rumble's cutoff and level track items in flight, a jam pulls the pad a shade sharp, the last ten ticks swell it. */
  humUpdate(input: HumInput) {
    if (!this.#hum.on) return;
    const t = humTarget(this.#hum.root, input);
    this.#hum = { ...this.#hum, freq: t.freq, cutoff: t.cutoff, detuned: t.detuned };
    if (!this.#bed) this.#startBed();
    const b = this.#bed;
    const c = this.#ctx;
    if (!b || !c) return;
    const now = c.currentTime;
    b.belt.filter?.frequency.setTargetAtTime(t.cutoff, now, 0.25);
    b.belt.gain.setTargetAtTime(MIX.belt * (0.3 + 0.7 * Math.min(1, input.inFlight / 12)), now, 0.4);
    b.pad.src.playbackRate.setTargetAtTime(t.freq / PAD_HZ, now, 0.5);
    b.pad.gain.setTargetAtTime(MIX.pad * (1 + 0.4 * t.rise), now, 0.5);
  }
  /** Fade the bed out and stop its loops: slowly under the settle, quickly when the scene goes. */
  humStop(resolve = true) {
    if (!resolve) this.#held = false; // the scene is going: a pause dies with it
    const b = this.#bed;
    const c = this.#ctx;
    this.#bed = null;
    this.#hum = { ...this.#hum, on: false, detuned: false };
    if (!b || !c) return;
    const tau = resolve ? 0.16 : 0.04;
    for (const v of [b.pad, b.belt]) {
      v.gain.cancelScheduledValues(c.currentTime);
      fadeOut(v, c, tau);
    }
  }

  // ---------- the Sound test ----------
  /** Everything the Sound test can play: ids and buses. A label for an id is the string table's business. */
  previewList() {
    return CATALOG.filter((e) => e.kind !== 'room').map(({ id, bus }) => ({ id, bus: bus as BusName }));
  }
  /** Play one sound for audition, fading the last one. A bed plays a few seconds and stops by itself. False when it cannot sound yet. */
  preview(name: string) {
    this.unlock();
    const c = this.#ctx;
    const e = CATALOG.find((x) => x.id === name);
    if (!c || !e || !this.#bank?.get(name)) return false;
    if (this.#preview) fadeOut(this.#preview, c, 0.015);
    const loop = e.kind === 'bed';
    const go = () => {
      const v = (this.#preview = this.#play(name, { loop, gain: loop ? 0 : 1, rate: name === 'pad' ? (this.#hum.root || PAD_HZ) / PAD_HZ : 1 }));
      if (!v || !loop) return;
      v.gain.setTargetAtTime(name === 'pad' ? MIX.pad : MIX.belt, c.currentTime, 0.3);
      v.gain.setTargetAtTime(0, c.currentTime + PREVIEW_LOOP_S - 0.8, 0.12);
      v.src.stop(c.currentTime + PREVIEW_LOOP_S);
    };
    if (c.state === 'running') go();
    else void c.resume().then(go);
    return true;
  }
}

interface Voice {
  src: AudioBufferSourceNode;
  gain: AudioParam;
  filter?: BiquadFilterNode;
}
function gainNode(c: AudioContext, value: number) {
  const g = c.createGain();
  g.gain.value = value;
  return g;
}
/** Fade a voice with time constant `tau`, then stop it once it is about 80 dB down. */
function fadeOut(v: Voice, c: AudioContext, tau: number) {
  v.gain.setTargetAtTime(0, c.currentTime, tau);
  v.src.stop(c.currentTime + tau * 9);
}

export const audio = new Synth();
