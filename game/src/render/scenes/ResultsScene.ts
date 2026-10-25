import Phaser from 'phaser';
import type { RunState } from '../../sim/run';
import { encodeReplay, exportReplay } from '../../sim/replay';
import { Button, label, mono, panel } from '../ui';
import { CSS, P } from '../palette';
import { audio } from '../audio';
import { clearSave, dailySeed, loadBests, randomSeed, recordBest } from '../storage';
import { W } from '../layout';
import { RULES } from '../../sim/rules';

export class ResultsScene extends Phaser.Scene {
  constructor() { super('Results'); }

  create(data: { run: RunState; replayed?: boolean }) {
    const run = data.run;
    this.cameras.main.setBackgroundColor(P.bg);
    clearSave();
    const rec = data.replayed ? { newOverall: false, newSeed: false } : recordBest(run.seed, run.score);
    const bests = loadBests();
    audio.roundEnd(true);

    label(this, W / 2, 60, 'RUN COMPLETE', 16, CSS.amber, { fontStyle: 'bold', letterSpacing: 4 }).setOrigin(0.5);
    const score = label(this, W / 2, 125, `$${run.score}`, 72, CSS.gold, { fontStyle: 'bold' }).setOrigin(0.5).setScale(0.5);
    this.tweens.add({ targets: score, scale: 1, duration: 500, ease: 'Back.out' });
    mono(this, W / 2, 180, `seed ${run.seed} · rules v${run.rulesVersion}${data.replayed ? ' · replay playback (not recorded as a best)' : ''}`, 13).setOrigin(0.5);
    if (rec.newOverall) label(this, W / 2, 210, 'NEW LOCAL PERSONAL BEST', 18, CSS.green, { fontStyle: 'bold', letterSpacing: 2 }).setOrigin(0.5);
    else if (rec.newSeed) label(this, W / 2, 210, 'New local best for this seed', 16, CSS.green).setOrigin(0.5);
    else label(this, W / 2, 210, bests.overall ? `Local best: $${bests.overall.score} (${bests.overall.seed})` : '', 14, CSS.dim).setOrigin(0.5);

    panel(this, 90, 240, 420, 250, 0.95);
    label(this, 106, 252, 'ROUND BY ROUND', 13, CSS.amber, { fontStyle: 'bold', letterSpacing: 2 });
    const max = Math.max(1, ...run.rounds.map((r) => r.earned));
    run.rounds.forEach((r, i) => {
      const y = 282 + i * 32;
      label(this, 106, y, `Round ${r.round}`, 14, CSS.dim);
      this.add.rectangle(180, y + 9, 230 * (r.earned / max), 16, i === run.rounds.length - 1 ? P.gold : P.amber).setOrigin(0, 0.5);
      label(this, 420, y, `$${r.earned}`, 14, CSS.text, { fontStyle: 'bold' });
    });
    const shipped = run.rounds.reduce((acc, r) => { for (const k of Object.keys(r.result.shipped) as (keyof typeof r.result.shipped)[]) acc[k] = (acc[k] || 0) + r.result.shipped[k]; return acc; }, {} as Record<string, number>);
    panel(this, 540, 240, 490, 250, 0.95);
    label(this, 556, 252, 'WHAT SHIPPED', 13, CSS.amber, { fontStyle: 'bold', letterSpacing: 2 });
    let y = 282;
    for (const m of ['ingot', 'shards', 'scrap', 'slag'] as const) if (shipped[m]) { this.add.image(566, y + 9, `i-${m}`); label(this, 586, y, `${shipped[m]} × ${m} ($${RULES.value[m]} each) = $${shipped[m] * RULES.value[m]}`, 14); y += 28; }
    label(this, 556, y + 8, `Drafted: ${run.picks.map((p) => p.replace(/^./, (c) => c.toUpperCase())).join(', ')}`, 13, CSS.dim).setWordWrapWidth(460);
    label(this, 556, y + 50, 'Scores are local and unverified until a server re-simulates the replay.', 12, CSS.dim).setWordWrapWidth(460);

    new Button(this, W / 2 - 230, 540, 'Retry this seed', () => this.scene.start('Game', { seed: run.seed, fresh: true }), { w: 200, h: 48, name: 'retry' });
    new Button(this, W / 2, 540, 'New random seed', () => this.scene.start('Game', { seed: randomSeed(), fresh: true }), { w: 200, h: 48, color: P.steel, name: 'newseed' });
    new Button(this, W / 2 + 230, 540, "Today's challenge", () => this.scene.start('Game', { seed: dailySeed(), fresh: true }), { w: 200, h: 48, color: P.steel, name: 'daily' });
    const exp = new Button(this, W / 2 - 115, 600, 'Copy replay JSON', () => this.copyReplay(run, exp), { w: 200, h: 36, color: P.steelDark, textColor: CSS.text, size: 13, name: 'export' });
    new Button(this, W / 2 + 115, 600, 'Download replay', () => this.downloadReplay(run), { w: 200, h: 36, color: P.steelDark, textColor: CSS.text, size: 13, name: 'download' });
    new Button(this, W / 2, 650, 'Title screen', () => this.scene.start('Title'), { w: 160, h: 32, color: P.steelDark, textColor: CSS.text, size: 13, name: 'title' });
    this.input.keyboard?.on('keydown-ENTER', () => this.scene.start('Game', { seed: run.seed, fresh: true }));
  }

  private copyReplay(run: RunState, btn: Button) {
    const text = encodeReplay(exportReplay(run, import.meta.env.BUILD));
    const done = () => { btn.setText('Copied!'); this.time.delayedCall(1500, () => btn.setText('Copy replay JSON')); };
    if (navigator.clipboard?.writeText) navigator.clipboard.writeText(text).then(done, () => window.prompt('Copy replay JSON:', text));
    else window.prompt('Copy replay JSON:', text);
  }
  private downloadReplay(run: RunState) {
    const text = encodeReplay(exportReplay(run, import.meta.env.BUILD));
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
    a.download = `junkyard-draft-${run.seed}-${run.score}.replay.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }
}
