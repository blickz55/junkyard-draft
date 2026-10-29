import Phaser from 'phaser';
import { applyDpr } from '../dpr';
import type { RunState } from '../../sim/run';
import { P } from '../palette';
import { audio } from '../audio';
import { clearSave, recordBest, recordDayPlayed, recordForkBest } from '../storage';
import type { Challenge } from '../challenge';
import type { Rank } from '../share';
import { mountResults } from '../../ui/ResultsScreen';
import { ui } from '../../ui/dom';
import { recordClip, renderGif, saveClip, type ClipResult } from '../clip';
import { loadPlayer, loadSubmissions } from '../storage';
import { canonicalReplayJson } from '../../sim/replay';

/** Results: bookkeeping (bests, save) happens here; the screen itself is DOM (ui/ResultsScreen.ts). */
export class ResultsScene extends Phaser.Scene {
  lastRank: Rank | null = null;
  lastPlayer = '';
  /** last share text produced (read by the e2e; the clipboard itself is not observable in headless runs) */
  lastShareText = '';
  /** verified standing from the histogram (for the share text): percentile and population */
  lastPercentile: number | null = null;
  lastN = 0;
  lastMedal: string | null = null;
  /** last exported clip (size, duration, container) for the e2e; the blob itself is not kept */
  lastClip: { size: number; ms: number; mime: string; frames: number; round: number; width: number; height: number; filename: string; savedTo: string; elapsedMs: number; footer: string } | null = null;
  /** this exact run's replay hash once a verifier accepted it (set by a submission here, or found among this device's stored submissions); null = unverified (review F11) */
  verifiedHash: string | null = null;
  private hashPromise: Promise<string> | null = null;
  /** SHA-256 of this run's canonical replay JSON (WebCrypto; the verifier computes the same bytes). */
  thisRunHash(): Promise<string> {
    if (!this.hashPromise) this.hashPromise = (async () => { const data = new TextEncoder().encode(canonicalReplayJson({ rulesVersion: this.run.rulesVersion, seed: this.run.seed, actions: this.run.actions })); const d = await crypto.subtle.digest('SHA-256', data); return Array.from(new Uint8Array(d), (b) => b.toString(16).padStart(2, '0')).join(''); })();
    return this.hashPromise;
  }
  /** True when the stored submission for this seed is this very run (e.g. a resumed run submitted earlier). */
  async matchesStoredSubmission(): Promise<boolean> { const s = loadSubmissions()[this.run.seed]; if (!s) return false; return (await this.thisRunHash()) === s.replayHash; }
  /** last exported GIF (size, frames, palette size, magic) for the e2e */
  lastGif: { size: number; ms: number; frames: number; round: number; width: number; height: number; colours: number; magic: string; filename: string; savedTo: string; elapsedMs: number; footer: string } | null = null;
  private exporting = false;
  private run!: RunState;
  constructor() { super('Results'); }
  /** Record and save a loop clip of one round (default the best). Resolves with what was saved; rejects when recording is unavailable. */
  async exportClip(round?: number, onProgress?: (f: number) => void): Promise<NonNullable<ResultsScene['lastClip']>> {
    if (this.exporting) throw new Error('already exporting');
    this.exporting = true;
    const t0 = performance.now();
    try {
      const clip: ClipResult = await recordClip(this.game, this.run, { round, player: loadPlayer() || undefined, verified: this.verifiedHash != null, onProgress });
      const savedTo = await saveClip(clip);
      this.lastClip = { size: clip.blob.size, ms: clip.ms, mime: clip.mime, frames: clip.frames, round: clip.round, width: clip.width, height: clip.height, filename: clip.filename, savedTo, elapsedMs: Math.round(performance.now() - t0), footer: clip.footer };
      return this.lastClip;
    } finally { this.exporting = false; }
  }

  /** Render and save a looping GIF of one round (default the best); offline, so it works without MediaRecorder. */
  async exportGif(round?: number, onProgress?: (f: number) => void): Promise<NonNullable<ResultsScene['lastGif']>> {
    if (this.exporting) throw new Error('already exporting');
    this.exporting = true;
    const t0 = performance.now();
    try {
      const gif = await renderGif(this.game, this.run, { round, player: loadPlayer() || undefined, verified: this.verifiedHash != null, onProgress });
      const savedTo = await saveClip(gif);
      this.lastGif = { size: gif.blob.size, ms: gif.ms, frames: gif.frames, round: gif.round, width: gif.width, height: gif.height, colours: gif.colours, magic: gif.magic, filename: gif.filename, savedTo, elapsedMs: Math.round(performance.now() - t0), footer: gif.footer };
      return this.lastGif;
    } finally { this.exporting = false; }
  }

  create(data: { run: RunState; replayed?: boolean; replayLabel?: string; challenge?: Challenge; replayHash?: string; replayPlayer?: string }) {
    const run = data.run;
    this.run = run; this.verifiedHash = null; this.hashPromise = null;
    this.cameras.main.setBackgroundColor(P.bg);
    applyDpr(this);
    const fork = !!run.forkedFrom; // PLAN-v4 0.7.3: a fork is practice: it never touches the save, the bests or the days played
    if (!data.replayed && !fork) clearSave(); // a watched replay is someone else's run: the player's own unfinished save stays untouched
    const rec = data.replayed || fork ? { newOverall: false, newSeed: false } : recordBest(run.seed, run.score);
    const forkRec = fork ? recordForkBest(run.seed, run.score) : { newFork: false };
    if (!data.replayed && !fork) recordDayPlayed();
    audio.roundEnd(true);
    this.lastRank = null; this.lastPlayer = ''; this.lastShareText = ''; this.lastPercentile = null; this.lastN = 0; this.lastMedal = null;
    mountResults(this, run, { replayed: !!data.replayed, replayLabel: data.replayLabel, newOverall: rec.newOverall, newSeed: rec.newSeed, challenge: data.challenge, replayHash: data.replayHash, replayPlayer: data.replayPlayer, newFork: forkRec.newFork });
    this.events.once('shutdown', () => ui.unmount());
  }
}
