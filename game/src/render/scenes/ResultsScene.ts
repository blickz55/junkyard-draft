import Phaser from 'phaser';
import { applyDpr } from '../dpr';
import type { RunState } from '../../sim/run';
import { P } from '../palette';
import { audio } from '../audio';
import { clearSave, recordBest } from '../storage';
import type { Rank } from '../share';
import { mountResults } from '../../ui/ResultsScreen';
import { ui } from '../../ui/dom';

/** Results: bookkeeping (bests, save) happens here; the screen itself is DOM (ui/ResultsScreen.ts). */
export class ResultsScene extends Phaser.Scene {
  lastRank: Rank | null = null;
  lastPlayer = '';
  /** last share text produced (read by the e2e; the clipboard itself is not observable in headless runs) */
  lastShareText = '';
  constructor() { super('Results'); }

  create(data: { run: RunState; replayed?: boolean; replayLabel?: string }) {
    const run = data.run;
    this.cameras.main.setBackgroundColor(P.bg);
    applyDpr(this);
    if (!data.replayed) clearSave(); // a watched replay is someone else's run: the player's own unfinished save stays untouched
    const rec = data.replayed ? { newOverall: false, newSeed: false } : recordBest(run.seed, run.score);
    audio.roundEnd(true);
    this.lastRank = null; this.lastPlayer = ''; this.lastShareText = '';
    mountResults(this, run, { replayed: !!data.replayed, replayLabel: data.replayLabel, newOverall: rec.newOverall, newSeed: rec.newSeed });
    this.events.once('shutdown', () => ui.unmount());
  }
}
