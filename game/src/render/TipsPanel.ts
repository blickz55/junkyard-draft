/**
 * Tips panel (PLAN-v1 0.3.6): a list of tips with one live mini-simulation, drawn with the real textures and
 * stepped by the real simulation so it can never contradict the rules. Opened from the title and from the
 * build phase; opening a tip marks it read (storage) so its badge never returns. Tips never write to the hint
 * strip: rejections (0.3.2) own that channel.
 */
import Phaser from 'phaser';
import { TIPS, type Tip } from '../sim/tips';
import { createSim, step, type SimState } from '../sim/sim';
import { CELL, itemTexture, machineTexture } from './textures';
import { Button, label, panel } from './ui';
import { CSS, FONT, P } from './palette';
import { loadReadTips, markTipRead } from './storage';
import { prefs, px } from './prefs';
import { telemetry } from './telemetry';
import { W, H } from './layout';

const DEMO_CELL = Math.round(CELL * 0.75);
const DEMO_TICK_MS = 240;

export class TipsPanel {
  private root: Phaser.GameObjects.Container | null = null;
  private demo: Phaser.GameObjects.Container | null = null;
  private demoItems = new Map<number, Phaser.GameObjects.Image>();
  private demoSim: SimState | null = null;
  private demoTip: Tip | null = null;
  private demoTimer: Phaser.Time.TimerEvent | null = null;
  private demoLine: Phaser.GameObjects.Text | null = null;
  private current: string | null = null;

  constructor(private readonly scene: Phaser.Scene, private readonly onClose?: () => void) {}

  get isOpen(): boolean { return this.root != null; }
  get currentId(): string | null { return this.current; }
  /** Demo progress for tests: current tick and what shipped so far in this loop. */
  demoState() { return this.demoSim ? { tip: this.demoTip?.id ?? null, tick: this.demoSim.tick, shipped: { ...this.demoSim.shipped } } : null; }

  open(tipId?: string) {
    if (this.root) { if (tipId) this.show(tipId); return; }
    const s = this.scene;
    const root = s.add.container(0, 0).setDepth(30).setName('tips-panel');
    const dim = s.add.rectangle(0, 0, W, H, 0x000000, 0.6).setOrigin(0).setInteractive(); // swallows clicks under the panel
    root.add(dim);
    const PW = 820, PH = 470, PX = (W - PW) / 2, PY = (H - PH) / 2;
    root.add(panel(s, PX, PY, PW, PH, 0.98));
    root.add(label(s, PX + 20, PY + 14, 'TIPS — each demo is the real simulation', 13, CSS.amber, { fontStyle: 'bold', letterSpacing: 2 }));
    root.add(new Button(s, PX + PW - 60, PY + 26, 'Close (Esc)', () => this.close(), { w: 100, h: 26, color: P.steelDark, textColor: CSS.text, size: 12, name: 'tips-close' }));
    const read = loadReadTips();
    TIPS.forEach((t, i) => {
      const unread = !read.includes(t.id);
      const b = new Button(s, PX + 20 + 120, PY + 62 + i * 40, (unread ? '● ' : '') + t.title, () => this.show(t.id), { w: 240, h: 32, color: P.steelDark, textColor: CSS.text, size: 12, name: `tip-${t.id}` });
      root.add(b);
    });
    this.root = root;
    this.show(tipId ?? TIPS[0].id);
  }

  close() {
    if (!this.root) return;
    this.stopDemo();
    this.root.destroy(true); this.root = null; this.demo = null; this.demoLine = null; this.current = null;
    this.onClose?.();
  }

