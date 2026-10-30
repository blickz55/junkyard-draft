/**
 * Tiny WebAudio synth with three buses (DOSSIER-v1 §3, 0.4.9). Everything is generated; no asset files.
 *   ui      — clicks, place/rotate/invalid, lock-in
 *   factory — ship/transform/jam/stall: one call per tick (ship chord, capped transforms, throttled jam), value priority;
 *             two authored samples (dock clink, press thud) sit beneath the tones inside the same voices (0.4.13)
 *   music   — run start, round fanfare, settle (the fanfare ducks the factory bus −6 dB for 600 ms) and the throughput hum:
 *             a drone of two detuned triangles through a low-pass filter that lives from run start to the settle (0.4.10)
 * Per-bus levels live in settings; reduced audio plays at most one sound per simulation tick and never a chord.
 * Counters are kept even while the context is suspended or muted, so tests can observe the allocator.
 */
import { loadSettings, updateSettings, type Buses } from './storage';
import { VoiceAllocator, planTick, humRoot, humTarget, HUM_RESOLVE_HZ, type TickSounds, type TickPlan, type HumInput } from './mixer';
import { SampleBank, impactsForTick, type ImpactKind } from './samples';

export type BusName = keyof Buses;
const SHIP_NOTE = (value: number) => (value >= 12 ? 880 : value >= 8 ? 740 : value >= 3 ? 660 : 440);
const TRANSFORM_NOTE = (tier: number) => [262, 330, 392, 494][Math.max(0, Math.min(3, tier))];

class Synth {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private bus: Partial<Record<BusName, GainNode>> = {};
  private lastJam = 0;
  private duckUntil = 0;
  private alloc = new VoiceAllocator();
  readonly samples = new SampleBank();
  private stats = { sounds: 0, chords: 0, maxPerTick: 0, lastTick: 0, ticks: 0 };
  private hum: { osc: OscillatorNode[]; filter: BiquadFilterNode; gain: GainNode } | null = null;
  private humState = { on: false, round: 0, root: 0, freq: 0, cutoff: 0, detuned: false, starts: 0 };
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
  private ensure() {
    if (this.ctx) return this.ctx;
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return null;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.muted ? 0 : this.volume;
    this.master.connect(this.ctx.destination);
    for (const b of ['ui', 'factory', 'music'] as BusName[]) {
      const g = this.ctx.createGain();
      g.gain.value = this.buses[b];
      g.connect(this.master);
      this.bus[b] = g;
    }
    void this.samples.decode(this.ctx); // bytes arrived with the boot loader; decoding needs a context
    return this.ctx;
  }
  /** how many gestures asked for the context (the touch e2e checks the first tap on the yard asks) */
  unlockAttempts = 0;
  /** Call from a user gesture so the context can start. */
  unlock() {
    this.unlockAttempts++;
    const c = this.ensure();
    if (c && c.state === 'suspended') void c.resume();
  }
  setVolume(v: number) {
    this.volume = Math.max(0, Math.min(1, v));
    if (this.master) this.master.gain.value = this.muted ? 0 : this.volume;
    updateSettings({ volume: this.volume, muted: this.muted });
  }
  setMuted(m: boolean) {
    this.muted = m;
    if (this.master) this.master.gain.value = m ? 0 : this.volume;
    updateSettings({ volume: this.volume, muted: this.muted });
  }
  /** Per-bus level 0..1, persisted. */
  setBus(name: BusName, v: number) {
    this.buses = { ...this.buses, [name]: Math.max(0, Math.min(1, v)) };
    const g = this.bus[name];
    if (g) g.gain.value = this.buses[name];
    updateSettings({ buses: this.buses });
  }
  setReducedAudio(on: boolean) {
    this.reducedAudio = on;
    updateSettings({ reducedAudio: on });
  }
  suspend() {
    void this.ctx?.suspend();
  }
  resume() {
    void this.ctx?.resume();
  }
  /** Counters for the dev API / tests: sounds requested, chords played, the most sounds in one tick, ticks seen. */
  info() {
    return {
      ...this.stats,
      reducedAudio: this.reducedAudio,
      buses: { ...this.buses },
      muted: this.muted,
      volume: this.volume,
      unlockAttempts: this.unlockAttempts,
      contextState: this.ctx?.state ?? null,
      duckedNow: performance.now() < this.duckUntil,
      hum: { ...this.humState },
      samples: this.samples.stats(),
    };
  }

