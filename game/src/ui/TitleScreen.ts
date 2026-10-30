import { verifierUrl as resolveVerifierUrl } from '../render/config';
import { diagnostics } from '../render/errlog';
/** Title screen as DOM (DOSSIER-v1 0.4.0). The Phaser TitleScene keeps the decorative belt and the tips panel; everything else lives here. Every string comes from the table (0.9.0). */
import type Phaser from 'phaser';
import { h, btn, ui, alertText, dialog, promptText, showText, foremanBox, setForeman } from './dom';
import { foremanSays, chatter } from '../content/foreman';
import type { TipsPanel } from './TipsPanel';
import { telemetry } from '../render/telemetry';
import { audio } from '../render/audio';
import { prefs } from '../render/prefs';
import { DPR } from '../render/dpr';
import {
  clearSave,
  hasUnusableSave,
  loadArchivedBests,
  loadBests,
  loadSave,
  loadSettings,
  loadSubmissions,
  randomSeed,
  updateSettings,
  isOnboarded,
  daysPlayed,
  currentStreak,
} from '../render/storage';
import { streakLine } from '../content/streak';
import { MAX_SEED_LENGTH, sanitizeSeed, TUTORIAL_SEED } from '../sim/run';
import { decodeReplay, verifyReplay } from '../sim/replay';
import { fetchVerifiedReplay, playVerifiedReplay } from '../render/verified';
import { identityDialog, playerLabel } from './identityDialog';
import { loadIdentity, fetchClaimed, bearerAllowed } from '../render/identity';
import { HIDDEN_LABEL } from '../identity/identity';
import { acceptDaily, cachedDaily, fetchDaily, practiceSeed, todaySeed, revealGate, fetchWeekly } from '../render/daily';
import { openArchive } from './ArchivePanel';
import { openPolicy } from './PolicyPanel';
import { openPrivacy } from './PrivacyPanel';
import { flushPending, describeOutcomes } from '../render/pending';
import { loadPending } from '../render/storage';
import { openGroups } from './GroupsPanel';
import { groupHeaders, groupParam, loadGroup, saveGroup } from '../render/groups';
import { t } from '../content/strings';
import { money, int } from '../content/format';

