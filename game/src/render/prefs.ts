/**
 * Accessibility preferences: reduced motion and text size. Persisted with the other settings
 * (`jd.settings.v1`). Read live by the scenes; text size is applied through the UI helpers'
 * font sizes (the canvas keeps its fixed 1120×700 layout and already FITs the window, so text
 * size is the lever that actually makes things easier to read).
 */
import { loadSettings, updateSettings } from './storage';

export const TEXT_SCALES = [1, 1.15, 1.3] as const;
export type TextScale = (typeof TEXT_SCALES)[number];

const s = loadSettings();

export const prefs = {
  reducedMotion: s.reducedMotion,
  textScale: (TEXT_SCALES as readonly number[]).includes(s.textScale) ? (s.textScale as TextScale) : (1 as TextScale),
  setReducedMotion(v: boolean) { this.reducedMotion = v; updateSettings({ reducedMotion: v }); },
  setTextScale(v: TextScale) { this.textScale = v; updateSettings({ textScale: v }); },
  nextTextScale(): TextScale { const i = TEXT_SCALES.indexOf(this.textScale); return TEXT_SCALES[(i + 1) % TEXT_SCALES.length]; },
  textScaleLabel(): string { return `${Math.round(this.textScale * 100)}%`; },
};

/** Font size in px for a base size, scaled by the text-size preference. */
export const px = (base: number): string => `${Math.round(base * prefs.textScale)}px`;
