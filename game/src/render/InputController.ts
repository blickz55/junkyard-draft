/**
 * Pointer and keyboard input for the yard (production roadmap 0.9.4, extracted from GameScene): drag and drop, the grid
 * cursor and the machine held "in hand", the selection, the shortcuts, and the feedback that belongs to input: the hover
 * tile, the ghost's arrows, the red flash, and the toast at a cell (0.9.3: a refusal or a warning that stays until the next
 * action). It applies rule-checked actions through the host and never touches the run itself.
 *
 * 0.10.1: one action table (content/controls.ts) for mouse, touch and keys. The keys are bound from the table. A tap
 * (a touch shorter than the long press, or a click that did not drag) takes a shelf part in hand, places the part in
 * hand on a cell, selects a machine, or clears the selection on empty yard; a long press starts a touch drag; two
 * fingers on the yard rotate the selection; the first tap on the yard unlocks sound.
 */
import Phaser from 'phaser';
import type { Action, RunState } from '../sim/run';
import type { Machine } from '../sim/types';
import { DIR_DX, DIR_DY, RULES } from '../sim/rules';
import { inputTravelDirs, outputDirs } from '../sim/advice';
import { explainRunError, placementWarning } from '../content/advice';
import type { Mode } from './RoundController';
import { CELL } from './textures';
import { fit, setArt } from './atlas';
import { audio } from './audio';
import { ui } from '../ui/dom';
import { BIN_Y, GRID_W, GRID_X, GRID_Y } from './layout';
import { DPR } from './dpr';
import { CONTROLS, LONG_PRESS_MS, TAP_SLOP_PX, type ControlId } from '../content/controls';

export interface MachineView {
  c: Phaser.GameObjects.Container;
  img: Phaser.GameObjects.Image;
  belt?: Phaser.GameObjects.Image;
  m: Machine;
  inBin: boolean;
}
export type ToastKind = 'refusal' | 'warning';
export interface Toast {
  text: string;
  kind: ToastKind;
  x: number;
  y: number;
}

/** What the controller needs from the scene. */
export interface InputHost {
  readonly mode: Mode;
  readonly run: RunState;
  /** a recording is being applied (no edits) */ readonly playback: boolean;
  /** a recording is being watched */ readonly watching: boolean;
  readonly tipsOpen: boolean;
  act(a: Action): boolean;
  syncMachines(): void;
  renderSide(): void;
  startRun(): void;
  nextRound(): void;
  setPaused(p: boolean): void;
  stepTick(): void;
  stopReplay(): void;
  closeTips(): void;
  pick(i: number): void;
  undo(): void;
  redo(): void;
  setToast(toast: Toast | null): void;
  cellXY(x: number, y: number): { px: number; py: number };
  /** shelf slot i's top-left (the selection frame sits on a held shelf part, 0.10.1) */
  binSlotXY(i: number): { px: number; py: number };
}

