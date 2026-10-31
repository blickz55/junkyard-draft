/**
 * The home screen as DOM (DOSSIER-v1 0.4.0; rebuilt for docs/UX-STANDARD.md). One primary action: keep playing a saved game,
 * learn if you are new, else play today's yard, and today's job is right there with its stars. Your rank and today's board
 * sit beside it; everything else is a quiet line of links, and the settings live in their own dialog. The Phaser TitleScene
 * keeps the tips panel. Every string comes from the table (0.9.0).
 */
import { verifierUrl as resolveVerifierUrl } from '../render/config';
import type Phaser from 'phaser';
import { h, btn, ui, alertText, dialog, promptText, foremanBox, setForeman } from './dom';
import { withArt } from './opening';
import { foremanSays } from '../content/foreman';
import type { TipsPanel } from './TipsPanel';
import { audio } from '../render/audio';
import {
  clearSave,
  hasUnusableSave,
  loadArchivedBests,
  loadBests,
  loadSave,
  loadSubmissions,
  randomSeed,
  isOnboarded,
  daysPlayed,
  currentStreak,
  totalStars,
} from '../render/storage';
import { streakLine } from '../content/streak';
import { MAX_SEED_LENGTH, sanitizeSeed, TUTORIAL_SEED } from '../sim/run';
import { yardFor } from '../sim/yard';
import { decodeReplay, verifyReplay } from '../sim/replay';
import { fetchVerifiedReplay, playVerifiedReplay } from '../render/verified';
import { playerLabel } from './identityDialog';
import { loadIdentity, fetchClaimed, bearerAllowed } from '../render/identity';
import { HIDDEN_LABEL } from '../identity/identity';
import { acceptDaily, cachedDaily, practiceSeed, todaySeed, revealGate, fetchWeekly, todaysYard } from '../render/daily';
import { openArchive } from './ArchivePanel';
import { openRecord } from './RecordPanel';
import { openDivision, openPolicy, openPrivacy } from './panels';
import { isFresh, latestPlacement } from '../render/divisions';
import { periodLabel, placeLine } from '../content/division';
import { reactionLine, type ReactionCounts } from '../content/reactions';
import { flushPending, describeOutcomes } from '../render/pending';
import { loadPending } from '../render/storage';
import { openGroups } from './GroupsPanel';
import { groupHeaders, groupParam, loadGroup, saveGroup } from '../render/groups';
import { t } from '../content/strings';
import { pwa } from '../render/pwa';
import { money, int, localHour } from '../content/format';
import { pushSupported, loadReminder } from '../render/push';
import { openReminder } from './ReminderPanel';
import { openSettings } from './SettingsPanel';
import { openHowTo } from './HowTo';
import { recipeRow, starRow } from './JobCard';
import { choiceDialog } from './choice';
import { jobFlavour, jobLine, starMarks } from '../content/job';
import { rankLine, rankNext } from '../content/ranks';

