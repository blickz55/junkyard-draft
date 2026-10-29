import Phaser from 'phaser';
import { applyDpr, DPR } from '../dpr';
import { decideQuality, QUALITY_PROBE_FRAMES } from '../quality';
import { explainRunError, inputTravelDirs, outputDirs, placementWarning } from '../../sim/advice';
import { isTutorialSeed, type Action, type RoundRecord, type RunState } from '../../sim/run';
import { runLayout } from '../../sim/sim';
import { cellIndex, type SimState } from '../../sim/sim';
import { RoundController, type Mode } from '../RoundController';
import { TipsPanel } from '../TipsPanel';
import { GamePanel, type PanelState } from '../../ui/GamePanel';
import { ui } from '../../ui/dom';
import { tipForMachine } from '../../sim/tips';
import { telemetry } from '../telemetry';
import { DIR_DX, DIR_DY, MACHINE_INFO, RULES } from '../../sim/rules';
import type { Machine, Material, SimEvent } from '../../sim/types';
import { BELT_FRAMES, CELL, itemTexture, machineTexture } from '../textures';
import { baseScale, fit, setArt } from '../atlas';
import { label, panel } from '../ui';
import { CSS, FONT, P } from '../palette';
import { audio } from '../audio';
import { clearSave, isOnboarded, loadBests, loadReadTips, loadSettings, setOnboarded, updateSettings, writeSave } from '../storage';
import { BIN_Y, GRID_H, GRID_W, GRID_X, GRID_Y } from '../layout';
import { installDevApi } from '../devapi';
import { prefs, px as fpx } from '../prefs';

interface MachineView { c: Phaser.GameObjects.Container; img: Phaser.GameObjects.Image; belt?: Phaser.GameObjects.Image; m: Machine; inBin: boolean }

export class GameScene extends Phaser.Scene {
  /** authoritative run state, mode machine, sim pacing, undo/redo and playback live in the controller; the scene renders and routes input */
  ctl!: RoundController;
  get run(): RunState { return this.ctl.run; }
  get mode(): Mode { return this.ctl.mode; }
  get sim(): SimState | null { return this.ctl.sim; }
  private get speed() { return this.ctl.speed; }
  private get replayQueue() { return this.ctl.replayQueue; }
  private get replayLabel() { return this.ctl.replayLabel; }
  private get replayRounds() { return this.ctl.replayRounds; }
  private lastFrame = 0;
  private beltFrame = 0;
  private views = new Map<number, MachineView>();
  private itemSprites = new Map<number, Phaser.GameObjects.Image>();
  private hover!: Phaser.GameObjects.Image;
  private ghostGfx!: Phaser.GameObjects.Graphics;
  private rejectTimer: Phaser.Time.TimerEvent | null = null;
  private lastReject = '';
  private selection!: Phaser.GameObjects.Image;
  private selectedId: number | null = null;
  /** HUD, side panel, hint strip, result banner and badges are DOM (ui/GamePanel.ts); the canvas keeps the factory */
  private panel!: GamePanel;
  private jamMarks = new Map<number, Phaser.GameObjects.Image>();
  private tutorial = false;
  private tutorialStep = 0;
  private dragging: MachineView | null = null;
  private dragFrom: { x: number; y: number } | null = null;
  /** keyboard placement: grid cursor (null = hidden) and the machine currently held "in hand" */
  private cursor: { x: number; y: number } | null = null;
  private cursorImg!: Phaser.GameObjects.Image;
  private heldId: number | null = null;
  /** reused per frame / per tick to avoid allocating sets in the hot path */
  private readonly aliveIds = new Set<number>();
  private readonly jammedNow = new Set<number>();
  /** +$ pops are pooled: a busy round ships dozens of items and a fresh Text per ship rasterised a canvas each time (0.3.9) */
  static readonly POP_POOL = 16;
  private popPool: Phaser.GameObjects.Text[] = [];
  private popsAlive = 0;
  private popsPeak = 0;
  private popsSkipped = 0;
  private readonly shipsThisTick = new Map<number, number>();
  private lastShortcutAt = -1000;
  /** tips (PLAN-v1 0.3.6): the panel and the tip suggested by the most recent first-time draft (badge on the Tips button) */
  private tips!: TipsPanel;
  private suggestedTip: string | null = null;
  /** stall indicator (PLAN-v1 0.3.5): tick of the last ship this round, the cell currently flagged, its frame */
  static readonly STALL_TICKS = 8;
  private lastShipTick = 0;
  private stallCell: number | null = null;
  private stallMark!: Phaser.GameObjects.Image;
  /** money heartbeat: the HUD total is re-rasterised at most every HUD_MS (a Text update is a canvas draw + texture upload; at 4x it would be one per frame) */
  static readonly HUD_MS = 100;
  private hudDirty = false;
  private lastHudAt = 0;
  /** adaptive resolution: frame deltas of the first 120 running frames at DPR > 1 while renderQuality is still 'auto' */
  private dprProbe: number[] | null = null;

  constructor() { super('Game'); }

  init(data: { seed: string; fresh: boolean; replay?: Action[]; actions?: Action[]; replayLabel?: string }) {
    this.ctl = new RoundController(data, {
      onTick: (evs) => this.onTickEvents(evs),
      onRunStart: () => this.onRunStart(),
      onPause: (p) => this.onPause(p),
      onRoundEnd: (rec, visual) => this.onRoundEnd(rec, visual),
      onNextRound: () => { this.heldId = null; this.syncMachines(); this.renderSide(); this.updateHint(); },
      onFinished: () => { telemetry.track('game_complete', { mode: this.replayLabel ? 'replay' : this.run.seed.startsWith('daily-') ? 'daily' : 'seed' }); this.scene.start('Results', { run: this.run, replayed: this.replayLabel != null, replayLabel: this.replayLabel ?? undefined }); },
      onStateChange: (a) => this.onStateChange(a),
      onReject: (a, message) => { if (a.t === 'place') { this.showReject(explainRunError(message)); telemetry.track('first_place_attempt'); telemetry.track('first_place_rejected', { reason: /occupied/i.test(message) ? 'occupied' : /bounds/i.test(message) ? 'out_of_bounds' : 'other' }); } },
      onPlaybackDone: () => { this.syncMachines(); this.renderSide(); },
      persist: (seed, actions) => writeSave(seed, actions),
      schedule: (ms, fn) => { this.time.delayedCall(ms, fn); },
    });
    if (data.fresh && !data.replay) telemetry.gameStart(data.seed);
    if (this.ctl.resumeNotice) clearSave(); // a damaged save is dropped so the title stops offering it; the notice is shown once
    this.tutorial = isTutorialSeed(data.seed) && !this.replayQueue; // the tutorial seed carries the lesson; other seeds get one pointer to it
    this.tutorialStep = 0;
    this.views.clear(); this.itemSprites.clear(); this.jamMarks.clear();
    this.selectedId = null; this.dragging = null;
    this.cursor = null; this.heldId = null;
  }

