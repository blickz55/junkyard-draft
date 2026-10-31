/**
 * A dialog of big, plain choices (docs/UX-STANDARD.md): the game menu, the job card, the end of the lesson, how to play. One
 * primary, the rest step back; Esc or a tap outside takes the `onDismiss` way out when there is one. Keyboard stays inside the
 * dialog, and focus goes back to where it came from.
 */
import type Phaser from 'phaser';
import { h, btn, ui, type Child } from './dom';

export interface Choice {
  label: string;
  tid: string;
  primary?: boolean;
  /** close the dialog first unless this says to stay open (a toggle) */ keepOpen?: boolean;
  run?: (button: HTMLButtonElement) => void;
}
export interface ChoiceOptions {
  title: string;
  tid: string;
  /** anything above the buttons */ lead?: Child[];
  choices: Choice[];
  /** a quiet line under the buttons */ note?: string;
  /** Esc and a tap outside; without it the dialog must be answered */ onDismiss?: () => void;
}
export function choiceDialog(scene: Phaser.Scene, o: ChoiceOptions): () => void {
  const prev = document.activeElement as HTMLElement | null;
  let open = true;
  const close = () => {
    if (!open) return;
    open = false;
    layer.remove();
    prev?.focus?.();
  };
  const buttons = o.choices.map((c) => {
    const b: HTMLButtonElement = btn(
      c.label,
      c.tid,
      () => {
        if (!c.keepOpen) close();
        c.run?.(b);
      },
      { variant: c.primary ? 'primary' : 'dark' },
    );
    return b;
  });
  const box = h(
    'div',
    { class: 'jd-dialog jd-panel jd-choice', role: 'dialog', ariaLabel: o.title, tid: o.tid },
    h('div', { class: 'jd-head' }, o.title),
    ...(o.lead ?? []),
    h('div', { class: 'jd-choice-buttons' }, ...buttons),
    o.note ? h('div', { class: 'jd-dim jd-choice-note' }, o.note) : null,
  );
  const dismiss = () => {
    if (!o.onDismiss) return;
    close();
    o.onDismiss();
  };
  const layer = h(
    'div',
    {
      class: 'jd-modal',
      onClick: (e) => {
        if (e.target === layer) dismiss();
      },
    },
    box,
  );
  layer.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Escape') {
      e.preventDefault();
      dismiss();
    } else if (e.key === 'Tab') {
      const i = buttons.indexOf(document.activeElement as HTMLButtonElement);
      if (i >= 0) {
        e.preventDefault();
        buttons[(i + (e.shiftKey ? -1 : 1) + buttons.length) % buttons.length].focus();
      }
    }
  });
  ui.layer(scene, layer);
  (buttons.find((_, i) => o.choices[i].primary) ?? buttons[0])?.focus();
  return close;
}