export function mountTitle(scene: Phaser.Scene, tips: TipsPanel) {
  const save = loadSave();
  const bests = loadBests();
  const fresh = !isOnboarded();
  const start = (seed: string, freshRun: boolean) => {
    audio.unlock();
    if (freshRun) clearSave();
    withArt(scene, () => scene.scene.start('Game', { seed, fresh: freshRun }));
  };
  const continueRun = () => {
    if (save) {
      audio.unlock();
      withArt(scene, () => scene.scene.start('Game', { seed: save.seed, fresh: false, actions: save.actions }));
    }
  };
  const restart = () => scene.scene.restart();
  const verifierUrl = resolveVerifierUrl();
  const playToday = () => {
    audio.unlock();
    const known = cachedDaily();
    if (known) return start(known.seed, true);
    void todaysYard(verifierUrl).then((seed) => {
      if (scene.scene.isActive('Title')) start(seed, true);
    });
  };

  // ---- notes that appear only when there is something to say ----
  const playerNote = h('div', { class: 'jd-dim jd-home-note', style: 'display:none' }, '');
  if (loadIdentity().name && bearerAllowed(verifierUrl))
    void fetchClaimed(verifierUrl).then((c) => {
      // the server's view of this player: a report shows its note (PLAN-v4 0.7.7)
      if (c?.hidden) {
        playerNote.textContent = t('title.reportedNote', { label: HIDDEN_LABEL });
        playerNote.style.display = '';
        playerNote.dataset.testid = 'player-note';
      }
    });
  // production roadmap 0.8.7: games saved while offline are submitted now, and the player is told what became of them
  const pendingNote = h('div', { class: 'jd-amber jd-home-note', style: 'display:none' }, '');
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
  // the web app's notices (0.10.3): a new version waiting (never shown mid-game: only home asks), and the install offer after the second finished game
  const notices = h('div', { tid: 'notices', style: 'display:flex; flex-direction:column; gap:0.35em' });
  const updateStrip = () =>
    h(
      'div',
      { class: 'jd-row jd-between jd-panel', tid: 'update-ready', style: 'padding:0.4em 0.8em; border-color:#f0a830' },
      h('span', { class: 'jd-amber' }, t('title.updateReady')),
      btn(t('title.updateRestart'), 'update-restart', () => pwa.applyUpdate(), { variant: 'primary', small: true }),
    );
  const installStrip = (kind: 'prompt' | 'ios') => {
    const strip: HTMLElement = h(
      'div',
      { class: 'jd-row jd-between jd-panel', tid: 'install-offer', style: 'padding:0.4em 0.8em' },
      h('span', { style: 'flex:1 1 16em; min-width:0' }, kind === 'ios' ? `${t('title.installOffer')} ${t('title.installIOS')}` : t('title.installOffer')),
      h(
        'span',
        { class: 'jd-row', style: 'gap:0.4em; flex:0 0 auto' },
        kind === 'prompt'
          ? btn(
              t('title.installBtn'),
              'install',
              () => {
                void pwa.promptInstall().then(() => strip.remove());
              },
              { variant: 'primary', small: true },
            )
          : null,
        btn(
          t('title.installLater'),
          'install-later',
          () => {
            pwa.snoozeInstall();
            strip.remove();
          },
          { small: true },
        ),
      ),
    );
    return strip;
  };
  const refreshNotices = () => {
    if (!notices.isConnected && notices.childElementCount) return;
    notices.replaceChildren();
    if (pwa.updateReady) notices.append(updateStrip());
    const offer = pwa.installOffer();
    if (offer) notices.append(installStrip(offer));
  };
  refreshNotices();
  const offUpdate = pwa.onUpdateReady(refreshNotices);
  const offInstall = pwa.onInstallPrompt(refreshNotices);
  scene.events.once('shutdown', () => {
    offUpdate();
    offInstall();
  });

  // ---- the top: who you are, the name, Sal ----
  const streak = currentStreak();
  const foremanText =
    streak === 30 ? foremanSays('streak30') : streak === 7 ? foremanSays('streak7') : streak === 3 ? foremanSays('streak3') : foremanSays('welcome');
  const foreman = foremanBox(foremanText, 'foreman', '', t('foreman.nameLong'));
  const playerName = h('span', { class: 'jd-player', tid: 'player-name' }, playerLabel());
  const hero = h(
    'header',
    { class: 'jd-hero', tid: 'hero' },
    h('div', { class: 'jd-hero-name' }, h('h1', { class: 'jd-wordmark' }, t('title.name')), h('div', { class: 'jd-tagline' }, t('title.tagline'))),
    h(
      'div',
      { class: 'jd-hero-side' },
      h(
        'div',
        { class: 'jd-hero-corner' },
        playerName,
        btn(t('home.settings'), 'settings', () => openSettings(scene, verifierUrl, restart), { small: true }),
      ),
      foreman,
    ),
  );

  // ---- the one thing to do ----
  const stars = totalStars();
  const todayBest = bests.bySeed[todaySeed()];
  const modeSpan = h(
    'span',
    { class: 'jd-dim', tid: 'daily-mode', style: 'font-size:0.8125em; white-space:nowrap', title: t('title.modeTitle') },
    cachedDaily() ? t('common.minted') : t('title.modePracticeUntil'),
  );
  const jobBox = h('div', { tid: 'today-job' });
  const showJob = (seed: string) => {
    const job = yardFor(seed).job;
    jobBox.replaceChildren();
    if (!job) return;
    jobBox.append(
      h('div', { class: 'jd-dim jd-job-flavour' }, jobFlavour(seed, job)),
      h('div', { class: 'jd-job-goal', tid: 'job-goal' }, jobLine(job)),
      starRow(job),
      recipeRow(job),
    );
  };
  if (cachedDaily()) showJob(todaySeed()); // else the job appears once we know today's yard, never one job and then another
  const dailyBtn = btn(t('title.daily'), 'daily', playToday, { variant: fresh || save ? 'dark' : 'primary' });
  dailyBtn.classList.add('jd-home-go');
  const todayLine = h(
    'div',
    { class: 'jd-dim', tid: 'today-line', style: 'font-size:0.8125em' },
    [
      todayBest ? t('title.todayBest', { score: money(todayBest.score) }) : t('title.todayNotPlayed'),
      daysPlayed() ? streakLine(daysPlayed(), currentStreak()) : '',
    ]
      .filter(Boolean)
      .join(' · '),
  ); // PLAN-v3 0.6.3: days played and the streak, no loss copy when it breaks
  const todayCard = h(
    'section',
    { class: 'jd-home-card jd-home-today', tid: 'today-card' },
    h('div', { class: 'jd-row jd-between' }, h('h2', { class: 'jd-head' }, t('job.headToday')), modeSpan),
    jobBox,
    dailyBtn,
    todayLine,
  );
  const lead = h('div', { class: 'jd-home-lead' });
  if (save) {
    lead.append(
      h(
        'section',
        { class: 'jd-home-card jd-home-continue', tid: 'continue-card' },
        btn(t('title.continue'), 'continue', continueRun, { variant: 'primary' }),
        h('div', { class: 'jd-dim', tid: 'continue-note', style: 'font-size:0.8125em' }, t('title.continueNote')),
      ),
    );
  } else if (hasUnusableSave()) {
    lead.append(h('div', { class: 'jd-dim jd-home-note', tid: 'continue-note' }, t('title.unusableSave')));
    clearSave();
  }
  if (fresh && !save)
    lead.append(
      h(
        'section',
        { class: 'jd-home-card', tid: 'learn-card' },
        btn(t('title.learnFresh'), 'learn', () => start(TUTORIAL_SEED, true), { variant: 'primary' }),
        h('div', { class: 'jd-dim', style: 'font-size:0.8125em' }, t('home.learnNote')),
      ),
    );
  lead.append(todayCard);

  // ---- rank and today's board ----
  // where the last closed day left this player (0.11.11): Home says so for a week, the board is a tap away
  const divisionBox = h('div', { class: 'jd-division-line', tid: 'division-line', style: 'display:none' });
  void latestPlacement(verifierUrl).then((p) => {
    if (!p || !isFresh(p.period) || !divisionBox.isConnected) return;
    divisionBox.style.display = '';
    divisionBox.replaceChildren(
      h('span', {}, t('division.home', { day: periodLabel(p.period), line: placeLine(p) })),
      btn(t('division.open'), 'division-open', () => openDivision(scene, verifierUrl, p), { small: true }),
    );
    ui.refit();
  });
  const rankCard = h(
    'section',
    { class: 'jd-home-card jd-home-rank', tid: 'rank' },
    h('div', { class: 'jd-rank-line', tid: 'rank-line' }, rankLine(stars)),
    h('div', { class: 'jd-dim', tid: 'rank-next', style: 'font-size:0.8125em' }, rankNext(stars)),
    divisionBox,
    h(
      'div',
      { style: 'font-size:0.875em; margin-top:0.25em' },
      bests.overall ? t('title.bestScore', { score: money(bests.overall.score), seed: bests.overall.seed }) : t('title.noGames'),
    ),
    h('div', { class: 'jd-dim', style: 'font-size:0.75em' }, t('title.gamesOnDevice', { n: bests.runs })),
    ...loadArchivedBests().map(({ version, bests: ab }) =>
      h(
        'details',
        { tid: `archived-bests-${version}`, style: 'margin-top:0.2em' },
        h('summary', { class: 'jd-dim', style: 'font-size:0.75em; cursor:pointer' }, t('title.underRules', { version: `v${version}` })),
        h(
          'div',
          { class: 'jd-dim', style: 'font-size:0.75em; margin-top:0.15em' },
          `${ab.overall ? t('title.archivedBest', { score: money(ab.overall.score), seed: ab.overall.seed }) : ''}${t('title.archivedGames', { n: ab.runs })}`,
        ),
      ),
    ),
  );
  const url = verifierUrl;
  const line = h('div', { class: 'jd-dim jd-board-lines', tid: 'daily-board' }, t('title.checking'));
  const boardExtras = h('div', { class: 'jd-row', style: 'gap:0.5em; margin-top:0.3em' });
  const strip = h('section', { class: 'jd-home-card', tid: 'daily-strip' }, h('h2', { class: 'jd-head' }, t('title.boardHead')), line, boardExtras);
  const alive = () => line.isConnected && scene.scene.isActive('Title');
  const practiceMode = (why: string) => {
    showJob(practiceSeed());
    modeSpan.textContent = t('title.modePractice', { why });
  };
  const closesIn = (closesAt: string, now: string) => {
    const ms = Date.parse(closesAt) - Date.parse(now);
    if (!Number.isFinite(ms) || ms <= 0) return t('title.closing');
    const hrs = Math.floor(ms / 3_600_000);
    return hrs >= 1 ? t('title.closesInH', { n: hrs }) : t('title.closesInMin', { n: Math.max(1, Math.round(ms / 60_000)) });
  };
  const groupSel = loadGroup();

  // ---- other ways to play ----
  const weeklyBtn = btn(
    t('title.weekly'),
    'weekly',
    () => {
      /* set once the server answers */
    },
    { disabled: true, title: t('title.weeklyTitle') },
  );
  const more = h(
    'div',
    { class: 'jd-home-more' },
    fresh && !save ? null : btn(t(fresh ? 'title.learnFresh' : 'title.learn'), 'learn', () => start(TUTORIAL_SEED, true)),
    btn(t('title.random'), 'random', () => start(randomSeed(), true)),
    weeklyBtn,
  );
  const link = (text: string, tid: string, onClick: () => void, title?: string) => h('button', { class: 'jd-link', tid, type: 'button', title, onClick }, text);
  const footer = h(
    'nav',
    { class: 'jd-home-foot', tid: 'home-foot' },
    link(t('home.howto'), 'howto', () => openHowTo(scene, tips)),
    link(t('title.record'), 'record', () => openRecord(scene), t('title.recordTitle')),
    link(t('title.crews'), 'groups', () => openGroups(scene, verifierUrl, () => scene.scene.restart()), t('title.crewsTitle')),
    link(t('home.more'), 'more', () => {
      const r = pushSupported() ? loadReminder() : null;
      choiceDialog(scene, {
        title: t('home.more'),
        tid: 'more-dialog',
        choices: [
          { label: t('title.archive'), tid: 'archive', run: () => openArchive(scene, verifierUrl) },
          ...(pushSupported()
            ? [
                {
                  label: r ? t('title.reminderOn', { time: localHour(r.hourLocal) }) : t('title.reminder'),
                  tid: 'reminder',
                  run: () => openReminder(scene, verifierUrl, () => {}),
                },
              ]
            : []),
          {
            label: t('title.custom'),
            tid: 'custom',
            run: () => {
              void promptText(scene, t('title.customTitle'), t('title.customLabel', { max: MAX_SEED_LENGTH }), 'junkyard', MAX_SEED_LENGTH).then((s) => {
                if (s && s.trim()) start(sanitizeSeed(s), true);
              });
            },
          },
          { label: t('title.import'), tid: 'import', run: () => importRecording(scene) },
          { label: t('title.policy'), tid: 'policy', run: () => openPolicy(scene) },
          {
            label: t('title.privacyLink'),
            tid: 'privacy',
            run: () => openPrivacy(scene, verifierUrl, 'privacy', () => (playerName.textContent = playerLabel())),
          },
        ],
        onDismiss: () => {},
      });
    }),
  );

  // ---- what our server says ----
  void fetchWeekly(url).then((wk) => {
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
    weeklyBtn.title = t('title.weeklyBtnTitle');
    weeklyBtn.dataset.seed = wk.seed;
    weeklyBtn.disabled = false;
    weeklyBtn.onclick = () => start(wk.seed, true);
  });
  fetch(`${url}/daily?limit=5${groupParam(url)}`, { headers: groupHeaders(url) })
    .then((r) => {
      if (!r.ok && groupSel && (r.status === 401 || r.status === 403)) {
        saveGroup(null);
        throw new Error('group unavailable');
      }
      if (!r.ok) throw new Error(`no daily (${r.status})`); // a server with no board today: the practice yard, said plainly (the catch below)
      return r.json();
    })
    .then(
      (d: {
        seed: string;
        date?: string;
        rulesVersion: number;
        entries: { player: string; score: number; replayHash: string; replayAvailable?: boolean; stars?: number; reactions?: ReactionCounts }[];
        botPar?: number | null;
        closesAt?: string;
        now?: string;
        final?: boolean;
      }) => {
        if (!alive()) return;
        const info = acceptDaily(d);
        if (!info) {
          practiceMode(t('title.practiceOtherDay', { date: d.date ?? t('title.anotherDay') }));
          line.textContent = t('title.boardOtherDay');
          return;
        }
        const seed = info.seed;
        showJob(seed);
        todayCard.dataset.seed = seed;
        if (!(streak === 3 || streak === 7 || streak === 30)) setForeman(foreman, foremanSays(d.final ? 'dailyFinal' : 'dailyOpen'));
        modeSpan.textContent = `${d.final ? t('title.modeRankedFinal') : t('title.modeRankedProvisional', { closes: closesIn(d.closesAt ?? info.closesAt, d.now ?? new Date().toISOString()) })}${groupSel ? t('title.crewSuffix', { name: groupSel.name }) : ''}`; // PLAN-v3 0.6.2: one global deadline, said plainly
        const rows = d.entries.map((e, i) =>
          h(
            'div',
            { class: 'jd-board-line' },
            `${i + 1}. ${money(e.score)} ${e.player}${e.stars ? ` ${starMarks(e.stars)}` : ''}${e.reactions ? ` ${reactionLine(e.reactions)}` : ''}`,
          ),
        );
        line.replaceChildren(...(rows.length ? rows : [t('title.noScores')]));
        line.classList.toggle('jd-dim', !d.entries.length);
        if (d.botPar != null)
          boardExtras.prepend(
            h(
              'span',
              { class: 'jd-dim', tid: 'daily-par', style: 'font-size:0.8125em; white-space:nowrap', title: t('title.foremanMarkTitle') },
              t('title.foremanMark', { score: money(d.botPar) }),
            ),
          );
        if (d.entries.length) {
          fetch(`${url}/histogram?seed=${encodeURIComponent(seed)}${groupParam(url)}`, { headers: groupHeaders(url) })
            .then((r) => r.json())
            .then((hg: { n: number; bins: { count: number }[] }) => {
              if (!alive() || !hg.n) return;
              const max = Math.max(1, ...hg.bins.map((b) => b.count));
              boardExtras.append(
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
                  line.classList.add('jd-red');
                  watch.disabled = false;
                });
            },
            { small: true, disabled: !!gate, title: gate ?? t('title.watchTitle') },
          );
          boardExtras.append(watch);
        }
        const mine = loadSubmissions()[seed];
        if (!mine) return;
        fetch(`${url}/board?seed=${encodeURIComponent(seed)}&limit=100${groupParam(url)}`, { headers: groupHeaders(url) })
          .then((r) => r.json())
          .then((b: { entries: { replayHash: string }[] }) => {
            if (!alive()) return;
            const i = b.entries.findIndex((e) => e.replayHash === mine.replayHash);
            line.prepend(
              h(
                'div',
                { class: 'jd-board-line jd-amber', tid: 'daily-you' },
                t('title.you', {
                  rank: i >= 0 ? t('common.rankOf', { n: int(i + 1), of: int(b.entries.length) }) : t('common.beyondTop', { of: int(b.entries.length) }),
                  score: money(mine.score),
                }),
              ),
            );
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
      practiceMode(t('title.offlineWhy'));
      line.textContent = t('title.offline');
    });

  const screen = h(
    'div',
    { class: 'jd-title' },
    hero,
    notices,
    playerNote,
    pendingNote,
    h('div', { class: 'jd-home-main' }, lead, h('div', { class: 'jd-home-side' }, rankCard, strip)),
    more,
    footer,
  );
  ui.mount(scene, screen, (e) => {
    if (e.key !== 'Enter' || tips.isOpen || ui.dialogOpen) return;
    const el = e.target as HTMLElement | null;
    if (el && (el.tagName === 'BUTTON' || el.tagName === 'INPUT')) return; // the focused control handles its own Enter
    if (save) continueRun();
    else if (fresh) start(TUTORIAL_SEED, true);
    else playToday();
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
      withArt(scene, () => scene.scene.start('Game', { seed: r.seed, fresh: true, replay: r.actions }));
    } catch (e) {
      void alertText(scene, t('title.importUnreadable'), (e as Error).message);
    }
  });
}
