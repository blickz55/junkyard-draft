/**
 * What is this? (docs/UX-STANDARD.md, "everything can be asked about"): the card a tap on any piece opens, in every phase. It
 * says what the machine does, what goes in, what comes out and what it did last shift, in the same words as the offer cards.
 * The scene anchors it on the board (GamePanel.showInspector); this module only builds it.
 */
import type Phaser from 'phaser';
import { h, btn, textureImg } from './dom';
import type { RunState } from '../sim/run';
import type { Machine } from '../sim/types';
import { cellIndex } from '../sim/sim';
import { machineTexture } from '../render/textures';
import { machineName, machineBlurb } from '../content/machines';
import { t, type StringKey } from '../content/strings';
import { int, money } from '../content/format';

/** What the machine did last shift, as a short line; empty when it was not in the yard then. */
export function lastShiftLine(m: Machine, run: RunState): string {
  const last = run.rounds[run.rounds.length - 1];
  if (!last || m.x < 0) return '';
  const was = last.layout.machines.find((q) => q.id === m.id);
  if (!was) return '';
  const st = last.result.cellStats[cellIndex(was.x, was.y, last.layout.width)];
  if (!st) return t('inspect.nothingYet');
  const parts: string[] = [];
  if (m.kind === 'hopper') parts.push(t('inspect.dropped', { n: int(st.spawned) }));
  else if (m.kind === 'dock') parts.push(t('inspect.shipped', { n: int(st.shipped), amount: money(st.earned) }));
  else if (m.kind === 'tuner') parts.push(t('inspect.sped', { n: int(st.tuned) }));
  else if (m.kind === 'conveyor' || m.kind === 'splitter') parts.push(t('inspect.moved', { n: int(st.passed) }));
  else parts.push(t('inspect.made', { n: int(st.processed) }));
  if (st.jammedTicks > 3 || st.blockedTicks > 3) parts.push(t('inspect.waited', { n: int(Math.max(st.jammedTicks, st.blockedTicks)) }));
  return parts.join(' · ');
}

const row = (label: string, value: string, tid: string) =>
  h('div', { class: 'jd-inspect-row', tid }, h('span', { class: 'jd-dim' }, label), h('span', {}, value));

/** The card for a machine, on the yard or on the shelf. */
export function machineCard(game: Phaser.Game, m: Machine, run: RunState, onClose: () => void): HTMLElement {
  const img = textureImg(game, machineTexture(m.kind), machineName(m.kind));
  img.style.transform = `rotate(${m.dir * 90}deg)`;
  const last = lastShiftLine(m, run);
  return h(
    'div',
    { class: 'jd-inspect-body', tid: 'inspector' },
    h(
      'div',
      { class: 'jd-inspect-head' },
      img,
      h(
        'div',
        { style: 'min-width:0' },
        h('div', { class: 'jd-inspect-name', tid: 'inspector-name' }, machineName(m.kind)),
        h('div', { class: 'jd-dim' }, machineBlurb(m.kind, run.layout)),
      ),
    ),
    row(t('inspect.in'), t(`machine.${m.kind}.in` as StringKey), 'inspector-in'),
    row(t('inspect.out'), t(`machine.${m.kind}.out` as StringKey), 'inspector-out'),
    last ? row(t('inspect.last'), last, 'inspector-last') : null,
    btn(t('inspect.close'), 'inspector-close', onClose, { small: true }),
  );
}
/** The card for a junk pile. */
export function rubbleCard(onClose: () => void): HTMLElement {
  return h(
    'div',
    { class: 'jd-inspect-body', tid: 'inspector' },
    h('div', { class: 'jd-inspect-name', tid: 'inspector-name' }, t('inspect.rubbleName')),
    h('div', { class: 'jd-dim' }, t('inspect.rubble')),
    btn(t('inspect.close'), 'inspector-close', onClose, { small: true }),
  );
}
