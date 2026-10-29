/** Title screen as DOM (DOSSIER-v1 0.4.0). The Phaser TitleScene keeps the decorative belt and the tips panel; everything else lives here. */
import type Phaser from 'phaser';
import { h, btn, ui, alertText, dialog, promptText } from './dom';
import { RULES_VERSION } from '../sim/types';
import type { TipsPanel } from './TipsPanel';
import { telemetry } from '../render/telemetry';
import { audio } from '../render/audio';
import { prefs } from '../render/prefs';
import { DPR } from '../render/dpr';
import { clearSave, dailySeed, hasUnusableSave, loadArchivedBests, loadBests, loadPlayer, loadSave, loadSettings, loadSubmissions, randomSeed, savePlayer, updateSettings, isOnboarded, daysPlayed, currentStreak } from '../render/storage';
import { streakLine } from '../daily/streak';
import { MAX_SEED_LENGTH, sanitizeSeed, TUTORIAL_SEED } from '../sim/run';
import { decodeReplay, verifyReplay } from '../sim/replay';
import { fetchVerifiedReplay, playVerifiedReplay } from '../render/verified';
import { identityDialog, playerLabel } from './identityDialog';
import { acceptDaily, cachedDaily, fetchDaily, practiceSeed, todaySeed, revealGate } from '../render/daily';
import { openArchive } from './ArchivePanel';
import { openPolicy } from './PolicyPanel';

