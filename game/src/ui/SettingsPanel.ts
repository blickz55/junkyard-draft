/**
 * Settings (docs/UX-STANDARD.md): everything that used to crowd the home screen, in one dialog with plain labels. Sound
 * (volume, levels, fewer sounds, the sound test), display (motion, text size, picture), you (name, Sal) and data and help
 * (play data, privacy, a problem report, the version). A change that needs the screen rebuilt restarts the scene after closing.
 */
import type Phaser from 'phaser';
import { h, btn, ui, showText } from './dom';
import { audio } from '../render/audio';
import { prefs } from '../render/prefs';
import { telemetry } from '../render/telemetry';
import { diagnostics } from '../render/errlog';
import { loadSettings, updateSettings } from '../render/storage';
import { chatter } from '../content/foreman';
import { t, type StringKey } from '../content/strings';
import { playerLabel, identityDialog } from './identityDialog';
import { openPrivacy } from './panels';

const section = (title: string, ...rows: HTMLElement[]) => h('section', { class: 'jd-set-section' }, h('div', { class: 'jd-head' }, title), ...rows);
const row = (label: string, ...right: HTMLElement[]) =>
  h('div', { class: 'jd-set-row' }, h('span', { class: 'jd-set-label' }, label), h('div', { class: 'jd-set-right' }, ...right));

