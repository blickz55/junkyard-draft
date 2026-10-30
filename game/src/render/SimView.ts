/**
 * The yard's sprites (production roadmap 0.9.4, extracted from GameScene): the machine views on the grid and the shelf,
 * the item sprites of the live shift, jam marks, the stall mark, and the per-tick effects (transform flashes, press sparks,
 * the dock pulse). It applies render/simframes.ts to Phaser objects; it reads the run and the sim and changes neither.
 */
import Phaser from 'phaser';
import type { RunState } from '../sim/run';
import type { Machine, SimEvent } from '../sim/types';
import { cellIndex, type SimState } from '../sim/sim';
import { RULES } from '../sim/rules';
import { BELT_FRAMES, CELL, itemTexture, machineTexture } from './textures';
import { baseScale, fit, setArt } from './atlas';
import { P } from './palette';
import { prefs } from './prefs';
import type { MachineView } from './InputController';
import { digestTick, itemPose, machineFrame, transformColour, type TickDigest } from './simframes';

/** What the input controller holds: the machine in hand follows the cursor, the dragged one follows the pointer. */
export interface Hand { heldId: number | null; cursor: { x: number; y: number } | null; dragging: MachineView | null }

export class SimView {
  readonly views = new Map<number, MachineView>();
  private itemSprites = new Map<number, Phaser.GameObjects.Image>();
  private jamMarks = new Map<number, Phaser.GameObjects.Image>();
  private beltFrame = 0;
  /** reused per frame / per tick to avoid allocating sets in the hot path */
  private readonly aliveIds = new Set<number>();
  private readonly jammedNow = new Set<number>();
  private readonly shipsThisTick = new Map<number, number>();
  private stallMark!: Phaser.GameObjects.Image;

  constructor(private readonly scene: Phaser.Scene, private readonly cellXY: (x: number, y: number) => { px: number; py: number }, private readonly binSlot: (i: number) => { px: number; py: number }) {}

  attach(): this {
    this.stallMark = fit(this.scene.add.image(0, 0, 'tile-sel')).setOrigin(0).setDepth(7).setTint(P.red).setVisible(false).setName('stall-mark');
    return this;
  }
  /** Forget every object (they were destroyed with the scene). */
  clear() { this.views.clear(); this.itemSprites.clear(); this.jamMarks.clear(); }
  centerOfCell(cell: number) { const x = cell % RULES.gridWidth, y = Math.floor(cell / RULES.gridWidth); return { x: GRID(x, y, this.cellXY).x, y: GRID(x, y, this.cellXY).y }; }

  // ---------- machines ----------
  private makeView(m: Machine): MachineView {
    const c = this.scene.add.container(0, 0).setDepth(2);
    const img = fit(this.scene.add.image(CELL / 2, CELL / 2, machineTexture(m.kind)));
    c.add(img);
    let belt: Phaser.GameObjects.Image | undefined;
    if (m.kind === 'conveyor') { belt = fit(this.scene.add.image(CELL / 2, CELL / 2, 'belt-0')); c.add(belt); }
    c.setSize(CELL, CELL);
    img.setInteractive({ useHandCursor: true, draggable: true });
    this.scene.input.setDraggable(img);
    const v: MachineView = { c, img, belt, m, inBin: false };
    img.setData('view', v);
    return v;
  }
  /** Machines follow the run: placed ones on their cells, shelf ones in their slots, the held one under the cursor; returns the ids that exist. */
  sync(run: RunState, hand: Hand): Set<number> {
    const alive = new Set<number>();
    const place = (m: Machine, inBin: boolean, px: number, py: number) => {
      let v = this.views.get(m.id);
      if (!v) { v = this.makeView(m); this.views.set(m.id, v); v.c.setPosition(px, py); }
      v.m = m; v.inBin = inBin; alive.add(m.id);
      const held = hand.heldId === m.id && hand.cursor ? this.cellXY(hand.cursor.x, hand.cursor.y) : null;
      if (held) { px = held.px; py = held.py; }
      if (!hand.dragging || hand.dragging.m.id !== m.id) { if (prefs.reducedMotion) v.c.setPosition(px, py); else this.scene.tweens.add({ targets: v.c, x: px, y: py, duration: 120, ease: 'Quad.out' }); }
      v.img.setAngle(m.dir * 90); v.belt?.setAngle(m.dir * 90);
      v.c.setDepth(held ? 10 : 2);
      v.c.setAlpha(held ? 0.85 : inBin ? 0.95 : 1);
    };
    run.layout.machines.forEach((m) => { const { px, py } = this.cellXY(m.x, m.y); place(m, false, px, py); });
    run.bin.forEach((m, i) => { const { px, py } = this.binSlot(i); place(m, true, px, py); });
    for (const [id, v] of this.views) if (!alive.has(id)) { v.c.destroy(); this.views.delete(id); }
    return alive;
  }
  /** A placed or rotated machine lands with a small pulse (not under reduced motion). */
  pulse(id: number, kind: 'place' | 'rotate') {
    if (prefs.reducedMotion) return;
    const v = this.views.get(id); if (!v) return;
    const b = baseScale(v.img.texture.key); this.scene.tweens.killTweensOf(v.img); fit(v.img, kind === 'place' ? 1.06 : 0.94);
    this.scene.tweens.add({ targets: v.img, scaleX: b, scaleY: b, duration: kind === 'place' ? 90 : 60, ease: 'Quad.out' });
  }

