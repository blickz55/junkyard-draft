/**
 * Impact samples under the synth (DOSSIER-v1 §3.3, 0.4.13). Two tiny authored WAVs (game/public/sfx, rendered by
 * tools/make-sfx.ts) give the dock ship a metallic clink and the press a dull thud beneath the existing tones. The
 * bytes arrive through Phaser's loader (the same path as the art, so the packaged app's file:// origin works), are
 * decoded once a context exists, and play through the factory bus. A sample never has a voice of its own: the synth
 * triggers it only after the tone's voice was granted, so the caps stay shared. Anything missing or undecodable falls
 * back silently to synth-only; reduced audio never uses samples. Pure enough to unit-test with a stub context.
 */
import type { TickPlan } from './mixer';

export type ImpactKind = 'ship' | 'press';
export const IMPACTS: readonly ImpactKind[] = ['ship', 'press'];
export const IMPACT_FILES: Record<ImpactKind, string> = { ship: 'sfx/ship.wav', press: 'sfx/press.wav' };

/** The slice of AudioContext the bank uses, so Node tests can stub it. */
export interface SampleContext {
  currentTime: number;
  decodeAudioData(data: ArrayBuffer): Promise<AudioBuffer>;
  createBufferSource(): AudioBufferSourceNode;
  createGain(): GainNode;
}
export interface SampleStats { loaded: number; played: number; missing: ImpactKind[]; failed: ImpactKind[]; decoding: boolean }

/** Which impacts one tick carries: a ship when anything shipped (the chord), a press when a plate was made. */
export function impactsForTick(plan: TickPlan, reducedAudio: boolean): ImpactKind[] {
  if (reducedAudio) return [];
  const out: ImpactKind[] = [];
  if (plan.chord.length) out.push('ship');
  if (plan.transforms.includes(2)) out.push('press');
  return out;
}

export class SampleBank {
  private raw = new Map<ImpactKind, ArrayBuffer>();
  private buffers = new Map<ImpactKind, AudioBuffer>();
  private failed = new Set<ImpactKind>();
  private decoding: Promise<void> | null = null;
  private played = 0;

  /** Hand over fetched bytes (null when the file did not load). Decoding waits for `decode(ctx)`. */
  provide(kind: ImpactKind, bytes: ArrayBuffer | null) { if (bytes && bytes.byteLength > 44) this.raw.set(kind, bytes); }
  has(kind: ImpactKind) { return this.buffers.has(kind); }
  /** Decode everything provided and not yet decoded; safe to call repeatedly. */
  decode(ctx: SampleContext): Promise<void> {
    if (this.decoding) return this.decoding;
    const pending = [...this.raw].filter(([k]) => !this.buffers.has(k) && !this.failed.has(k));
    if (!pending.length) return Promise.resolve();
    this.decoding = Promise.all(pending.map(async ([kind, bytes]) => {
      try { this.buffers.set(kind, await ctx.decodeAudioData(bytes.slice(0))); } catch { this.failed.add(kind); }
    })).then(() => { this.decoding = null; });
    return this.decoding;
  }
  /** Play one impact beneath the tones; false when no buffer is ready (the synth alone carries the beat). */
  trigger(kind: ImpactKind, ctx: SampleContext, dest: AudioNode, gain = 0.5): boolean {
    const buf = this.buffers.get(kind); if (!buf) return false;
    const src = ctx.createBufferSource(); src.buffer = buf;
    const g = ctx.createGain(); g.gain.value = gain;
    src.connect(g); g.connect(dest); src.start(ctx.currentTime);
    this.played++;
    return true;
  }
  stats(): SampleStats {
    return { loaded: this.buffers.size, played: this.played, missing: IMPACTS.filter((k) => !this.raw.has(k)), failed: [...this.failed], decoding: this.decoding != null };
  }
}