export function mountTitle(scene: Phaser.Scene, tips: TipsPanel) {
  const save = loadSave();
  const bests = loadBests();
  const fresh = !isOnboarded();
  const start = (seed: string, freshRun: boolean) => { audio.unlock(); if (freshRun) clearSave(); scene.scene.start('Game', { seed, fresh: freshRun }); };
  const continueRun = () => { if (save) { audio.unlock(); scene.scene.start('Game', { seed: save.seed, fresh: false, actions: save.actions }); } };
  const restart = () => scene.scene.restart();

  // top bar: build, player, resolution, share stats
  const verifierUrl = new URLSearchParams(location.search).get('verifier') || import.meta.env.VERIFIER_URL;
  const playerBtn = btn(playerLabel(), 'player', () => { void identityDialog(scene, verifierUrl, (note) => { playerBtn.textContent = playerLabel(); if (note) { playerNote.textContent = note; playerNote.style.display = ''; playerNote.dataset.testid = 'player-note'; } }); }, { small: true });
  const playerNote = h('div', { class: 'jd-mono jd-dim', style: 'font-size:0.6em; text-align:right; margin-top:-0.3em; display:none' }, ''); // shown (and given its test id) only after the identity dialog reports an outcome: the layout tests measure every [data-testid] against the overlay
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
    btn("Today's challenge", 'daily', () => { // the minted seed when the verifier said so today; otherwise ask once, then practice (PLAN-v3 0.6.1)
      const known = cachedDaily(); if (known) { start(known.seed, true); return; }
      audio.unlock(); void fetchDaily(verifierUrl).then((d) => { if (scene.scene.isActive('Title')) start(d ? d.seed : practiceSeed(), true); });
    }, { variant: 'primary' }),
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
  const todayBest = bests.bySeed[todaySeed()];
  const volume = h('input', { type: 'range', min: '0', max: '1', step: '0.01', value: String(audio.volume), tid: 'volume', ariaLabel: 'Volume', onInput: (e) => audio.setVolume(Number((e.target as HTMLInputElement).value)) });
  const muteBtn = btn(audio.muted ? 'Unmute' : 'Mute', 'mute', () => { audio.setMuted(!audio.muted); muteBtn.textContent = audio.muted ? 'Unmute' : 'Mute'; }, { small: true });
  const motionBtn = btn(prefs.reducedMotion ? 'Reduced' : 'Full', 'motion', () => { telemetry.track('settings_changed', { key: 'reducedMotion' }); prefs.setReducedMotion(!prefs.reducedMotion); restart(); }, { small: true });
  const textBtn = btn(prefs.textScaleLabel(), 'textscale', () => { telemetry.track('settings_changed', { key: 'textScale' }); prefs.setTextScale(prefs.nextTextScale()); restart(); }, { small: true });
  const bestsPanel = h('div', { class: 'jd-panel' },
    h('div', { class: 'jd-head' }, 'Local personal bests'),
    h('div', { style: 'margin-top:0.35em; font-size:0.9375em' }, bests.overall ? `Best score: $${bests.overall.score}  (seed ${bests.overall.seed})` : 'No finished runs yet on this device.'),
    h('div', { class: 'jd-dim', tid: 'today-line', style: 'font-size:0.875em' }, `${todayBest ? `Today's challenge best: $${todayBest.score}` : "Today's challenge: not played yet"} · ${streakLine(daysPlayed(), currentStreak())}`), // PLAN-v3 0.6.3: days played and the streak, no loss copy when it breaks
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
  const url = verifierUrl;
  const line = h('div', { class: 'jd-mono jd-dim', tid: 'daily-board', style: 'font-size:0.75em; margin-top:0.3em; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; min-width:0' }, 'Checking the local verifier…'); // one line at every text scale (the full text is the tooltip): the strip's height never depends on when the verifier answers
  const seedSpan = h('span', { class: 'jd-mono jd-dim', tid: 'daily-seed', style: 'font-size:0.75em; white-space:nowrap; flex:1 1 auto; min-width:3em; overflow:hidden; text-overflow:ellipsis', title: todaySeed() }, `seed ${todaySeed()}`);
  const modeSpan = h('span', { class: 'jd-mono jd-dim', tid: 'daily-mode', style: 'font-size:0.75em; margin-left:0.75em; white-space:nowrap', title: 'minted: the verifier derived today\'s seed from its secret and published a commitment to tomorrow\'s; provisional: the board can still change until the day closes, 48 h after 00:00 UTC' }, cachedDaily() ? 'minted · ranked' : 'practice (unranked) until the verifier answers');
  // one line at every text scale: the head row never wraps, the left group clips, and the Archive button is text-height (the 130 % layout test measures the strip)
  const archiveBtn = btn('Archive', 'archive', () => openArchive(scene, verifierUrl), { small: true, title: 'closed days with their final boards; any day is playable as practice (PLAN-v3 0.6.2)' });
  archiveBtn.style.cssText += 'padding:0 0.5em; font-size:0.75em; line-height:1.4; min-height:0';
  const rightGroup = h('span', { class: 'jd-row', style: 'gap:0.4em; flex-wrap:nowrap; flex:0 0 auto' });
  const policyBtn = btn('Fairness policy', 'policy', () => openPolicy(scene), { small: true, title: 'how scores are verified, how the daily works, what is stored about you (generated from the code, PLAN-v3 0.6.5)' });
  policyBtn.style.cssText += 'padding:0 0.5em; font-size:0.75em; line-height:1.4; min-height:0';
  rightGroup.append(policyBtn, archiveBtn); // text-height like Archive: the top row at 130 % has no room for a fourth button
  const stripHead = h('div', { class: 'jd-row jd-between', style: 'flex-wrap:nowrap' }, h('div', { class: 'jd-row', style: 'flex-wrap:nowrap; min-width:0; overflow:hidden' }, h('div', { class: 'jd-head', style: 'white-space:nowrap' }, "Today's verified board"), seedSpan, modeSpan), rightGroup);
  const practiceMode = (why: string) => { seedSpan.textContent = `seed ${practiceSeed()}`; modeSpan.textContent = `practice (unranked): ${why}`; };
  const strip = h('div', { class: 'jd-panel', tid: 'daily-strip', style: 'margin-top:auto; padding-top:0.4em; padding-bottom:0.4em' }, stripHead, line);
  const alive = () => line.isConnected && scene.scene.isActive('Title');
  const closesIn = (closesAt: string, now: string) => { const ms = Date.parse(closesAt) - Date.parse(now); if (!Number.isFinite(ms) || ms <= 0) return 'closing'; const h = Math.floor(ms / 3_600_000); return h >= 1 ? `closes in ${h} h` : `closes in ${Math.max(1, Math.round(ms / 60_000))} min`; };
  fetch(`${url}/daily?limit=5`).then((r) => r.json()).then((d: { seed: string; date?: string; rulesVersion: number; entries: { player: string; score: number; replayHash: string; replayAvailable?: boolean }[]; botPar?: number | null; closesAt?: string; now?: string; final?: boolean }) => {
    if (!alive()) return;
    const info = acceptDaily(d);
    if (!info) { practiceMode(`the verifier's daily is for ${d.date ?? 'another day'}`); line.textContent = `Verifier day differs (${d.seed}); board hidden.`; return; }
    const seed = info.seed; seedSpan.textContent = `seed ${seed}`; seedSpan.title = seed;
    modeSpan.textContent = d.final ? 'minted · final' : `minted · ranked · provisional · ${closesIn(d.closesAt ?? info.closesAt, d.now ?? new Date().toISOString())}`; // PLAN-v3 0.6.2: one global deadline, said plainly
    const top = d.entries.length ? d.entries.map((e, i) => `${i + 1}. $${e.score} ${e.player}`).join('   ·   ') + `   ·   re-simulated by the verifier (rules v${d.rulesVersion}) · ties: fewer round-6 machines first` : 'No verified scores yet today. Finish a run and submit the replay from the results screen.';
    if (d.botPar != null) rightGroup.prepend(h('span', { class: 'jd-mono jd-dim', tid: 'daily-par', style: 'font-size:0.75em; white-space:nowrap', title: 'the shipped autoplayer\'s median on today\'s seed: a target, never an entry' }, `bot par $${d.botPar}`));
    line.textContent = top; line.title = top; line.classList.toggle('jd-dim', !d.entries.length);
    if (d.entries.length) {
      fetch(`${url}/histogram?seed=${encodeURIComponent(seed)}`).then((r) => r.json()).then((hg: { n: number; bins: { count: number }[] }) => {
        if (!alive() || !hg.n) return;
        const max = Math.max(1, ...hg.bins.map((b) => b.count));
        rightGroup.prepend(h('span', { class: 'jd-hist-mini', tid: 'daily-hist', title: `${hg.n} verified runs today` }, ...hg.bins.map((b) => h('span', { class: 'jd-hist-bar', style: `height:${Math.max(8, Math.round((100 * b.count) / max))}%` }))));
      }).catch(() => { /* decoration */ });
    }
    const bestIdx = d.entries.findIndex((e) => e.replayAvailable);
    const best = bestIdx >= 0 ? d.entries[bestIdx] : undefined;
    if (best) {
      const gate = revealGate(seed); // PLAN-v3 0.6.6: watchable after this device submitted for the day, or after the close
      const watch = btn(gate ? `Watch #${bestIdx + 1} (after you submit)` : `Watch #${bestIdx + 1}`, 'daily-watch', () => { watch.disabled = true; fetchVerifiedReplay(url, best.replayHash, seed).then((r) => playVerifiedReplay(scene, r)).catch((err: Error) => { line.textContent = err.message; line.className = 'jd-mono jd-red'; watch.disabled = false; }); }, { small: true, disabled: !!gate, title: gate ?? 'watch the best verified replay of the day' });
      rightGroup.append(watch);
    }
    const mine = loadSubmissions()[seed];
    if (!mine) return;
    fetch(`${url}/board?seed=${encodeURIComponent(seed)}&limit=100`).then((r) => r.json()).then((b: { entries: { replayHash: string }[] }) => {
      if (!alive()) return;
      const i = b.entries.findIndex((e) => e.replayHash === mine.replayHash);
      line.textContent = `You: ${i >= 0 ? `#${i + 1} of ${b.entries.length}` : `beyond the top ${b.entries.length}`} ($${mine.score})   ·   ${top}`; line.title = line.textContent; line.classList.remove('jd-dim');
    }).catch(() => { /* board unavailable: keep the top list */ });
  }).catch(() => { if (alive()) { practiceMode('verifier unreachable'); line.textContent = 'Verifier offline (optional: npm run verifier). Daily board unavailable; local bests above are unverified.'; } });

  const screen = h('div', { class: 'jd-title' }, top, playerNote, statsNote, hero, actions, h('div', { class: 'jd-grid2', style: 'margin-top:0.4em' }, howto, bestsPanel), strip);
  ui.mount(scene, screen, (e) => {
    if (e.key !== 'Enter' || tips.isOpen || ui.dialogOpen) return;
    const t = e.target as HTMLElement | null; if (t && (t.tagName === 'BUTTON' || t.tagName === 'INPUT')) return; // the focused control handles its own Enter
    if (save) continueRun(); else start(fresh ? TUTORIAL_SEED : todaySeed(), true);
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