export class InputController {
  dragging: MachineView | null = null;
  private dragFrom: { x: number; y: number } | null = null;
  /** keyboard placement: grid cursor (null = hidden) and the machine currently held "in hand" */
  cursor: { x: number; y: number } | null = null;
  heldId: number | null = null;
  selectedId: number | null = null;
  lastReject = '';
  toast: Toast | null = null;
  private lastShortcutAt = 0;
  /** pointers that took part in a two-finger rotate: their release is not a tap (0.10.1) */
  private readonly multi = new Set<number>();
  private hover!: Phaser.GameObjects.Image;
  private ghostGfx!: Phaser.GameObjects.Graphics;
  private selection!: Phaser.GameObjects.Image;
  private cursorImg!: Phaser.GameObjects.Image;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly host: InputHost,
  ) {}

  /** Create the feedback objects and wire the pointer and keyboard; once per scene life. */
  attach(): this {
    const s = this.scene;
    this.hover = fit(s.add.image(0, 0, 'tile-ok'))
      .setOrigin(0)
      .setVisible(false)
      .setDepth(5);
    this.ghostGfx = s.add.graphics().setDepth(6);
    this.selection = fit(s.add.image(0, 0, 'tile-sel'))
      .setOrigin(0)
      .setVisible(false)
      .setDepth(6);
    this.cursorImg = fit(s.add.image(0, 0, 'tile-cursor'))
      .setOrigin(0)
      .setVisible(false)
      .setDepth(6);
    this.setupInput();
    return this;
  }

  private get run() {
    return this.host.run;
  }
  private get mode() {
    return this.host.mode;
  }
  cursorInfo() {
    return { visible: this.cursor != null && this.mode === 'build', x: this.cursor?.x ?? -1, y: this.cursor?.y ?? -1, held: this.heldId };
  }
  machineById(id: number | null): Machine | undefined {
    if (id == null) return undefined;
    return this.run.layout.machines.find((m) => m.id === id) ?? this.run.bin.find((m) => m.id === id);
  }
  occupantAt(x: number, y: number) {
    return this.run.layout.machines.find((m) => m.x === x && m.y === y);
  }

  // ---------- pointer and keys ----------
  private setupInput() {
    const toCell = (p: Phaser.Input.Pointer) => this.toCell(p);
    const input = this.scene.input;
    input.addPointer(1); // a second finger (the two-finger rotate, 0.10.1)
    input.on('dragstart', (p: Phaser.Input.Pointer, obj: Phaser.GameObjects.Image) => {
      if (this.mode !== 'build' || this.host.playback) return;
      const v = obj.getData('view') as MachineView;
      if (!v) return;
      this.heldId = null;
      this.updateCursor();
      this.clearToast();
      this.dragging = v;
      this.dragFrom = { x: v.c.x, y: v.c.y };
      v.c.setDepth(10);
      this.selectedId = v.m.id;
      this.updateSelection();
      this.host.renderSide();
    });
    input.on('drag', (p: Phaser.Input.Pointer, obj: Phaser.GameObjects.Image, dx: number, dy: number) => {
      const v = this.dragging;
      if (!v || obj !== v.img) return;
      if (this.mode !== 'build') {
        this.cancelDrag();
        return;
      } // the round started under the pointer: the layout is frozen
      v.c.setPosition(dx - CELL / 2, dy - CELL / 2);
      const cell = toCell(p);
      if (cell) {
        const occ = this.run.layout.machines.find((m) => m.x === cell.x && m.y === cell.y && m.id !== v.m.id);
        const { px, py } = this.host.cellXY(cell.x, cell.y);
        setArt(this.hover, occ ? 'tile-bad' : 'tile-ok')
          .setPosition(px, py)
          .setVisible(true);
        if (occ) {
          this.hideGhost();
        } else this.showGhost(v.m, cell.x, cell.y);
      } else {
        this.hover.setVisible(false);
        this.hideGhost();
        this.clearToast('warning');
      }
    });
    input.on('dragend', (p: Phaser.Input.Pointer, obj: Phaser.GameObjects.Image) => {
      const v = this.dragging;
      if (!v || obj !== v.img) return;
      if (this.mode !== 'build') {
        this.cancelDrag();
        return;
      } // drop after the round started: no edit, snap back
      this.dragging = null;
      this.hover.setVisible(false);
      this.hideGhost();
      v.c.setDepth(2);
      const cell = toCell(p);
      const inBinArea = p.worldY >= BIN_Y && p.worldY <= BIN_Y + 110 && p.worldX >= GRID_X && p.worldX <= GRID_X + GRID_W;
      if (cell) {
        const ok = this.host.act({ t: 'place', id: v.m.id, x: cell.x, y: cell.y, dir: v.m.dir });
        if (ok) audio.place();
        else {
          audio.invalid();
          this.flashBad(cell.x, cell.y);
        }
      } else if (inBinArea && !v.inBin) {
        this.host.act({ t: 'unplace', id: v.m.id });
        audio.place();
      }
      this.host.syncMachines();
    });
    input.on('gameobjectdown', (p: Phaser.Input.Pointer, obj: Phaser.GameObjects.GameObject) => {
      const v = (obj as Phaser.GameObjects.Image).getData?.('view') as MachineView | undefined;
      if (!v || this.mode !== 'build') return;
      this.selectedId = v.m.id;
      this.updateSelection();
      this.host.renderSide();
      if (p.rightButtonDown()) this.rotateSelected();
    });
    // taps and fingers (0.10.1)
    input.on('pointerdown', (p: Phaser.Input.Pointer) => {
      audio.unlock(); // the first tap on the yard unlocks sound (DOM buttons do the same in ui/dom.ts)
      input.dragTimeThreshold = p.wasTouch ? LONG_PRESS_MS : 0; // a finger drags after a long press; a mouse at once
      if (!p.wasTouch) return;
      const fingers = input.manager.pointers.filter((q) => q.isDown && q.wasTouch);
      if (fingers.length >= 2) {
        for (const q of fingers) this.multi.add(q.id);
        if (this.dragging) this.cancelDrag();
        this.rotateSelected();
      }
    });
    input.on('pointerup', (p: Phaser.Input.Pointer) => {
      if (this.multi.delete(p.id)) return;
      if (!p.wasTouch && p.button !== 0) return; // right and middle buttons have their own meaning
      if (p.getDistance() > TAP_SLOP_PX * DPR) return; // it moved: a drag, handled above
      this.tap(p);
    });
    const kb = input.keyboard;
    // Gameplay shortcuts belong to the grid (review F05): they stand down while a DOM control has focus (Enter/Space/Tab
    // then keep their native meaning on buttons and inputs) and while the tips panel or a dialog is open. No global
    // capture: the handled keys call preventDefault themselves, so arrows never scroll and Tab never leaves the grid.
    const domFocus = () => {
      const a = document.activeElement;
      return !!a && a !== document.body && a.tagName !== 'CANVAS' && !a.classList.contains('jd-screen');
    };
    const gridKeys = (e?: KeyboardEvent) => {
      if (this.host.tipsOpen || ui.dialogOpen || domFocus()) return false;
      e?.preventDefault();
      return true;
    };
    // Phaser queues a modifier+key keydown twice in Chromium (two listeners, differing timeStamps slip past its own bailout); one shortcut per 30 ms
    const once = (e: KeyboardEvent) => {
      if (e.timeStamp - this.lastShortcutAt < 30) return false;
      this.lastShortcutAt = e.timeStamp;
      return true;
    };
    // the action table (content/controls.ts): each control's keys call its handler; the Tips panel lists the same table
    const handlers: Record<ControlId, (key: string, e: KeyboardEvent) => void> = {
      pick: (key) => {
        if (gridKeys() && this.run.phase === 'draft' && !this.host.playback) this.host.pick(['ONE', 'TWO', 'THREE'].indexOf(key));
      },
      hold: (_key, e) => {
        if (gridKeys(e)) this.keyTab();
      },
      place: (key, e) => {
        if (!gridKeys(e)) return;
        if (key === 'ENTER') this.keyEnter();
        else this.moveCursor(key === 'LEFT' ? -1 : key === 'RIGHT' ? 1 : 0, key === 'UP' ? -1 : key === 'DOWN' ? 1 : 0);
      },
      move: () => {}, // pointer gestures only; the keyboard moves through place
      select: () => {},
      rotate: (_key, e) => {
        if (gridKeys(e)) this.rotateSelected();
      },
      toShelf: (_key, e) => {
        if (gridKeys(e)) this.keyDelete();
      },
      undo: (_key, e) => {
        if (once(e) && gridKeys()) {
          e.preventDefault();
          this.host.undo();
        }
      },
      redo: (_key, e) => {
        if (once(e) && gridKeys()) {
          e.preventDefault();
          this.host.redo();
        }
      },
      start: (_key, e) => {
        if (gridKeys(e) && this.mode === 'build' && this.run.phase === 'build') this.host.startRun();
      },
      next: (_key, e) => {
        if (gridKeys(e) && this.mode === 'summary') this.host.nextRound();
      },
      pause: () => {
        if (ui.dialogOpen) return;
        if (this.host.tipsOpen) this.host.closeTips();
        else if (domFocus()) (document.activeElement as HTMLElement).blur();
        else if (this.host.watching) this.host.stopReplay();
        else if (this.mode === 'running') this.host.setPaused(true);
        else if (this.mode === 'paused') this.host.setPaused(false);
        else this.keyEscape();
      },
      step: (_key, e) => {
        if (gridKeys(e) && this.mode === 'paused') this.host.stepTick();
      }, // 0.8.12: one tick while paused
      mute: () => {
        if (gridKeys()) audio.setMuted(!audio.muted);
      },
    };
    for (const c of CONTROLS)
      for (const b of c.keys)
        kb?.on(`keydown-${b.key}`, (e: KeyboardEvent) => {
          if (!!b.ctrl !== (e.ctrlKey || e.metaKey) || !!b.shift !== e.shiftKey) return; // a chord binds only its own modifiers
          handlers[c.id](b.key, e);
        });
    const onBlur = () => {
      if (this.mode === 'running') this.host.setPaused(true);
    };
    this.scene.game.events.on(Phaser.Core.Events.BLUR, onBlur);
    this.scene.events.once('shutdown', () => this.scene.game.events.off(Phaser.Core.Events.BLUR, onBlur)); // one handler per scene life, not one per create()
  }
  /** Abandon an in-progress pointer drag without applying anything: the view snaps back to its logical cell or bin slot. */
  cancelDrag() {
    const v = this.dragging;
    if (!v) return;
    this.dragging = null;
    this.dragFrom = null;
    this.hover.setVisible(false);
    this.hideGhost();
    this.clearToast('warning');
    v.c.setDepth(2);
    this.host.syncMachines();
  }
  /** The shift starts: nothing in hand, nothing selected, no cursor, no toast. */
  freeze() {
    this.cancelDrag();
    this.selectedId = null;
    this.heldId = null;
    this.cursor = null;
    this.updateSelection();
    this.updateCursor();
    this.hover.setVisible(false);
    this.clearToast();
  }
  /** After undo/redo: a held or selected machine that no longer exists is let go. */
  dropMissing() {
    const exists = (id: number | null) => id != null && (this.run.layout.machines.some((m) => m.id === id) || this.run.bin.some((m) => m.id === id));
    if (!exists(this.heldId)) this.heldId = null;
    if (!exists(this.selectedId)) this.selectedId = null;
  }
  /** Redraw the selection frame and the cursor (after the views moved). */
  refresh() {
    this.updateSelection();
    this.updateCursor();
  }

  // ---------- taps (0.10.1) ----------
  private toCell(p: Phaser.Input.Pointer) {
    const x = Math.floor((p.worldX - GRID_X) / CELL),
      y = Math.floor((p.worldY - GRID_Y) / CELL); // world coordinates: the camera is zoomed and scrolled
    return x >= 0 && y >= 0 && x < RULES.gridWidth && y < RULES.gridHeight ? { x, y } : null;
  }
  /** A tap: a shelf part goes in (or out of) hand, the part in hand is placed on an empty cell, a machine is selected, empty yard clears the selection. */
  private tap(p: Phaser.Input.Pointer) {
    if (this.mode !== 'build' || this.host.playback) return;
    const hit = this.scene.input
      .hitTestPointer(p)
      .map((o) => (o as Phaser.GameObjects.Image).getData?.('view') as MachineView | undefined)
      .find((v) => !!v);
    const cell = this.toCell(p);
    if (hit) {
      if (hit.inBin) {
        this.heldId = this.heldId === hit.m.id ? null : hit.m.id;
        this.selectedId = hit.m.id;
        this.cursor = null;
        audio.click();
      } else if (this.heldId != null && this.heldId !== hit.m.id) {
        audio.invalid();
        this.flashBad(hit.m.x, hit.m.y);
        this.showReject(explainRunError('cell occupied'), { x: hit.m.x, y: hit.m.y });
        return;
      } else {
        this.selectedId = hit.m.id;
        this.heldId = null;
      }
    } else if (cell) {
      if (this.heldId != null) {
        this.cursor = cell; // place through the keyboard path (its feedback and sounds), then hide the cursor again
        this.keyEnter();
        this.cursor = null;
        this.updateCursor();
        return;
      }
      this.selectedId = null;
    } else return;
    this.clearToast('warning');
    this.host.syncMachines();
    this.host.renderSide();
  }

  // ---------- feedback: toasts, ghost, flash ----------
  /** Refusal reason as a toast at the cell it was aimed at (production roadmap 0.9.3): it stays until the next action, never two seconds; the hint strip keeps its own hint. */
  showReject(text: string, cell: { x: number; y: number } | null) {
    this.lastReject = text;
    this.showToast({ text, kind: 'refusal', x: cell?.x ?? this.cursor?.x ?? 0, y: cell?.y ?? this.cursor?.y ?? 0 });
  }
  showToast(toast: Toast) {
    this.toast = toast;
    this.host.setToast(toast);
  }
  /** Hide the toast; with a kind, only a toast of that kind (a refusal outlives a ghost warning's coming and going). */
  clearToast(kind?: ToastKind) {
    if (!this.toast || (kind && this.toast.kind !== kind)) return;
    this.toast = null;
    this.host.setToast(null);
  }
  /** Ghost of the machine in hand at a cell: input (blue) and output (amber) arrows on the cell edges, plus a warning toast if it would not work as drawn. */
  showGhost(m: Machine, cx: number, cy: number) {
    const g = this.ghostGfx;
    g.clear();
    const { px, py } = this.host.cellXY(cx, cy);
    const mx = px + CELL / 2,
      my = py + CELL / 2,
      r = 9;
    const arrow = (d: number, outward: boolean, color: number) => {
      const dx = DIR_DX[d],
        dy = DIR_DY[d];
      const ex = mx + (outward ? dx : -dx) * (CELL / 2 - 4),
        ey = my + (outward ? dy : -dy) * (CELL / 2 - 4);
      const tipX = ex + dx * r,
        tipY = ey + dy * r,
        bx = ex - dx * r * 0.2,
        by = ey - dy * r * 0.2;
      g.fillStyle(color, 0.95).lineStyle(1, 0x0b0b0b, 0.9);
      g.fillTriangle(tipX, tipY, bx - dy * r * 0.8, by + dx * r * 0.8, bx + dy * r * 0.8, by - dx * r * 0.8);
    };
    for (const t of inputTravelDirs(m.kind, m.dir)) arrow(t, false, 0x6fb4ff);
    for (const o of outputDirs(m.kind, m.dir)) arrow(o, true, 0xffb347);
    const warn = cx >= 0 ? placementWarning(this.run.layout, m.kind, cx, cy, m.dir, m.id) : null;
    if (warn) this.showToast({ text: warn, kind: 'warning', x: cx, y: cy });
    else this.clearToast('warning');
  }
  hideGhost() {
    this.ghostGfx.clear();
  }
  flashBad(x: number, y: number) {
    const { px, py } = this.host.cellXY(x, y);
    const f = fit(this.scene.add.image(px, py, 'tile-bad'))
      .setOrigin(0)
      .setDepth(7);
    this.scene.tweens.add({ targets: f, alpha: 0, duration: 350, onComplete: () => f.destroy() });
  }
  rotateSelected() {
    if (this.mode !== 'build' || this.selectedId == null || this.host.playback) return;
    if (this.host.act({ t: 'rotate', id: this.selectedId })) {
      audio.rotate();
      this.host.syncMachines();
    }
  }

  // ---------- selection, cursor, keyboard placement ----------
  private updateSelection() {
    const m = this.machineById(this.selectedId);
    const slot = m ? this.run.bin.findIndex((b) => b.id === m.id) : -1;
    if (!m || (slot < 0 && m.x < 0)) {
      this.selection.setVisible(false);
      return;
    }
    const { px, py } = slot >= 0 ? this.host.binSlotXY(slot) : this.host.cellXY(m.x, m.y); // a selected shelf part wears the frame on its slot (0.10.1)
    this.selection.setPosition(px, py).setVisible(true);
  }
  /** First arrow press reveals the cursor (on the selected machine, else top-left) without moving it. */
  private moveCursor(dx: number, dy: number) {
    if (this.mode !== 'build' || this.host.playback) return;
    if (!this.cursor) {
      const sel = this.machineById(this.selectedId);
      this.cursor = sel && sel.x >= 0 ? { x: sel.x, y: sel.y } : { x: 0, y: 0 };
    } else {
      this.cursor = { x: Phaser.Math.Clamp(this.cursor.x + dx, 0, RULES.gridWidth - 1), y: Phaser.Math.Clamp(this.cursor.y + dy, 0, RULES.gridHeight - 1) };
    }
    if (this.heldId != null) this.host.syncMachines();
    else this.updateCursor();
  }
  private updateCursor() {
    if (!this.cursor || this.mode !== 'build') {
      this.cursorImg.setVisible(false);
      if (!this.dragging) {
        this.hover.setVisible(false);
        this.hideGhost();
      }
      return;
    }
    const { px, py } = this.host.cellXY(this.cursor.x, this.cursor.y);
    this.cursorImg.setPosition(px, py).setVisible(true);
    if (this.heldId != null) {
      const occ = this.occupantAt(this.cursor.x, this.cursor.y);
      setArt(this.hover, occ && occ.id !== this.heldId ? 'tile-bad' : 'tile-ok')
        .setPosition(px, py)
        .setVisible(true);
      const held = this.machineById(this.heldId);
      if (held && !(occ && occ.id !== held.id)) this.showGhost(held, this.cursor.x, this.cursor.y);
      else this.hideGhost();
    } else if (!this.dragging) {
      this.hover.setVisible(false);
      this.hideGhost();
    }
  }
  /** Enter: drop the held machine here; else pick up the machine here; else place the first bin part here. */
  private keyEnter() {
    if (this.mode !== 'build' || this.host.playback) return;
    if (!this.cursor) {
      this.moveCursor(0, 0);
      return;
    }
    const { x, y } = this.cursor;
    const occupant = this.occupantAt(x, y);
    const held = this.machineById(this.heldId);
    if (held) {
      if (held.x === x && held.y === y) {
        this.heldId = null;
      } else if (occupant) {
        audio.invalid();
        this.flashBad(x, y);
        this.showReject(explainRunError('cell occupied'), { x, y });
        return;
      } else if (this.host.act({ t: 'place', id: held.id, x, y, dir: held.dir })) {
        audio.place();
        this.heldId = null;
        this.selectedId = held.id;
      } else {
        audio.invalid();
        this.flashBad(x, y);
        return;
      }
    } else if (occupant) {
      this.heldId = occupant.id;
      this.selectedId = occupant.id;
      audio.click();
    } else if (this.run.bin.length) {
      const part = this.run.bin[0];
      if (this.host.act({ t: 'place', id: part.id, x, y, dir: part.dir })) {
        audio.place();
        this.selectedId = part.id;
      } else {
        audio.invalid();
        this.flashBad(x, y);
        return;
      }
    } else {
      audio.invalid();
      return;
    }
    this.host.syncMachines();
    this.host.renderSide();
  }
  /** Tab: take the next bin part in hand (cycling); Enter then places it at the cursor. */
  private keyTab() {
    if (this.mode !== 'build' || this.host.playback || !this.run.bin.length) return;
    const i = this.run.bin.findIndex((m) => m.id === this.heldId);
    const next = this.run.bin[(i + 1) % this.run.bin.length];
    this.heldId = next.id;
    this.selectedId = next.id;
    if (!this.cursor) this.cursor = { x: 0, y: 0 };
    audio.click();
    this.host.syncMachines();
    this.host.renderSide();
  }
  /** Delete: send the held machine, else the machine under the cursor, else the selected machine back to the bin. */
  private keyDelete() {
    if (this.mode !== 'build' || this.host.playback) return;
    const target =
      this.machineById(this.heldId) ?? (this.cursor ? this.occupantAt(this.cursor.x, this.cursor.y) : undefined) ?? this.machineById(this.selectedId);
    if (!target) return;
    this.heldId = null;
    if (target.x >= 0 && this.host.act({ t: 'unplace', id: target.id })) audio.place();
    this.host.syncMachines();
    this.host.renderSide();
  }
  /** Esc (build): drop what is in hand, else clear the selection, else hide the cursor. */
  private keyEscape() {
    if (this.heldId != null) {
      this.heldId = null;
      this.clearToast('warning');
      this.host.syncMachines();
      this.host.renderSide();
      return;
    }
    if (this.selectedId != null) {
      this.selectedId = null;
      this.updateSelection();
      this.host.renderSide();
      return;
    }
    this.cursor = null;
    this.updateCursor();
  }
}
