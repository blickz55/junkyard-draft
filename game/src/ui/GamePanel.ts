/**
 * Game-scene chrome as DOM (DOSSIER-v1 0.4.0, slice 2): HUD bar, side panel (pick / build / running / summary),
 * hint strip, the round-result banner with per-machine badges over the grid, and the pause veil. The canvas keeps
 * the grid, shelf, machines, items, ghost, cursor, jam and stall marks and the pooled +$ pops. The panel is rebuilt
 * only when its inputs change (the same change key the Phaser version hashed); per-frame values (progress,
 * earned, total) update elements in place. Every control carries data-testid, matching the old Phaser names.
 * Every string comes from the table (0.9.0).
 */
import type Phaser from 'phaser';
import { h, btn, ui, textureImg } from './dom';
import { canReroll, type RunState } from '../sim/run';
import { explainRunError } from '../content/advice';
import { analyseRound } from '../sim/bottleneck';
import { bottleneckLine } from '../content/bottleneck';
import type { Machine, Material } from '../sim/types';
import { RULES } from '../sim/rules';
import { cellIndex } from '../sim/sim';
import { CELL, machineTexture } from '../render/textures';
import { GRID_X, GRID_Y, GRID_W, GRID_H, SIDE_X, SIDE_W, W, H } from '../render/layout';
import { prefs } from '../render/prefs';
import { loadBests } from '../render/storage';
import { isDailySeed, isMintedDailySeed, dailyDateOf } from '../sim/daily';
import { isWeeklySeed, weeklyClosed } from '../sim/weekly';
import { challengerTotal, type Challenge } from '../render/challenge';
import { t } from '../content/strings';
import { money, int } from '../content/format';
import { machineName, machineBlurb, materialName } from '../content/machines';

export type PanelMode = 'build' | 'running' | 'paused' | 'summary';

/** Everything the panel renders from; the scene builds it on demand. */
export interface PanelState {
  run: RunState; mode: PanelMode; speed: number;
  replayLabel: string | null; replayRounds: number[] | null; playbackPending: boolean;
  /** the challenge being played, if any (PLAN-v4 0.7.1) */
  challenge?: Challenge | null;
  canUndo: boolean; canRedo: boolean; selected: Machine | undefined; tipsBadge: boolean; tipsOpen: boolean;
}
/** What the panel asks the scene to do. */
export interface PanelActions {
  pick(i: number): void; startRun(): void; setPaused(p: boolean): void; finishRun(): void; stopReplay(): void; setSpeed(s: number): void; /** one tick while paused (0.8.12) */ stepTick(): void;
  undo(): void; redo(): void; openTips(): void; rotateSelected(): void; toBin(id: number): void; sell(id: number): void; nextRound(): void; toTitle(): void; toggleMute(): boolean;
  /** buy new offers (rules v3): the scene applies { t: 'reroll' } through the controller */
  reroll(): void;
  /** continue the watched recording from the round just finished as a practice try (PLAN-v4 0.7.3) */
  forkHere(): void;
  /** report the watched recording's player name (PLAN-v4 0.7.7); present only while watching a checked recording with a hash */
  reportName?: () => void;
}

/** Canvas-logical pixels → CSS length that follows the canvas scale and ignores local font-size (em would shrink inside small-text elements). */
const em = (px: number) => `calc(${px} * var(--px))`;
const cap = (x: string) => x.charAt(0).toUpperCase() + x.slice(1);
const pos = (m: Machine) => `${m.x + 1},${m.y + 1}`;

export class GamePanel {
  private root: HTMLElement;
  private hud: { seed: HTMLElement; round: HTMLElement; score: HTMLElement; best: HTMLElement; stall: HTMLElement; mute: HTMLButtonElement };
  private side: HTMLElement;
  private hintEl: HTMLElement;
  private gridLayer: HTMLElement;
  private key = '';
  /** whether the last rendered state was recording playback (the summary overlay offers a try then, PLAN-v4 0.7.3) */
  private replayMode = false;
  private progress: HTMLElement | null = null;
  private earned: HTMLElement | null = null;
  private lastEarned = -1; private lastTick = -1;
  private legendEl: HTMLElement | null = null;
  hintText = '';
  stallText = '';