  // ---------- the live shift ----------
  /** One frame of the running shift: belts roll, machines show their state frames, items move between cells. */
  animate(sim: SimState, phase: number, delta: number, speed: number, time: number) {
    this.beltFrame = (this.beltFrame + delta * speed * 0.012 * (BELT_FRAMES / 3)) % BELT_FRAMES; // same cycle time as the old 3 frames, finer steps
    const bf = `belt-${Math.floor(this.beltFrame)}`;
    for (const v of this.views.values()) {
      if (v.inBin || prefs.reducedMotion) continue; // reduced motion: belts stay on frame 0, machines do not wobble
      if (v.belt) setArt(v.belt, bf);
      const f = machineFrame(v.m.kind, sim, cellIndex(v.m.x, v.m.y, RULES.gridWidth), phase);
      if (f.key && v.img.texture.key !== f.key) setArt(v.img, f.key);
      if (f.tint != null) v.img.setTint(f.tint);
      if (f.scale != null) fit(v.img, f.scale);
      if (f.angleOffset != null) v.img.setAngle(v.m.dir * 90 + f.angleOffset);
    }
    const alive = this.aliveIds; alive.clear();
    for (const it of sim.items) {
      alive.add(it.id);
      let s = this.itemSprites.get(it.id);
      if (!s) { s = fit(this.scene.add.image(0, 0, itemTexture(it.mat))).setDepth(4); this.itemSprites.set(it.id, s); }
      if (s.texture.key !== itemTexture(it.mat)) setArt(s, itemTexture(it.mat));
      const pose = itemPose(it, sim.tick, phase, prefs.reducedMotion, time);
      const to = this.centerOfCell(it.cell);
      if (pose.from != null) { const from = this.centerOfCell(pose.from); s.setPosition(from.x + (to.x - from.x) * pose.t, from.y + (to.y - from.y) * pose.t); }
      else s.setPosition(to.x, to.y);
      fit(s, pose.scale);
    }
    for (const [id, s] of this.itemSprites) if (!alive.has(id)) { this.itemSprites.delete(id); if (prefs.reducedMotion) s.destroy(); else this.scene.tweens.add({ targets: s, scale: 1.6, alpha: 0, duration: 200, onComplete: () => s.destroy() }); }
  }
  /** A tick's events as effects: transform flashes, press sparks, jam marks kept in step, the dock's pulse; the digest comes back for sounds, pops and the stall monitor. */
  applyTick(evs: SimEvent[]): TickDigest {
    const d = digestTick(evs, this.jamMarks, this.shipsThisTick, this.jammedNow);
    if (!prefs.reducedMotion) {
      for (const tr of d.transforms) { const c = this.centerOfCell(tr.cell); const flash = this.scene.add.circle(c.x, c.y, 16, transformColour(tr.to), 0.6).setDepth(3); this.scene.tweens.add({ targets: flash, scale: 2, alpha: 0, duration: 300, onComplete: () => flash.destroy() }); }
      for (const cell of d.absorbs) { const c = this.centerOfCell(cell); const spark = fit(this.scene.add.image(c.x, c.y, itemTexture('shards'))).setDepth(4).setAlpha(0.9); this.scene.tweens.add({ targets: spark, scale: 0.2 * baseScale(spark.texture.key), alpha: 0, duration: 220, onComplete: () => spark.destroy() }); } // a press swallowed a shard: shrink a shard marker into the machine
    }
    for (const cell of d.newJams) { const { x, y } = this.centerOfCell(cell); this.jamMarks.set(cell, fit(this.scene.add.image(x - CELL / 2, y - CELL / 2, 'tile-bad')).setOrigin(0).setDepth(3).setAlpha(0.7)); }
    for (const [cell, mk] of this.jamMarks) if (!d.jammed.has(cell)) { mk.destroy(); this.jamMarks.delete(cell); }
    if (!prefs.reducedMotion) for (const cell of d.ships.keys()) { const dock = [...this.views.values()].find((v) => !v.inBin && cellIndex(v.m.x, v.m.y, RULES.gridWidth) === cell); if (dock) this.scene.tweens.add({ targets: dock.img, scale: 1.08 * baseScale(dock.img.texture.key), duration: 60, yoyo: true }); } // the pulse is relative to the HiDPI base scale (review F15)
    return d;
  }
  /** The round is over: items and jam marks go, machines return to their rest frames and settle. */
  teardownRound() {
    for (const s of this.itemSprites.values()) s.destroy();
    this.itemSprites.clear();
    for (const j of this.jamMarks.values()) j.destroy();
    this.jamMarks.clear();
    for (const v of this.views.values()) { fit(v.img).setTint(0xffffff).setAngle(v.m.dir * 90); if (v.img.texture.key !== machineTexture(v.m.kind)) setArt(v.img, machineTexture(v.m.kind)); }
    if (!prefs.reducedMotion) for (const v of this.views.values()) if (!v.inBin) { const b = baseScale(v.img.texture.key); this.scene.tweens.add({ targets: v.img, scaleX: 0.97 * b, scaleY: 0.97 * b, duration: 120, yoyo: true, delay: v.m.x * 25, ease: 'Quad.out' }); }
  }
  // ---------- the stall mark ----------
  showStall(x: number, y: number) {
    const { px, py } = this.cellXY(x, y);
    this.stallMark.setPosition(px, py).setAlpha(1).setVisible(true);
    this.scene.tweens.killTweensOf(this.stallMark);
    if (!prefs.reducedMotion) this.scene.tweens.add({ targets: this.stallMark, alpha: 0.35, duration: 450, yoyo: true, repeat: -1 });
  }
  hideStall() { if (this.stallMark) { this.scene.tweens.killTweensOf(this.stallMark); this.stallMark.setVisible(false); } }
}

const GRID = (x: number, y: number, cellXY: (x: number, y: number) => { px: number; py: number }) => { const { px, py } = cellXY(x, y); return { x: px + CELL / 2, y: py + CELL / 2 }; };
