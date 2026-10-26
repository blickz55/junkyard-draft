import Phaser from 'phaser';
import { Button, label, mono, panel, slider } from '../ui';
import { CSS, P } from '../palette';
import { audio } from '../audio';
import { clearSave, dailySeed, hasUnusableSave, loadBests, loadPlayer, loadSave, loadSubmissions, randomSeed, savePlayer } from '../storage';
import { MAX_SEED_LENGTH, sanitizeSeed } from '../../sim/run';
import { decodeReplay, verifyReplay } from '../../sim/replay';
import { W, H } from '../layout';
import { prefs } from '../prefs';
import { fetchVerifiedReplay, playVerifiedReplay } from '../verified';

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
      const shortSeed = save.seed.length > 22 ? `${save.seed.slice(0, 20)}…` : save.seed;
      new Button(this, W / 2, y, `Continue run (${shortSeed})`, () => { audio.unlock(); this.scene.start('Game', { seed: save.seed, fresh: false, actions: save.actions }); }, { w: 360, h: 48, name: 'continue' });
      // the warning lives right under the button it concerns, where there is always room at every text size
      mono(this, W / 2, y + 27, 'Starting a new run discards the saved one.', 12, CSS.dim).setOrigin(0.5, 0).setName('continue-note');
      y += 78; // room for the note at 130 % text

    } else if (hasUnusableSave()) {
      mono(this, W / 2, y - 34, 'A saved run was found but cannot be resumed (damaged or from older rules); it will be replaced by your next run.', 12, CSS.dim).setOrigin(0.5, 0).setName('continue-note');
      clearSave();
    }
    new Button(this, W / 2 - 130, y, "Today's challenge", () => this.start(dailySeed(), true), { w: 240, h: 48, name: 'daily' });
    new Button(this, W / 2 + 130, y, 'Random seed', () => this.start(randomSeed(), true), { w: 240, h: 48, color: P.steel, name: 'random' });
    y += 62;
    const seedBtn = new Button(this, W / 2 - 130, y, 'Custom seed…', () => { const s = window.prompt(`Seed (same seed = same offers for everyone; up to ${MAX_SEED_LENGTH} characters):`, 'junkyard'); if (s && s.trim()) this.start(sanitizeSeed(s), true); }, { w: 240, h: 40, color: P.steelDark, textColor: CSS.text, size: 14, name: 'custom' });
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
    mono(this, W - 24, 12, `build ${import.meta.env.BUILD}`, 11, '#948a79').setOrigin(1, 0);
    // player name for verified boards (public); asked on first submission if still empty
    const playerLabel = () => (loadPlayer() ? `Player: ${loadPlayer()}` : 'Set player name…');
    const playerBtn = new Button(this, W - 120, 48, playerLabel(), () => {
      const typed = window.prompt('Name shown on verified boards (max 32 characters, leave empty to clear):', loadPlayer() || 'player');
      if (typed !== null) { savePlayer(typed); playerBtn.setText(playerLabel()); }
    }, { w: 200, h: 28, color: P.steelDark, textColor: CSS.text, size: 12, name: 'player' });

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

    this.dailyBoard(H - 72); // fixed strip above the bottom edge, same place with or without a saved run
    this.input.keyboard?.on('keydown-ENTER', () => { if (save) this.scene.start('Game', { seed: save.seed, fresh: false, actions: save.actions }); else this.start(dailySeed(), true); });
  }

  /** Today's verified board from the local verifier (optional service). Shown separately from local bests; never mixes claimed scores in. */
  private dailyBoard(y: number) {
    const url = new URLSearchParams(location.search).get('verifier') || import.meta.env.VERIFIER_URL;
    panel(this, 60, y, 1000, 58, 0.96);
    const head = label(this, 76, y + 9, "TODAY'S VERIFIED BOARD", 13, CSS.amber, { fontStyle: 'bold', letterSpacing: 2 });
    mono(this, head.x + head.width + 18, y + 10, `seed ${dailySeed()}`, 12, CSS.dim);
    const line = mono(this, 76, y + 32, 'Checking the local verifier…', 12, CSS.dim).setName('daily-board');
    fetch(`${url}/daily?limit=5`).then((r) => r.json()).then((d: { seed: string; rulesVersion: number; entries: { player: string; score: number; replayHash: string; replayAvailable?: boolean }[] }) => {
      if (!line.active || !line.scene) return; // the scene may have restarted (settings change) while the request was in flight
      if (d.seed !== dailySeed()) { line.setText(`Verifier day differs (${d.seed}); board hidden.`); return; }
      const top = d.entries.length ? d.entries.map((e, i) => `${i + 1}. $${e.score} ${e.player}`).join('   ·   ') + `   ·   re-simulated by the verifier (rules v${d.rulesVersion})` : 'No verified scores yet today. Finish a run and submit the replay from the results screen.';
      line.setText(top); line.setColor(d.entries.length ? CSS.text : CSS.dim);
      // best entry that has a stored replay (boards from before replay storage have entries without one)
      const bestIdx = d.entries.findIndex((e) => e.replayAvailable);
      const best = bestIdx >= 0 ? d.entries[bestIdx] : undefined;
      if (best) {
        const watch = new Button(this, 60 + 1000 - 70, y + 29, `Watch #${bestIdx + 1}`, () => { watch.setEnabled(false); fetchVerifiedReplay(url, best.replayHash).then((r) => playVerifiedReplay(this, r)).catch((err: Error) => { line.setText(err.message); line.setColor(CSS.red); watch.setEnabled(true); }); }, { w: 110, h: 26, color: P.steelDark, textColor: CSS.text, size: 12, name: 'daily-watch' });
        line.setWordWrapWidth(1000 - 160);
      }
      // own rank: this device's recorded submission for today, located on the board by replay hash (not by name)
      const mine = loadSubmissions()[dailySeed()];
      if (!mine) return;
      fetch(`${url}/board?seed=${encodeURIComponent(dailySeed())}&limit=100`).then((r) => r.json()).then((b: { entries: { replayHash: string }[] }) => {
        if (!line.active || !line.scene) return;
        const i = b.entries.findIndex((e) => e.replayHash === mine.replayHash);
        line.setText(`You: ${i >= 0 ? `#${i + 1} of ${b.entries.length}` : `beyond the top ${b.entries.length}`} ($${mine.score})   ·   ${top}`); line.setColor(CSS.text);
      }).catch(() => { /* board unavailable: keep the top list */ });
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