  create() {
    // the scene instance is reused across scene.start(): anything cached on it from the previous life was destroyed at shutdown
    this.popPool = []; this.popsAlive = 0; this.popsPeak = 0; this.popsSkipped = 0;
    this.cameras.main.setBackgroundColor(P.bg);
    applyDpr(this);
    this.input.mouse?.disableContextMenu();
    this.buildStatic();
    this.hover = fit(this.add.image(0, 0, 'tile-ok')).setOrigin(0).setVisible(false).setDepth(5);
    this.ghostGfx = this.add.graphics().setDepth(6);
    this.stallMark = fit(this.add.image(0, 0, 'tile-sel')).setOrigin(0).setDepth(7).setTint(P.red).setVisible(false).setName('stall-mark');
    this.selection = fit(this.add.image(0, 0, 'tile-sel')).setOrigin(0).setVisible(false).setDepth(6);
    this.cursorImg = fit(this.add.image(0, 0, 'tile-cursor')).setOrigin(0).setVisible(false).setDepth(6);
    this.panel = new GamePanel(this, {
      pick: (i) => this.pick(i), startRun: () => this.startRun(), setPaused: (p) => this.setPaused(p), finishRun: () => this.finishRun(), stopReplay: () => this.stopReplay(),
      setSpeed: (s) => this.ctl.setSpeed(s), undo: () => this.undo(), redo: () => this.redo(), openTips: () => this.openTips(this.suggestedTip ?? undefined), rotateSelected: () => this.rotateSelected(),
      toBin: (id) => { this.act({ t: 'unplace', id }); this.syncMachines(); },
      sell: (id) => { if (this.act({ t: 'sell', id })) { audio.ship(RULES.sellValue); this.selectedId = null; this.syncMachines(); this.renderSide(); } },
      nextRound: () => this.nextRound(), toTitle: () => this.scene.start('Title'), toggleMute: () => { audio.setMuted(!audio.muted); return audio.muted; },
    }, this.run.seed, this.replayLabel, audio.muted);
    this.tips = new TipsPanel(this, () => { ui.setHidden(false); this.renderSide(); });
    this.suggestedTip = null;
    this.updateHud();
    this.syncMachines();
    this.renderSide();
    this.setupInput();
    this.updateHint();
    installDevApi(this);
    this.events.on('shutdown', () => { audio.humStop(false); this.views.clear(); this.itemSprites.clear(); this.tips.close(); this.panel.destroy(); });
    if (this.replayQueue) this.time.delayedCall(600, () => this.ctl.advanceReplay());
    if (this.mode === 'summary') this.showSummary();
  }

  // ---------- static scenery ----------
  private buildStatic() {
    for (let y = 0; y < RULES.gridHeight; y++) for (let x = 0; x < RULES.gridWidth; x++) fit(this.add.image(GRID_X + x * CELL, GRID_Y + y * CELL, 'tile')).setOrigin(0);
    this.add.rectangle(GRID_X, GRID_Y, GRID_W, GRID_H).setOrigin(0).setStrokeStyle(2, P.panelLine);
    panel(this, GRID_X, BIN_Y, GRID_W, 100, 0.9);
    label(this, GRID_X + 10, BIN_Y + 6, 'PARTS BIN  — drag parts onto the grid, or arrow keys + Enter', 12, CSS.amber, { fontStyle: 'bold', letterSpacing: 1 });
  }
  /** Leave a watched replay at any point: nothing was recorded, nothing to save. */
  stopReplay() {
    if (!this.replayLabel) return;
    this.ctl.stopReplay(); audio.resume();
    this.scene.start('Title');
  }
  private updateHud() { this.panel.setHud(this.run, this.run.score, false); }

  // ---------- machine views ----------
  private cellXY(x: number, y: number) { return { px: GRID_X + x * CELL, py: GRID_Y + y * CELL }; }
  private binSlot(i: number) { return { px: GRID_X + 12 + i * (CELL + 8), py: BIN_Y + 28 }; }

  private makeView(m: Machine): MachineView {
    const c = this.add.container(0, 0).setDepth(2);
    const img = fit(this.add.image(CELL / 2, CELL / 2, machineTexture(m.kind)));
    c.add(img);
    let belt: Phaser.GameObjects.Image | undefined;
    if (m.kind === 'conveyor') { belt = fit(this.add.image(CELL / 2, CELL / 2, 'belt-0')); c.add(belt); }
    c.setSize(CELL, CELL);
    img.setInteractive({ useHandCursor: true, draggable: true });
    this.input.setDraggable(img);
    const v: MachineView = { c, img, belt, m, inBin: false };
    img.setData('view', v);
    return v;
  }
  syncMachines() {
    const alive = new Set<number>();
    const place = (m: Machine, inBin: boolean, px: number, py: number) => {
      let v = this.views.get(m.id);
      if (!v) { v = this.makeView(m); this.views.set(m.id, v); v.c.setPosition(px, py); }
      v.m = m; v.inBin = inBin; alive.add(m.id);
      const held = this.heldId === m.id && this.cursor ? this.cellXY(this.cursor.x, this.cursor.y) : null;
      if (held) { px = held.px; py = held.py; }
      if (!this.dragging || this.dragging.m.id !== m.id) { if (prefs.reducedMotion) v.c.setPosition(px, py); else this.tweens.add({ targets: v.c, x: px, y: py, duration: 120, ease: 'Quad.out' }); }
      v.img.setAngle(m.dir * 90); v.belt?.setAngle(m.dir * 90);
      v.c.setDepth(held ? 10 : 2);
      v.c.setAlpha(held ? 0.85 : inBin ? 0.95 : 1);
    };
    this.run.layout.machines.forEach((m) => { const { px, py } = this.cellXY(m.x, m.y); place(m, false, px, py); });
    this.run.bin.forEach((m, i) => { const { px, py } = this.binSlot(i); place(m, true, px, py); });
    for (const [id, v] of this.views) if (!alive.has(id)) { v.c.destroy(); this.views.delete(id); }
    if (this.heldId != null && !alive.has(this.heldId)) this.heldId = null;
    this.updateSelection();
    this.updateCursor();
  }
  private updateSelection() {
    const v = this.selectedId != null ? this.views.get(this.selectedId) : undefined;
    if (!v || v.inBin) { this.selection.setVisible(false); return; }
    const { px, py } = this.cellXY(v.m.x, v.m.y); this.selection.setPosition(px, py).setVisible(true);
  }

