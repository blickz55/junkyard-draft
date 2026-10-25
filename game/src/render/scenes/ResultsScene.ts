import Phaser from 'phaser';
import type { RunState } from '../../sim/run';
import { encodeReplay, exportReplay } from '../../sim/replay';
import { Button, label, mono, panel } from '../ui';
import { CSS, P } from '../palette';
import { audio } from '../audio';
import { clearSave, dailySeed, loadBests, loadPlayer, randomSeed, recordBest, recordSubmission, savePlayer } from '../storage';
import { shareText, type Rank } from '../share';
import { W } from '../layout';
import { RULES } from '../../sim/rules';
import { prefs } from '../prefs';

export class ResultsScene extends Phaser.Scene {
  private lastRank: Rank | null = null;
  private lastPlayer = '';
  /** last share text produced (read by the e2e; the clipboard itself is not observable in headless runs) */
  lastShareText = '';
  constructor() { super('Results'); }

  create(data: { run: RunState; replayed?: boolean }) {
    const run = data.run;
    this.cameras.main.setBackgroundColor(P.bg);
    clearSave();
    const rec = data.replayed ? { newOverall: false, newSeed: false } : recordBest(run.seed, run.score);
    const bests = loadBests();
    audio.roundEnd(true);

    label(this, W / 2, 60, 'RUN COMPLETE', 16, CSS.amber, { fontStyle: 'bold', letterSpacing: 4 }).setOrigin(0.5);
    const score = label(this, W / 2, 125, `$${run.score}`, 72, CSS.gold, { fontStyle: 'bold' }).setOrigin(0.5).setScale(prefs.reducedMotion ? 1 : 0.5);
    if (!prefs.reducedMotion) this.tweens.add({ targets: score, scale: 1, duration: 500, ease: 'Back.out' });
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
    for (const m of ['ingot', 'plate', 'shards', 'scrap', 'slag'] as const) if (shipped[m]) { this.add.image(566, y + 9, `i-${m}`); label(this, 586, y, `${shipped[m]} × ${m} ($${RULES.value[m]} each) = $${shipped[m] * RULES.value[m]}`, 14); y += 28; }
    if (run.sold) { label(this, 586, y, `Sold unused parts = $${run.sold}`, 14); y += 28; }
    label(this, 556, y + 8, `Drafted: ${run.picks.map((p) => p.replace(/^./, (c) => c.toUpperCase())).join(', ')}`, 13, CSS.dim).setWordWrapWidth(250);
    label(this, 556, y + 56, 'Scores are local and unverified until a verifier re-simulates the replay.', 12, CSS.dim).setWordWrapWidth(250);

    new Button(this, W / 2 - 230, 540, 'Retry this seed', () => this.scene.start('Game', { seed: run.seed, fresh: true }), { w: 200, h: 48, name: 'retry' });
    new Button(this, W / 2, 540, 'New random seed', () => this.scene.start('Game', { seed: randomSeed(), fresh: true }), { w: 200, h: 48, color: P.steel, name: 'newseed' });
    new Button(this, W / 2 + 230, 540, "Today's challenge", () => this.scene.start('Game', { seed: dailySeed(), fresh: true }), { w: 200, h: 48, color: P.steel, name: 'daily' });
    const exp = new Button(this, W / 2 - 115, 600, 'Copy replay JSON', () => this.copyReplay(run, exp), { w: 200, h: 36, color: P.steelDark, textColor: CSS.text, size: 13, name: 'export' });
    new Button(this, W / 2 + 115, 600, 'Download replay', () => this.downloadReplay(run), { w: 200, h: 36, color: P.steelDark, textColor: CSS.text, size: 13, name: 'download' });
    new Button(this, W / 2, 650, 'Title screen', () => this.scene.start('Title'), { w: 160, h: 32, color: P.steelDark, textColor: CSS.text, size: 13, name: 'title' });
    // Local verifier (optional service): verified scores are shown separately from local bests.
    const verifierUrl = new URLSearchParams(location.search).get('verifier') || import.meta.env.VERIFIER_URL;
    const status = mono(this, 90, 672, '', 12, CSS.dim);
    this.lastRank = null; this.lastPlayer = '';
    const submit = new Button(this, 200, 650, 'Submit to local verifier', () => this.submitToVerifier(run, verifierUrl, submit, status), { w: 210, h: 32, color: P.steelDark, textColor: CSS.text, size: 13, name: 'submit', disabled: !!data.replayed });
    const share = new Button(this, W - 130, 650, 'Copy share text', () => this.copyShare(run, share), { w: 200, h: 32, color: P.steelDark, textColor: CSS.text, size: 13, name: 'share' });
    void this.loadBoard(run.seed, verifierUrl, status);
    this.input.keyboard?.on('keydown-ENTER', () => this.scene.start('Game', { seed: run.seed, fresh: true }));
  }