  constructor(private readonly scene: Phaser.Scene, private readonly actions: PanelActions, seed: string, replayLabel: string | null, muted: boolean, forkLabelText: string | null = null) {
    const suffix = forkLabelText ? ` · ${forkLabelText}` : replayLabel ? ` · ${replayLabel}` : isWeeklySeed(seed) ? (weeklyClosed(seed, new Date()) ? t('game.suffixArchivedWeekly') : t('game.suffixThisWeek')) : isMintedDailySeed(seed) ? (dailyDateOf(seed) === new Date().toISOString().slice(0, 10) ? t('game.suffixToday') : t('game.suffixArchivedDaily')) : isDailySeed(seed) ? t('game.suffixPractice') : ''; // PLAN-v3 0.6.1/0.6.2: the HUD says which daily this is
    this.hud = {
      seed: h('span', { class: `jd-mono jd-hud-seed ${replayLabel ? 'jd-blue' : 'jd-dim'}`, tid: 'hud-seed', title: seed }, t('game.hudYard', { yard: t('common.yard', { seed }), suffix })),
      round: h('span', { class: 'jd-hud-round', tid: 'hud-round' }, ''),
      score: h('span', { class: 'jd-gold jd-hud-score', tid: 'hud-score' }, money(0)),
      best: h('span', { class: 'jd-mono jd-dim jd-hud-best' }, ''),
      stall: h('span', { class: 'jd-mono jd-red jd-hud-stall', tid: 'stall' }, ''),
      mute: btn(muted ? t('common.unmute') : t('common.mute'), 'mute', () => { this.hud.mute.textContent = this.actions.toggleMute() ? t('common.unmute') : t('common.mute'); }, { small: true }),
    };
    const hudBar = h('div', { class: 'jd-hud' },
      h('span', { class: 'jd-amber jd-hud-title' }, t('title.name')),
      this.hud.seed,
      this.hud.round,
      h('div', { class: 'jd-hud-scoreblock' }, this.hud.score, this.hud.best, this.hud.stall),
      h('div', { class: 'jd-row jd-hud-right' }, btn(t('common.title'), 'title', () => this.actions.toTitle(), { small: true }), this.hud.mute));
    this.side = h('div', { class: 'jd-side' });
    this.hintEl = h('div', { class: 'jd-hint', tid: 'hint' }, '');
    this.gridLayer = h('div', { class: 'jd-gridlayer' });
    this.root = h('div', { class: 'jd-game' }, hudBar, this.side, this.gridLayer, this.hintEl);
    if (!document.getElementById('jd-game-style')) { const st = document.createElement('style'); st.id = 'jd-game-style'; st.textContent = GAME_STYLE; document.head.append(st); }
    ui.mount(scene, this.root);
  }

  destroy() { ui.unmount(); }

  // ---------- HUD ----------
  setHud(run: RunState, total: number, pulse: boolean) {
    this.hud.round.textContent = t('game.round', { n: run.round, total: RULES.rounds });
    const next = money(total);
    if (this.hud.score.textContent !== next) {
      this.hud.score.textContent = next;
      if (pulse && !prefs.reducedMotion) { this.hud.score.classList.remove('jd-pulse'); void this.hud.score.offsetWidth; this.hud.score.classList.add('jd-pulse'); }
    }
    const b = loadBests().bySeed[run.seed];
    this.hud.best.textContent = b ? t('game.bestForYard', { score: money(b.score) }) : t('game.noBestForYard');
  }
  setStall(text: string) { this.stallText = text; this.hud.stall.textContent = text; }
  setHint(text: string) { this.hintText = text; this.hintEl.textContent = text; }

  // ---------- per-frame ----------
  setProgress(tick: number, earned: number) {
    if (this.progress && tick !== this.lastTick) { this.lastTick = tick; this.progress.style.width = `${(100 * tick) / RULES.ticksPerRound}%`; }
    if (this.earned && earned !== this.lastEarned) { this.lastEarned = earned; this.earned.textContent = t('game.earned', { amount: money(earned) }); }
  }

