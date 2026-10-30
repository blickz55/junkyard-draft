import { t } from '../../content/strings';
import { forkLabel } from '../../content/fork';
import { tipForMachine } from '../../content/tips';
import { explainRunError, placementWarning } from '../../content/advice';
import { foremanSays } from '../../content/foreman';
import Phaser from 'phaser';
import { DPR } from '../dpr';
import { viewport } from '../viewport';
import type { Challenge } from '../challenge';
import { forkFrom } from '../../sim/fork';
import type { ForkOrigin } from '../../sim/run';
import { RULES_VERSION } from '../../sim/types';
import { decideQuality, QUALITY_PROBE_FRAMES } from '../quality';
import { InputController, type InputHost } from '../InputController';
import { SimView } from '../SimView';
import { forkPayload, reportPlayer, type ReplayOrigin } from '../replayActions';
import { hintFor } from '../guide';
import { StallMonitor, stallText } from '../StallMonitor';
import { PopPool } from '../PopPool';
import { GameTelemetry } from '../GameTelemetry';
import { flowLinks, drawFlowLinks, type FlowLink } from '../FlowOverlay';
import { isTutorialSeed, type Action, type RoundRecord, type RunState } from '../../sim/run';
import type { SimState } from '../../sim/sim';
import { RoundController, type Mode } from '../RoundController';
import { TipsPanel } from '../../ui/TipsPanel';
import { GamePanel, type PanelState } from '../../ui/GamePanel';
import { telemetry } from '../telemetry';
import { RULES } from '../../sim/rules';
import type { SimEvent } from '../../sim/types';
import { CELL } from '../textures';
import { fit } from '../atlas';
import { label, panel } from '../ui';
import { CSS, FONT, P } from '../palette';
import { audio } from '../audio';
import { clearSave, isOnboarded, loadReadTips, loadSettings, setOnboarded, updateSettings, writeSave } from '../storage';
import { BIN_H, BIN_Y, GRID_H, GRID_W, GRID_X, GRID_Y, binSlotXY, boardCameraCenter, fitBoard } from '../layout';
import { installDevApi } from '../devapi';
import { prefs } from '../prefs';

export interface BoardGeometry {
  cell: number;
  scale: number;
  grid: { x: number; y: number; w: number; h: number };
  shelf: { x: number; y: number; w: number; h: number };
  slots: { x: number; y: number }[];
}

export class GameScene extends Phaser.Scene {
  /** authoritative run state, mode machine, sim pacing, undo/redo and playback live in the controller; the scene renders and routes input */
  ctl!: RoundController;
  get run(): RunState {
    return this.ctl.run;
  }
  get mode(): Mode {
    return this.ctl.mode;
  }
  get sim(): SimState | null {
    return this.ctl.sim;
  }
  private get speed() {
    return this.ctl.speed;
  }
  private get replayQueue() {
    return this.ctl.replayQueue;
  }
  private get replayLabel() {
    return this.ctl.replayLabel;
  }
  /** Continue the watched replay from the round just finished as a practice fork (PLAN-v4 0.7.3; render/replayActions.ts). */
  private forkHere() {
    const p = forkPayload(this.run, this.replayOrigin);
    if (!p) return;
    audio.unlock();
    this.scene.start('Game', p);
  }
  private get replayRounds() {
    return this.ctl.replayRounds;
  }
  /** the flow overlay (0.9.3): translucent links drawn from inputTravelDirs/outputDirs in the build phase (render/FlowOverlay.ts) */
  private flowGfx!: Phaser.GameObjects.Graphics;
  private flow: FlowLink[] = [];
  /** the yard's sprites: machines, items, jam and stall marks, per-tick effects (render/SimView.ts) */
  private view!: SimView;
  /** HUD, side panel, hint strip, result banner and badges are DOM (ui/GamePanel.ts); the canvas keeps the factory */
  private panel!: GamePanel;
  /** pointer, keyboard, cursor, selection and their feedback (render/InputController.ts) */
  private inputCtl!: InputController;
  private tutorial = false;
  private tutorialStep = 0;
  /** +$ pops are pooled (0.3.9; render/PopPool.ts) */
  private pops!: PopPool;
  /** the funnel's observer on the controller hooks (render/GameTelemetry.ts) */
  private tele!: GameTelemetry;
  /** tips (PLAN-v1 0.3.6): the panel and the tip suggested by the most recent first-time draft (badge on the Tips button) */
  private tips!: TipsPanel;
  private suggestedTip: string | null = null;
  /** stall indicator (PLAN-v1 0.3.5): the state machine is render/StallMonitor.ts; the scene draws its mark */
  private readonly stall = new StallMonitor();
  /** money heartbeat: the HUD total is re-rasterised at most every HUD_MS (a Text update is a canvas draw + texture upload; at 4x it would be one per frame) */
  static readonly HUD_MS = 100;
  private hudDirty = false;
  private lastHudAt = 0;
  private lastFrame = 0;
  /** adaptive resolution: frame deltas of the first 120 running frames at DPR > 1 while renderQuality is still 'auto' */
  private dprProbe: number[] | null = null;

