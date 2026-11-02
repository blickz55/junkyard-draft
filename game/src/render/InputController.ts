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
import type { Machine, MachineKind } from '../sim/types';
import { loadKeyMap } from './storage';
import { DIR_DX, DIR_DY, RULES } from '../sim/rules';
import { dropActions, smartFacing, strokeActions } from './placement';
import { nextPlanned, plannedFacing } from './guide';
import { money } from '../content/format';
import { inputTravelDirs, outputDirs } from '../sim/advice';
import { explainRunError, placementWarning } from '../content/advice';
import type { Mode } from './RoundController';
import { CELL } from './textures';
import { fit, setArt } from './atlas';
import { audio } from './audio';
import { ui } from '../ui/dom';
import { t } from '../content/strings';
import { BIN_Y, GRID_W, GRID_X, GRID_Y } from './layout';
import { DPR } from './dpr';
import { boundKey, CONTROLS, LONG_PRESS_MS, TAP_SLOP_PX, type ControlId } from '../content/controls';

export interface MachineView {
  c: Phaser.GameObjects.Container;
  img: Phaser.GameObjects.Image;
  belt?: Phaser.GameObjects.Image;
  m: Machine;
  inBin: boolean;
}
/** What a tap on the yard landed on. */
export type Inspected = { kind: 'machine'; id: number } | { kind: 'rubble'; x: number; y: number } | { kind: 'ground'; x: number; y: number };
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
  /** a lesson is on: it has one way through, so no stroke */ readonly lesson: boolean;
  /** the coach's spots are lit: a tap on one puts the lit part in */ lit(): boolean;
  /** the cursor moved: say where, for a screen reader (0.12.4) */ announce(x: number, y: number, held: MachineKind | null): void;
  /** a keyboard asks for the buttons (0.12.4) */ focusControls(): void;
  readonly tipsOpen: boolean;
  act(a: Action): boolean;
  /** several actions as one edit: all or none, one Undo reverses them */
  actAll(actions: Action[]): boolean;
  /** the player asked what this is: a machine, a junk pile or open ground (every phase) */
  inspect(target: Inspected | null): void;
  syncMachines(): void;
  renderSide(): void;
  startRun(): void;
  nextRound(): void;
  setPaused(p: boolean): void;
  stepTick(): void;
  stopReplay(): void;
  closeTips(): void;
  pick(i: number): void;
  openMenu(): void;
  undo(): void;
  redo(): void;
  setToast(toast: Toast | null): void;
  cellXY(x: number, y: number): { px: number; py: number };
  /** shelf slot i's top-left (the selection frame sits on a held shelf part, 0.10.1) */
  binSlotXY(i: number): { px: number; py: number };
}

/** How long a refusal stays on the yard. */
const REFUSAL_MS = 5000;