  // ---------- side panel ----------
  private keyOf(s: PanelState): string {
    const sel = s.selected;
    return JSON.stringify([s.mode, s.run.phase, s.run.round, s.run.offers, s.run.rerolledRound, s.run.score, s.challenge?.hash ?? null, s.run.bin.length, s.run.layout.machines.length, s.speed, s.replayLabel, !!s.replayRounds, sel ? [sel.id, sel.kind, sel.dir, sel.x >= 0] : null, s.playbackPending, s.canUndo, s.canRedo, s.tipsBadge, s.tipsOpen]);
  }
  /** Rebuild the side panel if its inputs changed. */
  render(s: PanelState) {
    const key = this.keyOf(s);
    if (key === this.key && this.side.childElementCount > 0) return;
    this.key = key;
    this.replayMode = !!s.replayLabel;
    this.side.replaceChildren();
    this.progress = null; this.earned = null; this.lastEarned = -1; this.lastTick = -1;
    const r = s.run;
    if (s.challenge) { // PLAN-v4 0.7.1: the challenger's earnings, round by round, next to yours
      const c = s.challenge; const idx = Math.min(r.round, c.rounds.length) - 1; const done = r.rounds.length >= RULES.rounds;
      const text = done ? t('game.challengeDone', { player: c.player, score: money(c.score), yours: money(r.score) }) : t('game.challengeLive', { player: c.player, theirs: money(c.rounds[idx] ?? 0), round: r.round, total: money(challengerTotal(c, r.round)), yours: money(r.score) });
      this.side.append(h('div', { class: 'jd-mono jd-amber', tid: 'challenge-line', style: 'font-size:0.75em; margin-bottom:0.4em', title: t('game.challengeTitle', { player: c.player, score: money(c.score) }) }, text));
    }
    const head = (text: string, right?: HTMLElement | null) => h('div', { class: 'jd-row jd-between', style: 'margin-bottom:0.4em' }, h('div', { class: 'jd-head' }, text), right ?? null);
    const tipsBtn = s.replayLabel ? null : btn(s.tipsBadge ? t('game.tipsBadge') : t('game.tips'), 'tips', () => this.actions.openTips(), { small: true, variant: s.tipsBadge ? 'primary' : 'dark' });
    const replayBanner = s.replayLabel ? h('span', { class: 'jd-replay-banner jd-blue', tid: 'replay-banner' }, t('game.recordingBanner')) : null;
    if (s.mode === 'running' || s.mode === 'paused') {
      this.side.append(head(s.mode === 'paused' ? t('game.paused') : t('game.running'), replayBanner));
      this.side.append(h('div', { class: 'jd-dim', style: 'font-size:0.875em' }, t('game.watchLine', { n: r.round })));
      this.progress = h('div', { class: 'jd-progress-fill', tid: 'progress' });
      this.side.append(h('div', { class: 'jd-progress' }, this.progress));
      this.earned = h('div', { class: 'jd-gold', tid: 'earned', style: 'font-size:1.125em; font-weight:700; margin-top:0.4em' }, t('game.earned', { amount: money(0) }));
      this.side.append(this.earned);
      if (s.replayRounds) {
        const idx = r.round - 1; const orig = s.replayRounds[idx] ?? 0; const total = s.replayRounds.slice(0, idx + 1).reduce((a, b) => a + b, 0);
        this.side.append(h('div', { class: 'jd-blue', tid: 'replay-original', style: 'font-size:0.6875em; margin-top:0.25em' }, t('game.original', { orig: money(orig), total: money(total), n: r.round, final: money(s.replayRounds.reduce((a, b) => a + b, 0)) })));
      }
      this.side.append(h('div', { class: 'jd-row', style: 'margin-top:0.6em' }, h('span', { class: 'jd-dim', style: 'font-size:0.75em' }, t('game.speed')),
        ...[1, 2, 4].map((sp) => btn(t('game.speedX', { n: sp }), `speed-${sp}`, () => this.actions.setSpeed(sp), { small: true, variant: s.speed === sp ? 'primary' : 'dark' }))));
      this.side.append(h('div', { class: 'jd-row jd-center', style: 'margin-top:0.6em' }, btn(s.mode === 'paused' ? t('game.resume') : s.replayLabel ? t('game.pause') : t('game.pauseEsc'), 'pause', () => this.actions.setPaused(s.mode !== 'paused')), s.mode === 'paused' ? btn(t('game.step'), 'step', () => { this.actions.stepTick(); (document.activeElement as HTMLElement | null)?.blur?.(); }, { small: true, title: t('game.stepTitle') }) : null)); // the button gives focus back so the . key works right after a click
      this.side.append(h('div', { class: 'jd-row jd-center' }, btn(t('game.skip'), 'skip', () => this.actions.finishRun(), { small: true })));
      if (s.replayLabel) {
        this.side.append(h('div', { class: 'jd-row jd-center' }, btn(t('game.stopWatching'), 'stop', () => this.actions.stopReplay(), { small: true })));
        this.side.append(h('div', { class: 'jd-blue', style: 'font-size:0.75em; margin-top:0.3em; overflow-wrap:anywhere' }, s.replayLabel));
      }
      this.side.append(this.legend());
      return;
    }
    if (r.phase === 'draft') {
      this.side.append(head(t('game.pickHead', { n: r.round }), replayBanner ?? tipsBtn));
      r.offers.forEach((kind, i) => {
        const card = h('button', { class: 'jd-offer', tid: `offer-${i}`, type: 'button', onClick: () => { if (!s.playbackPending) this.actions.pick(i); } },
          textureImg(this.scene.game, machineTexture(kind), machineName(kind)),
          h('div', { class: 'jd-offer-text' }, h('div', { style: 'font-weight:700; font-size:1.0625em' }, machineName(kind)), h('div', { class: 'jd-dim', style: 'font-size:0.8125em' }, machineBlurb(kind))),
          h('span', { class: 'jd-dim jd-offer-key' }, t('game.offerKey', { n: i + 1 })));
        this.side.append(card);
      });
      if (!s.replayLabel) {
        const why = canReroll(r);
        const rerollBtn = btn(t('game.newOffers', { cost: money(RULES.rerollCost) }), 'reroll', () => { if (!s.playbackPending) this.actions.reroll(); }, { small: true, disabled: !!why || s.playbackPending, title: why ? explainRunError(why) : t('game.newOffersTitle') });
        this.side.append(h('div', { class: 'jd-row', style: 'margin-top:0.5em; gap:0.6em; align-items:center' }, rerollBtn, h('span', { class: 'jd-dim', tid: 'reroll-note', style: 'font-size:0.75em' }, why ? explainRunError(why) : t('game.newOffersNote', { score: money(r.score) }))));
      }
      this.side.append(this.legend());
      return;
    }
    if (r.phase === 'build') {
      this.side.append(head(t('game.buildHead', { n: r.round }), replayBanner ?? tipsBtn));
      const sel = s.selected;
      if (sel) {
        const img = textureImg(this.scene.game, machineTexture(sel.kind), machineName(sel.kind)); img.style.transform = `rotate(${sel.dir * 90}deg)`;
        this.side.append(h('div', { class: 'jd-sel' }, img,
          h('div', { style: 'flex:1' }, h('div', { style: 'font-weight:700; font-size:1.0625em' }, machineName(sel.kind)), h('div', { class: 'jd-dim', style: 'font-size:0.78em' }, machineBlurb(sel.kind)),
            h('div', { class: 'jd-row', style: 'margin-top:0.4em; gap:0.4em' }, btn(t('game.rotate'), 'rotate', () => this.actions.rotateSelected(), { small: true }),
              sel.x >= 0 ? btn(t('game.toShelf'), 'tobin', () => this.actions.toBin(sel.id), { small: true }) : btn(t('game.sellFor', { amount: money(RULES.sellValue) }), 'sell', () => this.actions.sell(sel.id), { small: true })))));
      } else {
        this.side.append(h('div', { class: 'jd-dim', style: 'font-size:0.875em' }, t('game.buildHelp')));
        this.side.append(h('div', { class: 'jd-dim', style: 'font-size:0.875em; margin-top:0.4em' }, t('game.keyboardHelp')));
      }
      this.side.append(h('div', { class: 'jd-row jd-between', style: 'margin-top:0.5em' }, h('span', { class: 'jd-dim', style: 'font-size:0.75em' }, t('game.placed', { placed: int(r.layout.machines.length), shelf: int(r.bin.length) })),
        h('div', { class: 'jd-row', style: 'gap:0.4em' }, btn(t('game.undo'), 'undo', () => this.actions.undo(), { small: true, disabled: !s.canUndo }), btn(t('game.redo'), 'redo', () => this.actions.redo(), { small: true, disabled: !s.canRedo }))));
      this.side.append(h('div', { style: 'margin-top:0.6em' }, h('button', { class: 'jd-btn jd-btn-primary jd-run', tid: 'run', type: 'button', onClick: () => this.actions.startRun() }, t('game.startShift', { n: r.round }))));
      if (r.bin.length > 0) this.side.append(h('div', { class: 'jd-dim', style: 'font-size:0.75em; margin-top:0.4em' }, t('game.shelfNote', { amount: money(RULES.sellValue) })));
      this.side.append(this.legend());
      return;
    }
    if (r.phase === 'result') this.renderSummary(r);
  }