  // ---------- input ----------
  private setupInput() {
    const toCell = (p: Phaser.Input.Pointer) => {
      const x = Math.floor((p.worldX - GRID_X) / CELL), y = Math.floor((p.worldY - GRID_Y) / CELL); // world coordinates: the camera is zoomed on HiDPI
      return x >= 0 && y >= 0 && x < RULES.gridWidth && y < RULES.gridHeight ? { x, y } : null;
    };
    this.input.on('dragstart', (p: Phaser.Input.Pointer, obj: Phaser.GameObjects.Image) => {
      if (this.mode !== 'build' || this.replayQueue) return;
      const v = obj.getData('view') as MachineView; if (!v) return;
      this.heldId = null; this.updateCursor();
      this.dragging = v; this.dragFrom = { x: v.c.x, y: v.c.y }; v.c.setDepth(10); this.selectedId = v.m.id; this.updateSelection(); this.renderSide();
    });
    this.input.on('drag', (p: Phaser.Input.Pointer, obj: Phaser.GameObjects.Image, dx: number, dy: number) => {
      const v = this.dragging; if (!v || obj !== v.img) return;
      if (this.mode !== 'build') { this.cancelDrag(); return; } // the round started under the pointer: the layout is frozen
      v.c.setPosition(dx - CELL / 2, dy - CELL / 2);
      const cell = toCell(p);
      if (cell) {
        const occ = this.run.layout.machines.find((m) => m.x === cell.x && m.y === cell.y && m.id !== v.m.id);
        const { px, py } = this.cellXY(cell.x, cell.y);
        setArt(this.hover, occ ? 'tile-bad' : 'tile-ok').setPosition(px, py).setVisible(true);
        if (occ) { this.hideGhost(); } else this.showGhost(v.m, cell.x, cell.y);
      } else { this.hover.setVisible(false); this.hideGhost(); }
    });
    this.input.on('dragend', (p: Phaser.Input.Pointer, obj: Phaser.GameObjects.Image) => {
      const v = this.dragging; if (!v || obj !== v.img) return;
      if (this.mode !== 'build') { this.cancelDrag(); return; } // drop after the round started: no edit, snap back
      this.dragging = null; this.hover.setVisible(false); this.hideGhost(); v.c.setDepth(2);
      const cell = toCell(p);
      const inBinArea = p.worldY >= BIN_Y && p.worldY <= BIN_Y + 110 && p.worldX >= GRID_X && p.worldX <= GRID_X + GRID_W;
      if (cell) {
        const ok = this.act({ t: 'place', id: v.m.id, x: cell.x, y: cell.y, dir: v.m.dir });
        if (ok) audio.place(); else { audio.invalid(); this.flashBad(cell.x, cell.y); }
      } else if (inBinArea && !v.inBin) { this.act({ t: 'unplace', id: v.m.id }); audio.place(); }
      this.syncMachines();
    });
    this.input.on('gameobjectdown', (p: Phaser.Input.Pointer, obj: Phaser.GameObjects.GameObject) => {
      const v = (obj as Phaser.GameObjects.Image).getData?.('view') as MachineView | undefined;
      if (!v || this.mode !== 'build') return;
      this.selectedId = v.m.id; this.updateSelection(); this.renderSide();
      if (p.rightButtonDown()) this.rotateSelected();
    });
    const kb = this.input.keyboard;
    const KC = Phaser.Input.Keyboard.KeyCodes;
    kb?.addCapture([KC.UP, KC.DOWN, KC.LEFT, KC.RIGHT, KC.ENTER, KC.TAB, KC.SPACE]);
    kb?.on('keydown-R', () => this.rotateSelected());
    // Phaser queues a modifier+key keydown twice in Chromium (two listeners, differing timeStamps slip past its own bailout); one shortcut per 30 ms
    const once = (e: KeyboardEvent) => { if (e.timeStamp - this.lastShortcutAt < 30) return false; this.lastShortcutAt = e.timeStamp; return true; };
    kb?.on('keydown-Z', (e: KeyboardEvent) => { if ((e.ctrlKey || e.metaKey) && once(e)) { e.preventDefault(); if (e.shiftKey) this.redo(); else this.undo(); } });
    kb?.on('keydown-Y', (e: KeyboardEvent) => { if ((e.ctrlKey || e.metaKey) && once(e)) { e.preventDefault(); this.redo(); } });
    kb?.on('keydown-SPACE', () => { if (this.mode === 'build' && this.run.phase === 'build') this.startRun(); else if (this.mode === 'summary') this.nextRound(); });
    kb?.on('keydown-ESC', () => { if (this.tips.isOpen) this.closeTips(); else if (this.replayLabel) this.stopReplay(); else if (this.mode === 'running') this.setPaused(true); else if (this.mode === 'paused') this.setPaused(false); else this.keyEscape(); });
    kb?.on('keydown-M', () => audio.setMuted(!audio.muted));
    kb?.on('keydown-DELETE', () => this.keyDelete());
    kb?.on('keydown-BACKSPACE', () => this.keyDelete());
    // keyboard-only placement: arrows move the cursor, Enter places / picks up, Tab cycles bin parts
    kb?.on('keydown-UP', () => this.moveCursor(0, -1));
    kb?.on('keydown-DOWN', () => this.moveCursor(0, 1));
    kb?.on('keydown-LEFT', () => this.moveCursor(-1, 0));
    kb?.on('keydown-RIGHT', () => this.moveCursor(1, 0));
    kb?.on('keydown-ENTER', () => this.keyEnter());
    kb?.on('keydown-TAB', () => this.keyTab());
    for (const n of [1, 2, 3]) kb?.on(`keydown-${['ONE', 'TWO', 'THREE'][n - 1]}`, () => { if (this.run.phase === 'draft' && !this.replayQueue) this.pick(n - 1); });
    this.game.events.on(Phaser.Core.Events.BLUR, () => { if (this.mode === 'running') this.setPaused(true); });
  }
  /** Abandon an in-progress pointer drag without applying anything: the view snaps back to its logical cell or bin slot. */
  private cancelDrag() {
    const v = this.dragging; if (!v) return;
    this.dragging = null; this.dragFrom = null; this.hover.setVisible(false); this.hideGhost(); v.c.setDepth(2);
    this.syncMachines();
  }
  /** Refusal reason in the hint strip for ~2 s; it pre-empts every other hint (tips never interrupt it). */
  private showReject(text: string) {
    this.lastReject = text;
    this.setHint(text);
    this.rejectTimer?.remove(false);
    const t = this.time.delayedCall(2200, () => { if (this.rejectTimer === t) { this.rejectTimer = null; if (this.heldId != null || this.dragging) this.updateCursor(); else this.updateHint(); } });
    this.rejectTimer = t;
  }
  /** Last refusal text shown (dev API / tests). */
  lastRejectText(): string { return this.lastReject; }
  /** Ghost of the machine in hand at a cell: input (blue) and output (amber) arrows on the cell edges, plus a warning if it would not be fed. */
  private showGhost(m: Machine, cx: number, cy: number) {
    const g = this.ghostGfx; g.clear();
    const { px, py } = this.cellXY(cx, cy);
    const mx = px + CELL / 2, my = py + CELL / 2, r = 9;
    const arrow = (d: number, outward: boolean, color: number) => {
      const dx = DIR_DX[d], dy = DIR_DY[d];
      const ex = mx + (outward ? dx : -dx) * (CELL / 2 - 4), ey = my + (outward ? dy : -dy) * (CELL / 2 - 4);
      const tipX = ex + dx * r, tipY = ey + dy * r, bx = ex - dx * r * 0.2, by = ey - dy * r * 0.2;
      g.fillStyle(color, 0.95).lineStyle(1, 0x0b0b0b, 0.9);
      g.fillTriangle(tipX, tipY, bx - dy * r * 0.8, by + dx * r * 0.8, bx + dy * r * 0.8, by - dx * r * 0.8);
    };
    for (const t of inputTravelDirs(m.kind, m.dir)) arrow(t, false, 0x6fb4ff);
    for (const o of outputDirs(m.kind, m.dir)) arrow(o, true, 0xffb347);
    if (this.rejectTimer) return;
    const warn = cx >= 0 ? placementWarning(this.run.layout, m.kind, cx, cy, m.dir, m.id) : null;
    if (warn) this.setHint(`Heads up: ${warn}`); else this.updateHint();
  }
  private hideGhost() { this.ghostGfx.clear(); }
  private flashBad(x: number, y: number) {
    const { px, py } = this.cellXY(x, y);
    const f = fit(this.add.image(px, py, 'tile-bad')).setOrigin(0).setDepth(7);
    this.tweens.add({ targets: f, alpha: 0, duration: 350, onComplete: () => f.destroy() });
  }
  rotateSelected() {
    if (this.mode !== 'build' || this.selectedId == null || this.replayQueue) return;
    if (this.act({ t: 'rotate', id: this.selectedId })) { audio.rotate(); this.syncMachines(); }
  }

