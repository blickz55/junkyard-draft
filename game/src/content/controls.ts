/**
 * The action table (production roadmap 0.10.1): every yard action once, with the keys that trigger it and, as string
 * keys, how the mouse and a finger do the same thing. render/InputController.ts binds the keys from this table, the Tips
 * panel lists it ("Mouse, touch and keys") and the build panel's keyboard line is composed from it, so the three can
 * never drift apart. Mouse, touch and keys all end in the same rule-checked actions.
 */
import { t, type StringKey } from './strings';

export type ControlId =
  'pick' | 'hold' | 'place' | 'stroke' | 'move' | 'select' | 'rotate' | 'toShelf' | 'undo' | 'redo' | 'start' | 'pause' | 'step' | 'next' | 'mute' | 'panel';

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
  { id: 'stroke', keys: [], placement: true },
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
  { id: 'panel', keys: [{ key: 'F6' }], placement: false },
];

/**
 * What the player moved (0.12.4), by slot: one key of one action. A handler goes on hearing the slot's own key, so moving one changes what fires
 * it and nothing else.
 */
export type KeyMap = Record<string, KeyBinding>;
export const slotId = (c: Control, b: KeyBinding) => `${c.id}.${b.ctrl ? 'ctrl+' : ''}${b.shift ? 'shift+' : ''}${b.key}`;
export const boundKey = (c: Control, b: KeyBinding, map: KeyMap): KeyBinding => map[slotId(c, b)] ?? b;

const KEY_WORDS: Readonly<Record<string, StringKey>> = {
  SPACE: 'keys.space',
  ENTER: 'keys.enter',
  TAB: 'keys.tab',
  ESC: 'keys.esc',
  DELETE: 'keys.delete',
  BACKSPACE: 'keys.backspace',
  UP: 'keys.up',
  DOWN: 'keys.down',
  LEFT: 'keys.left',
  RIGHT: 'keys.right',
  INSERT: 'keys.insert',
  HOME: 'keys.home',
  END: 'keys.end',
  PAGE_UP: 'keys.pageUp',
  PAGE_DOWN: 'keys.pageDown',
};
const KEY_MARKS: Readonly<Record<string, string>> = {
  ZERO: '0',
  ONE: '1',
  TWO: '2',
  THREE: '3',
  FOUR: '4',
  FIVE: '5',
  SIX: '6',
  SEVEN: '7',
  EIGHT: '8',
  NINE: '9',
  PERIOD: '.',
  COMMA: ',',
  MINUS: '-',
  PLUS: '=',
  SEMICOLON: ';',
  FORWARD_SLASH: '/',
  BACK_SLASH: '\\',
  QUOTES: "'",
  BACKTICK: '`',
  OPEN_BRACKET: '[',
  CLOSED_BRACKET: ']',
};
/** A key as the player reads it. */
export function keyLabel(b: KeyBinding): string {
  const name = KEY_WORDS[b.key] ? t(KEY_WORDS[b.key]) : (KEY_MARKS[b.key] ?? b.key);
  const shifted = b.shift ? t('keys.shift', { key: name }) : name;
  return b.ctrl ? t('keys.ctrl', { key: shifted }) : shifted;
}

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
/** The usual words, until the player moves a key of this action: then the keys themselves, so the page never tells them to press what no longer works. */
function keysText(c: Control, map: KeyMap): string {
  if (c.keys.some((b) => map[slotId(c, b)])) return c.keys.map((b) => keyLabel(boundKey(c, b, map))).join(', ');
  const place = CONTROLS.find((p) => p.id === 'place')!;
  return t(key(c.id, 'keys'), { enter: keyLabel(boundKey(place, { key: 'ENTER' }, map)) });
}
/** The table as the player reads it (built on each call so the pseudo-locale applies). */
export const controlRows = (map: KeyMap = {}): ControlRow[] =>
  CONTROLS.map((c) => ({ id: c.id, label: t(key(c.id, 'label')), keys: keysText(c, map), mouse: t(key(c.id, 'mouse')), touch: t(key(c.id, 'touch')) }));
/** The build panel's keyboard line: the placement actions and their keys. */
export const keyboardHelpList = (map: KeyMap = {}): string =>
  CONTROLS.filter((c) => c.placement)
    .map((c) => `${t(key(c.id, 'label'))}: ${keysText(c, map)}`)
    .join(' · ');
