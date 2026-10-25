/** Tiny WebAudio synth. Everything is generated; no asset files. */
import { loadSettings, updateSettings } from './storage';

class Synth {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private lastJam = 0;
  volume = 0.7;
  muted = false;

  constructor() {
    const s = loadSettings();
    this.volume = s.volume; this.muted = s.muted;
  }
  private ensure() {
    if (this.ctx) return this.ctx;
    const AC = (window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext);
    if (!AC) return null;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.muted ? 0 : this.volume;
    this.master.connect(this.ctx.destination);
    return this.ctx;
  }
  /** Call from a user gesture so the context can start. */
  unlock() { const c = this.ensure(); if (c && c.state === 'suspended') void c.resume(); }
  setVolume(v: number) { this.volume = Math.max(0, Math.min(1, v)); if (this.master) this.master.gain.value = this.muted ? 0 : this.volume; updateSettings({ volume: this.volume, muted: this.muted }); }
  setMuted(m: boolean) { this.muted = m; if (this.master) this.master.gain.value = m ? 0 : this.volume; updateSettings({ volume: this.volume, muted: this.muted }); }
  suspend() { void this.ctx?.suspend(); }
  resume() { void this.ctx?.resume(); }

  private tone(freq: number, dur: number, type: OscillatorType = 'square', gain = 0.15, slide = 0) {
    const c = this.ensure(); if (!c || !this.master || this.muted) return;
    const o = c.createOscillator(); const g = c.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, c.currentTime);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(20, freq + slide), c.currentTime + dur);
    g.gain.setValueAtTime(gain, c.currentTime); g.gain.exponentialRampToValueAtTime(0.001, c.currentTime + dur);
    o.connect(g); g.connect(this.master); o.start(); o.stop(c.currentTime + dur + 0.02);
  }
  private noise(dur: number, gain = 0.12, lowpass = 800) {
    const c = this.ensure(); if (!c || !this.master || this.muted) return;
    const buf = c.createBuffer(1, Math.floor(c.sampleRate * dur), c.sampleRate);
    const d = buf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length);
    const src = c.createBufferSource(); src.buffer = buf;
    const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = lowpass;
    const g = c.createGain(); g.gain.value = gain;
    src.connect(f); f.connect(g); g.connect(this.master); src.start();
  }
  click() { this.tone(900, 0.05, 'square', 0.08); }
  place() { this.noise(0.08, 0.15, 1200); this.tone(220, 0.08, 'triangle', 0.12, -60); }
  rotate() { this.tone(500, 0.04, 'square', 0.06, 200); }
  invalid() { this.tone(160, 0.15, 'sawtooth', 0.1, -40); }
  ship(value: number) { const base = value >= 12 ? 880 : value >= 3 ? 660 : 440; this.tone(base, 0.09, 'triangle', 0.1); if (value >= 12) this.tone(base * 1.5, 0.12, 'triangle', 0.08); }
  transform() { this.tone(330, 0.06, 'square', 0.05, 120); }
  jam() { const t = performance.now(); if (t - this.lastJam < 400) return; this.lastJam = t; this.noise(0.06, 0.06, 400); }
  roundEnd(good: boolean) { const n = good ? [523, 659, 784, 1046] : [392, 440]; n.forEach((f, i) => setTimeout(() => this.tone(f, 0.18, 'triangle', 0.12), i * 90)); }
  run() { this.tone(200, 0.3, 'sawtooth', 0.08, 300); }
}

export const audio = new Synth();