export function openSettings(scene: Phaser.Scene, verifierUrl: string, restart: () => void): void {
  const prev = document.activeElement as HTMLElement | null;
  let needsRestart = false;
  const close = () => {
    layer.remove();
    prev?.focus?.();
    if (needsRestart) restart();
  };
  // ---- sound ----
  const volume = h('input', {
    type: 'range',
    min: '0',
    max: '1',
    step: '0.01',
    value: String(audio.volume),
    tid: 'volume',
    ariaLabel: t('title.volume'),
    onInput: (e) => audio.setVolume(Number((e.target as HTMLInputElement).value)),
  });
  const muteBtn = btn(
    audio.muted ? t('common.unmute') : t('common.mute'),
    'mute',
    () => {
      audio.setMuted(!audio.muted);
      muteBtn.textContent = audio.muted ? t('common.unmute') : t('common.mute');
    },
    { small: true },
  );
  const bus = (name: 'ui' | 'factory' | 'music', label: string) =>
    row(
      label,
      h('input', {
        type: 'range',
        min: '0',
        max: '1',
        step: '0.05',
        value: String(audio.buses[name]),
        tid: `bus-${name}`,
        ariaLabel: t('title.busVolume', { label }),
        onInput: (e) => audio.setBus(name, Number((e.target as HTMLInputElement).value)),
      }),
    );
  const quietLabel = () => (audio.reducedAudio ? t('title.reducedAudioOn') : t('title.reducedAudioOff'));
  const quiet = btn(
    quietLabel(),
    'reduced-audio',
    () => {
      audio.setReducedAudio(!audio.reducedAudio);
      quiet.textContent = quietLabel();
    },
    { small: true, title: t('title.reducedAudioTitle') },
  );
  const soundTest = h(
    'details',
    { tid: 'sound-test' },
    h('summary', { class: 'jd-dim' }, t('settings.soundTest')),
    h(
      'div',
      { class: 'jd-sound-list' },
      ...audio.previewList().map((s) =>
        h(
          'div',
          { class: 'jd-set-row' },
          h('span', { class: 'jd-set-label' }, t(`sound.${s.id.replace('-', '.')}` as StringKey)),
          btn(t('settings.play'), `sound-${s.id}`, () => audio.preview(s.id), { small: true }),
        ),
      ),
    ),
  );
  // ---- display ----
  const motionBtn = btn(
    prefs.reducedMotion ? t('title.motionReduced') : t('title.motionFull'),
    'motion',
    () => {
      telemetry.track('settings_changed', { key: 'reducedMotion' });
      prefs.setReducedMotion(!prefs.reducedMotion);
      motionBtn.textContent = prefs.reducedMotion ? t('title.motionReduced') : t('title.motionFull');
      needsRestart = true;
    },
    { small: true },
  );
  const textBtn = btn(
    prefs.textScaleLabel(),
    'textscale',
    () => {
      telemetry.track('settings_changed', { key: 'textScale' });
      prefs.setTextScale(prefs.nextTextScale());
      textBtn.textContent = prefs.textScaleLabel();
      needsRestart = true;
    },
    { small: true },
  );
  const quality = loadSettings().renderQuality;
  const qualityBtn = btn(
    quality === 'low' ? t('title.resolutionStandard') : quality === 'high' ? t('title.resolutionHigh') : t('title.resolutionAuto'),
    'quality',
    () => {
      telemetry.track('settings_changed', { key: 'renderQuality' });
      updateSettings({ renderQuality: quality === 'low' ? 'high' : 'low' });
      location.reload();
    },
    { small: true, title: t('title.resolutionTitle') },
  );
  // ---- you ----
  const playerBtn = btn(
    playerLabel(),
    'player',
    () => {
      void identityDialog(scene, verifierUrl, (note) => {
        playerBtn.textContent = playerLabel();
        needsRestart = true;
        if (note) {
          playerNote.textContent = note;
          playerNote.dataset.testid = 'player-note';
        }
      });
    },
    { small: true },
  );
  const playerNote = h('div', { class: 'jd-dim', style: 'font-size:0.75em' }, '');
  const chatterBtn = btn(
    chatter() === 'less' ? t('title.foremanLess') : t('title.foremanFull'),
    'foreman-chatter',
    () => {
      updateSettings({ chatter: chatter() === 'less' ? 'full' : 'less' });
      chatterBtn.textContent = chatter() === 'less' ? t('title.foremanLess') : t('title.foremanFull');
      needsRestart = true;
    },
    { small: true, title: t('title.foremanTitle') },
  );
  // ---- data and help ----
  const statsLabel = () => (telemetry.enabled ? t('title.statsOn') : t('title.statsOff'));
  const statsBtn = btn(
    statsLabel(),
    'telemetry',
    () => {
      telemetry.setEnabled(!telemetry.enabled);
      if (telemetry.enabled) telemetry.track('settings_changed', { key: 'telemetry' });
      statsBtn.textContent = statsLabel();
    },
    { small: true },
  );
  const privacyBtn = btn(
    t('title.privacyLink'),
    'settings-privacy',
    () =>
      openPrivacy(scene, verifierUrl, 'privacy', () => {
        playerBtn.textContent = playerLabel();
        statsBtn.textContent = statsLabel();
        needsRestart = true;
      }),
    { small: true, title: t('title.privacyTitle') },
  );
  const diagBtn = btn(
    t('title.diagnostics'),
    'diagnostics',
    () => {
      const text = diagnostics();
      const done = () => {
        diagBtn.textContent = t('common.copiedShort');
        setTimeout(() => {
          diagBtn.textContent = t('title.diagnostics');
        }, 1500);
      };
      const fallback = () => {
        void showText(scene, t('title.diagnosticsDialog'), text);
      };
      if (navigator.clipboard?.writeText) navigator.clipboard.writeText(text).then(done, fallback);
      else fallback();
    },
    { small: true, title: t('title.diagnosticsTitle') },
  );
  const box = h(
    'div',
    { class: 'jd-dialog jd-panel jd-settings', role: 'dialog', ariaLabel: t('home.settings'), tid: 'settings-dialog' },
    h(
      'div',
      { class: 'jd-row jd-between' },
      h('div', { class: 'jd-head jd-settings-title' }, t('home.settings')),
      btn(t('common.close'), 'settings-close', close, { small: true }),
    ),
    section(
      t('settings.sound'),
      row(t('title.volume'), volume, muteBtn),
      bus('ui', t('title.busUi')),
      bus('factory', t('title.busFactory')),
      bus('music', t('title.busMusic')),
      row('', quiet),
      soundTest,
    ),
    section(t('settings.display'), row(t('title.motion'), motionBtn), row(t('title.textSize'), textBtn), row('', qualityBtn)),
    section(t('settings.player'), row(t('home.name'), playerBtn), playerNote, row(t('settings.sal'), chatterBtn)),
    section(
      t('settings.data'),
      h('div', { class: 'jd-set-row' }, statsBtn, privacyBtn, diagBtn),
      h('div', { class: 'jd-dim', tid: 'telemetry-note', style: 'font-size:0.75em' }, t('title.statsNote')),
      h('div', { class: 'jd-dim', style: 'font-size:0.75em' }, t('title.build', { build: import.meta.env.BUILD })),
    ),
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
    if (e.key === 'Escape') {
      e.preventDefault();
      close();
    }
  });
  ui.layer(scene, layer);
  (box.querySelector('button') as HTMLButtonElement | null)?.focus();
}