export function mountTitle(scene: Phaser.Scene, tips: TipsPanel) {
  const save = loadSave();
  const bests = loadBests();
  const fresh = !isOnboarded();
  const start = (seed: string, freshRun: boolean) => {
    audio.unlock();
    if (freshRun) clearSave();
    scene.scene.start('Game', { seed, fresh: freshRun });
  };
  const continueRun = () => {
    if (save) {
      audio.unlock();
      scene.scene.start('Game', { seed: save.seed, fresh: false, actions: save.actions });
    }
  };
  const restart = () => scene.scene.restart();

  // top bar: build, player, resolution, share stats
  const verifierUrl = resolveVerifierUrl();
  const playerBtn = btn(
    playerLabel(),
    'player',
    () => {
      void identityDialog(scene, verifierUrl, (note) => {
        playerBtn.textContent = playerLabel();
        if (note) {
          playerNote.textContent = note;
          playerNote.style.display = '';
          playerNote.dataset.testid = 'player-note';
        }
      });
    },
    { small: true },
  );
  const playerNote = h('div', { class: 'jd-mono jd-dim', style: 'font-size:0.6em; text-align:right; margin-top:-0.3em; display:none' }, ''); // shown (and given its test id) only after the identity dialog reports an outcome: the layout tests measure every [data-testid] against the overlay
  if (loadIdentity().name && bearerAllowed(verifierUrl))
    void fetchClaimed(verifierUrl).then((c) => {
      // the server's view of this player: a moderator's rename follows onto the button, a report shows its note (PLAN-v4 0.7.7)
      playerBtn.textContent = playerLabel();
      if (c?.hidden) {
        playerNote.textContent = t('title.reportedNote', { label: HIDDEN_LABEL });
        playerNote.style.display = '';
        playerNote.dataset.testid = 'player-note';
      }
    });
  // production roadmap 0.8.7: games saved while offline are submitted now, and the player is told what became of them
  const pendingNote = h('div', { class: 'jd-mono jd-amber', style: 'font-size:0.7em; text-align:right; margin-top:-0.2em; display:none' }, '');
  const pending = loadPending();
  if (pending.length) {
    pendingNote.textContent = t('title.pendingWaiting', { n: pending.length });
    pendingNote.style.display = '';
    pendingNote.dataset.testid = 'pending-note';
    void flushPending(verifierUrl).then((outcomes) => {
      if (!pendingNote.isConnected) return;
      pendingNote.textContent = describeOutcomes(outcomes);
      const good = outcomes.some((x) => x.status === 'verified' || x.status === 'keep-best');
      pendingNote.classList.toggle('jd-amber', good);
      pendingNote.classList.toggle('jd-dim', !good);
    });
  }
  const quality = loadSettings().renderQuality;
  const qualityLabel =
    quality === 'low' ? t('title.resolutionStandard') : quality === 'high' ? t('title.resolutionHigh') : t('title.resolutionAuto', { dpr: DPR });
  const qualityBtn = btn(
    qualityLabel,
    'quality',
    () => {
      telemetry.track('settings_changed', { key: 'renderQuality' });
      updateSettings({ renderQuality: quality === 'low' ? 'high' : 'low' });
      location.reload();
    },
    { small: true, title: t('title.resolutionTitle') },
  );
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
  const top = h(
    'div',
    { class: 'jd-row jd-between' },
    h('span', { class: 'jd-mono jd-dim', style: 'font-size:0.7em' }, t('title.build', { build: import.meta.env.BUILD })),
    h('div', { class: 'jd-row', style: 'gap:0.5em' }, playerBtn, qualityBtn, statsBtn),
  );
  // the consent toggle's note carries the link to the privacy notice and the data buttons (production roadmap 0.8.6)
  const privacyLink = h(
    'button',
    {
      class: 'jd-link',
      tid: 'privacy',
      type: 'button',
      title: t('title.privacyTitle'),
      onClick: () =>
        openPrivacy(scene, verifierUrl, 'privacy', () => {
          playerBtn.textContent = playerLabel();
          statsBtn.textContent = statsLabel();
          playerNote.textContent = '';
          playerNote.style.display = 'none';
        }),
    },
    t('title.privacyLink'),
  ); // after a deletion the player button, the statistics button and the claim note are refreshed
  const statsNote = h(
    'div',
    { class: 'jd-mono jd-dim', tid: 'telemetry-note', style: 'font-size:0.6em; text-align:right; margin-top:-0.3em' },
    t('title.statsNote'),
    privacyLink,
  );

  // hero, with the foreman's line under the tagline (0.9.1): a streak milestone or a once-only moment first, else the welcome; the strip's answer may replace it
  const streak = currentStreak();
  const foremanText =
    streak === 30 ? foremanSays('streak30') : streak === 7 ? foremanSays('streak7') : streak === 3 ? foremanSays('streak3') : foremanSays('welcome');
  // Sal stands beside the sign: on a wide screen the box sits to the right of the name and tagline and costs no height
  // (the title must not shrink the player's chosen text size for a line of flavour); on a narrow one the row wraps and the box goes below
  const foreman = foremanBox(foremanText, 'foreman', 'flex:0 1 26em; max-width:26em; text-align:left');
  const hero = h(
    'div',
    { style: 'display:flex; flex-wrap:wrap; align-items:center; justify-content:center; gap:0.4em 1.5em' },
    h(
      'div',
      { style: 'text-align:center' },
      h('div', { class: 'jd-amber', style: 'font-size:2.6em; font-weight:700; letter-spacing:0.12em; line-height:1.05' }, t('title.name')),
      h('div', { class: 'jd-dim', style: 'font-size:1em; margin-top:0.15em' }, t('title.tagline')),
    ),
    foreman,
  );

  // actions
  const actions = h('div', { style: 'display:flex; flex-direction:column; align-items:center; gap:0.35em; margin-top:0.25em' });
  if (save) {
    const shortSeed = save.seed.length > 22 ? `${save.seed.slice(0, 20)}…` : save.seed;
    actions.append(btn(t('title.continue', { seed: shortSeed }), 'continue', continueRun, { variant: 'primary' }));
    actions.append(h('div', { class: 'jd-mono jd-dim', tid: 'continue-note', style: 'font-size:0.75em' }, t('title.continueNote')));
  } else if (hasUnusableSave()) {
    actions.append(
      h('div', { class: 'jd-mono jd-dim', tid: 'continue-note', style: 'font-size:0.75em; text-align:center; max-width:40em' }, t('title.unusableSave')),
    );
    clearSave();
  }
  actions.append(
    h(
      'div',
      { class: 'jd-row jd-center' },
      btn(
        t('title.daily'),
        'daily',
        () => {
          // the minted yard when our server said so today; otherwise ask once, then practice (PLAN-v3 0.6.1)
          const known = cachedDaily();
          if (known) {
            start(known.seed, true);
            return;
          }
          audio.unlock();
          void fetchDaily(verifierUrl).then((d) => {
            if (scene.scene.isActive('Title')) start(d ? d.seed : practiceSeed(), true);
          });
        },
        { variant: 'primary' },
      ),
      btn(t('title.random'), 'random', () => start(randomSeed(), true), { variant: 'steel' }),
    ),
  );
  actions.append(
    h(
      'div',
      { class: 'jd-row jd-center' },
      btn(fresh ? t('title.learnFresh') : t('title.learn'), 'learn', () => start(TUTORIAL_SEED, true), { variant: fresh ? 'primary' : 'dark' }),
      btn(t('title.custom'), 'custom', () => {
        void promptText(scene, t('title.customTitle'), t('title.customLabel', { max: MAX_SEED_LENGTH }), 'junkyard', MAX_SEED_LENGTH).then((s) => {
          if (s && s.trim()) start(sanitizeSeed(s), true);
        });
      }),
      btn(t('title.import'), 'import', () => importRecording(scene)),
    ),
  );

  // how to play + tips
  const howto = h(
    'div',
    { class: 'jd-panel' },
    h(
      'div',
      { class: 'jd-row jd-between' },
      h('div', { class: 'jd-head' }, t('title.howto')),
      btn(t('title.tips'), 'tips', () => tips.open(), { small: true }),
    ),
    ...[t('title.howto1'), t('title.howto2'), t('title.howto3'), t('title.howto4'), t('title.howto5')].map((line, i) =>
      h('div', { tid: `howto-${i + 1}`, style: 'font-size:0.9375em; margin-top:0.2em' }, line),
    ),
  );

  // bests + settings
  const todayBest = bests.bySeed[todaySeed()];
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
  const motionBtn = btn(
    prefs.reducedMotion ? t('title.motionReduced') : t('title.motionFull'),
    'motion',
    () => {
      telemetry.track('settings_changed', { key: 'reducedMotion' });
      prefs.setReducedMotion(!prefs.reducedMotion);
      restart();
    },
    { small: true },
  );
  const textBtn = btn(
    prefs.textScaleLabel(),
    'textscale',
    () => {
      telemetry.track('settings_changed', { key: 'textScale' });
      prefs.setTextScale(prefs.nextTextScale());
      restart();
    },
    { small: true },
  );
  // production roadmap 0.8.0: build, browser, settings, storage health and the last ten errors as text for a bug report; never the identity or the key
  const chatterBtn = btn(
    chatter() === 'less' ? t('title.foremanLess') : t('title.foremanFull'),
    'foreman-chatter',
    () => {
      updateSettings({ chatter: chatter() === 'less' ? 'full' : 'less' });
      restart();
    },
    { small: true, title: t('title.foremanTitle') },
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
  const bestsPanel = h(
    'div',
    { class: 'jd-panel' },
    h('div', { class: 'jd-head' }, t('title.bestsHead')),
    h(
      'div',
      { style: 'margin-top:0.35em; font-size:0.9375em' },
      bests.overall ? t('title.bestScore', { score: money(bests.overall.score), seed: bests.overall.seed }) : t('title.noGames'),
    ),
    h(
      'div',
      { class: 'jd-dim', tid: 'today-line', style: 'font-size:0.875em' },
      `${todayBest ? t('title.todayBest', { score: money(todayBest.score) }) : t('title.todayNotPlayed')} · ${streakLine(daysPlayed(), currentStreak())}`,
    ), // PLAN-v3 0.6.3: days played and the streak, no loss copy when it breaks
    h('div', { class: 'jd-mono jd-dim', style: 'font-size:0.75em' }, t('title.gamesOnDevice', { n: bests.runs })),
    ...loadArchivedBests().map(({ version, bests: ab }) =>
      h(
        'details',
        { tid: `archived-bests-${version}`, style: 'margin-top:0.2em' },
        h('summary', { class: 'jd-dim', style: 'font-size:0.75em; cursor:pointer' }, t('title.underRules', { version: `v${version}` })),
        h(
          'div',
          { class: 'jd-mono jd-dim', style: 'font-size:0.75em; margin-top:0.15em' },
          `${ab.overall ? t('title.archivedBest', { score: money(ab.overall.score), seed: ab.overall.seed }) : ''}${t('title.archivedGames', { n: ab.runs })}`,
        ),
      ),
    ),
    h('div', { class: 'jd-row', style: 'margin-top:0.6em' }, h('span', { class: 'jd-dim', style: 'font-size:0.8125em' }, t('title.volume')), volume, muteBtn),
    (() => {
      // audio buses (DOSSIER-v1 0.4.9): collapsed so the title keeps its height at 130 % text
      const bus = (name: 'ui' | 'factory' | 'music', label: string) =>
        h(
          'label',
          { class: 'jd-dim', style: 'font-size:0.75em; display:inline-flex; align-items:center; gap:0.3em' },
          label,
          h('input', {
            type: 'range',
            min: '0',
            max: '1',
            step: '0.05',
            value: String(audio.buses[name]),
            tid: `bus-${name}`,
            ariaLabel: t('title.busVolume', { label }),
            style: 'width:5em',
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
      const d = h(
        'details',
        { style: 'margin-top:0.3em' },
        h('summary', { class: 'jd-dim', style: 'font-size:0.75em; cursor:pointer' }, t('title.audioBuses')),
        h(
          'div',
          { class: 'jd-row', style: 'margin-top:0.3em; gap:0.6em' },
          bus('ui', t('title.busUi')),
          bus('factory', t('title.busFactory')),
          bus('music', t('title.busMusic')),
          quiet,
        ),
      );
      d.dataset.testid = 'audio-buses';
      return d;
    })(),
    h(
      'div',
      { class: 'jd-row', style: 'margin-top:0.4em' },
      h('span', { class: 'jd-dim', style: 'font-size:0.8125em' }, t('title.motion')),
      motionBtn,
      h('span', { class: 'jd-dim', style: 'font-size:0.8125em; margin-left:0.5em' }, t('title.textSize')),
      textBtn,
      chatterBtn,
      diagBtn,
    ),
  );

  // today's board (our server, when reachable)
  const url = verifierUrl;
  const line = h(
    'div',
    {
      class: 'jd-mono jd-dim',
      tid: 'daily-board',
      style: 'font-size:0.75em; margin-top:0.3em; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; min-width:0',
    },
    t('title.checking'),
  ); // one line at every text scale (the full text is the tooltip): the strip's height never depends on when the server answers
  const seedSpan = h(
    'span',
    {
      class: 'jd-mono jd-dim',
      tid: 'daily-seed',
      style: 'font-size:0.75em; white-space:nowrap; flex:1 1 auto; min-width:3em; overflow:hidden; text-overflow:ellipsis',
      title: todaySeed(),
    },
    t('common.yard', { seed: todaySeed() }),
  );
  const modeSpan = h(
    'span',
    { class: 'jd-mono jd-dim', tid: 'daily-mode', style: 'font-size:0.75em; margin-left:0.75em; white-space:nowrap', title: t('title.modeTitle') },
    cachedDaily() ? t('common.minted') : t('title.modePracticeUntil'),
  );
  // one line at every text scale: the head row never wraps, the left group clips, and the Archive button is text-height (the 130 % layout test measures the strip)
  const compact = 'padding:0 0.5em; font-size:0.75em; line-height:1.4; min-height:0';
  const archiveBtn = btn(t('title.archive'), 'archive', () => openArchive(scene, verifierUrl), { small: true, title: t('title.archiveTitle') });
  archiveBtn.style.cssText += compact;
  const rightGroup = h('span', { class: 'jd-row', style: 'gap:0.4em; flex-wrap:nowrap; flex:0 0 auto' });
  const policyBtn = btn(t('title.policy'), 'policy', () => openPolicy(scene), { small: true, title: t('title.policyTitle') });
  policyBtn.style.cssText += compact;
  const groupsBtn = btn(t('title.crews'), 'groups', () => openGroups(scene, verifierUrl, () => scene.scene.restart()), {
    small: true,
    title: t('title.crewsTitle'),
  });
  groupsBtn.style.cssText += compact;
  const weeklyBtn = btn(
    t('title.weekly'),
    'weekly',
    () => {
      /* set once the server answers */
    },
    { small: true, disabled: true, title: t('title.weeklyTitle') },
  );
  weeklyBtn.style.cssText += compact;
  rightGroup.append(weeklyBtn, groupsBtn, policyBtn, archiveBtn); // text-height like Archive: the top row at 130 % has no room for a fourth button
  const stripHead = h(
    'div',
    { class: 'jd-row jd-between', style: 'flex-wrap:nowrap' },
    h(
      'div',
      { class: 'jd-row', style: 'flex-wrap:nowrap; min-width:0; overflow:hidden' },
      h('div', { class: 'jd-head', style: 'white-space:nowrap' }, t('title.boardHead')),
      seedSpan,
      modeSpan,
    ),
    rightGroup,
  );
  const practiceMode = (why: string) => {
    seedSpan.textContent = t('common.yard', { seed: practiceSeed() });
    modeSpan.textContent = t('title.modePractice', { why });
  };
  const strip = h('div', { class: 'jd-panel', tid: 'daily-strip', style: 'margin-top:auto; padding-top:0.4em; padding-bottom:0.4em' }, stripHead, line);
  const alive = () => line.isConnected && scene.scene.isActive('Title');
  const closesIn = (closesAt: string, now: string) => {
    const ms = Date.parse(closesAt) - Date.parse(now);
    if (!Number.isFinite(ms) || ms <= 0) return t('title.closing');
    const hrs = Math.floor(ms / 3_600_000);
    return hrs >= 1 ? t('title.closesInH', { n: hrs }) : t('title.closesInMin', { n: Math.max(1, Math.round(ms / 60_000)) });
  };
  const groupSel = loadGroup();
  void fetchWeekly(url).then((wk) => {
    // PLAN-v4 0.7.5: the weekly lives in the strip head as a button; no new row
    if (!alive()) return;
    if (!wk) {
      weeklyBtn.textContent = t('title.weeklyOffline');
      return;
    }
    const ms = Date.parse(wk.closesAt) - Date.parse(wk.now);
    const d = Math.floor(ms / 86_400_000);
    const wn = wk.week.slice(5); // W43: the year is implied by the window
    const hrs = Math.floor(ms / 3_600_000);
    weeklyBtn.textContent = wk.final
      ? t('title.weeklyFinal', { week: wn })
      : t('title.weeklyCloses', {
          week: wn,
          left:
            d >= 1
              ? t('title.daysShort', { n: d })
              : hrs >= 1
                ? t('title.hoursShort', { n: hrs })
                : t('title.minutesShort', { n: Math.max(1, Math.round(ms / 60_000)) }),
        });
    weeklyBtn.title = t('title.weeklyBtnTitle', { seed: wk.seed });
    weeklyBtn.disabled = false;
    weeklyBtn.onclick = () => start(wk.seed, true);
  });
  fetch(`${url}/daily?limit=5${groupParam(url)}`, { headers: groupHeaders(url) })
    .then((r) => {
      if (!r.ok && groupSel && (r.status === 401 || r.status === 403)) {
        saveGroup(null);
        throw new Error('group unavailable');
      }
      return r.json();
    })
    .then(
      (d: {
        seed: string;
        date?: string;
        rulesVersion: number;
        entries: { player: string; score: number; replayHash: string; replayAvailable?: boolean }[];
        botPar?: number | null;
        closesAt?: string;
        now?: string;
        final?: boolean;
      }) => {
        if (!alive()) return;
        const info = acceptDaily(d);
        if (!info) {
          practiceMode(t('title.practiceOtherDay', { date: d.date ?? t('title.anotherDay') }));
          line.textContent = t('title.boardOtherDay', { seed: d.seed });
          return;
        }
        const seed = info.seed;
        seedSpan.textContent = t('common.yard', { seed });
        seedSpan.title = seed;
        if (!(streak === 3 || streak === 7 || streak === 30)) setForeman(foreman, foremanSays(d.final ? 'dailyFinal' : 'dailyOpen'));
        modeSpan.textContent = `${d.final ? t('title.modeRankedFinal') : t('title.modeRankedProvisional', { closes: closesIn(d.closesAt ?? info.closesAt, d.now ?? new Date().toISOString()) })}${groupSel ? t('title.crewSuffix', { name: groupSel.name }) : ''}`; // PLAN-v3 0.6.2: one global deadline, said plainly
        const top = d.entries.length
          ? d.entries.map((e, i) => `${i + 1}. ${money(e.score)} ${e.player}`).join('   ·   ') + t('title.topSuffix')
          : t('title.noScores');
        if (d.botPar != null)
          rightGroup.prepend(
            h(
              'span',
              { class: 'jd-mono jd-dim', tid: 'daily-par', style: 'font-size:0.75em; white-space:nowrap', title: t('title.foremanMarkTitle') },
              t('title.foremanMark', { score: money(d.botPar) }),
            ),
          );
        line.textContent = top;
        line.title = top;
        line.classList.toggle('jd-dim', !d.entries.length);
        if (d.entries.length) {
          fetch(`${url}/histogram?seed=${encodeURIComponent(seed)}${groupParam(url)}`, { headers: groupHeaders(url) })
            .then((r) => r.json())
            .then((hg: { n: number; bins: { count: number }[] }) => {
              if (!alive() || !hg.n) return;
              const max = Math.max(1, ...hg.bins.map((b) => b.count));
              rightGroup.prepend(
                h(
                  'span',
                  { class: 'jd-hist-mini', tid: 'daily-hist', title: t('title.histTitle', { n: hg.n }) },
                  ...hg.bins.map((b) => h('span', { class: 'jd-hist-bar', style: `height:${Math.max(8, Math.round((100 * b.count) / max))}%` })),
                ),
              );
            })
            .catch(() => {
              /* decoration */
            });
        }
        const bestIdx = d.entries.findIndex((e) => e.replayAvailable);
        const best = bestIdx >= 0 ? d.entries[bestIdx] : undefined;
        if (best) {
          const gate = revealGate(seed); // PLAN-v3 0.6.6: watchable after this device submitted for the day, or after the close
          const watch = btn(
            gate ? t('title.watchGated', { n: bestIdx + 1 }) : t('title.watch', { n: bestIdx + 1 }),
            'daily-watch',
            () => {
              watch.disabled = true;
              fetchVerifiedReplay(url, best.replayHash, seed)
                .then((r) => playVerifiedReplay(scene, r))
                .catch((err: Error) => {
                  line.textContent = err.message;
                  line.className = 'jd-mono jd-red';
                  watch.disabled = false;
                });
            },
            { small: true, disabled: !!gate, title: gate ?? t('title.watchTitle') },
          );
          rightGroup.append(watch);
        }
        const mine = loadSubmissions()[seed];
        if (!mine) return;
        fetch(`${url}/board?seed=${encodeURIComponent(seed)}&limit=100${groupParam(url)}`, { headers: groupHeaders(url) })
          .then((r) => r.json())
          .then((b: { entries: { replayHash: string }[] }) => {
            if (!alive()) return;
            const i = b.entries.findIndex((e) => e.replayHash === mine.replayHash);
            line.textContent = t('title.you', {
              rank: i >= 0 ? t('common.rankOf', { n: int(i + 1), of: int(b.entries.length) }) : t('common.beyondTop', { of: int(b.entries.length) }),
              score: money(mine.score),
              top,
            });
            line.title = line.textContent;
            line.classList.remove('jd-dim');
          })
          .catch(() => {
            /* board unavailable: keep the top list */
          });
      },
    )
    .catch((err: Error) => {
      if (!alive()) return;
      if (err.message === 'group unavailable') {
        line.textContent = t('title.crewUnavailable');
        scene.time.delayedCall(1200, () => {
          if (alive()) scene.scene.restart();
        });
        return;
      }
      {
        practiceMode(t('title.offlineWhy'));
        line.textContent = t('title.offline');
      }
    });

  const screen = h(
    'div',
    { class: 'jd-title' },
    top,
    playerNote,
    pendingNote,
    statsNote,
    hero,
    actions,
    h('div', { class: 'jd-grid2', style: 'margin-top:0.4em' }, howto, bestsPanel),
    strip,
  );
  ui.mount(scene, screen, (e) => {
    if (e.key !== 'Enter' || tips.isOpen || ui.dialogOpen) return;
    const el = e.target as HTMLElement | null;
    if (el && (el.tagName === 'BUTTON' || el.tagName === 'INPUT')) return; // the focused control handles its own Enter
    if (save) continueRun();
    else start(fresh ? TUTORIAL_SEED : todaySeed(), true);
  });
}

function importRecording(scene: Phaser.Scene) {
  void dialog(scene, {
    title: t('title.importTitle'),
    label: t('title.importLabel'),
    multiline: true,
    ok: t('title.importOk'),
    placeholder: '{"format":1,"seed":…}',
  }).then((text) => {
    if (!text || !text.trim()) return;
    try {
      const r = decodeReplay(text.trim());
      const v = verifyReplay(r);
      if (!v.ok) {
        void alertText(scene, t('title.importRejected'), v.error || t('title.importMismatch', { claimed: money(v.claimed), score: money(v.score) }));
        return;
      }
      scene.scene.start('Game', { seed: r.seed, fresh: true, replay: r.actions });
    } catch (e) {
      void alertText(scene, t('title.importUnreadable'), (e as Error).message);
    }
  });
}
