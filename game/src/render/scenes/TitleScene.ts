import Phaser from 'phaser';
import { Button, label, mono, panel, slider } from '../ui';
import { CSS, P } from '../palette';
import { audio } from '../audio';
import { clearSave, dailySeed, loadBests, loadSave, randomSeed } from '../storage';
import { decodeReplay, verifyReplay } from '../../sim/replay';
import { W, H } from '../layout';
import { prefs } from '../prefs';

export class TitleScene extends Phaser.Scene {
  constructor() { super('Title'); }

  create() {
    this.cameras.main.setBackgroundColor(P.bg);
    // decorative belt
    for (let i = 0; i < 16; i++) this.add.image(i * 72 + 36, H - 36, 'm-conveyor').setAlpha(0.25);
    const scrapBelt = this.add.group();
    for (let i = 0; i < 6; i++) scrapBelt.add(this.add.image(-40 + i * 200, H - 36, ['i-scrap', 'i-shards', 'i-ingot'][i % 3]).setScale(1.4).setAlpha(0.6));
    if (!prefs.reducedMotion) this.time.addEvent({ delay: 16, loop: true, callback: () => scrapBelt.getChildren().forEach((c) => { const img = c as Phaser.GameObjects.Image; img.x += 1.2; if (img.x > W + 40) img.x = -40; }) });

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
    const howto = panel(this, 60, y, 560, 180, 0.9);
    label(this, 76, y + 12, 'HOW TO PLAY', 13, CSS.amber, { fontStyle: 'bold', letterSpacing: 2 });
    const lines = [
      '1. Each round, pick one of three salvaged machines.',
      '2. Drag parts onto the grid; R or right-click rotates.',
      '3. RUN: machines transform scrap; the dock sells it.',
      '4. Scrap $1 → Crusher → Shards $3 → Furnace → Ingot $12.',
      '5. Six rounds. Score = total money shipped. Try again.',
    ];
    let ly = y + 40; // lines wrap at larger text sizes; stack them by measured height and grow the panel
    lines.forEach((l, i) => { const t = label(this, 76, ly, l, 15, CSS.text, { wordWrap: { width: 528 } }).setName(`howto-${i + 1}`); ly += t.height + 6; });
    howto.setSize(560, Math.max(180, ly + 6 - y));
    mono(this, W - 24, 12, `build ${import.meta.env.BUILD}`, 11, '#6f6758').setOrigin(1, 0);

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
    // accessibility: reduced motion (belts, flashes, floats off) and text size (100 / 115 / 130 %)
    label(this, 656, y + 148, 'Motion', 13, CSS.dim);
    const motion = new Button(this, 760, y + 156, prefs.reducedMotion ? 'Reduced' : 'Full', () => { prefs.setReducedMotion(!prefs.reducedMotion); motion.setText(prefs.reducedMotion ? 'Reduced' : 'Full'); this.scene.restart(); }, { w: 100, h: 28, color: P.steelDark, textColor: CSS.text, size: 12, name: 'motion' });
    label(this, 830, y + 148, 'Text size', 13, CSS.dim);
    new Button(this, 955, y + 156, prefs.textScaleLabel(), () => { prefs.setTextScale(prefs.nextTextScale()); this.scene.restart(); }, { w: 80, h: 28, color: P.steelDark, textColor: CSS.text, size: 12, name: 'textscale' });

    if (save) mono(this, W / 2, y + 186, 'Starting a new run discards the saved one.', 12, CSS.dim).setOrigin(0.5, 0);
    this.dailyBoard(H - 72); // fixed strip above the bottom edge, same place with or without a saved run
    this.input.keyboard?.on('keydown-ENTER', () => { if (save) this.scene.start('Game', { seed: save.seed, fresh: false, actions: save.actions }); else this.start(dailySeed(), true); });
  }

  /** Today's verified board from the local verifier (optional service). Shown separately from local bests; never mixes claimed scores in. */
  private dailyBoard(y: number) {
    const url = new URLSearchParams(location.search).get('verifier') || 'http://127.0.0.1:4400';
    panel(this, 60, y, 1000, 58, 0.96);
    const head = label(this, 76, y + 9, "TODAY'S VERIFIED BOARD", 13, CSS.amber, { fontStyle: 'bold', letterSpacing: 2 });
    mono(this, head.x + head.width + 18, y + 10, `seed ${dailySeed()}`, 12, CSS.dim);
    const line = mono(this, 76, y + 32, 'Checking the local verifier…', 12, CSS.dim).setName('daily-board');
    fetch(`${url}/daily?limit=5`).then((r) => r.json()).then((d: { seed: string; rulesVersion: number; entries: { player: string; score: number }[] }) => {
      if (!line.active || !line.scene) return; // the scene may have restarted (settings change) while the request was in flight
      if (d.seed !== dailySeed()) { line.setText(`Verifier day differs (${d.seed}); board hidden.`); return; }
      line.setText(d.entries.length ? d.entries.map((e, i) => `${i + 1}. $${e.score} ${e.player}`).join('   ·   ') + `   ·   re-simulated by the verifier (rules v${d.rulesVersion})` : 'No verified scores yet today. Finish a run and submit the replay from the results screen.');
      line.setColor(d.entries.length ? CSS.text : CSS.dim);
    }).catch(() => { if (line.active && line.scene) line.setText('Verifier offline (optional: npm run verifier). Daily board unavailable; local bests above are unverified.'); });
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
