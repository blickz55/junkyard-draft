import Phaser from 'phaser';
import { Button, label, mono, panel, slider } from '../ui';
import { CSS, P } from '../palette';
import { audio } from '../audio';
import { clearSave, dailySeed, loadBests, loadSave, randomSeed } from '../storage';
import { decodeReplay, verifyReplay } from '../../sim/replay';
import { W, H } from '../layout';

export class TitleScene extends Phaser.Scene {
  constructor() { super('Title'); }

  create() {
    this.cameras.main.setBackgroundColor(P.bg);
    // decorative belt
    for (let i = 0; i < 16; i++) this.add.image(i * 72 + 36, H - 36, 'm-conveyor').setAlpha(0.25);
    const scrapBelt = this.add.group();
    for (let i = 0; i < 6; i++) scrapBelt.add(this.add.image(-40 + i * 200, H - 36, ['i-scrap', 'i-shards', 'i-ingot'][i % 3]).setScale(1.4).setAlpha(0.6));
    this.time.addEvent({ delay: 16, loop: true, callback: () => scrapBelt.getChildren().forEach((c) => { const img = c as Phaser.GameObjects.Image; img.x += 1.2; if (img.x > W + 40) img.x = -40; }) });

    label(this, W / 2, 110, 'JUNKYARD DRAFT', 56, CSS.amber, { fontStyle: 'bold', letterSpacing: 6 }).setOrigin(0.5);
    label(this, W / 2, 160, 'Draft salvaged machines. Build a production line. Beat your best.', 18, CSS.dim).setOrigin(0.5);

    const save = loadSave();
    const bests = loadBests();
    let y = 230;
    if (save) {
      new Button(this, W / 2, y, `Continue run (${save.seed})`, () => { audio.unlock(); this.scene.start('Game', { seed: save.seed, fresh: false, actions: save.actions }); }, { w: 360, h: 48, name: 'continue' });
      y += 62;
    }
    new Button(this, W / 2 - 130, y, "Today's challenge", () => this.start(dailySeed(), true), { w: 240, h: 48, name: 'daily' });
    new Button(this, W / 2 + 130, y, 'Random seed', () => this.start(randomSeed(), true), { w: 240, h: 48, color: P.steel, name: 'random' });
    y += 62;
    const seedBtn = new Button(this, W / 2 - 130, y, 'Custom seed…', () => { const s = window.prompt('Seed (same seed = same offers for everyone):', 'junkyard'); if (s && s.trim()) this.start(s.trim(), true); }, { w: 240, h: 40, color: P.steelDark, textColor: CSS.text, size: 14, name: 'custom' });
    void seedBtn;
    new Button(this, W / 2 + 130, y, 'Import replay…', () => this.importReplay(), { w: 240, h: 40, color: P.steelDark, textColor: CSS.text, size: 14, name: 'import' });
    y += 70;

    // how to play
    panel(this, 60, y, 560, 180, 0.9);
    label(this, 76, y + 12, 'HOW TO PLAY', 13, CSS.amber, { fontStyle: 'bold', letterSpacing: 2 });
    const lines = [
      '1. Each round, pick one of three salvaged machines.',
      '2. Drag machines onto the grid. R or right-click rotates them.',
      '3. Press RUN: scrap flows, machines transform it, the dock sells it.',
      '4. Scrap $1 → Crusher → Shards $3 → Furnace → Ingot $12.',
      '5. Six rounds. Your score is the total money shipped. Then try again.',
    ];
    lines.forEach((l, i) => label(this, 76, y + 40 + i * 24, l, 15, CSS.text));

    // bests + settings
    panel(this, 640, y, 420, 180, 0.9);
    label(this, 656, y + 12, 'LOCAL PERSONAL BESTS', 13, CSS.amber, { fontStyle: 'bold', letterSpacing: 2 });
    label(this, 656, y + 36, bests.overall ? `Best score: $${bests.overall.score}  (seed ${bests.overall.seed})` : 'No finished runs yet on this device.', 15);
    const todayBest = bests.bySeed[dailySeed()];
    label(this, 656, y + 58, todayBest ? `Today's challenge best: $${todayBest.score}` : "Today's challenge: not played yet", 14, CSS.dim);
    mono(this, 656, y + 80, `${bests.runs} run(s) recorded locally · not verified online`, 12, CSS.dim);
    label(this, 656, y + 112, 'Volume', 13, CSS.dim);
    slider(this, 720, y + 120, 200, audio.volume, (v) => audio.setVolume(v));
    const mute = new Button(this, 990, y + 120, audio.muted ? 'Unmute' : 'Mute', () => { audio.setMuted(!audio.muted); mute.setText(audio.muted ? 'Unmute' : 'Mute'); }, { w: 100, h: 30, color: P.steelDark, textColor: CSS.text, size: 13, name: 'mute' });
    mono(this, 656, y + 150, `build ${import.meta.env.BUILD}`, 11, '#6f6758');

    if (save) mono(this, W / 2, y + 200, 'Starting a new run discards the saved one.', 12, CSS.dim).setOrigin(0.5, 0);
    this.input.keyboard?.on('keydown-ENTER', () => { if (save) this.scene.start('Game', { seed: save.seed, fresh: false, actions: save.actions }); else this.start(dailySeed(), true); });
  }

  private start(seed: string, fresh: boolean) {
    audio.unlock();
    if (fresh) clearSave();
    this.scene.start('Game', { seed, fresh });
  }

  private importReplay() {
    const text = window.prompt('Paste replay JSON:');
    if (!text) return;
    try {
      const r = decodeReplay(text);
      const v = verifyReplay(r);
      if (!v.ok) { window.alert(`Replay rejected: ${v.error || `score mismatch (claimed $${v.claimed}, re-simulated $${v.score})`}`); return; }
      this.scene.start('Game', { seed: r.seed, fresh: true, replay: r.actions });
    } catch (e) { window.alert(`Could not read replay: ${(e as Error).message}`); }
  }
}