  /** Name shown on verified boards: asked once, kept in jd.player, editable on the title screen. */
  private ensurePlayer(): string {
    let player = loadPlayer();
    if (!player) {
      const typed = window.prompt('Name for the verified board (shown publicly, max 32 characters):', 'player');
      player = (typed ?? '').trim() ? typed!.trim().slice(0, 32) : 'anonymous';
      if (player !== 'anonymous') savePlayer(player);
    }
    return player;
  }
  /** Rank of a verified entry among the top 100 for its seed (server orders by score, then time). */
  private async rankOf(seed: string, url: string, replayHash: string): Promise<Rank> {
    const res = await fetch(`${url}/board?seed=${encodeURIComponent(seed)}&limit=100`);
    const body = await res.json() as { entries: { replayHash: string }[] };
    const i = body.entries.findIndex((e) => e.replayHash === replayHash);
    return { n: i >= 0 ? i + 1 : null, of: body.entries.length };
  }
  private async submitToVerifier(run: RunState, url: string, btn: Button, status: Phaser.GameObjects.Text) {
    btn.setEnabled(false); status.setText('Submitting replay to the local verifier…');
    try {
      const player = this.ensurePlayer();
      const res = await fetch(`${url}/verify`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ replay: exportReplay(run, import.meta.env.BUILD), player }) });
      const body = await res.json() as { ok: boolean; score?: number; error?: string; entry?: { replayHash: string; verifiedAt: string } };
      if (body.ok && body.entry) {
        recordSubmission(run.seed, { score: body.score ?? run.score, replayHash: body.entry.replayHash, verifiedAt: body.entry.verifiedAt, player });
        this.lastRank = await this.rankOf(run.seed, url, body.entry.replayHash); this.lastPlayer = player;
        const r = this.lastRank;
        status.setText(`Verified by re-simulation: $${body.score} — ${r.n != null ? `#${r.n} of ${r.of}` : `beyond the top ${r.of}`} on the local verified board as ${player}.`);
      } else status.setText(`Verifier response: ${body.error || 'rejected'}`);
      status.setColor(body.ok ? CSS.green : CSS.red);
      await this.loadBoard(run.seed, url, status, true);
    } catch { status.setText(`Verifier unreachable at ${url} (start it with: npm run verifier). Score stays local/unverified.`); status.setColor(CSS.dim); btn.setEnabled(true); }
  }
  private boardTexts: Phaser.GameObjects.Text[] = [];
  private async loadBoard(seed: string, url: string, status: Phaser.GameObjects.Text, keepStatus = false) {
    for (const t of this.boardTexts) t.destroy(); this.boardTexts = [];
    try {
      const res = await fetch(`${url}/board?seed=${encodeURIComponent(seed)}&limit=5`);
      const body = await res.json() as { entries: { player: string; score: number; verifiedAt: string }[] };
      const x = 830, y0 = 300;
      this.boardTexts.push(label(this, x, y0, 'LOCAL VERIFIED BOARD · this seed', 11, CSS.amber, { fontStyle: 'bold', letterSpacing: 1 }));
      if (!body.entries.length) this.boardTexts.push(mono(this, x, y0 + 18, 'no verified scores yet', 12, CSS.dim));
      body.entries.forEach((e, i) => this.boardTexts.push(mono(this, x, y0 + 18 + i * 16, `${i + 1}. $${e.score}  ${e.player}`, 12, CSS.text)));
      if (!keepStatus) status.setText(`Local verifier online at ${url}. Scores on this board were re-simulated, not trusted from the client.`);
    } catch { if (!keepStatus) status.setText('No local verifier running (optional: npm run verifier). Local bests are unverified.'); }
  }

  /** Clipboard blocked: offer the text in a prompt; where prompt() itself is unavailable (embedded webviews), say so on the button. */
  private showTextFallback(title: string, text: string, btn: Button, label: string) {
    try { window.prompt(title, text); }
    catch { btn.setText('Clipboard blocked'); this.time.delayedCall(2000, () => btn.setText(label)); }
  }
  private copyShare(run: RunState, btn: Button) {
    const text = shareText({ seed: run.seed, score: run.score, rulesVersion: run.rulesVersion, rounds: run.rounds.map((r) => r.earned), player: this.lastPlayer || undefined, rank: this.lastRank });
    this.lastShareText = text;
    const done = () => { btn.setText('Copied!'); this.time.delayedCall(1500, () => btn.setText('Copy share text')); };
    const fallback = () => this.showTextFallback('Share text:', text, btn, 'Copy share text');
    if (navigator.clipboard?.writeText) navigator.clipboard.writeText(text).then(done, fallback);
    else fallback();
  }
  private copyReplay(run: RunState, btn: Button) {
    const text = encodeReplay(exportReplay(run, import.meta.env.BUILD));
    const done = () => { btn.setText('Copied!'); this.time.delayedCall(1500, () => btn.setText('Copy replay JSON')); };
    const fallback = () => this.showTextFallback('Copy replay JSON:', text, btn, 'Copy replay JSON');
    if (navigator.clipboard?.writeText) navigator.clipboard.writeText(text).then(done, fallback);
    else fallback();
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
