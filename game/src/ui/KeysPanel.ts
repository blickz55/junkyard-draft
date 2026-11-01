/**
 * Moving keys (0.12.4): every key of every action, one press to change it. Kept on this device, because a keyboard belongs to the machine in
 * front of you. A key that already does something else is refused, by name, and not swapped behind the player's back.
 * Loaded on first use (ui/panels.ts).
 */
import type Phaser from 'phaser';
import { keyLabel, type KeyBinding, type KeyMap } from '../content/controls';
import { KEY_SLOTS, keyNameOf, takenBy, type KeySlot } from '../content/keymap';
import { t, type StringKey } from '../content/strings';
import '../content/strings-more';
import { loadKeyMap, saveKeyMap } from '../render/storage';
import { addStyle, btn, h, ui } from './dom';

const STYLE = `
#ui .jd-keys-list { max-height: 60vh; overflow: auto; display: flex; flex-direction: column; gap: 0.25em; }
#ui .jd-keys-row { display: flex; align-items: center; justify-content: space-between; gap: 0.75em; font-size: 0.875em; }
#ui .jd-keys-row .jd-btn { min-width: 6.5em; }
`;
/** What a slot does, where one action has several keys. */
const PART: Readonly<Record<string, StringKey>> = {
  'pick.ONE': 'keys.pick1',
  'pick.TWO': 'keys.pick2',
  'pick.THREE': 'keys.pick3',
  'place.UP': 'keys.cursorUp',
  'place.DOWN': 'keys.cursorDown',
  'place.LEFT': 'keys.cursorLeft',
  'place.RIGHT': 'keys.cursorRight',
  'place.ENTER': 'keys.confirm',
  'toShelf.BACKSPACE': 'keys.toShelfToo',
  'redo.ctrl+shift+Z': 'keys.redoToo',
};
const slotName = (s: KeySlot) => t(PART[s.id] ?? (`controls.${s.control.id}.label` as StringKey));

export function openKeys(scene: Phaser.Scene): void {
  addStyle('jd-keys-style', STYLE);
  let map: KeyMap = loadKeyMap();
  let listening: { slot: KeySlot; button: HTMLButtonElement } | null = null;
  const prev = document.activeElement as HTMLElement | null;
  const shown = (s: KeySlot) => keyLabel(map[s.id] ?? s.binding);
  const stop = () => {
    if (listening) listening.button.textContent = shown(listening.slot);
    listening = null;
  };
  const close = () => {
    document.removeEventListener('keydown', onKey, true);
    layer.remove();
    prev?.focus?.();
  };
  const status = h('div', { class: 'jd-amber', tid: 'keys-status', role: 'status', style: 'min-height:1.3em; font-size:0.875em' });
  const list = h('div', { class: 'jd-keys-list', tid: 'keys-list' });
  /** The next key press, before anything else hears it. Esc lets go, so a mistaken click costs nothing. */
  const onKey = (e: KeyboardEvent) => {
    if (!listening) return;
    if (['Shift', 'Control', 'Alt', 'Meta'].includes(e.key)) return; // a chord: wait for the key it goes with
    e.preventDefault();
    e.stopPropagation();
    const { slot, button } = listening;
    if (e.key === 'Escape') {
      stop();
      status.textContent = '';
      return;
    }
    const name = keyNameOf(e.keyCode);
    if (!name) {
      status.textContent = t('keys.cannot');
      return;
    }
    const binding: KeyBinding = { key: name, ...(e.ctrlKey || e.metaKey ? { ctrl: true } : {}), ...(e.shiftKey ? { shift: true } : {}) };
    const taken = takenBy(map, slot, binding);
    if (taken) {
      status.textContent = t('keys.taken', { key: keyLabel(binding), action: slotName(taken) });
      return;
    }
    map = { ...map, [slot.id]: binding };
    saveKeyMap(map);
    status.textContent = '';
    stop();
    button.focus();
  };
  const row = (s: KeySlot) => {
    const change: HTMLButtonElement = btn(
      shown(s),
      `key-${s.id}`,
      () => {
        stop();
        listening = { slot: s, button: change };
        change.textContent = t('keys.press');
        status.textContent = '';
      },
      { small: true, title: t('keys.changeTitle', { action: slotName(s) }) },
    );
    return h('div', { class: 'jd-keys-row' }, h('span', {}, slotName(s)), change);
  };
  const draw = () => list.replaceChildren(...KEY_SLOTS.map(row));
  const reset = btn(
    t('keys.reset'),
    'keys-reset',
    () => {
      listening = null;
      map = {};
      saveKeyMap(map);
      status.textContent = '';
      draw();
    },
    { small: true },
  );
  const box = h(
    'div',
    { class: 'jd-dialog jd-panel', role: 'dialog', ariaLabel: t('keys.head'), tid: 'keys-dialog' },
    h('div', { class: 'jd-row jd-between' }, h('div', { class: 'jd-head' }, t('keys.head')), btn(t('common.close'), 'keys-close', close, { small: true })),
    h('div', { class: 'jd-dim', style: 'font-size:0.875em' }, t('keys.lead')),
    list,
    status,
    reset,
  );
  const layer = h(
    'div',
    {
      class: 'jd-modal',
      onClick: (e) => {
        if (e.target === layer) close();
      },
    },
    box,
  );
  layer.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Escape') close();
  });
  document.addEventListener('keydown', onKey, true);
  draw();
  ui.layer(scene, layer);
  (box.querySelector('[data-testid=keys-close]') as HTMLElement | null)?.focus();
}