  constructor() {
    super('Game');
  }

  /** A challenge being played (PLAN-v4 0.7.1); only when it names this very seed, so an overlay never appears on another seed. */
  private challenge: Challenge | null = null;
  /** the watched replay's identity, so a fork can name its origin (PLAN-v4 0.7.3) */
  private replayOrigin: ReplayOrigin | null = null;
  init(data: {
    seed: string;
    fresh: boolean;
    replay?: Action[];
    actions?: Action[];
    replayLabel?: string;
    challenge?: Challenge;
    replayHash?: string;
    replayPlayer?: string;
    fork?: { origin: Omit<ForkOrigin, 'round'>; actions: Action[]; round: number };
  }) {
    this.challenge = data.challenge && data.challenge.seed === data.seed && !data.replay && !data.fork ? data.challenge : null;
    this.replayOrigin = data.replay ? { hash: data.replayHash ?? null, player: data.replayPlayer ?? 'replay', actions: data.replay } : null;
    let forked: ForkOrigin | null = null;
    if (data.fork) {
      // PLAN-v4 0.7.3: resume from the forked state's action prefix (deterministic), then mark the run as a fork
      const f = forkFrom(data.seed, data.fork.actions, RULES_VERSION, data.fork.round, data.fork.origin);
      data = { seed: data.seed, fresh: false, actions: f.actions.slice() };
      forked = f.forkedFrom!;
    }
    this.tele = new GameTelemetry(telemetry, { watching: () => this.replayLabel != null, seed: () => this.run.seed, round: () => this.run.round });
    this.ctl = new RoundController(
      data,
      this.tele.observe({
        onTick: (evs) => this.onTickEvents(evs),
        onRunStart: () => this.onRunStart(),
        onPause: (p) => this.onPause(p),
        onRoundEnd: (rec, visual) => this.onRoundEnd(rec, visual),
        onNextRound: () => {
          this.inputCtl.heldId = null;
          this.syncMachines();
          this.renderSide();
          this.updateHint();
        },
        onFinished: () => {
          this.scene.start('Results', {
            run: this.run,
            replayed: this.replayLabel != null,
            replayLabel: this.replayLabel ?? undefined,
            challenge: this.challenge ?? undefined,
            replayHash: this.replayOrigin?.hash ?? undefined,
            replayPlayer: this.replayOrigin?.player,
          });
        },
        onStateChange: (a) => this.onStateChange(a),
        onReject: (a, message) => {
          if (a.t === 'place') {
            this.panel?.setForeman(foremanSays('refused'));
            this.inputCtl.showReject(explainRunError(message), { x: a.x, y: a.y });
          }
        },
        onPlaybackDone: () => {
          this.syncMachines();
          this.renderSide();
        },
        persist: (seed, actions) => {
          if (!this.run.forkedFrom) writeSave(seed, actions);
        }, // a fork is never the player's save: resuming it would lose the mark and make it submittable
        schedule: (ms, fn) => {
          this.time.delayedCall(ms, fn);
        },
      }),
    );
    if (forked) this.run.forkedFrom = forked; // PLAN-v4 0.7.3: the resumed state is now a labelled practice fork
    if (data.fresh && !data.replay) telemetry.gameStart(data.seed);
    if (this.ctl.resumeNotice) clearSave(); // a damaged save is dropped so the title stops offering it; the notice is shown once
    this.tutorial = isTutorialSeed(data.seed) && !this.replayQueue; // the tutorial seed carries the lesson; other seeds get one pointer to it
    this.tutorialStep = 0;
    this.view?.clear();
  }