  // ---------- keyboard placement ----------
  cursorInfo() { return { visible: this.cursor != null && this.mode === 'build', x: this.cursor?.x ?? -1, y: this.cursor?.y ?? -1, held: this.heldId }; }
  private machineById(id: number | null): Machine | undefined {
    if (id == null) return undefined;
    return this.run.layout.machines.find((m) => m.id === id) ?? this.run.bin.find((m) => m.id === id);
  }
  private occupantAt(x: number, y: number) { return this.run.layout.machines.find((m) => m.x === x && m.y === y); }
  /** First arrow press reveals the cursor (on the selected machine, else top-left) without moving it. */
  private moveCursor(dx: number, dy: number) {
    if (this.mode !== 'build' || this.replayQueue) return;
    if (!this.cursor) {
      const sel = this.machineById(this.selectedId);
      this.cursor = sel && sel.x >= 0 ? { x: sel.x, y: sel.y } : { x: 0, y: 0 };
    } else {
      this.cursor = { x: Phaser.Math.Clamp(this.cursor.x + dx, 0, RULES.gridWidth - 1), y: Phaser.Math.Clamp(this.cursor.y + dy, 0, RULES.gridHeight - 1) };
    }
    if (this.heldId != null) this.syncMachines(); else this.updateCursor();
  }
  private updateCursor() {
    if (!this.cursor || this.mode !== 'build') { this.cursorImg.setVisible(false); if (!this.dragging) { this.hover.setVisible(false); this.hideGhost(); } return; }
    const { px, py } = this.cellXY(this.cursor.x, this.cursor.y);
    this.cursorImg.setPosition(px, py).setVisible(true);
    if (this.heldId != null) {
      const occ = this.occupantAt(this.cursor.x, this.cursor.y);
      setArt(this.hover, occ && occ.id !== this.heldId ? 'tile-bad' : 'tile-ok').setPosition(px, py).setVisible(true);
      const held = this.machineById(this.heldId);
      if (held && !(occ && occ.id !== held.id)) this.showGhost(held, this.cursor.x, this.cursor.y); else this.hideGhost();
    } else if (!this.dragging) { this.hover.setVisible(false); this.hideGhost(); }
  }
  /** Enter: drop the held machine here; else pick up the machine here; else place the first bin part here. */
  private keyEnter() {
    if (this.mode !== 'build' || this.replayQueue) return;
    if (!this.cursor) { this.moveCursor(0, 0); return; }
    const { x, y } = this.cursor;
    const occupant = this.occupantAt(x, y);
    const held = this.machineById(this.heldId);
    if (held) {
      if (held.x === x && held.y === y) { this.heldId = null; }
      else if (occupant) { audio.invalid(); this.flashBad(x, y); this.showReject(explainRunError('cell occupied')); return; }
      else if (this.act({ t: 'place', id: held.id, x, y, dir: held.dir })) { audio.place(); this.heldId = null; this.selectedId = held.id; }
      else { audio.invalid(); this.flashBad(x, y); return; }
    } else if (occupant) {
      this.heldId = occupant.id; this.selectedId = occupant.id; audio.click();
    } else if (this.run.bin.length) {
      const part = this.run.bin[0];
      if (this.act({ t: 'place', id: part.id, x, y, dir: part.dir })) { audio.place(); this.selectedId = part.id; }
      else { audio.invalid(); this.flashBad(x, y); return; }
    } else { audio.invalid(); return; }
    this.syncMachines(); this.renderSide();
  }
  /** Tab: take the next bin part in hand (cycling); Enter then places it at the cursor. */
  private keyTab() {
    if (this.mode !== 'build' || this.replayQueue || !this.run.bin.length) return;
    const i = this.run.bin.findIndex((m) => m.id === this.heldId);
    const next = this.run.bin[(i + 1) % this.run.bin.length];
    this.heldId = next.id; this.selectedId = next.id;
    if (!this.cursor) this.cursor = { x: 0, y: 0 };
    audio.click(); this.syncMachines(); this.renderSide();
  }
  /** Delete: send the held machine, else the machine under the cursor, else the selected machine back to the bin. */
  private keyDelete() {
    if (this.mode !== 'build' || this.replayQueue) return;
    const target = this.machineById(this.heldId) ?? (this.cursor ? this.occupantAt(this.cursor.x, this.cursor.y) : undefined) ?? this.machineById(this.selectedId);
    if (!target) return;
    this.heldId = null;
    if (target.x >= 0 && this.act({ t: 'unplace', id: target.id })) audio.place();
    this.syncMachines(); this.renderSide();
  }
  /** Esc (build): drop what is in hand, else clear the selection, else hide the cursor. */
  private keyEscape() {
    if (this.heldId != null) { this.heldId = null; this.syncMachines(); this.renderSide(); return; }
    if (this.selectedId != null) { this.selectedId = null; this.updateSelection(); this.renderSide(); return; }
    this.cursor = null; this.updateCursor();
  }