  /** The VALUES legend: built once and re-appended (it never changes). */
  private legend(): HTMLElement {
    if (this.legendEl) return this.legendEl;
    const mats: Material[] = ['scrap', 'shards', 'plate', 'ingot', 'slag'];
    const notes: Record<Material, string> = { scrap: t('game.valueScrap'), shards: t('game.valueShards'), plate: t('game.valuePlate', { n: RULES.pressShards }), ingot: t('game.valueIngot'), slag: t('game.valueSlag') };
    this.legendEl = h('div', { class: 'jd-legend' }, h('div', { class: 'jd-head', style: 'font-size:0.75em' }, t('game.values')),
      ...mats.map((m) => h('div', { class: 'jd-row', style: 'gap:0.5em; margin-top:0.15em; font-size:0.8125em' }, textureImg(this.scene.game, `i-${m}`, materialName(m)), h('span', { style: 'width:6.5em' }, t('game.valueRow', { name: cap(materialName(m)), price: money(RULES.value[m]) })), h('span', { class: 'jd-dim', style: 'font-size:0.9em' }, notes[m]))),
      h('div', { class: 'jd-dim', style: 'font-size:0.6875em; margin-top:0.4em' }, t('game.timing', { hopper: RULES.hopperPeriod, crusher: RULES.process.crusher, press: RULES.process.press, furnace: RULES.process.furnace, round: RULES.ticksPerRound })));
    return this.legendEl;
  }