  create() {
    // the scene instance is reused across scene.start(): anything cached on it from the previous life was destroyed at shutdown
    this.pops = new PopPool({
      make: () => this.add.text(0, 0, '', { fontFamily: FONT, fontStyle: 'bold' }).setOrigin(0.5).setDepth(8).setVisible(false),
      tween: (cfg) => {
        this.tweens.add(cfg);
      },
    });
    this.cameras.main.setBackgroundColor(P.bg); // the camera is fitted to the board slot once the panel has laid out (layoutBoard)
    this.input.mouse?.disableContextMenu();
    this.buildStatic();
    this.flowGfx = this.add.graphics().setDepth(3);
    this.view = new SimView(
      this,
      (x, y) => this.cellXY(x, y),
      (i) => this.binSlot(i),
    ).attach();
    this.inputCtl = new InputController(this, this.inputHost()).attach();
    this.panel = new GamePanel(
      this,
      {
        pick: (i) => this.pick(i),
        startRun: () => this.startRun(),
        setPaused: (p) => this.setPaused(p),
        finishRun: () => this.finishRun(),
        stopReplay: () => this.stopReplay(),
        setSpeed: (s) => this.ctl.setSpeed(s),
        stepTick: () => this.stepTick(),
        undo: () => this.undo(),
        redo: () => this.redo(),
        openTips: (id) => this.openTips(id ?? this.suggestedTip ?? undefined),
        rotateSelected: () => this.rotateSelected(),
        toBin: (id) => {
          this.act({ t: 'unplace', id });
          this.syncMachines();
        },
        sell: (id) => {
          if (this.act({ t: 'sell', id })) {
            audio.ship(RULES.sellValue);
            this.inputCtl.selectedId = null;
            this.syncMachines();
            this.renderSide();
          }
        },
        nextRound: () => this.nextRound(),
        toTitle: () => this.scene.start('Title'),
        toggleMute: () => {
          audio.setMuted(!audio.muted);
          return audio.muted;
        },
        reroll: () => {
          if (this.replayQueue) return;
          if (this.act({ t: 'reroll' })) {
            audio.lockIn();
            this.renderSide();
          }
        },
        forkHere: () => this.forkHere(),
        ...(this.replayOrigin?.hash ? { reportName: () => reportPlayer(this, this.replayOrigin!) } : {}),
      },
      this.run.seed,
      this.replayLabel,
      audio.muted,
      this.run.forkedFrom ? forkLabel(this.run.forkedFrom) : null,
    );
    this.panel.onBoard((slot) => this.layoutBoard(slot));
    const offViewport = viewport.on(() => this.panel.relayout());
    this.tips = new TipsPanel(this, () => this.renderSide());
    this.suggestedTip = null;
    this.updateHud();
    this.syncMachines();
    this.renderSide();
    this.updateHint();
    installDevApi(this);
    this.events.once('shutdown', () => {
      offViewport();
      audio.humStop(false);
      this.view.clear();
      this.tips.close();
      this.panel.destroy();
    });
    if (this.replayQueue) this.time.delayedCall(600, () => this.ctl.advanceReplay());
    if (this.mode === 'summary') this.showSummary();
  }

  private buildStatic() {
    for (let y = 0; y < RULES.gridHeight; y++)
      for (let x = 0; x < RULES.gridWidth; x++) fit(this.add.image(GRID_X + x * CELL, GRID_Y + y * CELL, 'tile')).setOrigin(0);
    this.add.rectangle(GRID_X, GRID_Y, GRID_W, GRID_H).setOrigin(0).setStrokeStyle(2, P.panelLine);
    panel(this, GRID_X, BIN_Y, GRID_W, BIN_H, 0.9);
    label(this, GRID_X + 10, BIN_Y + 6, t('game.shelfLabel'), 12, CSS.amber, { fontStyle: 'bold', letterSpacing: 1 });
  }
  /** Leave a watched replay at any point: nothing was recorded, nothing to save. */
  stopReplay() {
    if (!this.replayLabel) return;
    this.ctl.stopReplay();
    audio.resume();
    this.scene.start('Title');
  }
  private updateHud() {
    this.panel.setHud(this.run, this.run.score, false);
  }