  /** Apply an action to the run through the controller; false (state unchanged) if the rules reject it or the layout is frozen. */
  act(a: Action): boolean { return this.ctl.act(a); }
  /** Controller hook: the run changed (an accepted action, or null for undo/redo/speed): refresh HUD, hints and the panel. */
  private onStateChange(a: Action | null) {
    if (!this.panel) return; // init() runs before create(): nothing to draw yet
    if (a && !this.replayLabel) { if (a.t === 'pick') telemetry.track('first_draft_pick'); else if (a.t === 'place') telemetry.track('first_place_attempt'); else if (a.t === 'rotate') telemetry.track('first_rotate'); }
    if (a && !prefs.reducedMotion && (a.t === 'place' || a.t === 'rotate')) { const v = this.views.get(a.id); if (v) { const b = baseScale(v.img.texture.key); this.tweens.killTweensOf(v.img); fit(v.img, a.t === 'place' ? 1.06 : 0.94); this.tweens.add({ targets: v.img, scaleX: b, scaleY: b, duration: a.t === 'place' ? 90 : 60, ease: 'Quad.out' }); } }
    if (a?.t === 'pick' && !this.replayLabel) { const kind = this.run.picks[this.run.picks.length - 1]; const tip = kind ? tipForMachine(kind, loadReadTips()) : null; if (tip) this.suggestedTip = tip.id; }
    this.updateHud();
    if (!a || a.t === 'place' || a.t === 'pick' || a.t === 'rotate') this.updateHint();
    if (!a || a.t !== 'rotate') this.renderSide();
  }
  pick(i: number) {
    if (this.run.phase !== 'draft') return;
    if (this.act({ t: 'pick', i })) { audio.lockIn(); this.selectedId = this.run.bin[this.run.bin.length - 1]?.id ?? null; this.syncMachines(); this.renderSide(); }
  }

  // ---------- undo / redo (build phase only; the replay stays a flat list of final actions) ----------
  /** Ctrl+Z: remove the last layout edit of this build phase (never across a run). Returns false when there is nothing to undo. */
  undo(): boolean { if (!this.ctl.undo()) { audio.invalid(); return false; } telemetry.track('undo_used'); this.afterHistoryChange(); return true; }
  /** Ctrl+Y / Ctrl+Shift+Z: re-apply the last undone edit if the rules still accept it. */
  redo(): boolean { if (!this.ctl.redo()) { audio.invalid(); return false; } this.afterHistoryChange(); return true; }
  canRedo(): boolean { return this.ctl.canRedo(); }
  private afterHistoryChange() {
    audio.click();
    const exists = (id: number | null) => id != null && (this.run.layout.machines.some((m) => m.id === id) || this.run.bin.some((m) => m.id === id));
    if (!exists(this.heldId)) this.heldId = null;
    if (!exists(this.selectedId)) this.selectedId = null;
    this.syncMachines(); this.renderSide();
  }

