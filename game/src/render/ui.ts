import Phaser from 'phaser';
import { CSS, FONT, P } from './palette';
import { px } from './prefs';

/**
 * Hover state that keeps label contrast: dark labels sit on a lighter button, so brighten; light labels sit on a dark
 * button, so darken (brightening dark-steel to #79858f dropped light text to 3.1:1). Audited in tools/a11y-audit.ts.
 */
export function hoverColor(color: number, textColor: string): number {
  const light = /^#?[89a-f]/i.test(textColor.replace('#', '').slice(0, 1)) || textColor === '#f1e8d8';
  const c = Phaser.Display.Color.IntegerToColor(color);
  return light ? c.darken(12).color : c.brighten(12).color;
}

/** A flat panel rectangle on the canvas (the shelf's backdrop). The controls themselves are DOM (ui/dom.ts) since DOSSIER-v1 0.4.0. */
export function panel(scene: Phaser.Scene, x: number, y: number, w: number, h: number, alpha = 1) {
  const r = scene.add.rectangle(x, y, w, h, P.panel, alpha).setOrigin(0).setStrokeStyle(1, P.panelLine, 1);
  return r;
}

export function label(scene: Phaser.Scene, x: number, y: number, text: string, size = 14, color = CSS.text, style: Partial<Phaser.Types.GameObjects.Text.TextStyle> = {}) {
  return scene.add.text(x, y, text, { fontFamily: FONT, fontSize: px(size), color, ...style });
}