  private cellXY(x: number, y: number) {
    return { px: GRID_X + x * CELL, py: GRID_Y + y * CELL };
  }
  private binSlot(i: number) {
    return binSlotXY(i);
  }

  // ---------- the board in its slot (production roadmap 0.10.0; render/layout.ts) ----------
  /** the fitted board's top-left in CSS px relative to the canvas, and CSS px per logical px */
  private boardCss = { left: 0, top: 0, s: 1 };
  /** Fit the camera so the board (grid plus shelf) fills the slot the shell laid out, centred, and tell the panel the cell size. */
  layoutBoard(slot: { x: number; y: number; w: number; h: number }) {
    viewport.measure();
    const f = fitBoard(slot.w, slot.h);
    const left = slot.x + f.dx,
      top = slot.y + f.dy;
    const c = boardCameraCenter(f, left, top, viewport.width, viewport.height);
    this.cameras.main.setZoom(DPR * f.s).centerOn(c.x, c.y);
    this.panel.setBoardVars(CELL * f.s, f.dx, f.dy);
    this.boardCss = { left, top, s: f.s };
  }
  /** Where the board is on the page (CSS px): the cell size, the grid and shelf rectangles and the shelf slots' centres; the tests aim their pointer with it. */
  geometryInfo(): BoardGeometry {
    const g = document.getElementById('game')?.getBoundingClientRect() ?? { left: 0, top: 0 };
    const { left, top, s } = this.boardCss;
    const L = g.left + left,
      T = g.top + top;
    return {
      cell: CELL * s,
      scale: s,
      grid: { x: L, y: T, w: GRID_W * s, h: GRID_H * s },
      shelf: { x: L, y: T + (BIN_Y - GRID_Y) * s, w: GRID_W * s, h: BIN_H * s },
      slots: Array.from({ length: 7 }, (_, i) => {
        const { px, py } = binSlotXY(i);
        return { x: L + (px - GRID_X + CELL / 2) * s, y: T + (py - GRID_Y + CELL / 2) * s };
      }),
    };
  }

  /** Machines follow the run (render/SimView.ts); a held machine that vanished is let go; the cursor, the selection and the overlay follow. */
  syncMachines() {
    const alive = this.view.sync(this.run, this.inputCtl);
    if (this.inputCtl.heldId != null && !alive.has(this.inputCtl.heldId)) this.inputCtl.heldId = null;
    this.inputCtl.refresh();
    this.drawFlow();
  }
  // ---------- input (render/InputController.ts) ----------
  private inputHost(): InputHost {
    // eslint-disable-next-line @typescript-eslint/no-this-alias -- the host's getters read the scene's live state
    const scene = this;
    return {
      get mode() {
        return scene.mode;
      },
      get run() {
        return scene.run;
      },
      get playback() {
        return scene.replayQueue != null;
      },
      get watching() {
        return scene.replayLabel != null;
      },
      get tipsOpen() {
        return scene.tips?.isOpen ?? false;
      },
      act: (a) => this.act(a),
      syncMachines: () => this.syncMachines(),
      renderSide: () => this.renderSide(),
      startRun: () => this.startRun(),
      nextRound: () => this.nextRound(),
      setPaused: (p) => this.setPaused(p),
      stepTick: () => this.stepTick(),
      stopReplay: () => this.stopReplay(),
      closeTips: () => this.closeTips(),
      pick: (i) => this.pick(i),
      undo: () => {
        this.undo();
      },
      redo: () => {
        this.redo();
      },
      setToast: (toast) => this.panel?.setToast(toast),
      cellXY: (x, y) => this.cellXY(x, y),
    };
  }
  rotateSelected() {
    this.inputCtl.rotateSelected();
  }
  /** keyboard cursor and the machine in hand (dev API / tests) */
  cursorInfo() {
    return this.inputCtl.cursorInfo();
  }
  /** The toast on screen (dev API / tests). */
  toastInfo() {
    return this.inputCtl.toast;
  }
  /** Last refusal text shown (dev API / tests). */
  lastRejectText(): string {
    return this.inputCtl.lastReject;
  }
  /** The flow overlay (0.9.3; render/FlowOverlay.ts): build phase only, cleared while the shift runs. */
  private drawFlow() {
    if (!this.flowGfx) return;
    this.flow = this.mode === 'build' ? flowLinks(this.run.layout) : [];
    drawFlowLinks(this.flowGfx, this.flow, (x, y) => this.cellXY(x, y));
  }
  /** The overlay's state (dev API / tests): drawn in the build phase, how many outputs connect and how many go nowhere. */
  flowInfo() {
    const links = this.flow.filter((l) => l.ok).length;
    return { visible: this.mode === 'build' && this.flow.length > 0, links, loose: this.flow.length - links };
  }