  // ---------- side panel ----------
  /** The DOM side panel renders from this snapshot and rebuilds only when it changes. */
  private panelState(): PanelState {
    const r = this.run;
    const selected = this.selectedId != null ? r.layout.machines.find((m) => m.id === this.selectedId) ?? r.bin.find((m) => m.id === this.selectedId) : undefined;
    return { run: r, mode: this.mode, speed: this.speed, replayLabel: this.replayLabel, replayRounds: this.replayRounds, playbackPending: !!this.replayQueue, canUndo: this.ctl.canUndo(), canRedo: this.ctl.canRedo(), selected, tipsBadge: !this.replayLabel && this.suggestedTip != null && !loadReadTips().includes(this.suggestedTip), tipsOpen: this.tips?.isOpen ?? false };
  }
  renderSide() { if (this.panel) this.panel.render(this.panelState()); }
  openTips(id?: string) { ui.setHidden(true); this.tips.open(id ?? this.suggestedTip ?? undefined); if (this.suggestedTip && loadReadTips().includes(this.suggestedTip)) this.suggestedTip = null; this.renderSide(); }
  closeTips() { this.tips.close(); }
  tipsInfo() { return { open: this.tips.isOpen, current: this.tips.currentId, suggested: this.suggestedTip != null && !loadReadTips().includes(this.suggestedTip) ? this.suggestedTip : null, read: loadReadTips(), demo: this.tips.demoState() }; }
  // ---------- onboarding hints ----------
  updateHint() {
    if (this.rejectTimer) return;
    const r = this.run;
    let text = '';
    if (this.tutorial) {
      const t = this.tutorialHint();
      text = t.text;
      // funnel: which tutorial step is on screen (1 pick crusher, 2 place it, 3 run it, 4 furnace, 5 splitter merge, 6 free draft)
      if (t.step !== this.tutorialStep) { if (this.tutorialStep) telemetry.track('tutorial_step_complete', { n: this.tutorialStep }); if (t.step) telemetry.track('tutorial_step_start', { n: t.step }); this.tutorialStep = t.step; }
      if (r.round >= 4) { this.tutorial = false; setOnboarded(); }
    } else if (!isOnboarded() && r.round === 1 && r.phase === 'draft' && !this.replayLabel) {
      text = "New here? 'Learn (3 min)' on the title screen walks through every rule in three short rounds. Or dive in: pick a machine.";
    }
    if (this.ctl.resumeNotice) { text = this.ctl.resumeNotice; this.ctl.resumeNotice = null; }
    if (!text) {
      const tips = ['Scrap $1 → crusher → shards $3 → furnace → ingot $12.', 'Conveyors accept from behind or the side; crushers, furnaces and splitters only from behind.', 'A splitter alternates left and right. Two furnaces beat one.', 'Docks take items from any side. A second hopper doubles raw supply.', 'Right-click or R rotates. Drop a machine on the bin to remove it.', `A press squeezes ${RULES.pressShards} shards into one $${RULES.value.plate} plate: less than a furnace, but it never backs a line up.`, 'Keyboard: arrows move the cursor, Enter places or picks up, Tab cycles bin parts.'];
      text = tips[(r.round + r.layout.machines.length) % tips.length];
    }
    this.setHint(text);
  }
  /**
   * The tutorial seed's one guidance surface (PLAN-v1 0.3.4): one rule per round, the objective sufficient on its own, checked
   * against the real layout (fed-ness via placementWarning, flow via a short real simulation), never a modal.
   */
  private tutorialHint(): { text: string; step: number } {
    const r = this.run; const L = r.layout;
    const find = (k: Machine['kind']) => L.machines.find((m) => m.kind === k);
    const fed = (m: Machine) => placementWarning(L, m.kind, m.x, m.y, m.dir, m.id) == null;
    const $ = (m: Material) => `$${RULES.value[m]}`;
    if (r.round === 1) {
      if (r.phase === 'draft') return { step: 1, text: `Welcome! The hopper drops ${$('scrap')} scrap onto a belt that ends at the dock. Pick the CRUSHER (click it or press 1): it turns scrap into ${$('shards')} shards. Three spare conveyors wait in the bin for round 3.` };
      const crusher = find('crusher');
      if (!crusher) return { step: 2, text: 'Make room: drag the conveyor right after the hopper down to the bin (or select it and press Delete), then drop the crusher there with its arrow pointing right. Then press RUN.' };
      return fed(crusher) ? { step: 3, text: `Good: the hopper feeds the crusher from behind. Press RUN and watch every shard sell for ${$('shards')}.` } : { step: 3, text: 'The crusher only takes items from behind: put it in the belt so the hopper\'s line enters its back, arrow pointing on toward the dock (R rotates).' };
    }
    if (r.round === 2) {
      if (r.phase === 'draft') return { step: 4, text: `A FURNACE turns shards into ${$('ingot')} ingots, but raw scrap melts into ${$('slag')} slag, so it belongs after the crusher. Pick it.` };
      const furnace = find('furnace'); const crusher = find('crusher');
      if (!furnace) return { step: 4, text: 'Move the dock one cell to the right to make room, then put the furnace just before it: crusher → belt → furnace → dock, every arrow pointing right.' };
      if (crusher && furnace.y === crusher.y && furnace.x < crusher.x) return { step: 4, text: 'Raw scrap would reach the furnace first and melt into slag: move the furnace after the crusher.' };
      return fed(furnace) ? { step: 4, text: `Shards reach the furnace from behind. Press RUN: each ingot sells for ${$('ingot')}.` } : { step: 4, text: 'Nothing feeds the furnace from behind yet: put it in the line with its arrow pointing right.' };
    }
    if (r.round === 3) {
      if (r.phase === 'draft') return { step: 5, text: 'A SPLITTER sends items up and down in turn, so one line can feed two. Pick it; the spare conveyors will bring both branches back onto the belt.' };
      const splitter = find('splitter');
      if (!splitter) return { step: 5, text: 'Replace the conveyor after the crusher with the splitter. Its two outputs go up and down; from each, one conveyor along and one turning back onto the belt. Conveyors accept items from the side.' };
      const flow = runLayout(L, 40);
      if (flow.shipped.ingot > 0) return { step: 5, text: `Both branches rejoin the belt and ingots flow. Select the spare conveyor in the bin and sell it for ${$('scrap').replace('$1', `$${RULES.sellValue}`)}, then press RUN.` };
      return { step: 5, text: 'Not flowing yet: from each splitter output, one conveyor along, then one turning back into the belt (R rotates). Items may enter a conveyor from behind or either side.' };
    }
    return { step: 6, text: 'You know every rule. Rounds 4 to 6 are an ordinary draft: pick what helps your line most, arrange, run. Parts you cannot use sell for $10. The daily challenge is waiting on the title screen.' };
  }
  /** Current hint text (typed accessor for the dev API and tests instead of private-field access). */
  hintText(): string { return this.panel?.hintText ?? ''; }
  private setHint(text: string) { this.panel?.setHint(text); }
  private chainHasCrusher() {
    return this.run.layout.machines.some((m) => m.kind === 'crusher');
  }

  // ---------- simulation playback ----------
  startRun() { this.ctl.startRun(); }
  /** Controller hook: the layout is frozen and the live sim exists; reset the per-round visuals. */
  private onRunStart() {
    this.cancelDrag(); // a machine still under the pointer snaps back; nothing can change the layout from here on
    this.selectedId = null; this.heldId = null; this.cursor = null; this.updateSelection(); this.updateCursor(); this.hover.setVisible(false);
    this.lastShipTick = 0; this.hudDirty = false; this.lastHudAt = 0; this.clearStall();
    if (DPR > 1 && !this.dprProbe && loadSettings().renderQuality === 'auto') this.dprProbe = [];
    if (!this.replayLabel) telemetry.track('first_run_start');
    audio.run(); audio.humStart(this.run.round);
    this.renderSide();
    this.setHint(this.replayLabel ? 'Watching a verified replay: 1/2/4× change the speed, Skip jumps to the round result, Esc stops and returns to the title.' : 'Running… Jams glow red: an item waits for a free cell or a slow machine.');
  }
  setPaused(p: boolean) { this.ctl.setPaused(p); }
  private onPause(paused: boolean) {
    if (paused) { audio.suspend(); this.renderSide(); this.panel.showPauseVeil(true); }
    else { audio.resume(); this.panel.clearGridLayer(); this.renderSide(); }
  }
  /** Complete the round instantly (authoritative result comes from the run orchestrator). */
  finishRun() { if (this.ctl.finishRun()) audio.resume(); }
  /** Controller hook: the round is recorded; tear down the live visuals and show the summary. */
  private onRoundEnd(rec: RoundRecord, visual: number) {
    if (!this.replayLabel) { telemetry.track('round_complete', { n: rec.round }); telemetry.track('first_run_complete', { money: rec.earned }); }
    if (import.meta.env.DEV && rec.earned !== visual) console.error(`DETERMINISM MISMATCH: visual ${visual} vs authoritative ${rec.earned}`);
    for (const s of this.itemSprites.values()) s.destroy();
    this.itemSprites.clear();
    for (const j of this.jamMarks.values()) j.destroy();
    this.jamMarks.clear();
    this.clearStall();
    for (const v of this.views.values()) { fit(v.img).setTint(0xffffff).setAngle(v.m.dir * 90); if (v.img.texture.key !== machineTexture(v.m.kind)) setArt(v.img, machineTexture(v.m.kind)); }
    if (!prefs.reducedMotion) for (const v of this.views.values()) if (!v.inBin) { const b = baseScale(v.img.texture.key); this.tweens.add({ targets: v.img, scaleX: 0.97 * b, scaleY: 0.97 * b, duration: 120, yoyo: true, delay: v.m.x * 25, ease: 'Quad.out' }); }
    audio.humStop(true); // the drone resolves to the fanfare's root under the settle
    audio.settle();
    this.showSummary();
  }

