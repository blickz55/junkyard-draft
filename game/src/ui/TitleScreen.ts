/** Title screen as DOM (DOSSIER-v1 0.4.0). The Phaser TitleScene keeps the decorative belt and the tips panel; everything else lives here. */
import type Phaser from 'phaser';
import { h, btn, ui, alertText, dialog, promptText } from './dom';
import { RULES_VERSION } from '../sim/types';
import type { TipsPanel } from './TipsPanel';
import { telemetry } from '../render/telemetry';
import { audio } from '../render/audio';
import { prefs } from '../render/prefs';
import { DPR } from '../render/dpr';
import { clearSave, dailySeed, hasUnusableSave, loadArchivedBests, loadBests, loadPlayer, loadSave, loadSettings, loadSubmissions, randomSeed, savePlayer, updateSettings, isOnboarded } from '../render/storage';
import { MAX_SEED_LENGTH, sanitizeSeed, TUTORIAL_SEED } from '../sim/run';
import { decodeReplay, verifyReplay } from '../sim/replay';
import { fetchVerifiedReplay, playVerifiedReplay } from '../render/verified';

export function mountTitle(scene: Phaser.Scene, tips: TipsPanel) {
  const save = loadSave();
  const bests = loadBests();
  const fresh = !isOnboarded();
  const start = (seed: string, freshRun: boolean) => { audio.unlock(); if (freshRun) clearSave(); scene.scene.start('Game', { seed, fresh: freshRun }); };
  const continueRun = () => { if (save) { audio.unlock(); scene.scene.start('Game', { seed: save.seed, fresh: false, actions: save.actions }); } };
  const restart = () => scene.scene.restart();

  // top bar: build, player, resolution, share stats
  const playerLabel = () => (loadPlayer() ? `Player: ${loadPlayer()}` : 'Set player name…');
  const playerBtn = btn(playerLabel(), 'player', () => { void promptText(scene, 'Player name', 'Name shown on verified boards (max 32 characters, leave empty to clear):', loadPlayer() || 'player', 32).then((typed) => { if (typed !== null) { savePlayer(typed); playerBtn.textContent = playerLabel(); } }); }, { small: true });
  const quality = loadSettings().renderQuality;
  const qualityLabel = quality === 'low' ? 'Resolution: Standard' : quality === 'high' ? 'Resolution: High' : `Resolution: Auto (${DPR}×)`;
  const qualityBtn = btn(qualityLabel, 'quality', () => { telemetry.track('settings_changed', { key: 'renderQuality' }); updateSettings({ renderQuality: quality === 'low' ? 'high' : 'low' }); location.reload(); }, { small: true, title: 'High = device pixel ratio (crisper), Standard = 1× (smoother on weak machines); applies on reload' });
  const statsLabel = () => `Share stats: ${telemetry.enabled ? 'On' : 'Off'}`;
  const statsBtn = btn(statsLabel(), 'telemetry', () => { telemetry.setEnabled(!telemetry.enabled); if (telemetry.enabled) telemetry.track('settings_changed', { key: 'telemetry' }); statsBtn.textContent = statsLabel(); }, { small: true });
  const top = h('div', { class: 'jd-row jd-between' },
    h('span', { class: 'jd-mono jd-dim', style: 'font-size:0.7em' }, `build ${import.meta.env.BUILD}`),
    h('div', { class: 'jd-row', style: 'gap:0.5em' }, playerBtn, qualityBtn, statsBtn));
  const statsNote = h('div', { class: 'jd-mono jd-dim', tid: 'telemetry-note', style: 'font-size:0.6em; text-align:right; margin-top:-0.3em' }, 'Anonymous play statistics only: which steps you reach, never seeds or layouts.');

  // hero
  const hero = h('div', { style: 'text-align:center' },
    h('div', { class: 'jd-amber', style: 'font-size:2.6em; font-weight:700; letter-spacing:0.12em; line-height:1.05' }, 'JUNKYARD DRAFT'),
    h('div', { class: 'jd-dim', style: 'font-size:1em; margin-top:0.15em' }, 'Draft salvaged machines. Build a production line. Beat your best.'));

  // actions
  const actions = h('div', { style: 'display:flex; flex-direction:column; align-items:center; gap:0.35em; margin-top:0.25em' });
  if (save) {
    const shortSeed = save.seed.length > 22 ? `${save.seed.slice(0, 20)}…` : save.seed;
    actions.append(btn(`Continue run (${shortSeed})`, 'continue', continueRun, { variant: 'primary' }));
    actions.append(h('div', { class: 'jd-mono jd-dim', tid: 'continue-note', style: 'font-size:0.75em' }, 'Starting a new run discards the saved one.'));
  } else if (hasUnusableSave()) {
    actions.append(h('div', { class: 'jd-mono jd-dim', tid: 'continue-note', style: 'font-size:0.75em; text-align:center; max-width:40em' }, 'A saved run was found but cannot be resumed (damaged or from older rules); it will be replaced by your next run.'));
    clearSave();
  }
  actions.append(h('div', { class: 'jd-row jd-center' },
    btn("Today's challenge", 'daily', () => start(dailySeed(), true), { variant: 'primary' }),
    btn('Random seed', 'random', () => start(randomSeed(), true), { variant: 'steel' })));
  actions.append(h('div', { class: 'jd-row jd-center' },
    btn(fresh ? 'Learn to play (3 min)' : 'Learn (3 min)', 'learn', () => start(TUTORIAL_SEED, true), { variant: fresh ? 'primary' : 'dark' }),
    btn('Custom seed…', 'custom', () => { void promptText(scene, 'Custom seed', `Same seed = same offers for everyone; up to ${MAX_SEED_LENGTH} characters.`, 'junkyard', MAX_SEED_LENGTH).then((s) => { if (s && s.trim()) start(sanitizeSeed(s), true); }); }),
    btn('Import replay…', 'import', () => importReplay(scene))));

  // how to play + tips
  const howto = h('div', { class: 'jd-panel' },
    h('div', { class: 'jd-row jd-between' }, h('div', { class: 'jd-head' }, 'How to play'), btn('Tips & demos', 'tips', () => tips.open(), { small: true })),
    ...['1. Each round, pick one of three salvaged machines.', '2. Drag parts onto the grid; R or right-click rotates.', '3. RUN: machines transform scrap; the dock sells it.', '4. Scrap $1 → Crusher → Shards $3 → Furnace → Ingot $12.', '5. Six rounds. Score = total money shipped. Try again.']
      .map((line, i) => h('div', { tid: `howto-${i + 1}`, style: 'font-size:0.9375em; margin-top:0.2em' }, line)));

  // bests + settings
  const todayBest = bests.bySeed[dailySeed()];
  const volume = h('input', { type: 'range', min: '0', max: '1', step: '0.01', value: String(audio.volume), tid: 'volume', ariaLabel: 'Volume', onInput: (e) => audio.setVolume(Number((e.target as HTMLInputElement).value)) });
  const muteBtn = btn(audio.muted ? 'Unmute' : 'Mute', 'mute', () => { audio.setMuted(!audio.muted); muteBtn.textContent = audio.muted ? 'Unmute' : 'Mute'; }, { small: true });
  const motionBtn = btn(prefs.reducedMotion ? 'Reduced' : 'Full', 'motion', () => { telemetry.track('settings_changed', { key: 'reducedMotion' }); prefs.setReducedMotion(!prefs.reducedMotion); restart(); }, { small: true });
  const textBtn = btn(prefs.textScaleLabel(), 'textscale', () => { telemetry.track('settings_changed', { key: 'textScale' }); prefs.setTextScale(prefs.nextTextScale()); restart(); }, { small: true });
  const bestsPanel = h('div', { class: 'jd-panel' },
    h('div', { class: 'jd-head' }, 'Local personal bests'),
    h('div', { style: 'margin-top:0.35em; font-size:0.9375em' }, bests.overall ? `Best score: $${bests.overall.score}  (seed ${bests.overall.seed})` : 'No finished runs yet on this device.'),
    h('div', { class: 'jd-dim', style: 'font-size:0.875em' }, todayBest ? `Today's challenge best: $${todayBest.score}` : "Today's challenge: not played yet"),
    h('div', { class: 'jd-mono jd-dim', style: 'font-size:0.75em' }, `${bests.runs} run(s) recorded locally · not verified online`),
    ...loadArchivedBests().map(({ version, bests: ab }) => h('details', { tid: `archived-bests-${version}`, style: 'margin-top:0.2em' }, h('summary', { class: 'jd-dim', style: 'font-size:0.75em; cursor:pointer' }, `Under rules v${version}`), h('div', { class: 'jd-mono jd-dim', style: 'font-size:0.75em; margin-top:0.15em' }, `${ab.overall ? `best $${ab.overall.score} (seed ${ab.overall.seed}) · ` : ''}${ab.runs} run(s) · kept, not comparable with v${RULES_VERSION}`))),
    h('div', { class: 'jd-row', style: 'margin-top:0.6em' }, h('span', { class: 'jd-dim', style: 'font-size:0.8125em' }, 'Volume'), volume, muteBtn),
    (() => {
      // audio buses (DOSSIER-v1 0.4.9): collapsed so the title keeps its height at 130 % text
      const bus = (name: 'ui' | 'factory' | 'music', label: string) => h('label', { class: 'jd-dim', style: 'font-size:0.75em; display:inline-flex; align-items:center; gap:0.3em' }, label, h('input', { type: 'range', min: '0', max: '1', step: '0.05', value: String(audio.buses[name]), tid: `bus-${name}`, ariaLabel: `${label} volume`, style: 'width:5em', onInput: (e) => audio.setBus(name, Number((e.target as HTMLInputElement).value)) }));
      const quiet = btn(audio.reducedAudio ? 'Reduced audio: On' : 'Reduced audio: Off', 'reduced-audio', () => { audio.setReducedAudio(!audio.reducedAudio); quiet.textContent = audio.reducedAudio ? 'Reduced audio: On' : 'Reduced audio: Off'; }, { small: true, title: 'at most one sound per tick, no chords' });
      const d = h('details', { style: 'margin-top:0.3em' }, h('summary', { class: 'jd-dim', style: 'font-size:0.75em; cursor:pointer' }, 'Audio buses'), h('div', { class: 'jd-row', style: 'margin-top:0.3em; gap:0.6em' }, bus('ui', 'UI'), bus('factory', 'Factory'), bus('music', 'Music'), quiet));
      d.dataset.testid = 'audio-buses';
      return d;
    })(),
    h('div', { class: 'jd-row', style: 'margin-top:0.4em' }, h('span', { class: 'jd-dim', style: 'font-size:0.8125em' }, 'Motion'), motionBtn, h('span', { class: 'jd-dim', style: 'font-size:0.8125em; margin-left:0.5em' }, 'Text size'), textBtn));

  // today's verified board (optional verifier)
  const url = new URLSearchParams(location.search).get('verifier') || import.meta.env.VERIFIER_URL;
  const line = h('div', { class: 'jd-mono jd-dim', tid: 'daily-board', style: 'font-size:0.75em; margin-top:0.3em' }, 'Checking the local verifier…');
  const stripHead = h('div', { class: 'jd-row jd-between' }, h('div', { class: 'jd-row' }, h('div', { class: 'jd-head' }, "Today's verified board"), h('span', { class: 'jd-mono jd-dim', style: 'font-size:0.75em' }, `seed ${dailySeed()}`)));
  const strip = h('div', { class: 'jd-panel', tid: 'daily-strip', style: 'margin-top:auto; padding-top:0.4em; padding-bottom:0.4em' }, stripHead, line);
  const alive = () => line.isConnected && scene.scene.isActive('Title');
  fetch(`${url}/daily?limit=5`).then((r) => r.json()).then((d: { seed: string; rulesVersion: number; entries: { player: string; score: number; replayHash: string; replayAvailable?: boolean }[]; botPar?: number | null }) => {
    if (!alive()) return;
    if (d.seed !== dailySeed()) { line.textContent = `Verifier day differs (${d.seed}); board hidden.`; return; }
    const top = d.entries.length ? d.entries.map((e, i) => `${i + 1}. $${e.score} ${e.player}`).join('   ·   ') + `   ·   re-simulated by the verifier (rules v${d.rulesVersion}) · ties: fewer round-6 machines first` : 'No verified scores yet today. Finish a run and submit the replay from the results screen.';
    if (d.botPar != null) stripHead.firstElementChild?.append(h('span', { class: 'jd-mono jd-dim', tid: 'daily-par', style: 'font-size:0.75em; margin-left:0.75em', title: 'the shipped autoplayer\'s median on today\'s seed: a target, never an entry' }, `bot par $${d.botPar}`));
    line.textContent = top; line.classList.toggle('jd-dim', !d.entries.length);
    if (d.entries.length) {
      fetch(`${url}/histogram?seed=${encodeURIComponent(dailySeed())}`).then((r) => r.json()).then((hg: { n: number; bins: { count: number }[] }) => {
        if (!alive() || !hg.n) return;
        const max = Math.max(1, ...hg.bins.map((b) => b.count));
        stripHead.firstElementChild?.append(h('span', { class: 'jd-hist-mini', tid: 'daily-hist', title: `${hg.n} verified runs today` }, ...hg.bins.map((b) => h('span', { class: 'jd-hist-bar', style: `height:${Math.max(8, Math.round((100 * b.count) / max))}%` }))));
      }).catch(() => { /* decoration */ });
    }
    const bestIdx = d.entries.findIndex((e) => e.replayAvailable);
    const best = bestIdx >= 0 ? d.entries[bestIdx] : undefined;
    if (best) {
      const watch = btn(`Watch #${bestIdx + 1}`, 'daily-watch', () => { watch.disabled = true; fetchVerifiedReplay(url, best.replayHash).then((r) => playVerifiedReplay(scene, r)).catch((err: Error) => { line.textContent = err.message; line.className = 'jd-mono jd-red'; watch.disabled = false; }); }, { small: true });
      stripHead.append(watch);
    }
    const mine = loadSubmissions()[dailySeed()];
    if (!mine) return;
    fetch(`${url}/board?seed=${encodeURIComponent(dailySeed())}&limit=100`).then((r) => r.json()).then((b: { entries: { replayHash: string }[] }) => {
      if (!alive()) return;
      const i = b.entries.findIndex((e) => e.replayHash === mine.replayHash);
      line.textContent = `You: ${i >= 0 ? `#${i + 1} of ${b.entries.length}` : `beyond the top ${b.entries.length}`} ($${mine.score})   ·   ${top}`; line.classList.remove('jd-dim');
    }).catch(() => { /* board unavailable: keep the top list */ });
  }).catch(() => { if (alive()) line.textContent = 'Verifier offline (optional: npm run verifier). Daily board unavailable; local bests above are unverified.'; });

  const screen = h('div', { class: 'jd-title' }, top, statsNote, hero, actions, h('div', { class: 'jd-grid2', style: 'margin-top:0.4em' }, howto, bestsPanel), strip);
  ui.mount(scene, screen, (e) => {
    if (e.key !== 'Enter' || tips.isOpen || ui.dialogOpen) return;
    const t = e.target as HTMLElement | null; if (t && (t.tagName === 'BUTTON' || t.tagName === 'INPUT')) return; // the focused control handles its own Enter
    if (save) continueRun(); else start(fresh ? TUTORIAL_SEED : dailySeed(), true);
  });
}

function importReplay(scene: Phaser.Scene) {
  void dialog(scene, { title: 'Import replay', label: 'Paste replay JSON (it is re-simulated before it plays):', multiline: true, ok: 'Verify and watch', placeholder: '{"format":1,"seed":…}' }).then((text) => {
    if (!text || !text.trim()) return;
    try {
      const r = decodeReplay(text.trim());
      const v = verifyReplay(r);
      if (!v.ok) { void alertText(scene, 'Replay rejected', v.error || `score mismatch (claimed $${v.claimed}, re-simulated $${v.score})`); return; }
      scene.scene.start('Game', { seed: r.seed, fresh: true, replay: r.actions });
    } catch (e) { void alertText(scene, 'Could not read replay', (e as Error).message); }
  });
}