  /** Apply an action to the run through the controller; false (state unchanged) if the rules reject it or the layout is frozen. */
  act(a: Action): boolean {
    return this.ctl.act(a);
  }
  /** Controller hook: the run changed (an accepted action, or null for undo/redo/speed): refresh HUD, hints and the panel. */
  private onStateChange(a: Action | null) {
    if (!this.panel) return; // init() runs before create(): nothing to draw yet
    if (a) {
      this.inputCtl.clearToast();
      if (a.t === 'place' && !this.replayQueue) {
        const m = this.run.layout.machines.find((q) => q.id === a.id);
        const warn = m ? placementWarning(this.run.layout, m.kind, m.x, m.y, m.dir, m.id) : null;
        if (warn) this.inputCtl.showToast({ text: warn, kind: 'warning', x: a.x, y: a.y });
      }
    } // 0.9.3
    if (a && (a.t === 'place' || a.t === 'rotate')) this.view.pulse(a.id, a.t);
    if (a?.t === 'pick' && !this.replayLabel) {
      const kind = this.run.picks[this.run.picks.length - 1];
      const tip = kind ? tipForMachine(kind, loadReadTips()) : null;
      if (tip) this.suggestedTip = tip.id;
    }
    this.updateHud();
    if (!a || a.t === 'place' || a.t === 'pick' || a.t === 'rotate') this.updateHint();
    if (!a || a.t !== 'rotate') this.renderSide();
  }
  pick(i: number) {
    if (this.run.phase !== 'draft') return;
    if (this.act({ t: 'pick', i })) {
      audio.lockIn();
      this.inputCtl.selectedId = this.run.bin[this.run.bin.length - 1]?.id ?? null;
      this.syncMachines();
      this.renderSide();
    }
  }

  // ---------- undo / redo (build phase only; the replay stays a flat list of final actions) ----------
  /** Ctrl+Z: remove the last layout edit of this build phase (never across a run). Returns false when there is nothing to undo. */
  undo(): boolean {
    if (!this.ctl.undo()) {
      audio.invalid();
      return false;
    }
    this.tele.undoUsed();
    this.afterHistoryChange();
    return true;
  }
  /** Ctrl+Y / Ctrl+Shift+Z: re-apply the last undone edit if the rules still accept it. */
  redo(): boolean {
    if (!this.ctl.redo()) {
      audio.invalid();
      return false;
    }
    this.afterHistoryChange();
    return true;
  }
  private afterHistoryChange() {
    audio.click();
    this.inputCtl.dropMissing();
    this.syncMachines();
    this.renderSide();
  }

