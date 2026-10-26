import Phaser from 'phaser';
import { apply, newRun, replay as replayRun, RunError, type Action, type RunState } from '../../sim/run';
import { createSim, step, cellIndex, type SimState } from '../../sim/sim';
import { MACHINE_INFO, RULES } from '../../sim/rules';
import type { Machine, Material, SimEvent } from '../../sim/types';
import { CELL, itemTexture, machineTexture } from '../textures';
import { Button, label, mono, panel } from '../ui';
import { CSS, FONT, P } from '../palette';
import { audio } from '../audio';
import { clearSave, isOnboarded, loadBests, setOnboarded, writeSave } from '../storage';
import { RULES_VERSION } from '../../sim/types';
import { BIN_Y, GRID_H, GRID_W, GRID_X, GRID_Y, H, SIDE_W, SIDE_X, W } from '../layout';
import { installDevApi } from '../devapi';
import { prefs, px as fpx } from '../prefs';

type Mode = 'build' | 'running' | 'paused' | 'summary';
interface MachineView { c: Phaser.GameObjects.Container; img: Phaser.GameObjects.Image; belt?: Phaser.GameObjects.Image; m: Machine; inBin: boolean }

export class GameScene extends Phaser.Scene {
  run!: RunState;
  mode: Mode = 'build';
  sim: SimState | null = null;
  private acc = 0;
  private lastFrame = 0;
  private tickMs = 170;
  private speed = 1;
  private beltFrame = 0;
  private views = new Map<number, MachineView>();
  private itemSprites = new Map<number, Phaser.GameObjects.Image>();
  private hover!: Phaser.GameObjects.Image;
  private selection!: Phaser.GameObjects.Image;
  private selectedId: number | null = null;
  private side!: Phaser.GameObjects.Container;
  private hud: Record<string, Phaser.GameObjects.Text> = {};
  private hint!: Phaser.GameObjects.Text;
  private hintBg!: Phaser.GameObjects.Rectangle;
  private overlay: Phaser.GameObjects.Container | null = null;
  private jamMarks = new Map<number, Phaser.GameObjects.Image>();
  private replayQueue: Action[] | null = null;
  private replayLabel: string | null = null;
  /** per-round earnings of the watched run (re-simulated at init), shown next to the live total */
  private replayRounds: number[] | null = null;
  private tutorial = false;
  private tutorialStep = 0;
  private dragging: MachineView | null = null;
  private dragFrom: { x: number; y: number } | null = null;
  private runBtn: Button | null = null;
  /** keyboard placement: grid cursor (null = hidden) and the machine currently held "in hand" */
  private cursor: { x: number; y: number } | null = null;
  private cursorImg!: Phaser.GameObjects.Image;
  private heldId: number | null = null;
  /** shown once in the hint strip when a save could not be resumed */
  private resumeNotice: string | null = null;
  /** reused per frame / per tick to avoid allocating sets in the hot path */
  private readonly aliveIds = new Set<number>();
  private readonly jammedNow = new Set<number>();

  constructor() { super('Game'); }

  init(data: { seed: string; fresh: boolean; replay?: Action[]; actions?: Action[]; replayLabel?: string }) {
    this.replayLabel = data.replay ? data.replayLabel ?? 'replay playback' : null;
    this.replayRounds = null;
    if (data.replay) { try { this.replayRounds = replayRun(data.seed, data.replay, RULES_VERSION).rounds.map((r) => r.earned); } catch { this.replayRounds = null; } }
    this.run = newRun(data.seed);
    this.resumeNotice = null;
    if (!data.fresh && data.actions) {
      try { this.run = replayRun(data.seed, data.actions, RULES_VERSION); }
      catch (e) {
        // a damaged save must not silently start over: say so, and drop it so the title stops offering it
        this.run = newRun(data.seed); clearSave();
        this.resumeNotice = `Saved run could not be resumed (${(e as Error).message}); starting this seed fresh.`;
      }
    }
    this.replayQueue = data.replay ? data.replay.slice() : null;
    this.tutorial = !isOnboarded() && !this.replayQueue;
    this.tutorialStep = 0;
    this.mode = 'build';
    this.sim = null;
    this.views.clear(); this.itemSprites.clear(); this.jamMarks.clear();
    this.selectedId = null; this.overlay = null; this.dragging = null;
    this.cursor = null; this.heldId = null;
  }

  create() {
    this.cameras.main.setBackgroundColor(P.bg);
    this.input.mouse?.disableContextMenu();
    this.buildStatic();
    this.buildHud();
    this.hover = this.add.image(0, 0, 'tile-ok').setOrigin(0).setVisible(false).setDepth(5);
    this.selection = this.add.image(0, 0, 'tile-sel').setOrigin(0).setVisible(false).setDepth(6);
    this.cursorImg = this.add.image(0, 0, 'tile-cursor').setOrigin(0).setVisible(false).setDepth(6);
    this.side = this.add.container(SIDE_X, GRID_Y);
    this.syncMachines();
    this.renderSide();
    this.setupInput();
    this.hintBg = this.add.rectangle(GRID_X, H - 62, GRID_W, 50, P.panel, 0.95).setOrigin(0).setStrokeStyle(1, P.panelLine);
    this.hint = label(this, GRID_X + 12, H - 56, '', 13, CSS.text, { wordWrap: { width: GRID_W - 24 } });
    this.updateHint();
    if (this.replayLabel) this.buildReplayBanner();
    installDevApi(this);
    this.events.on('shutdown', () => { this.views.clear(); this.itemSprites.clear(); });
    if (this.replayQueue) this.time.delayedCall(600, () => this.advanceReplay());
    if (this.run.phase === 'result') this.showSummary();
  }

