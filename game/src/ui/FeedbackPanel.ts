/**
 * The tester build's survey: a minute of questions, once per device, ending in a completion code to paste back where the tester signed
 * up. Only a tester build offers it (render/config.ts), and the answers go to deploy/test-link/worker.ts and nowhere else. A sign-up
 * service can pass its own id as `?tester=` on the link, and it travels with the answers so a code can be matched to a person.
 */
import type Phaser from 'phaser';
import { h, btn, ui } from './dom';
import { t, type StringKey } from '../content/strings';
import '../content/strings-more';
import { telemetry } from '../render/telemetry';
import { loadFeedbackCode, saveFeedbackCode } from '../render/storage';

const MAX_TEXT = 1000;

function testerId(): string | null {
  const id = new URLSearchParams(location.search).get('tester');
  return id && /^[\w-]{1,64}$/.test(id) ? id : null;
}

export function openFeedback(scene: Phaser.Scene, onClose: () => void = () => {}): void {
  const prev = document.activeElement as HTMLElement | null;
  const close = () => {
    layer.remove();
    prev?.focus?.();
    onClose();
  };
  const box = h('div', {
    class: 'jd-dialog jd-panel',
    role: 'dialog',
    ariaLabel: t('feedback.title'),
    tid: 'feedback-dialog',
    style: 'max-height:96%; overflow-y:auto; gap:0.7em; outline:none',
  });
  box.tabIndex = -1; // focus starts here and not in the first box, which on a phone would throw up the keyboard over the questions
  const layer = h('div', { class: 'jd-modal' }, box);
  layer.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Escape') close();
  });

  const thanks = (code: string) => {
    const copyBtn = btn(t('feedback.copy'), 'feedback-copy', () => {
      void navigator.clipboard?.writeText(code).then(() => (copyBtn.textContent = t('feedback.copied')));
    });
    box.replaceChildren(
      h('div', { class: 'jd-head' }, t('feedback.doneTitle')),
      h('div', {}, t('feedback.doneText')),
      h(
        'div',
        { tid: 'feedback-code', style: 'font-family:var(--jd-display); font-size:1.75em; letter-spacing:0.08em; text-align:center; user-select:all' },
        code,
      ),
      h(
        'div',
        { class: 'jd-row', style: 'gap:0.5em; justify-content:center' },
        copyBtn,
        btn(t('feedback.close'), 'feedback-close', close, { variant: 'primary' }),
      ),
    );
    box.focus();
  };

  const question = (key: StringKey, field: HTMLElement) => {
    field.setAttribute('aria-label', t(key));
    return h('div', { style: 'display:flex; flex-direction:column; gap:0.3em' }, h('div', { style: 'font-weight:600' }, t(key)), field);
  };
  const text = (tid: string) => {
    const area = h('textarea', { tid, class: 'jd-words' });
    area.maxLength = MAX_TEXT;
    return area;
  };
  /** One choice of several, as big as a thumb. */
  const choice = (name: string, options: { value: string; label: string }[]) => {
    const inputs = options.map((o) => {
      const input = h('input', { type: 'radio', tid: `${name}-${o.value}`, style: 'width:auto; margin:0' });
      input.name = name;
      input.value = o.value;
      return input;
    });
    const row = h(
      'div',
      { role: 'radiogroup', style: 'display:flex; flex-wrap:wrap; gap:0.5em 1em' },
      ...options.map((o, i) =>
        h('label', { style: 'display:flex; gap:0.35em; align-items:center; min-height:44px; padding-inline:0.3em' }, inputs[i], o.label),
      ),
    );
    return { row, value: () => inputs.find((x) => x.checked)?.value ?? null };
  };
  const scale = (name: string, low: StringKey, high: StringKey) => {
    const c = choice(
      name,
      ['1', '2', '3', '4', '5'].map((v) => ({ value: v, label: v })),
    );
    c.row.style.justifyContent = 'space-between';
    const row = h(
      'div',
      { role: 'group' },
      c.row,
      h('div', { class: 'jd-dim', style: 'display:flex; justify-content:space-between; font-size:0.8125em' }, h('span', {}, t(low)), h('span', {}, t(high))),
    );
    return { row, value: c.value };
  };
  const yesNo = (name: string) =>
    choice(name, [
      { value: 'yes', label: t('feedback.yes') },
      { value: 'maybe', label: t('feedback.maybe') },
      { value: 'no', label: t('feedback.no') },
    ]);

  const goal = text('feedback-goal');
  const clear = scale('feedback-clear', 'feedback.clearLow', 'feedback.clearHigh');
  const fun = scale('feedback-fun', 'feedback.funLow', 'feedback.funHigh');
  const back = yesNo('feedback-back');
  const worst = text('feedback-worst');
  const pay = yesNo('feedback-pay');
  const status = h('div', { class: 'jd-red', tid: 'feedback-status', role: 'status', style: 'font-size:0.875em; min-height:1.3em' });

  const send = async () => {
    const answers = {
      goal: goal.value.trim(),
      clear: Number(clear.value()),
      fun: Number(fun.value()),
      back: back.value(),
      worst: worst.value.trim(),
      pay: pay.value(),
    };
    if (!answers.goal || !answers.worst || !answers.clear || !answers.fun || !answers.back || !answers.pay) {
      status.textContent = t('feedback.missing');
      return;
    }
    sendBtn.disabled = true;
    status.textContent = '';
    try {
      const res = await fetch('/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ install: telemetry.installId, tester: testerId(), answers }),
      });
      const body = (await res.json()) as { ok?: boolean; code?: string };
      if (!res.ok || !body.code) throw new Error('refused');
      saveFeedbackCode(body.code);
      thanks(body.code);
    } catch {
      status.textContent = t('feedback.failed');
      sendBtn.disabled = false;
    }
  };
  const sendBtn = btn(t('feedback.send'), 'feedback-send', () => void send(), { variant: 'primary' });

  const code = loadFeedbackCode();
  if (code) thanks(code);
  else
    box.append(
      h('div', { class: 'jd-head' }, t('feedback.title')),
      h('div', { class: 'jd-dim', style: 'font-size:0.875em' }, t('feedback.note')),
      question('feedback.goal', goal),
      question('feedback.clear', clear.row),
      question('feedback.fun', fun.row),
      question('feedback.back', back.row),
      question('feedback.worst', worst),
      question('feedback.pay', pay.row),
      status,
      h('div', { class: 'jd-row', style: 'gap:0.5em' }, sendBtn, btn(t('feedback.later'), 'feedback-later', close)),
    );
  ui.layer(scene, layer);
  box.focus();
}