  // ---------- side panel ----------
  /** The DOM side panel renders from this snapshot and rebuilds only when it changes. */
  private panelState(): PanelState {
    const r = this.run;
    const sel = this.inputCtl?.selectedId ?? null;
    const selected = sel != null ? (r.layout.machines.find((m) => m.id === sel) ?? r.bin.find((m) => m.id === sel)) : undefined;
    return {
      run: r,
      mode: this.mode,
      speed: this.speed,
      replayLabel: this.replayLabel,
      replayRounds: this.replayRounds,
      playbackPending: !!this.replayQueue,
      challenge: this.challenge,
      canUndo: this.ctl.canUndo(),
      canRedo: this.ctl.canRedo(),
      selected,
      tipsBadge: !this.replayLabel && this.suggestedTip != null && !loadReadTips().includes(this.suggestedTip),
      tipsOpen: this.tips?.isOpen ?? false,
    };
  }
  renderSide() {
    if (this.panel) this.panel.render(this.panelState());
  }
  openTips(id?: string) {
    this.tips.open(id ?? this.suggestedTip ?? undefined);
    if (this.suggestedTip && loadReadTips().includes(this.suggestedTip)) this.suggestedTip = null;
    this.renderSide();
  }
  closeTips() {
    this.tips.close();
  }
  tipsInfo() {
    return {
      open: this.tips.isOpen,
      current: this.tips.currentId,
      suggested: this.suggestedTip != null && !loadReadTips().includes(this.suggestedTip) ? this.suggestedTip : null,
      read: loadReadTips(),
      demo: this.tips.demoState(),
    };
  }
  // ---------- onboarding hints ----------
  /** The guide (render/guide.ts) reads the run; the scene shows the text, moves the lesson's funnel step and gives the foreman his situation. */
  updateHint() {
    const r = this.run;
    const g = hintFor(r, { tutorial: this.tutorial, onboarded: isOnboarded(), watching: !!this.replayLabel, resumeNotice: this.ctl.resumeNotice });
    if (this.ctl.resumeNotice) this.ctl.resumeNotice = null; // the notice is shown once
    if (this.tutorial) {
      if (g.step !== this.tutorialStep) {
        this.tele.tutorialStep(this.tutorialStep, g.step);
        this.tutorialStep = g.step;
      } // funnel: which lesson step is on screen
      if (r.round >= 4) {
        this.tutorial = false;
        setOnboarded();
      }
    }
    if (g.foreman) this.panel?.setForeman(foremanSays(g.foreman));
    else if (!this.tutorial && r.phase === 'build' && this.panel) this.panel.setForeman(this.panel.foremanText); // keep the draft's line through the build
    this.setHint(g.text, g.demo);
  }
  /** Current hint text (typed accessor for the dev API and tests instead of private-field access). */
  hintText(): string {
    return this.panel?.hintText ?? '';
  }
  private setHint(text: string, demo?: string) {
    this.panel?.setHint(text, demo);
  }

  // ---------- simulation playback ----------
  /** Controller hook: the layout is frozen and the live sim exists; reset the per-round visuals. */
  private onRunStart() {
    this.inputCtl.freeze(); // a machine still under the pointer snaps back; nothing in hand, nothing selected: nothing can change the layout from here on
    this.stall.reset();
    this.clearStallMark();
    this.hudDirty = false;
    this.lastHudAt = 0;
    this.drawFlow(); // 0.9.3: the layout is frozen; nothing to point at
    if (DPR > 1 && !this.dprProbe && loadSettings().renderQuality === 'auto') this.dprProbe = [];
    audio.run();
    audio.humStart(this.run.round);
    this.renderSide();
    this.setHint(this.replayLabel ? t('hint.watching') : t('hint.running'));
  }
  startRun() {
    this.ctl.startRun();
  }
  setPaused(p: boolean) {
    this.ctl.setPaused(p);
  }
  /** One tick while paused (0.8.12): the Step button or the . key; the veil shows the new tick. */
  stepTick() {
    if (this.ctl.stepTick()) {
      audio.resume();
      return;
    }
    if (this.mode === 'paused') this.panel.showPauseVeil(true, this.sim?.tick ?? 0);
  }
  private onPause(paused: boolean) {
    if (paused) {
      audio.suspend();
      this.renderSide();
      this.panel.showPauseVeil(true, this.sim?.tick ?? 0);
    } else {
      audio.resume();
      this.panel.clearGridLayer();
      this.renderSide();
    }
  }
  /** Complete the round instantly (authoritative result comes from the run orchestrator). */
  finishRun() {
    if (this.ctl.finishRun()) audio.resume();
  }
  /** Controller hook: the round is recorded; tear down the live visuals and show the summary. */
  private onRoundEnd(rec: RoundRecord, visual: number) {
    {
      const prev = this.run.rounds.length >= 2 ? this.run.rounds[this.run.rounds.length - 2].earned : -1;
      this.panel.bannerForeman = this.replayLabel ? '' : foremanSays(rec.earned > prev ? 'roundGood' : 'roundFlat');
    } // 0.9.1
    if (import.meta.env.DEV && rec.earned !== visual) console.error(`DETERMINISM MISMATCH: visual ${visual} vs authoritative ${rec.earned}`);
    this.view.teardownRound();
    this.stall.reset();
    this.clearStallMark();
    audio.humStop(true); // the drone resolves to the fanfare's root under the settle
    audio.settle();
    this.showSummary();
  }

