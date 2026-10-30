/**
 * The action table (production roadmap 0.10.1): every yard action once, with the keys that trigger it and, as string
 * keys, how the mouse and a finger do the same thing. render/InputController.ts binds the keys from this table, the Tips
 * panel lists it ("Mouse, touch and keys") and the build panel's keyboard line is composed from it, so the three can
 * never drift apart. Mouse, touch and keys all end in the same rule-checked actions.
 */
import { t, type StringKey } from './strings';

export type ControlId = 'pick' | 'hold' | 'place' | 'move' | 'select' | 'rotate' | 'toShelf' | 'undo' | 'redo' | 'start' | 'pause' | 'step' | 'next' | 'mute';

/** a Phaser key name (`keydown-<key>`) with the modifiers it needs; a binding without modifiers ignores a chord */
export interface KeyBinding {
  key: string;
  ctrl?: boolean;
  shift?: boolean;
}
export interface Control {
  id: ControlId;
  keys: readonly KeyBinding[];
  /** part of the build panel's keyboard line (the placement keys) */
  placement: boolean;
}

export const CONTROLS: readonly Control[] = [
  { id: 'pick', keys: [{ key: 'ONE' }, { key: 'TWO' }, { key: 'THREE' }], placement: false },
  { id: 'hold', keys: [{ key: 'TAB' }], placement: true },
  { id: 'place', keys: [{ key: 'UP' }, { key: 'DOWN' }, { key: 'LEFT' }, { key: 'RIGHT' }, { key: 'ENTER' }], placement: true },
  { id: 'move', keys: [], placement: true },
  { id: 'select', keys: [], placement: false },
  { id: 'rotate', keys: [{ key: 'R' }], placement: true },
  { id: 'toShelf', keys: [{ key: 'DELETE' }, { key: 'BACKSPACE' }], placement: true },
  { id: 'undo', keys: [{ key: 'Z', ctrl: true }], placement: false },
  {
    id: 'redo',
    keys: [
      { key: 'Y', ctrl: true },
      { key: 'Z', ctrl: true, shift: true },
    ],
    placement: false,
  },
  { id: 'start', keys: [{ key: 'SPACE' }], placement: false },
  { id: 'pause', keys: [{ key: 'ESC' }], placement: false },
  { id: 'step', keys: [{ key: 'PERIOD' }], placement: false },
  { id: 'next', keys: [{ key: 'SPACE' }], placement: false },
  { id: 'mute', keys: [{ key: 'M' }], placement: false },
];

/** How long a finger rests on a machine before it starts to drag (a shorter touch is a tap). */
export const LONG_PRESS_MS = 250;
/** A tap moves less than this many CSS px between down and up. */
export const TAP_SLOP_PX = 12;

export interface ControlRow {
  id: ControlId;
  label: string;
  keys: string;
  mouse: string;
  touch: string;
}
const key = (id: ControlId, part: 'label' | 'keys' | 'mouse' | 'touch') => `controls.${id}.${part}` as StringKey;
/** The table as the player reads it (built on each call so the pseudo-locale applies). */
export const controlRows = (): ControlRow[] =>
  CONTROLS.map((c) => ({ id: c.id, label: t(key(c.id, 'label')), keys: t(key(c.id, 'keys')), mouse: t(key(c.id, 'mouse')), touch: t(key(c.id, 'touch')) }));
/** The build panel's keyboard line: the placement actions and their keys. */
export const keyboardHelpList = (): string =>
  CONTROLS.filter((c) => c.placement)
    .map((c) => `${t(key(c.id, 'label'))}: ${t(key(c.id, 'keys'))}`)
    .join(' · ');