  private out(bus: BusName): AudioNode | null {
    const c = this.ensure();
    if (!c || !this.master) return null;
    return this.bus[bus] ?? this.master;
  }
  private tone(bus: BusName, freq: number, dur: number, type: OscillatorType = 'square', gain = 0.15, slide = 0) {
    this.stats.sounds++;
    const dest = this.out(bus);
    const c = this.ctx;
    if (!dest || !c || this.muted) return;
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, c.currentTime);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(20, freq + slide), c.currentTime + dur);
    g.gain.setValueAtTime(gain, c.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, c.currentTime + dur);
    o.connect(g);
    g.connect(dest);
    o.start();
    o.stop(c.currentTime + dur + 0.02);
  }
  private noise(bus: BusName, dur: number, gain = 0.12, lowpass = 800) {
    this.stats.sounds++;
    const dest = this.out(bus);
    const c = this.ctx;
    if (!dest || !c || this.muted) return;
    const buf = c.createBuffer(1, Math.floor(c.sampleRate * dur), c.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length);
    const src = c.createBufferSource();
    src.buffer = buf;
    const f = c.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = lowpass;
    const g = c.createGain();
    g.gain.value = gain;
    src.connect(f);
    f.connect(g);
    g.connect(dest);
    src.start();
  }
  /** Factory bus −6 dB for `ms`, then back (the fanfare speaks over the line). */
  private duck(ms = 600) {
    const g = this.bus.factory;
    const c = this.ctx;
    this.duckUntil = performance.now() + ms;
    if (!g || !c) return;
    g.gain.cancelScheduledValues(c.currentTime);
    g.gain.setValueAtTime(this.buses.factory * 0.5, c.currentTime);
    g.gain.linearRampToValueAtTime(this.buses.factory, c.currentTime + ms / 1000);
  }

  // ---------- ui bus ----------
  click() {
    if (this.alloc.acquire('ui', 1, performance.now(), 50)) this.tone('ui', 900, 0.05, 'square', 0.08);
  }
  place() {
    if (!this.alloc.acquire('ui', 2, performance.now(), 80)) return;
    this.noise('ui', 0.08, 0.15, 1200);
    this.tone('ui', 220, 0.08, 'triangle', 0.12, -60);
  }
  rotate() {
    if (this.alloc.acquire('ui', 1, performance.now(), 40)) this.tone('ui', 500, 0.04, 'square', 0.06, 200);
  }
  invalid() {
    if (this.alloc.acquire('ui', 3, performance.now(), 150)) this.tone('ui', 160, 0.15, 'sawtooth', 0.1, -40);
  }
  /** draft lock-in: a machine joins the bin (two quick rising notes) */
  lockIn() {
    if (!this.alloc.acquire('ui', 3, performance.now(), 150)) return;
    this.tone('ui', 660, 0.06, 'square', 0.07);
    setTimeout(() => this.tone('ui', 990, 0.08, 'square', 0.07), 60);
  }

  // ---------- factory bus: one call per simulation tick ----------
  /** Play what one tick sounds like: a coalesced ship chord, capped transforms, a throttled jam; reduced audio keeps one sound. */
  tickSounds(t: TickSounds): TickPlan {
    const plan = planTick(t, this.reducedAudio);
    this.stats.ticks++;
    this.stats.maxPerTick = Math.max(this.stats.maxPerTick, plan.count);
    this.stats.lastTick = plan.count;
    const now = performance.now();
    const impacts = impactsForTick(plan, this.reducedAudio);
    if (plan.chord.length > 1) this.stats.chords++;
    plan.chord.forEach((value, i) => {
      if (!this.alloc.acquire('ship', value, now, 120)) return;
      this.tone('factory', SHIP_NOTE(value), 0.09, 'triangle', i === 0 ? 0.1 : 0.06);
      if (value >= 12 && i === 0) this.tone('factory', SHIP_NOTE(value) * 1.5, 0.12, 'triangle', 0.08);
      if (i === 0 && impacts.includes('ship')) this.impact('ship', value >= 12 ? 0.6 : 0.45);
    });
    let pressed = false;
    for (const tier of plan.transforms)
      if (this.alloc.acquire('transform', tier, now, 80)) {
        this.tone('factory', TRANSFORM_NOTE(tier), 0.06, 'square', 0.05, 120);
        if (tier === 2 && !pressed && impacts.includes('press')) {
          pressed = true;
          this.impact('press', 0.5);
        }
      }
    if (plan.jam && now - this.lastJam >= 400) {
      this.lastJam = now;
      this.noise('factory', 0.06, 0.06, 400);
    }
    return plan;
  }
  /** A sample beneath a tone whose voice was just granted; silent fallback when the file is missing or still decoding. */
  private impact(kind: ImpactKind, gain: number) {
    const dest = this.out('factory');
    const c = this.ctx;
    if (!dest || !c || this.muted) return;
    this.samples.trigger(kind, c, dest, gain);
  }
  /** A single ship outside the tick path (kept for callers such as selling a part). */
  ship(value: number) {
    this.tickSounds({ ships: [value], transforms: [], jams: 0 });
  }
  /** A stall began (nothing shipped for a while): one low tone. */
  stall() {
    if (this.alloc.acquire('misc', 2, performance.now(), 300)) this.tone('factory', 110, 0.3, 'triangle', 0.08, -20);
  }

  // ---------- music bus ----------
  roundEnd(good: boolean) {
    this.duck(600);
    const n = good ? [523, 659, 784, 1046] : [392, 440];
    n.forEach((f, i) => setTimeout(() => this.tone('music', f, 0.18, 'triangle', 0.12), i * 90));
  }
  run() {
    this.tone('music', 200, 0.3, 'sawtooth', 0.08, 300);
  }
  /** round settle: the line comes to rest after the last tick (one soft falling tone) */
  settle() {
    this.tone('music', 196, 0.25, 'triangle', 0.08, -40);
  }

  // ---------- throughput hum (music bus, DOSSIER-v1 0.4.10) ----------
  /** Start the drone for a round: the root climbs a pentatonic scale by round. Silent under reduced audio. */
  humStart(round: number) {
    this.humStop(false);
    if (this.reducedAudio) return;
    const root = humRoot(round);
    this.humState = { on: true, round, root, freq: root, cutoff: 300, detuned: false, starts: this.humState.starts + 1 };
    const c = this.ensure();
    const dest = this.out('music');
    if (!c || !dest) return;
    const filter = c.createBiquadFilter();
    filter.type = 'lowpass';
    filter.Q.value = 0.9;
    filter.frequency.value = 300;
    const gain = c.createGain();
    gain.gain.setValueAtTime(0.0001, c.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.06, c.currentTime + 0.4);
    const osc = [1, 1.006].map((k) => {
      const o = c.createOscillator();
      o.type = 'triangle';
      o.frequency.value = root * k;
      o.connect(filter);
      o.start();
      return o;
    });
    filter.connect(gain);
    gain.connect(dest);
    this.hum = { osc, filter, gain };
  }
  /** Follow the line once per tick: the cutoff tracks items in flight, a jam detunes a quarter tone, the last ten ticks rise an octave. */
  humUpdate(input: HumInput) {
    if (!this.humState.on) return;
    const t = humTarget(this.humState.root, input);
    this.humState = { ...this.humState, freq: t.freq, cutoff: t.cutoff, detuned: t.detuned };
    const h = this.hum;
    const c = this.ctx;
    if (!h || !c) return;
    h.filter.frequency.setTargetAtTime(t.cutoff, c.currentTime, 0.08);
    h.osc[0].frequency.setTargetAtTime(t.freq, c.currentTime, 0.05);
    h.osc[1].frequency.setTargetAtTime(t.freq * 1.006, c.currentTime, 0.05);
  }
  /** Stop the drone. With `resolve` it glides to the fanfare's root (C4) and fades, as the settle; otherwise it just fades. */
  humStop(resolve = true) {
    const h = this.hum;
    const c = this.ctx;
    this.hum = null;
    this.humState = { ...this.humState, on: false, detuned: false };
    if (!h || !c) return;
    const now = c.currentTime;
    if (resolve)
      h.osc.forEach((o, i) => {
        o.frequency.cancelScheduledValues(now);
        o.frequency.setValueAtTime(Math.max(20, o.frequency.value), now);
        o.frequency.exponentialRampToValueAtTime(HUM_RESOLVE_HZ * (i ? 1.006 : 1), now + 0.25);
      });
    h.gain.gain.setTargetAtTime(0.0001, now + (resolve ? 0.2 : 0), 0.08);
    for (const o of h.osc) o.stop(now + (resolve ? 0.6 : 0.3));
  }
}

export const audio = new Synth();