  // ---------- round summary (side) + banner and badges over the grid ----------
  private renderSummary(r: RunState) {
    const rec = r.rounds[r.rounds.length - 1]; const res = rec.result;
    const notes = this.badgeNotes(r);
    this.side.append(h('div', { class: 'jd-head' }, t('game.shippedHead')));
    const mats: Material[] = ['ingot', 'plate', 'shards', 'scrap', 'slag'];
    let any = false;
    for (const m of mats) if (res.shipped[m]) { any = true; this.side.append(h('div', { class: 'jd-row', style: 'gap:0.5em; margin-top:0.25em; font-size:0.875em' }, textureImg(this.scene.game, `i-${m}`, materialName(m)), t('game.shippedRow', { n: res.shipped[m], mat: materialName(m), each: money(RULES.value[m]), total: money(res.shipped[m] * RULES.value[m]) }))); }
    if (!any) this.side.append(h('div', { class: 'jd-dim', style: 'font-size:0.875em' }, t('game.nothing')));
    // the bottleneck line (production roadmap 0.8.8): what held the line and the pool fixes; the next draft repeats it as the hint
    const bottleneck = analyseRound(rec.layout, res, rec.round + 1);
    this.side.append(h('div', { class: 'jd-head', style: 'margin-top:0.6em' }, t('game.heldHead')));
    this.side.append(h('div', { class: bottleneck.kind === 'balanced' ? 'jd-green' : 'jd-amber', tid: 'bottleneck', style: 'font-size:0.8125em' }, bottleneckLine(bottleneck)));
    this.side.append(h('div', { class: 'jd-head', style: 'margin-top:0.6em' }, t('game.diagnostics')));
    this.side.append(h('div', { class: notes.length ? 'jd-red' : 'jd-green', style: 'font-size:0.8125em; white-space:pre-line' }, notes.slice(0, 5).join('\n') || t('game.cleanRound')));
    this.side.append(h('div', { class: 'jd-head', style: 'margin-top:0.6em' }, t('game.historyHead')));
    this.side.append(h('div', { class: 'jd-history' }, ...r.rounds.map((rr, i) => h('span', { class: i === r.rounds.length - 1 ? 'jd-gold' : '' }, t('game.historyCell', { n: rr.round, score: money(rr.earned) })))));
    if (r.sold) this.side.append(h('div', { class: 'jd-dim', style: 'font-size:0.8125em' }, t('game.soldParts', { amount: money(r.sold) })));
    this.side.append(this.legend());
  }
  /** Diagnostics text shared by the side panel and the badges. */
  private badgeNotes(r: RunState): string[] {
    const rec = r.rounds[r.rounds.length - 1]; const res = rec.result; const g = r.layout; const notes: string[] = [];
    for (const m of g.machines) {
      const st = res.cellStats[cellIndex(m.x, m.y, g.width)];
      if (m.kind === 'hopper') { if (st && st.blockedTicks > 5) notes.push(t('game.noteHopperBlocked', { pos: pos(m), n: int(st.blockedTicks) })); if (!st) notes.push(t('game.noteHopperIdle', { pos: pos(m) })); }
      else if (m.kind === 'crusher' || m.kind === 'furnace' || m.kind === 'press') { if (st && st.jammedTicks > 8) notes.push(t('game.noteBlocked', { name: machineName(m.kind), pos: pos(m), n: int(st.jammedTicks) })); }
      else if (m.kind === 'tuner') { if (!st || !st.tuned) notes.push(t('game.noteTuner', { pos: pos(m) })); }
    }
    const inTransit = res.spawned - res.absorbed - Object.values(res.shipped).reduce((a, b) => a + b, 0);
    if (inTransit > 6) notes.push(t('game.noteTransit', { n: int(inTransit) }));
    if (!Object.values(res.shipped).some(Boolean)) notes.unshift(t('game.noteNoDock'));
    return notes;
  }
  /** Banner across the top of the grid plus a badge under each machine: what it actually did this round. */
  showSummaryOverlay(r: RunState) {
    const rec = r.rounds[r.rounds.length - 1]; const res = rec.result; const g = r.layout;
    const last = r.round >= RULES.rounds;
    const layer = this.gridLayer; layer.replaceChildren();
    layer.append(h('div', { class: 'jd-grid-dim' }));
    for (const m of g.machines) {
      const st = res.cellStats[cellIndex(m.x, m.y, g.width)];
      let line1 = ''; let line2 = ''; let cls = ''; let warn = true;
      if (m.kind === 'hopper') { line1 = st ? t('game.badgeOut', { n: int(st.spawned) }) : t('game.badgeIdle'); if (st && st.blockedTicks > 5) line2 = t('game.badgeBlocked', { n: int(st.blockedTicks) }); if (!st) cls = 'jd-dim'; }
      else if (m.kind === 'dock') { if (st && st.shipped) { line1 = money(st.earned); line2 = t('game.badgeShipped', { n: int(st.shipped) }); cls = 'jd-green'; warn = false; } else { line1 = t('game.badgeNoItems'); cls = 'jd-dim'; } }
      else if (m.kind === 'crusher' || m.kind === 'furnace' || m.kind === 'press') {
        line1 = st && st.passed ? t('game.badgeMade', { n: int(st.processed) }) : t('game.badgeUnused'); if (!st || !st.processed) cls = 'jd-dim';
        if (st && st.jammedTicks > 8) line2 = t('game.badgeWaited', { n: int(st.jammedTicks) }); else if (m.kind === 'press' && st && st.stored) { line2 = t('game.badgeHeld', { n: int(st.stored) }); warn = false; }
      } else if (m.kind === 'tuner') { if (st && st.tuned) { line1 = t('game.badgeSped', { n: int(st.tuned) }); cls = 'jd-green'; warn = false; } else { line1 = t('game.badgeNothingToTune'); cls = 'jd-dim'; } }
      else { if (st && st.jammedTicks > 8) line2 = t('game.badgeWaited', { n: int(st.jammedTicks) }); else if (!st || !st.passed) { line1 = t('game.badgeUnused'); cls = 'jd-dim'; } }
      if (!line1 && !line2) continue;
      layer.append(h('div', { class: 'jd-badge', style: `left:${em(m.x * CELL + CELL / 2)}; top:${em((m.y + 1) * CELL - 2)}` },
        line1 ? h('div', { class: cls }, line1) : null, line2 ? h('div', { class: warn ? 'jd-red' : 'jd-dim' }, line2) : null));
    }
    layer.append(h('div', { class: 'jd-banner' },
      h('div', {}, h('div', { class: 'jd-head' }, t('game.roundResult', { n: rec.round })), h('div', { class: 'jd-row', style: 'gap:0.6em; align-items:baseline' }, h('span', { class: 'jd-gold', style: 'font-size:1.875em; font-weight:700; line-height:1' }, money(rec.earned)), h('span', { class: 'jd-dim', style: 'font-size:0.8125em' }, t('game.thisRoundTotal', { total: money(r.score) })))),
      btn(last ? t('game.finalScore') : t('game.nextRound'), 'next', () => this.actions.nextRound(), { variant: 'primary' }),
      this.replayMode && !last ? btn(t('game.tryHere', { n: r.rounds.length }), 'fork-here', () => this.actions.forkHere(), { small: true, title: t('game.tryHereTitle') }) : null, // PLAN-v4 0.7.3
      this.replayMode && this.actions.reportName ? btn(t('game.reportName'), 'report-name', () => this.actions.reportName!(), { small: true, title: t('game.reportNameTitle') }) : null));
  }
  showPauseVeil(on: boolean, tick?: number) {
    this.gridLayer.replaceChildren();
    if (on) this.gridLayer.append(h('div', { class: 'jd-grid-dim jd-grid-dim-strong' }, h('div', { class: 'jd-paused', tid: 'paused-veil' }, t('game.pausedVeil'), h('div', { style: 'font-size:0.5em; font-weight:400' }, tick != null ? t('game.pausedHelp', { tick: int(tick), total: RULES.ticksPerRound }) : t('game.pausedHelpNoTick')))));
  }
  clearGridLayer() { this.gridLayer.replaceChildren(); }
}