  override update(_time: number, _delta: number) {
    if (this.mode !== 'running' || !this.sim) { this.lastFrame = 0; return; }
    // Wall-clock pacing (Phaser's smoothed delta under-reports when the browser throttles frames).
    const now = performance.now();
    const delta = this.lastFrame ? Math.min(250, now - this.lastFrame) : 16;
    this.lastFrame = now;
    if (this.dprProbe) {
      this.dprProbe.push(delta);
      if (this.dprProbe.length >= QUALITY_PROBE_FRAMES) {
        const quality = decideQuality(this.dprProbe);
        updateSettings({ renderQuality: quality }); this.dprProbe = null;
        if (quality === 'low') this.setHint('This device struggles at high resolution: from the next start the game runs at standard resolution (change it on the title screen).');
      }
    }
    if (this.ctl.advance(delta)) return; // the round ended: onRoundEnd tore the live visuals down
    const sim = this.sim; if (!sim) return;
    if (this.hudDirty && now - this.lastHudAt >= GameScene.HUD_MS) {
      this.hudDirty = false; this.lastHudAt = now;
      this.panel.setHud(this.run, this.run.score + sim.earned, true);
    }
    const phase = this.ctl.tickPhase;
    this.beltFrame = (this.beltFrame + delta * this.speed * 0.012 * (BELT_FRAMES / 3)) % BELT_FRAMES; // same cycle time as the old 3 frames, finer steps
    const bf = `belt-${Math.floor(this.beltFrame)}`;
    for (const v of this.views.values()) {
      if (v.inBin) continue;
      if (prefs.reducedMotion) continue; // belts stay on frame 0, machines do not wobble
      if (v.belt) setArt(v.belt, bf);
      const cell = cellIndex(v.m.x, v.m.y, RULES.gridWidth);
      const held = sim.itemAt[cell];
      // state frames (0.4.4): a machine that holds an item shows it; idle machines are still so a jam stays visible
      if (v.m.kind === 'crusher') { const key = held && held.hold > 0 && sim.tick % 2 === 1 ? 'm-crusher-1' : 'm-crusher'; if (v.img.texture.key !== key) setArt(v.img, key); }
      else if (v.m.kind === 'furnace') { v.img.setTint(held && held.hold > 0 ? 0xffd9a0 : 0xffffff); }
      else if (v.m.kind === 'press') { const busy = held && held.hold > 0; const key = busy ? (held.hold >= 2 ? 'm-press-1' : 'm-press-2') : 'm-press'; if (v.img.texture.key !== key) setArt(v.img, key); v.img.setTint(!busy && (sim.pressStore[cell] ?? 0) > 0 ? 0xcfe3ff : 0xffffff); }
      else if (v.m.kind === 'hopper') { fit(v.img, sim.tick % RULES.hopperPeriod === 0 && phase < 0.3 ? 1.05 : 1); }
      else if (v.m.kind === 'splitter') { v.img.setAngle(v.m.dir * 90 + ((sim.splitterToggle[cell] ?? 0) === 0 ? -4 : 4)); }
    }
    // item positions
    const alive = this.aliveIds; alive.clear();
    for (const it of sim.items) {
      alive.add(it.id);
      let s = this.itemSprites.get(it.id);
      if (!s) { s = fit(this.add.image(0, 0, itemTexture(it.mat))).setDepth(4); this.itemSprites.set(it.id, s); }
      if (s.texture.key !== itemTexture(it.mat)) setArt(s, itemTexture(it.mat));
      const to = this.centerOfCell(it.cell);
      if (!prefs.reducedMotion && it.movedAt === sim.tick && it.from >= 0) {
        const from = this.centerOfCell(it.from);
        const e = Phaser.Math.Easing.Quadratic.InOut(phase);
        s.setPosition(from.x + (to.x - from.x) * e, from.y + (to.y - from.y) * e);
      } else s.setPosition(to.x, to.y);
      if (it.hold > 0) { fit(s, prefs.reducedMotion ? 0.85 : 0.8 + 0.1 * Math.sin(_time / 60)); } else fit(s);
    }
    for (const [id, s] of this.itemSprites) if (!alive.has(id)) { this.itemSprites.delete(id); if (prefs.reducedMotion) s.destroy(); else this.tweens.add({ targets: s, scale: 1.6, alpha: 0, duration: 200, onComplete: () => s.destroy() }); }
    this.panel.setProgress(sim.tick, sim.earned);
  }
  private centerOfCell(cell: number) { const x = cell % RULES.gridWidth, y = Math.floor(cell / RULES.gridWidth); return { x: GRID_X + x * CELL + CELL / 2, y: GRID_Y + y * CELL + CELL / 2 }; }
  private onTickEvents(evs: SimEvent[]) {
    const jammedNow = this.jammedNow; jammedNow.clear();
    const ships = this.shipsThisTick; ships.clear();
    const sounds = { ships: [] as number[], transforms: [] as number[], jams: 0 };
    for (const e of evs) {
      if (e.kind === 'ship' && e.value != null) {
        ships.set(e.cell, (ships.get(e.cell) ?? 0) + e.value);
        sounds.ships.push(e.value);
      } else if (e.kind === 'transform') {
        sounds.transforms.push(e.to === 'ingot' ? 3 : e.to === 'plate' ? 2 : e.to === 'shards' ? 1 : 0);
        if (prefs.reducedMotion) continue; // the item sprite itself changes texture; no flash
        const c = this.centerOfCell(e.cell);
        const flash = this.add.circle(c.x, c.y, 16, e.to === 'ingot' ? P.gold : e.to === 'slag' ? P.red : e.to === 'plate' ? P.plate : P.shards, 0.6).setDepth(3);
        this.tweens.add({ targets: flash, scale: 2, alpha: 0, duration: 300, onComplete: () => flash.destroy() });
      } else if (e.kind === 'absorb') {
        if (prefs.reducedMotion) continue;
        // a press swallowed a shard: shrink a shard marker into the machine
        const c = this.centerOfCell(e.cell);
        const spark = fit(this.add.image(c.x, c.y, itemTexture('shards'))).setDepth(4).setAlpha(0.9);
        this.tweens.add({ targets: spark, scale: 0.2 * baseScale(spark.texture.key), alpha: 0, duration: 220, onComplete: () => spark.destroy() });
      } else if (e.kind === 'jam') {
        jammedNow.add(e.cell);
        if (!this.jamMarks.has(e.cell)) {
          const { x, y } = this.centerOfCell(e.cell);
          const mk = fit(this.add.image(x - CELL / 2, y - CELL / 2, 'tile-bad')).setOrigin(0).setDepth(3).setAlpha(0.7);
          this.jamMarks.set(e.cell, mk); sounds.jams++;
        }
      }
    }
    for (const [cell, mk] of this.jamMarks) if (!jammedNow.has(cell)) { mk.destroy(); this.jamMarks.delete(cell); }
    // one pop per dock per tick (same-tick ships coalesce into their sum), drawn from the pool
    for (const [cell, value] of ships) {
      const c = this.centerOfCell(cell);
      this.popAt(c.x, c.y, value);
      const dockView = [...this.views.values()].find((v) => !v.inBin && cellIndex(v.m.x, v.m.y, RULES.gridWidth) === cell);
      if (dockView && !prefs.reducedMotion) this.tweens.add({ targets: dockView.img, scale: 1.08, duration: 60, yoyo: true });
    }
    if (ships.size && this.sim) {
      // money heartbeat: the running total ticks up as items ship (reduced motion: the text changes, nothing pulses)
      this.lastShipTick = this.sim.tick;
      this.hudDirty = true;
    }
    ships.clear();
    audio.tickSounds(sounds); // one call per tick: chord, capped transforms, throttled jam; reduced audio keeps one sound
    const live = this.sim; if (live) audio.humUpdate({ inFlight: live.items.length, jammed: jammedNow.size > 0, tick: live.tick, ticksPerRound: RULES.ticksPerRound });
    this.updateStall(jammedNow);
  }
  /** No item shipped for STALL_TICKS while something is jammed or a hopper is blocked: flag the first blocking cell. */
  private updateStall(jammedNow: Set<number>) {
    const sim = this.sim;
    if (!sim || jammedNow.size === 0 || sim.tick - this.lastShipTick < GameScene.STALL_TICKS) { if (this.stallCell != null) this.clearStall(); return; }
    let cell = Infinity; for (const c of jammedNow) if (c < cell) cell = c;
    if (cell === this.stallCell) return;
    this.stallCell = cell;
    const m = sim.grid[cell];
    const x = cell % RULES.gridWidth, y = Math.floor(cell / RULES.gridWidth);
    const what = m ? MACHINE_INFO[m.kind].name : 'Item';
    this.panel.setStall(`Stalled: ${what} at ${x + 1},${y + 1} ${m?.kind === 'hopper' ? 'is blocked' : 'is waiting'} — nothing shipped for ${GameScene.STALL_TICKS} ticks`);
    const { px, py } = this.cellXY(x, y);
    this.stallMark.setPosition(px, py).setAlpha(1).setVisible(true);
    audio.stall();
    this.tweens.killTweensOf(this.stallMark);
    if (!prefs.reducedMotion) this.tweens.add({ targets: this.stallMark, alpha: 0.35, duration: 450, yoyo: true, repeat: -1 });
  }
  private clearStall() { this.stallCell = null; this.panel?.setStall(''); if (this.stallMark) { this.tweens.killTweensOf(this.stallMark); this.stallMark.setVisible(false); } }
  /** Stall indicator state (dev API / tests): the HUD text and the flagged cell (null when none). */
  stallInfo() { return { text: this.panel?.stallText ?? '', cell: this.stallCell, tick: this.sim?.tick ?? -1 }; }
  /** Show "+$value" at a cell using a pooled Text; when all POP_POOL pops are busy the visual is skipped (the counter still ticks). */
  private popAt(x: number, y: number, value: number) {
    let txt = this.popPool.find((t) => !t.visible);
    if (!txt) {
      if (this.popPool.length >= GameScene.POP_POOL) { this.popsSkipped++; return; }
      txt = this.add.text(0, 0, '', { fontFamily: FONT, fontStyle: 'bold' }).setOrigin(0.5).setDepth(8).setVisible(false);
      this.popPool.push(txt);
    }
    txt.setText(`+$${value}`).setStyle({ fontSize: fpx(value >= 12 ? 20 : 15), color: value >= 12 ? CSS.gold : value >= 3 ? CSS.green : CSS.text }).setPosition(x, y - 10).setAlpha(1).setVisible(true);
    this.popsAlive++; this.popsPeak = Math.max(this.popsPeak, this.popsAlive);
    const done = () => { txt!.setVisible(false); this.popsAlive--; };
    if (prefs.reducedMotion) this.tweens.add({ targets: txt, alpha: 0, duration: 900, delay: 300, onComplete: done }); // fade in place, no travel
    else this.tweens.add({ targets: txt, y: y - 48, alpha: 0, duration: 700, onComplete: done });
  }
  /** Pop-pool counters (dev API / tests / perf): alive now, the peak so far, and ships whose pop was skipped because the pool was full. */
  popCounters() { return { popsAlive: this.popsAlive, popsPeak: this.popsPeak, popsSkipped: this.popsSkipped, poolSize: this.popPool.length, poolMax: GameScene.POP_POOL }; }

  // ---------- round summary / results ----------
  private showSummary() {
    const rec = this.run.rounds[this.run.rounds.length - 1];
    audio.roundEnd(rec.earned > 38);
    this.panel.showSummaryOverlay(this.run);
    this.renderSide();
    this.setHint(this.run.round >= RULES.rounds ? 'Final round complete. Badges show what each machine did.' : 'Badges show what each machine did. Study the waits, then draft and rearrange.');
  }
  nextRound() {
    if (this.mode !== 'summary') return;
    this.panel.clearGridLayer();
    this.ctl.nextRound(); // onNextRound / onFinished hooks redraw or hand over to the results screen
  }
}