  override update(_time: number, _delta: number) {
    if (this.mode !== 'running' || !this.sim) {
      this.lastFrame = 0;
      return;
    }
    // Wall-clock pacing (Phaser's smoothed delta under-reports when the browser throttles frames).
    const now = performance.now();
    const delta = this.lastFrame ? Math.min(250, now - this.lastFrame) : 16;
    this.lastFrame = now;
    if (this.dprProbe) {
      this.dprProbe.push(delta);
      if (this.dprProbe.length >= QUALITY_PROBE_FRAMES) {
        const quality = decideQuality(this.dprProbe);
        updateSettings({ renderQuality: quality });
        this.dprProbe = null;
        if (quality === 'low') this.setHint(t('hint.lowQuality'));
      }
    }
    if (this.ctl.advance(delta)) return; // the round ended: onRoundEnd tore the live visuals down
    const sim = this.sim;
    if (!sim) return;
    if (this.hudDirty && now - this.lastHudAt >= GameScene.HUD_MS) {
      this.hudDirty = false;
      this.lastHudAt = now;
      this.panel.setHud(this.run, this.run.score + sim.earned, true);
    }
    this.view.animate(sim, this.ctl.tickPhase, delta, this.speed, _time);
    this.panel.setProgress(sim.tick, sim.earned);
  }
  /** Controller hook: a tick's events become effects (render/SimView.ts), pops, sounds, the money heartbeat and the stall monitor's input. */
  private onTickEvents(evs: SimEvent[]) {
    const d = this.view.applyTick(evs);
    for (const [cell, value] of d.ships) {
      const c = this.view.centerOfCell(cell);
      this.pops.pop(c.x, c.y, value, prefs.reducedMotion);
    } // one pop per dock per tick
    if (d.ships.size && this.sim) {
      this.stall.shipped(this.sim.tick);
      this.hudDirty = true;
    } // money heartbeat: the running total ticks up as items ship
    audio.tickSounds(d.sounds); // one call per tick: chord, capped transforms, throttled jam; reduced audio keeps one sound
    const live = this.sim;
    if (live) audio.humUpdate({ inFlight: live.items.length, jammed: d.jammed.size > 0, tick: live.tick, ticksPerRound: RULES.ticksPerRound });
    this.applyStall(d.jammed);
  }
  /** The stall monitor decided (PLAN-v1 0.3.5; render/StallMonitor.ts): draw or hide the mark and the HUD line. */
  private applyStall(jammedNow: Set<number>) {
    const sim = this.sim;
    if (!sim) {
      this.stall.reset();
      this.clearStallMark();
      return;
    }
    const ch = this.stall.update(jammedNow, sim.tick);
    if (!ch) return;
    if (ch.kind === 'clear') {
      this.clearStallMark();
      return;
    }
    this.panel.setStall(stallText(sim.grid[ch.cell]?.kind ?? null, ch.x, ch.y));
    this.view.showStall(ch.x, ch.y);
    audio.stall();
  }
  private clearStallMark() {
    this.panel?.setStall('');
    this.view?.hideStall();
  }
  /** Stall indicator state (dev API / tests): the HUD text, the flagged cell (null when none), the current sim tick and the tick the stall was flagged at (-1 when none). */
  stallInfo() {
    return { text: this.panel?.stallText ?? '', cell: this.stall.cell, tick: this.sim?.tick ?? -1, flaggedAt: this.stall.flaggedAt };
  }
  /** Pop-pool counters (dev API / tests / perf): alive now, the peak so far, and ships whose pop was skipped because the pool was full. */
  popCounters() {
    return this.pops.counters();
  }

  // ---------- round summary / results ----------
  private showSummary() {
    const rec = this.run.rounds[this.run.rounds.length - 1];
    audio.roundEnd(rec.earned > 38);
    this.panel.showSummaryOverlay(this.run);
    this.drawFlow();
    this.renderSide();
    this.setHint(this.run.round >= RULES.rounds ? t('hint.summaryFinal') : t('hint.summary'));
  }
  nextRound() {
    if (this.mode !== 'summary') return;
    this.panel.clearGridLayer();
    this.ctl.nextRound(); // onNextRound / onFinished hooks redraw or hand over to the results screen
  }
}