  // ---------- static scenery ----------
  private buildStatic() {
    for (let y = 0; y < RULES.gridHeight; y++) for (let x = 0; x < RULES.gridWidth; x++) this.add.image(GRID_X + x * CELL, GRID_Y + y * CELL, 'tile').setOrigin(0);
    this.add.rectangle(GRID_X, GRID_Y, GRID_W, GRID_H).setOrigin(0).setStrokeStyle(2, P.panelLine);
    panel(this, GRID_X, BIN_Y, GRID_W, 100, 0.9);
    label(this, GRID_X + 10, BIN_Y + 6, 'PARTS BIN  — drag parts onto the grid, or arrow keys + Enter', 12, CSS.amber, { fontStyle: 'bold', letterSpacing: 1 });
    panel(this, SIDE_X, GRID_Y, SIDE_W, H - GRID_Y - 24, 0.95);
  }
  private buildHud() {
    this.add.rectangle(0, 0, W, 56, P.panel).setOrigin(0).setStrokeStyle(1, P.panelLine);
    const title = label(this, 24, 14, 'JUNKYARD DRAFT', 20, CSS.amber, { fontStyle: 'bold', letterSpacing: 3 });
    // positions follow measured widths so larger text sizes and long seeds never overlap
    // the seed label is the flexible element: long seeds are shortened with an ellipsis (the full seed is on the title and
    // results screens) so round, score and local-best never leave the canvas at any text size
    const suffix = this.replayLabel ? ` · ${this.replayLabel}` : '';
    let seedText = this.run.seed;
    this.hud.seed = mono(this, title.x + title.width + 18, 20, `seed ${seedText}${suffix}`, 12, this.replayLabel ? CSS.blue : CSS.dim).setName('hud-seed');
    const fitSeed = (maxW: number) => { while (this.hud.seed.width > maxW && seedText.length > 6) { seedText = seedText.slice(0, Math.max(4, seedText.length - 3)) + '…'; this.hud.seed.setText(`seed ${seedText}${suffix}`); } };
    fitSeed(Math.max(80, 470 - 28 - this.hud.seed.x + (this.replayLabel ? 190 : 0)));
    let roundX = Math.max(470, this.hud.seed.x + this.hud.seed.width + 28);
    this.hud.round = label(this, roundX, 10, `Round ${RULES.rounds} / ${RULES.rounds}`, 16, CSS.text, { fontStyle: 'bold' });
    let scoreX = Math.max(640, this.hud.round.x + this.hud.round.width + 40);
    const scoreRoom = W - 340; // the score block ("$1234" + "local best for this seed: $1234") must end before the Title button
    if (scoreX > scoreRoom) {
      fitSeed(Math.max(60, this.hud.seed.width - (scoreX - scoreRoom)));
      roundX = Math.max(470, this.hud.seed.x + this.hud.seed.width + 28); this.hud.round.setX(roundX);
      scoreX = Math.min(scoreRoom, Math.max(640, this.hud.round.x + this.hud.round.width + 40));
    }
    this.hud.score = label(this, scoreX, 10, '', 16, CSS.gold, { fontStyle: 'bold' });
    this.hud.best = mono(this, scoreX, 34, '', 11, CSS.dim);
    const mute = new Button(this, W - 60, 28, audio.muted ? 'Unmute' : 'Mute', () => { audio.setMuted(!audio.muted); mute.setText(audio.muted ? 'Unmute' : 'Mute'); }, { w: 80, h: 28, color: P.steelDark, textColor: CSS.text, size: 12, name: 'mute' });
    new Button(this, W - 160, 28, 'Title', () => this.scene.start('Title'), { w: 70, h: 28, color: P.steelDark, textColor: CSS.text, size: 12, name: 'title' });
    this.updateHud();
  }
  /** Watching a verified replay: a marker in the HUD; Esc stops (see setupInput), speed/skip/stop live in the running panel. */
  private buildReplayBanner() {
    // right end of the side panel's header row: that area is free in every phase (headers are left-aligned)
    const c = this.add.container(SIDE_X + SIDE_W - 92, GRID_Y + 21).setDepth(9).setName('replay-banner');
    c.add(this.add.rectangle(0, 0, 150, 26, P.blue, 0.18).setStrokeStyle(1, P.blue, 0.9));
    c.add(this.add.circle(-60, 0, 4, P.blue));
    c.add(this.add.text(-50, 0, 'REPLAY · Esc stops', { fontFamily: FONT, fontSize: fpx(11), color: CSS.blue, fontStyle: 'bold', letterSpacing: 1 }).setOrigin(0, 0.5));
  }
  /** Leave a watched replay at any point: nothing was recorded, nothing to save. */
  stopReplay() {
    if (!this.replayLabel) return;
    this.replayQueue = null; this.sim = null; audio.resume();
    this.scene.start('Title');
  }
  private updateHud() {
    this.hud.round.setText(`Round ${this.run.round} / ${RULES.rounds}`);
    this.hud.score.setText(`$${this.run.score}`);
    const b = loadBests().bySeed[this.run.seed];
    this.hud.best.setText(b ? `local best for this seed: $${b.score}` : 'no local best for this seed yet');
  }

  // ---------- machine views ----------
  private cellXY(x: number, y: number) { return { px: GRID_X + x * CELL, py: GRID_Y + y * CELL }; }
  private binSlot(i: number) { return { px: GRID_X + 12 + i * (CELL + 8), py: BIN_Y + 28 }; }

