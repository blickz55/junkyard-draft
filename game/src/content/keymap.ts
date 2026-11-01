/** Moving a key (0.12.4): what a key press is called, and whether a key is free. Read by the panel that moves them, so it weighs nothing on a first visit. */
import { boundKey, CONTROLS, slotId, type Control, type ControlId, type KeyBinding, type KeyMap } from './controls';

export interface KeySlot {
  id: string;
  control: Control;
  binding: KeyBinding;
}
export const KEY_SLOTS: readonly KeySlot[] = CONTROLS.flatMap((control) => control.keys.map((binding) => ({ id: slotId(control, binding), control, binding })));

const NAMES: Readonly<Record<number, string>> = {
  8: 'BACKSPACE',
  9: 'TAB',
  13: 'ENTER',
  27: 'ESC',
  32: 'SPACE',
  33: 'PAGE_UP',
  34: 'PAGE_DOWN',
  35: 'END',
  36: 'HOME',
  37: 'LEFT',
  38: 'UP',
  39: 'RIGHT',
  40: 'DOWN',
  45: 'INSERT',
  46: 'DELETE',
  186: 'SEMICOLON',
  187: 'PLUS',
  188: 'COMMA',
  189: 'MINUS',
  190: 'PERIOD',
  191: 'FORWARD_SLASH',
  192: 'BACKTICK',
  219: 'OPEN_BRACKET',
  220: 'BACK_SLASH',
  221: 'CLOSED_BRACKET',
  222: 'QUOTES',
};
const DIGITS = ['ZERO', 'ONE', 'TWO', 'THREE', 'FOUR', 'FIVE', 'SIX', 'SEVEN', 'EIGHT', 'NINE'];

/** The name Phaser gives a key (`keydown-<name>`), or null for one that cannot carry an action: a modifier alone, say. */
export function keyNameOf(keyCode: number): string | null {
  if (keyCode >= 65 && keyCode <= 90) return String.fromCharCode(keyCode);
  if (keyCode >= 48 && keyCode <= 57) return DIGITS[keyCode - 48];
  if (keyCode >= 112 && keyCode <= 123) return `F${keyCode - 111}`;
  return NAMES[keyCode] ?? null;
}

/** Space starts a shift and starts the next one: the two never happen at the same moment, so they may share a key. */
const MAY_SHARE: readonly (readonly ControlId[])[] = [['start', 'next']];
const shares = (a: ControlId, b: ControlId) => MAY_SHARE.some((pair) => pair.includes(a) && pair.includes(b));
const same = (a: KeyBinding, b: KeyBinding) => a.key === b.key && !!a.ctrl === !!b.ctrl && !!a.shift === !!b.shift;

/** The slot that already has this key, if moving `slot` onto it would make one key do two things. */
export function takenBy(map: KeyMap, slot: KeySlot, binding: KeyBinding): KeySlot | null {
  return KEY_SLOTS.find((s) => s.id !== slot.id && !shares(s.control.id, slot.control.id) && same(boundKey(s.control, s.binding, map), binding)) ?? null;
}
