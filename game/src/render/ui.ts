import Phaser from 'phaser';
import { CSS, FONT, MONO, P } from './palette';
import { audio } from './audio';
import { prefs, px } from './prefs';

export interface ButtonOpts { w?: number; h?: number; color?: number; textColor?: string; size?: number; disabled?: boolean; name?: string }

/**
 * Hover state that keeps label contrast: dark labels sit on a lighter button, so brighten; light labels sit on a dark
 * button, so darken (brightening dark-steel to #79858f dropped light text to 3.1:1). Audited in tools/a11y-audit.ts.
 */
export function hoverColor(color: number, textColor: string): number {
  const light = /^#?[89a-f]/i.test(textColor.replace('#', '').slice(0, 1)) || textColor === '#f1e8d8';
  const c = Phaser.Display.Color.IntegerToColor(color);
  return light ? c.darken(12).color : c.brighten(12).color;
}

export class Button extends Phaser.GameObjects.Container {
  bg: Phaser.GameObjects.Rectangle;
  label: Phaser.GameObjects.Text;
  private color: number;
  private enabled = true;
  constructor(scene: Phaser.Scene, x: number, y: number, text: string, onClick: () => void, o: ButtonOpts = {}) {
    super(scene, x, y);
    const w = o.w ?? 160, h = o.h ?? 40;
    this.color = o.color ?? P.amber;
    this.bg = scene.add.rectangle(0, 0, w, h, this.color, 1).setStrokeStyle(2, 0x000000, 0.35);
    this.label = scene.add.text(0, 0, text, { fontFamily: FONT, fontSize: px(o.size ?? 16), color: o.textColor ?? '#1a1612', fontStyle: 'bold' }).setOrigin(0.5);
    this.add([this.bg, this.label]);
    this.setSize(w, h);
    this.setInteractive({ useHandCursor: true });
    this.name = o.name ?? text;
    this.on('pointerover', () => { if (this.enabled) this.bg.setFillStyle(hoverColor(this.color, o.textColor ?? '#1a1612')); });
    this.on('pointerout', () => this.bg.setFillStyle(this.color));
    this.on('pointerdown', () => { if (!this.enabled) return; audio.unlock(); audio.click(); if (!prefs.reducedMotion) this.scene.tweens.add({ targets: this, scale: 0.95, duration: 50, yoyo: true }); onClick(); });
    if (o.disabled) this.setEnabled(false);
    scene.add.existing(this);
  }
  setEnabled(v: boolean) { this.enabled = v; this.setAlpha(v ? 1 : 0.4); if (v) this.setInteractive({ useHandCursor: true }); else this.disableInteractive(); return this; }
  setText(t: string) { this.label.setText(t); return this; }
}

export function panel(scene: Phaser.Scene, x: number, y: number, w: number, h: number, alpha = 1) {
  const r = scene.add.rectangle(x, y, w, h, P.panel, alpha).setOrigin(0).setStrokeStyle(1, P.panelLine, 1);
  return r;
}

export function label(scene: Phaser.Scene, x: number, y: number, text: string, size = 14, color = CSS.text, style: Partial<Phaser.Types.GameObjects.Text.TextStyle> = {}) {
  return scene.add.text(x, y, text, { fontFamily: FONT, fontSize: px(size), color, ...style });
}
export function mono(scene: Phaser.Scene, x: number, y: number, text: string, size = 13, color = CSS.dim) {
  return scene.add.text(x, y, text, { fontFamily: MONO, fontSize: px(size), color });
}

/** Simple horizontal slider 0..1 */
export function slider(scene: Phaser.Scene, x: number, y: number, w: number, value: number, onChange: (v: number) => void) {
  const track = scene.add.rectangle(x, y, w, 6, P.panelLine).setOrigin(0, 0.5);
  const fill = scene.add.rectangle(x, y, w * value, 6, P.amber).setOrigin(0, 0.5);
  const knob = scene.add.circle(x + w * value, y, 9, P.text).setInteractive({ useHandCursor: true, draggable: true });
  const zone = scene.add.zone(x, y, w, 24).setOrigin(0, 0.5).setInteractive({ useHandCursor: true });
  const set = (px: number) => { const v = Phaser.Math.Clamp((px - x) / w, 0, 1); knob.x = x + w * v; fill.width = w * v; onChange(v); };
  scene.input.setDraggable(knob);
  knob.on('drag', (_p: unknown, dx: number) => set(dx));
  zone.on('pointerdown', (p: Phaser.Input.Pointer) => set(p.worldX)); // world coordinates: the camera is zoomed on HiDPI (render/dpr.ts)
  return { track, fill, knob, zone, set: (v: number) => set(x + w * v) };
}