export class InputController {
  dragging: MachineView | null = null;
  private dragFrom: { x: number; y: number } | null = null;
  /** keyboard placement: grid cursor (null = hidden) and the machine currently held "in hand" */
  cursor: { x: number; y: number } | null = null;
  heldId: number | null = null;
  selectedId: number | null = null;
  lastReject = '';
  toast: Toast | null = null;
  /** pointers that took part in a two-finger rotate: their release is not a tap (0.10.1) */
  private readonly multi = new Set<number>();
  /** the cells a finger or the mouse has crossed: laying a belt */
  private stroke: { x: number; y: number }[] | null = null;
  private strokeGfx!: Phaser.GameObjects.Graphics;
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
    this.strokeGfx = s.add.graphics().setDepth(7);
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
    // A finger drags after a long press, a mouse at once. Set from the DOM event, ahead of Phaser: it decides on a drag as the finger lands,
    // and from its own pointerdown the first tap of every game would count as a drag, select what is under it and then turn it.
    const canvas = this.scene.game.canvas;
    const pace = (e: PointerEvent) => {
      input.dragTimeThreshold = e.pointerType === 'mouse' ? 0 : LONG_PRESS_MS;
    };
    canvas.addEventListener('pointerdown', pace, true);
    this.scene.events.once('shutdown', () => canvas.removeEventListener('pointerdown', pace, true));
    input.on('dragstart', (p: Phaser.Input.Pointer, obj: Phaser.GameObjects.Image) => {
      this.endStroke();
      if (this.mode !== 'build' || this.host.playback) return;
      const v = obj.getData('view') as MachineView;
      if (!v) return;
      if (this.run.phase !== 'build') return; // a click asks what it is (tap); a real drag gets told why not (drag, below)
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
      if (this.mode === 'build' && this.run.phase === 'draft' && !this.host.playback && p.getDistance() > TAP_SLOP_PX * DPR) {
        const m = (obj.getData('view') as MachineView | undefined)?.m;
        if (m && this.lastReject !== t('advice.pickFirst')) this.showReject(t('advice.pickFirst'), this.toCell(p) ?? { x: m.x, y: m.y });
        return;
      }
      const v = this.dragging;
      if (!v || obj !== v.img) return;
      if (this.mode !== 'build') {
        this.cancelDrag();
        return;
      } // the round started under the pointer: the layout is frozen
      v.c.setPosition(dx - CELL / 2, dy - CELL / 2);
      const cell = toCell(p);
      if (cell) {
        // a machine standing there swaps out, so only a junk pile is a no
        const blocked = !!this.run.layout.rubble?.includes(cell.y * RULES.gridWidth + cell.x);
        const { px, py } = this.host.cellXY(cell.x, cell.y);
        setArt(this.hover, blocked ? 'tile-bad' : 'tile-ok')
          .setPosition(px, py)
          .setVisible(true);
        if (blocked) this.hideGhost();
        else this.showGhost(this.facingAt(v.m, cell.x, cell.y), cell.x, cell.y);
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
        this.dropAt(v.m, cell.x, cell.y);
      } else if (inBinArea && !v.inBin) {
        if (this.host.act({ t: 'unplace', id: v.m.id })) this.selectedId = null;
        audio.place();
      }
      this.host.syncMachines();
    });
    input.on('gameobjectdown', (p: Phaser.Input.Pointer, obj: Phaser.GameObjects.GameObject) => {
      const v = (obj as Phaser.GameObjects.Image).getData?.('view') as MachineView | undefined;
      if (!v || this.mode !== 'build' || this.run.phase !== 'build') return;
      if (p.rightButtonDown()) {
        this.selectedId = v.m.id;
        this.updateSelection();
        this.host.renderSide();
        this.rotateSelected();
      }
    });
    // taps and fingers (0.10.1)
    input.on('pointerdown', (p: Phaser.Input.Pointer) => {
      audio.unlock(); // the first tap on the yard unlocks sound (DOM buttons do the same in ui/dom.ts)
      this.beginStroke(p);
      if (!p.wasTouch) return;
      const fingers = input.manager.pointers.filter((q) => q.isDown && q.wasTouch);
      if (fingers.length >= 2) {
        this.endStroke();
        for (const q of fingers) this.multi.add(q.id);
        if (this.dragging) this.cancelDrag();
        this.rotateSelected();
      }
    });
    input.on('pointermove', (p: Phaser.Input.Pointer) => this.extendStroke(p));
    input.on('pointerup', (p: Phaser.Input.Pointer) => {
      if (this.multi.delete(p.id)) return;
      if (this.commitStroke()) return;
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
      stroke: () => {}, // pointer gestures only
      move: () => {}, // pointer gestures only; the keyboard moves through place
      select: () => {},
      rotate: (_key, e) => {
        if (gridKeys(e)) this.rotateSelected();
      },
      toShelf: (_key, e) => {
        if (gridKeys(e)) this.keyDelete();
      },
      undo: (_key, e) => {
        if (gridKeys()) {
          e.preventDefault();
          this.host.undo();
        }
      },
      redo: (_key, e) => {
        if (gridKeys()) {
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
      // Tab belongs to the shelf here, so this is how a keyboard reaches the Menu and the rest; pressed again, or Esc, it comes back to the yard (0.12.4)
      panel: (_key, e) => {
        if (this.host.tipsOpen || ui.dialogOpen) return;
        e.preventDefault();
        if (domFocus()) (document.activeElement as HTMLElement).blur();
        else this.host.focusControls();
      },
    };
    const moved = loadKeyMap(); // the keys a player moved (0.12.4): a handler still hears its own slot
    for (const c of CONTROLS)
      for (const b of c.keys) {
        const bound = boundKey(c, b, moved);
        // Phaser replays its whole queue on each new event until the frame ends and only knows the last one by sight, so three events in a frame fire
        // the first again: a quick double tap at 30 frames a second moves a cell too far. An event is heard once, per binding, because two may share a key.
        const heard = new WeakSet<KeyboardEvent>();
        kb?.on(`keydown-${bound.key}`, (e: KeyboardEvent) => {
          if (heard.has(e)) return;
          heard.add(e);
          if (!!bound.ctrl !== (e.ctrlKey || e.metaKey) || !!bound.shift !== e.shiftKey) return; // a chord binds only its own modifiers
          handlers[c.id](b.key, e);
        });
      }
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
  /** The selected machine goes in hand, as one on the shelf does: the next tap is where it goes. */
  holdSelected() {
    if (this.selectedId != null) this.heldId = this.selectedId;
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

  // ---------- the obvious move ----------
  /** The machine as it would stand at a spot: a shelf part takes the facing the drop will give it. */
  private facingAt(m: Machine, x: number, y: number): Machine {
    if (m.x >= 0) return m;
    return { ...m, dir: plannedFacing(this.run, m.kind, x, y) ?? smartFacing(this.run.layout, m.kind, x, y, m.dir, this.occupantAt(x, y)?.id) };
  }
  /** Put a machine at a cell the way a person means it: a part on the belt goes in the belt, whatever stood there steps aside, the part faces the way the line runs. */
  dropAt(m: Machine, x: number, y: number): boolean {
    if (this.run.layout.rubble?.includes(y * RULES.gridWidth + x)) {
      audio.invalid();
      this.flashBad(x, y);
      this.showReject(explainRunError('cell blocked by rubble'), { x, y });
      return false;
    }
    const acts = dropActions(this.run, m, x, y, m.x < 0 ? plannedFacing(this.run, m.kind, x, y) : undefined);
    if (!acts.length) return false;
    const ok = this.host.actAll(acts);
    if (ok) {
      if (acts.length > 1) audio.swap();
      else audio.place();
    } else {
      audio.invalid();
      this.flashBad(x, y);
    }
    return ok;
  }

  // ---------- taps (0.10.1) ----------
  private toCell(p: Phaser.Input.Pointer) {
    const x = Math.floor((p.worldX - GRID_X) / CELL),
      y = Math.floor((p.worldY - GRID_Y) / CELL); // world coordinates: the camera is zoomed and scrolled
    return x >= 0 && y >= 0 && x < RULES.gridWidth && y < RULES.gridHeight ? { x, y } : null;
  }
  /**
   * A tap. Any time: the piece tapped says what it does. While building: a shelf part goes in or out of hand, the part in hand
   * lands where you tap (swapping with what stood there), a machine is selected, the selected machine turns on a second tap,
   * empty yard lets go. The lit spot needs no part in hand: a tap there puts the lit part in.
   */
  private tap(p: Phaser.Input.Pointer) {
    const hit = this.scene.input
      .hitTestPointer(p)
      .map((o) => (o as Phaser.GameObjects.Image).getData?.('view') as MachineView | undefined)
      .find((v) => !!v);
    const cell = this.toCell(p);
    const rubble = cell && this.run.layout.rubble?.includes(cell.y * RULES.gridWidth + cell.x) ? cell : null;
    const building = this.mode === 'build' && this.run.phase === 'build' && !this.host.playback;
    if (!building) {
      this.host.inspect(hit ? { kind: 'machine', id: hit.m.id } : rubble ? { kind: 'rubble', ...rubble } : null);
      return;
    }
    const selected = this.machineById(this.selectedId);
    const held = this.machineById(this.heldId) ?? (selected && selected.x < 0 ? selected : undefined); // a part selected on the shelf is in hand
    // the lit spot takes the lit part, whatever shelf part is in hand: the words name it, so that is what lands
    const lit = (held && held.x >= 0) || hit?.inBin || this.host.lesson || !this.host.lit() ? null : nextPlanned(this.run);
    if (lit?.part && cell && lit.step.x === cell.x && lit.step.y === cell.y) {
      this.heldId = null;
      if (this.dropAt(lit.part, cell.x, cell.y)) this.selectedId = lit.part.id;
    } else if (hit?.inBin) {
      this.heldId = this.heldId === hit.m.id ? null : hit.m.id;
      this.selectedId = hit.m.id;
      this.cursor = null;
      audio.click();
    } else if (held && cell) {
      this.heldId = null;
      if (this.dropAt(held, cell.x, cell.y)) this.selectedId = held.id;
      else this.heldId = held.id;
    } else if (hit) {
      if (this.selectedId === hit.m.id) {
        this.rotateSelected();
        return;
      }
      this.selectedId = hit.m.id;
      audio.click();
    } else if (rubble) {
      this.host.inspect({ kind: 'rubble', ...rubble });
      return;
    } else if (cell) {
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
    const shown = this.toast;
    setTimeout(() => {
      if (this.toast === shown) this.clearToast('refusal'); // a note left standing reads as a new refusal of the next thing tried
    }, REFUSAL_MS);
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
  // ---------- laying a belt with one stroke ----------
  /** A stroke starts on the yard while building. With a mouse, not on a machine: dragging one moves it. With a part other than a belt in hand, the tap places it. */
  private beginStroke(p: Phaser.Input.Pointer) {
    this.endStroke();
    const cell = this.toCell(p);
    if (!cell || this.host.lesson || this.mode !== 'build' || this.run.phase !== 'build' || this.host.playback) return;
    const selected = this.machineById(this.selectedId);
    const held = this.machineById(this.heldId) ?? (selected && selected.x < 0 ? selected : undefined);
    if (held && held.kind !== 'conveyor') return;
    if (!p.wasTouch && this.occupantAt(cell.x, cell.y)) return;
    this.stroke = [cell];
  }
  private extendStroke(p: Phaser.Input.Pointer) {
    const path = this.stroke;
    if (!path || !p.isDown) return;
    const to = this.toCell(p);
    if (!to) return;
    let last = path[path.length - 1];
    while (last.x !== to.x || last.y !== to.y) {
      const dx = to.x - last.x,
        dy = to.y - last.y;
      const next = Math.abs(dx) >= Math.abs(dy) ? { x: last.x + Math.sign(dx), y: last.y } : { x: last.x, y: last.y + Math.sign(dy) };
      const back = path[path.length - 2];
      if (back && back.x === next.x && back.y === next.y)
        path.pop(); // going back along the stroke takes it back
      else if (!path.some((c) => c.x === next.x && c.y === next.y)) path.push(next);
      else break;
      last = path[path.length - 1];
    }
    this.drawStroke();
  }
  private drawStroke() {
    const g = this.strokeGfx;
    g.clear();
    const path = this.stroke;
    if (!path || path.length < 2) return;
    const centre = (c: { x: number; y: number }) => {
      const { px, py } = this.host.cellXY(c.x, c.y);
      return { x: px + CELL / 2, y: py + CELL / 2 };
    };
    g.lineStyle(10, 0xf5c542, 0.75);
    g.beginPath();
    const first = centre(path[0]);
    g.moveTo(first.x, first.y);
    for (const c of path.slice(1)) {
      const q = centre(c);
      g.lineTo(q.x, q.y);
    }
    g.strokePath();
  }
  private endStroke() {
    this.stroke = null;
    this.strokeGfx?.clear();
  }
  /** The finger came up: lay what the stroke drew. True when there was a stroke, so that this was no tap. */
  private commitStroke(): boolean {
    const path = this.stroke;
    this.endStroke();
    if (!path || path.length < 2 || this.mode !== 'build' || this.run.phase !== 'build') return false;
    const s = strokeActions(this.run, path);
    if (s.actions.length && this.host.actAll(s.actions)) {
      audio.place();
      this.selectedId = null;
      this.heldId = null;
      const at = path[path.length - 1];
      if (s.short) this.showReject(t('game.strokeShort', { cost: money(RULES.beltCost) }), at);
      else if (s.bought)
        this.showToast({ text: t('game.strokeBought', { n: s.bought, amount: money(s.bought * RULES.beltCost) }), kind: 'warning', x: at.x, y: at.y });
      this.host.renderSide();
    } else if (s.short) this.showReject(t('game.strokeShort', { cost: money(RULES.beltCost) }), path[0]);
    this.host.syncMachines();
    return true;
  }

  /** Ghost of the machine in hand at a cell: input (blue) and output (amber) arrows on the cell edges, plus a warning toast if it would not work as drawn. */
  showGhost(m: Machine, cx: number, cy: number, quiet = false) {
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
    if (quiet) return;
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
    // what goes in and what comes out, on the machine itself, for as long as it is selected (docs/UX-STANDARD.md: everything can be asked about)
    if (slot < 0 && !this.dragging && this.heldId == null) this.showGhost(m, m.x, m.y, true);
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
    this.host.announce(this.cursor.x, this.cursor.y, this.machineById(this.heldId)?.kind ?? null);
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
      setArt(this.hover, this.run.layout.rubble?.includes(this.cursor.y * RULES.gridWidth + this.cursor.x) ? 'tile-bad' : 'tile-ok')
        .setPosition(px, py)
        .setVisible(true);
      const held = this.machineById(this.heldId);
      if (held) this.showGhost(this.facingAt(held, this.cursor.x, this.cursor.y), this.cursor.x, this.cursor.y);
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
      } else {
        this.heldId = null;
        if (!this.dropAt(held, x, y)) {
          this.heldId = held.id;
          return;
        }
        this.selectedId = held.id;
      }
    } else if (occupant) {
      this.heldId = occupant.id;
      this.selectedId = occupant.id;
      audio.click();
    } else if (this.run.bin.length) {
      const part = this.run.bin[0];
      if (!this.dropAt(part, x, y)) return;
      this.selectedId = part.id;
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
    if (target.x >= 0 && this.host.act({ t: 'unplace', id: target.id })) {
      this.selectedId = null;
      audio.place();
    }
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
    if (this.cursor) {
      this.cursor = null;
      this.updateCursor();
      return;
    }
    this.host.openMenu(); // nothing left to let go of: Esc is the way out
  }
}
