import Phaser from 'phaser';
import { applyDpr } from '../dpr';
import type { RunState } from '../../sim/run';
import { P } from '../palette';
import { audio } from '../audio';
import { clearSave, recordBest, recordDayPlayed } from '../storage';
import type { Rank } from '../share';
import { mountResults } from '../../ui/ResultsScreen';
import { ui } from '../../ui/dom';
import { recordClip, saveClip, type ClipResult } from '../clip';
import { loadPlayer } from '../storage';

/** Results: bookkeeping (bests, save) happens here; the screen itself is DOM (ui/ResultsScreen.ts). */
export class ResultsScene extends Phaser.Scene {
  lastRank: Rank | null = null;
  lastPlayer = '';
  /** last share text produced (read by the e2e; the clipboard itself is not observable in headless runs) */
  lastShareText = '';
  /** verified standing from the histogram (for the share text): percentile and population */
  lastPercentile: number | null = null;
  lastN = 0;
  /** last exported clip (size, duration, container) for the e2e; the blob itself is not kept */
  lastClip: { size: number; ms: number; mime: string; frames: number; round: number; width: number; height: number; filename: string; savedTo: string; elapsedMs: number } | null = null;
  private exporting = false;
  private run!: RunState;
  constructor() { super('Results'); }
  /** Record and save a loop clip of one round (default the best). Resolves with what was saved; rejects when recording is unavailable. */
  async exportClip(round?: number, onProgress?: (f: number) => void): Promise<NonNullable<ResultsScene['lastClip']>> {
    if (this.exporting) throw new Error('already exporting');
    this.exporting = true;
    const t0 = performance.now();
    try {
      const clip: ClipResult = await recordClip(this.game, this.run, { round, player: loadPlayer() || undefined, onProgress });
      const savedTo = await saveClip(clip);
      this.lastClip = { size: clip.blob.size, ms: clip.ms, mime: clip.mime, frames: clip.frames, round: clip.round, width: clip.width, height: clip.height, filename: clip.filename, savedTo, elapsedMs: Math.round(performance.now() - t0) };
      return this.lastClip;
    } finally { this.exporting = false; }
  }

  create(data: { run: RunState; replayed?: boolean; replayLabel?: string }) {
    const run = data.run;
    this.run = run;
    this.cameras.main.setBackgroundColor(P.bg);
    applyDpr(this);
    if (!data.replayed) clearSave(); // a watched replay is someone else's run: the player's own unfinished save stays untouched
    const rec = data.replayed ? { newOverall: false, newSeed: false } : recordBest(run.seed, run.score);
    if (!data.replayed) recordDayPlayed();
    audio.roundEnd(true);
    this.lastRank = null; this.lastPlayer = ''; this.lastShareText = ''; this.lastPercentile = null; this.lastN = 0;
    mountResults(this, run, { replayed: !!data.replayed, replayLabel: data.replayLabel, newOverall: rec.newOverall, newSeed: rec.newSeed });
    this.events.once('shutdown', () => ui.unmount());
  }
}