  /** Show one tip: its text, its demo loop, and mark it read. */
  private show(tipId: string) {
    const tip = TIPS.find((t) => t.id === tipId); if (!tip || !this.root) return;
    this.current = tipId;
    markTipRead(tipId);
    telemetry.track('tip_opened', { id: tipId });
    const btn = this.root.getByName(`tip-${tipId}`) as Button | null; btn?.setText(tip.title);
    this.stopDemo();
    this.demo?.destroy(true); this.demo = null;
    const s = this.scene;
    const PW = 820, PH = 470, PX = (W - PW) / 2, PY = (H - PH) / 2;
    const c = s.add.container(0, 0); this.root.add(c); this.demo = c;
    const x0 = PX + 290;
    c.add(label(s, x0, PY + 56, tip.title, 18, CSS.text, { fontStyle: 'bold' }));
    const body = label(s, x0, PY + 88, tip.text, 13, CSS.dim, { wordWrap: { width: PW - 310 }, lineSpacing: 3 });
    c.add(body);
    if (!tip.layout) return;
    const ly = PY + 88 + body.height + 18;
    const gw = tip.layout.width * DEMO_CELL, gh = tip.layout.height * DEMO_CELL;
    const gx = x0 + Math.floor((PW - 310 - gw) / 2);
    const demoBox = s.add.container(gx, ly).setName('tips-demo'); c.add(demoBox);
    for (let y = 0; y < tip.layout.height; y++) for (let x = 0; x < tip.layout.width; x++) demoBox.add(s.add.image(x * DEMO_CELL, y * DEMO_CELL, 'tile').setOrigin(0).setDisplaySize(DEMO_CELL, DEMO_CELL));
    demoBox.add(s.add.rectangle(0, 0, gw, gh).setOrigin(0).setStrokeStyle(2, P.panelLine));
    for (const m of tip.layout.machines) {
      const img = s.add.image(m.x * DEMO_CELL + DEMO_CELL / 2, m.y * DEMO_CELL + DEMO_CELL / 2, machineTexture(m.kind)).setScale(DEMO_CELL / CELL).setAngle(m.dir * 90);
      demoBox.add(img);
    }
    this.demoLine = label(s, x0, ly + gh + 12, tip.watch, 12, CSS.amber).setName('tips-watch');
    c.add(this.demoLine);
    this.startDemo(tip, demoBox);
  }

  private startDemo(tip: Tip, box: Phaser.GameObjects.Container) {
    if (!tip.layout) return;
    this.demoTip = tip;
    this.demoSim = createSim(tip.layout);
    this.demoItems.clear();
    const s = this.scene;
    const tickOnce = () => {
      const sim = this.demoSim; if (!sim || !tip.layout) return;
      if (sim.tick >= tip.ticks) { // loop: wipe the items and restart from an empty line
        for (const img of this.demoItems.values()) img.destroy(); this.demoItems.clear();
        this.demoSim = createSim(tip.layout); return;
      }
      step(sim);
      const alive = new Set<number>();
      for (const it of sim.items) {
        alive.add(it.id);
        let img = this.demoItems.get(it.id);
        if (!img) { img = s.add.image(0, 0, itemTexture(it.mat)).setScale(DEMO_CELL / CELL).setDepth(1); box.add(img); this.demoItems.set(it.id, img); }
        if (img.texture.key !== itemTexture(it.mat)) img.setTexture(itemTexture(it.mat));
        const tx = (it.cell % sim.width) * DEMO_CELL + DEMO_CELL / 2, ty = Math.floor(it.cell / sim.width) * DEMO_CELL + DEMO_CELL / 2;
        if (prefs.reducedMotion || it.movedAt !== sim.tick) img.setPosition(tx, ty);
        else s.tweens.add({ targets: img, x: tx, y: ty, duration: DEMO_TICK_MS * 0.7 });
      }
      for (const [id, img] of this.demoItems) if (!alive.has(id)) { img.destroy(); this.demoItems.delete(id); }
      const shipped = Object.entries(sim.shipped).filter(([, n]) => n > 0).map(([k, n]) => `${n} ${k}`).join(', ');
      this.demoLine?.setText(`${tip.watch}  ·  tick ${sim.tick}/${tip.ticks}  ·  shipped: ${shipped || 'nothing yet'}`);
    };
    this.demoTimer = s.time.addEvent({ delay: DEMO_TICK_MS, loop: true, callback: tickOnce });
  }
  private stopDemo() {
    this.demoTimer?.remove(false); this.demoTimer = null;
    for (const img of this.demoItems.values()) img.destroy();
    this.demoItems.clear(); this.demoSim = null; this.demoTip = null;
  }
}

/** Font helper re-exported so scenes placing the Tips button size its badge consistently. */
export const tipsFont = (size: number) => ({ fontFamily: FONT, fontSize: px(size) });