  private makeView(m: Machine): MachineView {
    const c = this.add.container(0, 0).setDepth(2);
    const img = this.add.image(CELL / 2, CELL / 2, machineTexture(m.kind));
    c.add(img);
    let belt: Phaser.GameObjects.Image | undefined;
    if (m.kind === 'conveyor') { belt = this.add.image(CELL / 2, CELL / 2, 'belt-0'); c.add(belt); }
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
      const x = Math.floor((p.x - GRID_X) / CELL), y = Math.floor((p.y - GRID_Y) / CELL);
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
        this.hover.setTexture(occ ? 'tile-bad' : 'tile-ok').setPosition(px, py).setVisible(true);
      } else this.hover.setVisible(false);
    });
    this.input.on('dragend', (p: Phaser.Input.Pointer, obj: Phaser.GameObjects.Image) => {
      const v = this.dragging; if (!v || obj !== v.img) return;
      if (this.mode !== 'build') { this.cancelDrag(); return; } // drop after the round started: no edit, snap back
      this.dragging = null; this.hover.setVisible(false); v.c.setDepth(2);
      const cell = toCell(p);
      const inBinArea = p.y >= BIN_Y && p.y <= BIN_Y + 110 && p.x >= GRID_X && p.x <= GRID_X + GRID_W;
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
    kb?.on('keydown-SPACE', () => { if (this.mode === 'build' && this.run.phase === 'build') this.startRun(); else if (this.mode === 'summary') this.nextRound(); });
    kb?.on('keydown-ESC', () => { if (this.replayLabel) this.stopReplay(); else if (this.mode === 'running') this.setPaused(true); else if (this.mode === 'paused') this.setPaused(false); else this.keyEscape(); });
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
    this.dragging = null; this.dragFrom = null; this.hover.setVisible(false); v.c.setDepth(2);
    this.syncMachines();
  }
  /** Layout edits are only legal while building; once a round starts the authoritative layout is frozen. */
  private static readonly LAYOUT_EDITS = new Set(['place', 'unplace', 'rotate', 'sell', 'pick']);
  private flashBad(x: number, y: number) {
    const { px, py } = this.cellXY(x, y);
    const f = this.add.image(px, py, 'tile-bad').setOrigin(0).setDepth(7);
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
    if (!this.cursor || this.mode !== 'build') { this.cursorImg.setVisible(false); if (!this.dragging) this.hover.setVisible(false); return; }
    const { px, py } = this.cellXY(this.cursor.x, this.cursor.y);
    this.cursorImg.setPosition(px, py).setVisible(true);
    if (this.heldId != null) {
      const occ = this.occupantAt(this.cursor.x, this.cursor.y);
      this.hover.setTexture(occ && occ.id !== this.heldId ? 'tile-bad' : 'tile-ok').setPosition(px, py).setVisible(true);
    } else if (!this.dragging) this.hover.setVisible(false);
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
      else if (occupant) { audio.invalid(); this.flashBad(x, y); return; }
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

  /** Apply an action to the run; returns false (and keeps state) if the rules reject it. */
  act(a: Action): boolean {
    if (GameScene.LAYOUT_EDITS.has(a.t) && this.mode !== 'build') return false; // frozen: a drop, key or dev-API call during a run changes nothing
    try { apply(this.run, a); } catch (e) { if (e instanceof RunError) return false; throw e; }
    if (!this.replayLabel) writeSave(this.run.seed, this.run.actions); // playback is never saved: it is someone else's run
    this.updateHud();
    if (a.t === 'place' || a.t === 'pick' || a.t === 'rotate') this.updateHint();
    if (a.t !== 'rotate') this.renderSide();
    return true;
  }
  pick(i: number) {
    if (this.run.phase !== 'draft') return;
    if (this.act({ t: 'pick', i })) { audio.place(); this.selectedId = this.run.bin[this.run.bin.length - 1]?.id ?? null; this.syncMachines(); this.renderSide(); }
  }

  // ---------- side panel ----------
  renderSide() {
    this.side.removeAll(true);
    this.runBtn = null;
    const add = (o: Phaser.GameObjects.GameObject) => { this.side.add(o); return o; };
    const t = (x: number, y: number, s: string, size = 14, color = CSS.text, style: Partial<Phaser.Types.GameObjects.Text.TextStyle> = {}) => add(this.add.text(x, y, s, { fontFamily: FONT, fontSize: fpx(size), color, wordWrap: { width: SIDE_W - 32 }, ...style })) as Phaser.GameObjects.Text;
    const r = this.run;
    if (this.mode === 'running' || this.mode === 'paused') {
      t(16, 12, this.mode === 'paused' ? 'PAUSED' : 'RUNNING', 13, CSS.amber, { fontStyle: 'bold', letterSpacing: 2 });
      t(16, 36, `Round ${r.round}: watch the line. Items flow every tick; jams glow red.`, 14, CSS.dim);
      const prog = add(this.add.rectangle(16, 84, SIDE_W - 32, 10, P.panelLine).setOrigin(0)) as Phaser.GameObjects.Rectangle; void prog;
      const fill = add(this.add.rectangle(16, 84, 1, 10, P.amber).setOrigin(0)) as Phaser.GameObjects.Rectangle; fill.setName('progress');
      const earned = t(16, 104, 'Earned this round: $0', 18, CSS.gold, { fontStyle: 'bold' }); earned.setName('earned');
      if (this.replayRounds) {
        const idx = r.round - 1; const orig = this.replayRounds[idx] ?? 0; const total = this.replayRounds.slice(0, idx + 1).reduce((a, b) => a + b, 0);
        t(16, 126, `Original run: $${orig} this round · $${total} after round ${r.round} · $${this.replayRounds.reduce((a, b) => a + b, 0)} final`, 11, CSS.blue).setName('replay-original');
      }
      t(16, 140, 'Speed', 12, CSS.dim);
      [1, 2, 4].forEach((s, i) => add(new Button(this, 90 + i * 70, 148, `${s}×`, () => { this.speed = s; this.renderSide(); }, { w: 60, h: 28, color: this.speed === s ? P.amber : P.steelDark, textColor: this.speed === s ? '#1a1612' : CSS.text, size: 13, name: `speed-${s}` })));
      add(new Button(this, SIDE_W / 2, 200, this.mode === 'paused' ? 'Resume' : this.replayLabel ? 'Pause' : 'Pause (Esc)', () => this.setPaused(this.mode !== 'paused'), { w: 200, h: 36, color: P.steelDark, textColor: CSS.text, size: 14, name: 'pause' }));
      add(new Button(this, SIDE_W / 2, 246, 'Skip to result', () => this.finishRun(), { w: 200, h: 32, color: P.steelDark, textColor: CSS.text, size: 13, name: 'skip' }));
      if (this.replayLabel) {
        add(new Button(this, SIDE_W / 2, 290, 'Stop watching (Esc)', () => this.stopReplay(), { w: 200, h: 32, color: P.steelDark, textColor: CSS.text, size: 13, name: 'stop' }));
        t(16, 316, this.replayLabel, 12, CSS.blue).setWordWrapWidth(SIDE_W - 32);
      }
      this.side.add(this.legend(16, this.replayLabel ? 350 : 300));
      return;
    }
    if (r.phase === 'draft') {
      t(16, 12, `ROUND ${r.round} DRAFT — pick one part`, 13, CSS.amber, { fontStyle: 'bold', letterSpacing: 2 });
      r.offers.forEach((kind, i) => {
        const y = 44 + i * 112;
        const card = add(this.add.rectangle(16, y, SIDE_W - 32, 100, P.floor).setOrigin(0).setStrokeStyle(2, P.panelLine).setInteractive({ useHandCursor: true })) as Phaser.GameObjects.Rectangle;
        card.setName(`offer-${i}`);
        card.on('pointerover', () => card.setStrokeStyle(2, P.amber)); card.on('pointerout', () => card.setStrokeStyle(2, P.panelLine));
        card.on('pointerdown', () => { if (!this.replayQueue) this.pick(i); });
        add(this.add.image(16 + 50, y + 50, machineTexture(kind)).setScale(1.05));
        t(112, y + 10, MACHINE_INFO[kind].name, 17, CSS.text, { fontStyle: 'bold' });
        const b = t(112, y + 34, MACHINE_INFO[kind].blurb, 13, CSS.dim); b.setWordWrapWidth(SIDE_W - 150);
        add(this.add.text(SIDE_W - 60, y + 76, `[${i + 1}]`, { fontFamily: FONT, fontSize: fpx(12), color: CSS.dim }));
      });
      this.side.add(this.legend(16, 390));
      return;
    }
    if (r.phase === 'build') {
      t(16, 12, `ROUND ${r.round} — ARRANGE THE WORKSHOP`, 13, CSS.amber, { fontStyle: 'bold', letterSpacing: 2 });
      const sel = this.selectedId != null ? this.run.layout.machines.find((m) => m.id === this.selectedId) || this.run.bin.find((m) => m.id === this.selectedId) : undefined;
      if (sel) {
        add(this.add.rectangle(16, 40, SIDE_W - 32, 118, P.floor).setOrigin(0).setStrokeStyle(1, P.panelLine));
        add(this.add.image(16 + 44, 40 + 44, machineTexture(sel.kind)).setAngle(sel.dir * 90).setScale(0.9));
        t(104, 48, MACHINE_INFO[sel.kind].name, 17, CSS.text, { fontStyle: 'bold' });
        t(104, 72, MACHINE_INFO[sel.kind].blurb, 12.5, CSS.dim).setWordWrapWidth(SIDE_W - 130);
        add(new Button(this, 70, 128, 'Rotate (R)', () => this.rotateSelected(), { w: 100, h: 28, color: P.steelDark, textColor: CSS.text, size: 12, name: 'rotate' }));
        if (sel.x >= 0) add(new Button(this, 190, 128, 'To bin (Del)', () => { this.act({ t: 'unplace', id: sel.id }); this.syncMachines(); }, { w: 110, h: 28, color: P.steelDark, textColor: CSS.text, size: 12, name: 'tobin' }));
        else add(new Button(this, 200, 128, `Sell for $${RULES.sellValue}`, () => { if (this.act({ t: 'sell', id: sel.id })) { audio.ship(RULES.sellValue); this.selectedId = null; this.syncMachines(); this.renderSide(); } }, { w: 120, h: 28, color: P.steelDark, textColor: CSS.text, size: 12, name: 'sell' }));
      } else {
        t(16, 44, 'Drag a part from the bin onto the grid. Click a placed machine to select it; R or right-click rotates it. Drop a machine on the bin to remove it.\n\nKeyboard: arrow keys move the cursor · Enter places the next bin part, or picks up / drops a machine · Tab cycles bin parts · R rotates · Delete sends it to the bin.', 14, CSS.dim);
      }
      const placedCount = r.layout.machines.length;
      t(16, 176, `${placedCount} machines placed · ${r.bin.length} in bin`, 12, CSS.dim);
      this.runBtn = add(new Button(this, SIDE_W / 2, 230, `RUN ROUND ${r.round}  (Space)`, () => this.startRun(), { w: SIDE_W - 48, h: 52, size: 18, name: 'run' })) as Button;
      let legendY = 300;
      if (r.bin.length > 0) { const note = t(16, 262, `Parts left in the bin do nothing this round. Select one to sell it for $${RULES.sellValue}.`, 12, CSS.dim); legendY = Math.max(300, note.y + note.height + 14); }
      this.side.add(this.legend(16, legendY));
      return;
    }
  }
  private legend(x: number, y: number) {
    const c = this.add.container(x, y);
    c.add(this.add.text(0, 0, 'VALUES', { fontFamily: FONT, fontSize: fpx(12), color: CSS.amber, fontStyle: 'bold' }));
    const mats: Material[] = ['scrap', 'shards', 'plate', 'ingot', 'slag'];
    const notes: Record<Material, string> = { scrap: 'raw, from the hopper', shards: 'scrap through a crusher', plate: `${RULES.pressShards} shards through a press`, ingot: 'shards through a furnace', slag: 'raw scrap in a furnace' };
    mats.forEach((m, i) => {
      c.add(this.add.image(12, 28 + i * 26, itemTexture(m)).setScale(0.9));
      c.add(this.add.text(30, 19 + i * 26, `${m.charAt(0).toUpperCase() + m.slice(1)}  $${RULES.value[m]}`, { fontFamily: FONT, fontSize: fpx(13), color: CSS.text }));
      c.add(this.add.text(140, 20 + i * 26, notes[m], { fontFamily: FONT, fontSize: fpx(12), color: CSS.dim }));
    });
    c.add(this.add.text(0, 162, `Hopper: 1 scrap / ${RULES.hopperPeriod} ticks · Crusher ${RULES.process.crusher} · Press ${RULES.process.press} · Furnace ${RULES.process.furnace} ticks · Round ${RULES.ticksPerRound} ticks`, { fontFamily: FONT, fontSize: fpx(11), color: CSS.dim, wordWrap: { width: SIDE_W - 40 } }));
    return c;
  }

  // ---------- onboarding hints ----------
  updateHint() {
    const r = this.run;
    let text = '';
    if (this.tutorial) {
      if (r.round === 1 && r.phase === 'draft') text = 'Welcome! The hopper drops $1 scrap onto a belt that reaches the dock. Pick the CRUSHER (click it or press its number): it turns scrap into $3 shards.';
      else if (r.round === 1 && r.phase === 'build' && r.bin.length) text = 'Drag the crusher from the bin onto the belt, e.g. replace the conveyor right after the hopper. Its arrow must point along the line (R rotates).';
      else if (r.round === 1 && r.phase === 'build') text = this.chainHasCrusher() ? 'Good: scrap now reaches the crusher from behind. Press RUN and watch the shards sell for $3 each.' : 'The crusher only takes items from behind: line it up so the hopper feeds its back and its arrow points on toward the dock.';
      else if (r.round === 2 && r.phase === 'draft') text = `Next upgrade: a FURNACE turns shards into $${RULES.value.ingot} ingots (raw scrap only melts into $${RULES.value.slag} slag). Splitters and extra hoppers raise throughput.`;
      else if (r.round === 2) text = 'Machines are slow: a furnace handles one item every 3 ticks. Use a splitter to feed two furnaces, or add a second line.';
      else text = '';
      if (r.round >= 3) { this.tutorial = false; setOnboarded(); }
    }
    if (this.resumeNotice) { text = this.resumeNotice; this.resumeNotice = null; }
    if (!text) {
      const tips = ['Scrap $1 → crusher → shards $3 → furnace → ingot $12.', 'Conveyors accept from behind or the side; crushers, furnaces and splitters only from behind.', 'A splitter alternates left and right. Two furnaces beat one.', 'Docks take items from any side. A second hopper doubles raw supply.', 'Right-click or R rotates. Drop a machine on the bin to remove it.', `A press squeezes ${RULES.pressShards} shards into one $${RULES.value.plate} plate: less than a furnace, but it never backs a line up.`, 'Keyboard: arrows move the cursor, Enter places or picks up, Tab cycles bin parts.'];
      text = tips[(r.round + r.layout.machines.length) % tips.length];
    }
    this.setHint(text);
  }
  /** Current hint text (typed accessor for the dev API and tests instead of private-field access). */
  hintText(): string { return this.hint?.text ?? ''; }
  /** Hint box grows with wrapped text (larger text sizes) and stays anchored to the bottom edge. */
  private setHint(text: string) {
    this.hint.setText(text).setWordWrapWidth(GRID_W - 24);
    const h = Math.max(50, this.hint.height + 14);
    this.hintBg.setSize(GRID_W, h).setPosition(GRID_X, H - 12 - h);
    this.hint.setPosition(GRID_X + 12, H - 12 - h + 7);
  }
  private chainHasCrusher() {
    return this.run.layout.machines.some((m) => m.kind === 'crusher');
  }

  // ---------- simulation playback ----------
  startRun() {
    if (this.mode !== 'build' || this.run.phase !== 'build') return;
    this.cancelDrag(); // a machine still under the pointer snaps back; nothing can change the layout from here on
    this.selectedId = null; this.heldId = null; this.cursor = null; this.updateSelection(); this.updateCursor(); this.hover.setVisible(false);
    const layout = { width: this.run.layout.width, height: this.run.layout.height, machines: this.run.layout.machines.map((m) => ({ ...m })) };
    this.sim = createSim(layout);
    this.acc = 0; this.mode = 'running';
    audio.run();
    this.renderSide();
    this.setHint(this.replayLabel ? 'Watching a verified replay: 1/2/4× change the speed, Skip jumps to the round result, Esc stops and returns to the title.' : 'Running… Jams glow red: an item waits for a free cell or a slow machine.');
  }
  setPaused(p: boolean) {
    if (p && this.mode === 'running') { this.mode = 'paused'; audio.suspend(); this.renderSide(); this.showPauseOverlay(); }
    else if (!p && this.mode === 'paused') { this.mode = 'running'; audio.resume(); this.overlay?.destroy(); this.overlay = null; this.renderSide(); }
  }
  private showPauseOverlay() {
    this.overlay?.destroy();
    const c = this.add.container(0, 0).setDepth(20);
    c.add(this.add.rectangle(GRID_X, GRID_Y, GRID_W, GRID_H, 0x000000, 0.55).setOrigin(0));
    c.add(this.add.text(GRID_X + GRID_W / 2, GRID_Y + GRID_H / 2, 'PAUSED\nEsc to resume', { fontFamily: FONT, fontSize: fpx(28), color: CSS.text, align: 'center', fontStyle: 'bold' }).setOrigin(0.5));
    this.overlay = c;
  }
  /** Complete the round instantly (authoritative result comes from the run orchestrator). */
  finishRun() {
    if (this.mode !== 'running' && this.mode !== 'paused') return;
    audio.resume();
    while (this.sim && this.sim.tick < RULES.ticksPerRound) step(this.sim);
    this.endRun();
  }
  private endRun() {
    const visual = this.sim?.earned ?? 0;
    this.act({ t: 'run' });
    const rec = this.run.rounds[this.run.rounds.length - 1];
    if (import.meta.env.DEV && rec.earned !== visual) console.error(`DETERMINISM MISMATCH: visual ${visual} vs authoritative ${rec.earned}`);
    for (const s of this.itemSprites.values()) s.destroy();
    this.itemSprites.clear();
    for (const j of this.jamMarks.values()) j.destroy();
    this.jamMarks.clear();
    this.sim = null;
    for (const v of this.views.values()) { v.img.setScale(1).setTint(0xffffff).setAngle(v.m.dir * 90); }
    this.showSummary();
  }

  override update(_time: number, _delta: number) {
    if (this.mode !== 'running' || !this.sim) { this.lastFrame = 0; return; }
    // Wall-clock pacing (Phaser's smoothed delta under-reports when the browser throttles frames).
    const now = performance.now();
    const delta = this.lastFrame ? Math.min(250, now - this.lastFrame) : 16;
    this.lastFrame = now;
    this.acc += delta * this.speed;
    let guard = 0;
    while (this.acc >= this.tickMs && guard++ < 10) {
      this.acc -= this.tickMs;
      const evs = step(this.sim);
      this.onTickEvents(evs);
      if (this.sim.tick >= RULES.ticksPerRound) { this.endRun(); return; }
    }
    const phase = Math.min(1, this.acc / this.tickMs);
    this.beltFrame = (this.beltFrame + delta * this.speed * 0.012) % 3;
    const bf = `belt-${Math.floor(this.beltFrame)}`;
    for (const v of this.views.values()) {
      if (v.inBin) continue;
      if (prefs.reducedMotion) continue; // belts stay on frame 0, machines do not wobble
      if (v.belt) v.belt.setTexture(bf);
      const cell = cellIndex(v.m.x, v.m.y, RULES.gridWidth);
      const held = this.sim.itemAt[cell];
      if (v.m.kind === 'crusher') { v.img.setScale(held && held.hold > 0 ? 1 + 0.06 * Math.abs(Math.sin(_time / 45)) : 1); v.img.setAngle(v.m.dir * 90 + (held && held.hold > 0 ? Math.sin(_time / 30) * 2 : 0)); }
      else if (v.m.kind === 'furnace') { v.img.setTint(held && held.hold > 0 ? 0xffd9a0 : 0xffffff); v.img.setScale(held && held.hold > 0 ? 1 + 0.04 * Math.abs(Math.sin(_time / 90)) : 1); }
      else if (v.m.kind === 'press') { const busy = held && held.hold > 0; v.img.setScale(1, busy ? 0.9 + 0.08 * Math.abs(Math.sin(_time / 40)) : 1); v.img.setTint(!busy && (this.sim.pressStore[cell] ?? 0) > 0 ? 0xcfe3ff : 0xffffff); }
      else if (v.m.kind === 'hopper') { v.img.setScale(this.sim.tick % RULES.hopperPeriod === 0 && phase < 0.3 ? 1.05 : 1); }
      else if (v.m.kind === 'splitter') { v.img.setAngle(v.m.dir * 90 + ((this.sim.splitterToggle[cell] ?? 0) === 0 ? -4 : 4)); }
    }
    // item positions
    const alive = this.aliveIds; alive.clear();
    for (const it of this.sim.items) {
      alive.add(it.id);
      let s = this.itemSprites.get(it.id);
      if (!s) { s = this.add.image(0, 0, itemTexture(it.mat)).setDepth(4); this.itemSprites.set(it.id, s); }
      if (s.texture.key !== itemTexture(it.mat)) s.setTexture(itemTexture(it.mat));
      const to = this.centerOfCell(it.cell);
      if (!prefs.reducedMotion && it.movedAt === this.sim.tick && it.from >= 0) {
        const from = this.centerOfCell(it.from);
        const e = Phaser.Math.Easing.Quadratic.InOut(phase);
        s.setPosition(from.x + (to.x - from.x) * e, from.y + (to.y - from.y) * e);
      } else s.setPosition(to.x, to.y);
      if (it.hold > 0) { s.setScale(prefs.reducedMotion ? 0.85 : 0.8 + 0.1 * Math.sin(_time / 60)); } else s.setScale(1);
    }
    for (const [id, s] of this.itemSprites) if (!alive.has(id)) { this.itemSprites.delete(id); if (prefs.reducedMotion) s.destroy(); else this.tweens.add({ targets: s, scale: 1.6, alpha: 0, duration: 200, onComplete: () => s.destroy() }); }
    const fill = this.side.getByName('progress') as Phaser.GameObjects.Rectangle | null;
    if (fill) fill.width = (SIDE_W - 32) * (this.sim.tick / RULES.ticksPerRound);
    const earned = this.side.getByName('earned') as Phaser.GameObjects.Text | null;
    if (earned) earned.setText(`Earned this round: $${this.sim.earned}`);
  }
  private centerOfCell(cell: number) { const x = cell % RULES.gridWidth, y = Math.floor(cell / RULES.gridWidth); return { x: GRID_X + x * CELL + CELL / 2, y: GRID_Y + y * CELL + CELL / 2 }; }
  private onTickEvents(evs: SimEvent[]) {
    const jammedNow = this.jammedNow; jammedNow.clear();
    for (const e of evs) {
      if (e.kind === 'ship' && e.value != null) {
        const c = this.centerOfCell(e.cell);
        const txt = this.add.text(c.x, c.y - 10, `+$${e.value}`, { fontFamily: FONT, fontSize: fpx(e.value >= 12 ? 20 : 15), color: e.value >= 12 ? CSS.gold : e.value >= 3 ? CSS.green : CSS.text, fontStyle: 'bold' }).setOrigin(0.5).setDepth(8);
        if (prefs.reducedMotion) this.tweens.add({ targets: txt, alpha: 0, duration: 900, delay: 300, onComplete: () => txt.destroy() }); // fade in place, no travel
        else this.tweens.add({ targets: txt, y: c.y - 48, alpha: 0, duration: 700, onComplete: () => txt.destroy() });
        audio.ship(e.value);
        const dockView = [...this.views.values()].find((v) => !v.inBin && cellIndex(v.m.x, v.m.y, RULES.gridWidth) === e.cell);
        if (dockView && !prefs.reducedMotion) this.tweens.add({ targets: dockView.img, scale: 1.08, duration: 60, yoyo: true });
      } else if (e.kind === 'transform') {
        audio.transform();
        if (prefs.reducedMotion) continue; // the item sprite itself changes texture; no flash
        const c = this.centerOfCell(e.cell);
        const flash = this.add.circle(c.x, c.y, 16, e.to === 'ingot' ? P.gold : e.to === 'slag' ? P.red : e.to === 'plate' ? P.plate : P.shards, 0.6).setDepth(3);
        this.tweens.add({ targets: flash, scale: 2, alpha: 0, duration: 300, onComplete: () => flash.destroy() });
      } else if (e.kind === 'absorb') {
        if (prefs.reducedMotion) continue;
        // a press swallowed a shard: shrink a shard marker into the machine
        const c = this.centerOfCell(e.cell);
        const spark = this.add.image(c.x, c.y, itemTexture('shards')).setDepth(4).setAlpha(0.9);
        this.tweens.add({ targets: spark, scale: 0.2, alpha: 0, duration: 220, onComplete: () => spark.destroy() });
      } else if (e.kind === 'jam') {
        jammedNow.add(e.cell);
        if (!this.jamMarks.has(e.cell)) {
          const { x, y } = this.centerOfCell(e.cell);
          const mk = this.add.image(x - CELL / 2, y - CELL / 2, 'tile-bad').setOrigin(0).setDepth(3).setAlpha(0.7);
          this.jamMarks.set(e.cell, mk); audio.jam();
        }
      }
    }
    for (const [cell, mk] of this.jamMarks) if (!jammedNow.has(cell)) { mk.destroy(); this.jamMarks.delete(cell); }
  }

  // ---------- round summary / results ----------
  private showSummary() {
    this.mode = 'summary';
    const rec = this.run.rounds[this.run.rounds.length - 1];
    const res = rec.result;
    audio.roundEnd(rec.earned > 38);
    this.overlay?.destroy();
    const c = this.add.container(0, 0).setDepth(20);
    c.add(this.add.rectangle(GRID_X, GRID_Y, GRID_W, GRID_H, 0x000000, 0.25).setOrigin(0));
    // per-machine badges on the grid: what each machine actually did
    const g = this.run.layout;
    const notes: string[] = [];
    for (const m of g.machines) {
      const st = res.cellStats[cellIndex(m.x, m.y, g.width)];
      const { px, py } = this.cellXY(m.x, m.y);
      let line1 = ''; let line2 = ''; let color = CSS.text; let warn = true;
      if (m.kind === 'hopper') { line1 = st ? `${st.spawned} out` : 'idle'; if (st && st.blockedTicks > 5) { line2 = `blocked ${st.blockedTicks}`; notes.push(`Hopper ${m.x + 1},${m.y + 1} blocked ${st.blockedTicks} ticks: line ahead full or facing wrong.`); } if (!st) { color = CSS.dim; notes.push(`Hopper ${m.x + 1},${m.y + 1} never emitted: nothing accepts items ahead of it.`); } }
      else if (m.kind === 'dock') { if (st && st.shipped) { line1 = `$${st.earned}`; line2 = `${st.shipped} shipped`; color = CSS.green; warn = false; } else { line1 = 'no items'; color = CSS.dim; } }
      else if (m.kind === 'crusher' || m.kind === 'furnace' || m.kind === 'press') {
        line1 = st && st.passed ? `${st.processed} made` : 'unused'; if (!st || !st.processed) color = CSS.dim;
        if (st && st.jammedTicks > 8) { line2 = `waited ${st.jammedTicks}`; notes.push(`${MACHINE_INFO[m.kind].name} ${m.x + 1},${m.y + 1}: output blocked ${st.jammedTicks} ticks.`); }
        else if (m.kind === 'press' && st && st.stored) { line2 = `${st.stored} shard held`; warn = false; }
      }
      else { if (st && st.jammedTicks > 8) line2 = `waited ${st.jammedTicks}`; else if (!st || !st.passed) { line1 = 'unused'; color = CSS.dim; } }
      if (!line1 && !line2) continue;
      const lines = [line1, line2].filter(Boolean);
      const bg = this.add.rectangle(px + CELL / 2, py + CELL - 2, CELL - 6, 12 * lines.length + 4, 0x000000, 0.8).setOrigin(0.5, 1);
      c.add(bg);
      if (line1) c.add(this.add.text(px + CELL / 2, py + CELL - 4 - (line2 ? 11 : 0), line1, { fontFamily: FONT, fontSize: fpx(10), color, fontStyle: 'bold' }).setOrigin(0.5, 1));
      if (line2) c.add(this.add.text(px + CELL / 2, py + CELL - 4, line2, { fontFamily: FONT, fontSize: fpx(10), color: warn ? CSS.red : CSS.dim, fontStyle: 'bold' }).setOrigin(0.5, 1));
    }
    const inTransit = res.spawned - res.absorbed - Object.values(res.shipped).reduce((a, b) => a + b, 0);
    if (inTransit > 6) notes.push(`${inTransit} items were still in transit or stuck when time ran out.`);
    if (!Object.values(res.shipped).some(Boolean)) notes.unshift('Nothing reached a dock. Items only enter crushers, furnaces, presses and splitters from behind.');
    // banner across the top of the grid
    const last = this.run.round >= RULES.rounds;
    c.add(this.add.rectangle(GRID_X, GRID_Y, GRID_W, 64, P.panel, 0.97).setOrigin(0).setStrokeStyle(2, P.amber));
    c.add(this.add.text(GRID_X + 16, GRID_Y + 8, `ROUND ${rec.round} RESULT`, { fontFamily: FONT, fontSize: fpx(12), color: CSS.amber, fontStyle: 'bold', letterSpacing: 2 }));
    c.add(this.add.text(GRID_X + 16, GRID_Y + 24, `$${rec.earned}`, { fontFamily: FONT, fontSize: fpx(30), color: CSS.gold, fontStyle: 'bold' }));
    c.add(this.add.text(GRID_X + 120, GRID_Y + 36, `this round · total $${this.run.score}`, { fontFamily: FONT, fontSize: fpx(13), color: CSS.dim }));
    c.add(new Button(this, GRID_X + GRID_W - 130, GRID_Y + 32, last ? 'Final score (Space)' : 'Next round (Space)', () => this.nextRound(), { w: 230, h: 40, size: 15, name: 'next' }));
    this.overlay = c;
    if (this.replayQueue) this.time.delayedCall(1200, () => this.advanceReplay());
    this.renderSideSummary(notes);
    this.setHint(last ? 'Final round complete. Badges show what each machine did.' : 'Badges show what each machine did. Study the waits, then draft and rearrange.');
  }
  private renderSideSummary(notes: string[]) {
    this.side.removeAll(true);
    const r = this.run;
    const rec = r.rounds[r.rounds.length - 1]; const res = rec.result;
    const t = (x: number, y: number, s: string, size = 14, color = CSS.text, style: Partial<Phaser.Types.GameObjects.Text.TextStyle> = {}) => { const o = this.add.text(x, y, s, { fontFamily: FONT, fontSize: fpx(size), color, wordWrap: { width: SIDE_W - 32 }, ...style }); this.side.add(o); return o; };
    t(16, 12, 'WHAT SHIPPED', 13, CSS.amber, { fontStyle: 'bold', letterSpacing: 2 });
    let y = 36;
    const mats: Material[] = ['ingot', 'plate', 'shards', 'scrap', 'slag'];
    for (const m of mats) if (res.shipped[m]) { const img = this.add.image(26, y + 9, itemTexture(m)); this.side.add(img); t(44, y, `${res.shipped[m]} × ${m} @ $${RULES.value[m]} = $${res.shipped[m] * RULES.value[m]}`, 14); y += 24; }
    if (!Object.values(res.shipped).some(Boolean)) { t(16, y, 'nothing', 14, CSS.dim); y += 24; }
    y += 10;
    t(16, y, 'DIAGNOSTICS', 13, CSS.amber, { fontStyle: 'bold', letterSpacing: 2 }); y += 24;
    const diag = t(16, y, notes.slice(0, 5).join('\n') || 'Clean run: nothing waited, every hopper kept flowing.', 13, notes.length ? CSS.red : CSS.green, { lineSpacing: 4 });
    y += diag.height + 16;
    t(16, y, 'ROUND HISTORY', 13, CSS.amber, { fontStyle: 'bold', letterSpacing: 2 }); y += 24;
    r.rounds.forEach((rr, i) => { t(16 + (i % 3) * 140, y + Math.floor(i / 3) * 22, `R${rr.round}: $${rr.earned}`, 14, i === r.rounds.length - 1 ? CSS.gold : CSS.text); });
    y += Math.ceil(r.rounds.length / 3) * 22 + 8;
    if (r.sold) t(16, y, `Sold parts: $${r.sold}`, 13, CSS.dim);
    this.side.add(this.legend(16, Math.max(y + 24, 330)));
  }
  nextRound() {
    if (this.mode !== 'summary') return;
    this.overlay?.destroy(); this.overlay = null;
    const last = this.run.round >= RULES.rounds;
    this.act({ t: 'next' });
    if (last || this.run.phase === 'finished') { this.scene.start('Results', { run: this.run, replayed: this.replayLabel != null, replayLabel: this.replayLabel ?? undefined }); return; }
    this.mode = 'build'; this.heldId = null;
    this.syncMachines(); this.renderSide(); this.updateHint();
    if (this.replayQueue) this.time.delayedCall(400, () => this.advanceReplay());
  }

  // ---------- replay playback ----------
  private advanceReplay() {
    const q = this.replayQueue; if (!q) return;
    while (q.length) {
      const a = q[0];
      if (a.t === 'run') { q.shift(); this.startRun(); this.time.delayedCall(200, () => { this.speed = 4; this.renderSide(); }); return; }
      if (a.t === 'next') { q.shift(); if (this.mode === 'summary') this.nextRound(); else this.time.delayedCall(300, () => this.advanceReplay()); return; }
      q.shift(); this.act(a);
    }
    this.replayQueue = null; this.syncMachines(); this.renderSide();
  }
}