/** Stylesheet for the game chrome (appended to the shared one by dom.ts consumers). */
export const GAME_STYLE = `
#ui .jd-screen.jd-game { position: absolute; inset: 0; pointer-events: none; overflow: hidden; display: block; padding: 0; gap: 0; }
#ui .jd-game > * { pointer-events: auto; }
#ui .jd-hud { position: absolute; left: 0; top: 0; width: 100%; height: ${em(56)}; background: #24201a; border-bottom: 1px solid #3f382d; display: flex; align-items: center; gap: ${em(18)}; padding: 0 ${em(16)}; }
#ui .jd-hud-title { font-weight: 700; letter-spacing: 0.15em; font-size: 1.25em; white-space: nowrap; flex: 0 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; }
#ui .jd-hud-seed { font-size: 0.75em; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; flex: 0 1 auto; min-width: 0; }
#ui .jd-hud-round { font-weight: 700; white-space: nowrap; }
#ui .jd-hud-right { gap: 0.4em; margin-left: auto; flex: 0 0 auto; flex-wrap: nowrap; }
#ui .jd-hud-scoreblock { display: flex; flex-direction: column; line-height: 1.15; min-width: 0; flex: 0 1 auto; overflow: hidden; }
#ui .jd-hud-score { font-weight: 700; display: inline-block; transform-origin: left center; }
#ui .jd-hud-best, #ui .jd-hud-stall { font-size: 0.6875em; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
#ui .jd-pulse { animation: jd-pulse 0.14s ease-out; }
@keyframes jd-pulse { from { transform: scale(1.08); } to { transform: scale(1); } }
#ui .jd-side { position: absolute; left: ${em(SIDE_X)}; top: ${em(GRID_Y)}; width: ${em(SIDE_W)}; height: ${em(H - GRID_Y - 24)}; background: rgba(36, 32, 26, 0.95); border: 1px solid #3f382d; padding: ${em(14)} ${em(16)}; display: flex; flex-direction: column; overflow-y: auto; overflow-x: hidden; }
#ui .jd-hint { position: absolute; left: ${em(GRID_X)}; width: ${em(GRID_W)}; bottom: ${em(12)}; background: rgba(36, 32, 26, 0.95); border: 1px solid #3f382d; padding: ${em(7)} ${em(12)}; font-size: 0.8125em; min-height: ${em(50)}; }
#ui .jd-gridlayer { position: absolute; left: ${em(GRID_X)}; top: ${em(GRID_Y)}; width: ${em(GRID_W)}; height: ${em(GRID_H)}; pointer-events: none; }
#ui .jd-gridlayer > * { pointer-events: none; }
#ui .jd-gridlayer .jd-banner, #ui .jd-gridlayer .jd-banner * { pointer-events: auto; }
#ui .jd-grid-dim { position: absolute; inset: 0; background: rgba(0,0,0,0.25); }
#ui .jd-grid-dim-strong { background: rgba(0,0,0,0.55); display: flex; align-items: center; justify-content: center; }
#ui .jd-paused { font-size: 1.75em; font-weight: 700; text-align: center; }
#ui .jd-badge { position: absolute; transform: translate(-50%, -100%); background: rgba(0,0,0,0.8); border-radius: 0.15em; padding: 0.1em 0.3em; font-size: 0.625em; font-weight: 700; line-height: 1.2; white-space: nowrap; text-align: center; }
#ui .jd-banner { position: absolute; left: 0; top: 0; width: 100%; height: ${em(64)}; background: rgba(36, 32, 26, 0.97); border: 2px solid #f0a830; display: flex; align-items: center; justify-content: space-between; gap: 0.75em; padding: 0 ${em(16)}; }
#ui .jd-progress { height: ${em(10)}; background: #3f382d; margin-top: 0.75em; }
#ui .jd-progress-fill { height: 100%; width: 0; background: #f0a830; }
#ui .jd-offer { display: flex; align-items: center; gap: 0.75em; width: 100%; text-align: left; font: inherit; color: inherit; background: #2a241d; border: 2px solid #3f382d; border-radius: 0.2em; padding: 0.5em 0.75em; margin-top: 0.5em; cursor: pointer; }
#ui .jd-offer:hover { border-color: #f0a830; }
#ui .jd-offer img { width: ${em(72)}; height: ${em(72)}; flex: 0 0 auto; }
#ui .jd-offer-text { flex: 1; min-width: 0; }
#ui .jd-offer-key { font-size: 0.75em; align-self: flex-end; }
#ui .jd-sel { display: flex; gap: 0.75em; align-items: flex-start; background: #2a241d; border: 1px solid #3f382d; border-radius: 0.2em; padding: 0.5em 0.75em; }
#ui .jd-sel img { width: ${em(64)}; height: ${em(64)}; flex: 0 0 auto; }
#ui .jd-run { width: 100%; font-size: 1.125em; padding: 0.7em 0; }
#ui .jd-legend { margin-top: auto; padding-top: 0.75em; }
#ui .jd-legend img { width: 1.1em; height: 1.1em; }
#ui .jd-history { display: grid; grid-template-columns: repeat(3, 1fr); gap: 0.2em 0.5em; font-size: 0.875em; }
#ui .jd-replay-banner { font-size: 0.6875em; font-weight: 700; letter-spacing: 0.08em; border: 1px solid #5aa9e6; background: rgba(90,169,230,0.18); padding: 0.2em 0.5em; border-radius: 0.15em; white-space: nowrap; }
`;
export const PANEL_W = W;
