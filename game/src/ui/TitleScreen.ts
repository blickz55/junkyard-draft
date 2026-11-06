/**
 * The home screen as DOM (DOSSIER-v1 0.4.0; rebuilt for docs/UX-STANDARD.md). One primary action: keep playing a saved game,
 * learn if you are new, else play today's yard, and today's job is right there with its stars. Your rank and today's board
 * sit beside it; everything else is a quiet line of links, and the settings live in their own dialog. The Phaser TitleScene
 * keeps the tips panel. Every string comes from the table (0.9.0).
 */
import { isTestEdition, verifierUrl as resolveVerifierUrl } from '../render/config';
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
  lessonsDone,
  daysPlayed,
  currentStreak,
  careerStars,
  gamesEver,
  loadLinked,
} from '../render/storage';
import { streakLine } from '../content/streak';
import { withTitle } from '../content/title';
import { yardLabel } from '../content/yard';
import { MAX_SEED_LENGTH, sanitizeSeed, TUTORIAL_SEED } from '../sim/run';
import { yardFor } from '../sim/yard';
import { decodeReplay, verifyReplay } from '../sim/replay';
import { fetchVerifiedReplay, playVerifiedReplay } from '../render/verified';
import { identityDialog, playerLabel } from './identityDialog';
import { loadIdentity, fetchClaimed, bearerAllowed } from '../render/identity';
import { HIDDEN_LABEL } from '../identity/identity';
import { acceptDaily, cachedDaily, practiceSeed, todaySeed, revealGate, fetchWeekly, todaysYard, yesterdayOffer } from '../render/daily';
import {
  openArchive,
  openDivision,
  openFriends,
  openGroups,
  openHub,
  openInbox,
  openLinkLanding,
  openFeedback,
  openPaint,
  openPolicy,
  openPrivacy,
  openRecord,
  openReminder,
  openSettings,
  openThread,
} from './panels';
import { syncNow, takeLinkToken } from '../render/link';
import { hasInbox, loadInbox } from '../render/inbox';
import { isFresh, latestPlacement } from '../render/divisions';
import { periodLabel, placeLine } from '../content/division';
import { reactionLine, type ReactionCounts } from '../content/reactions';
import { flushPending, describeOutcomes } from '../render/pending';
import { loadDailyDates, loadPending, loadSalBeaten } from '../render/storage';
import { salLater } from '../render/sal';
import { groupHeaders, groupParam, loadGroup, saveGroup } from '../render/groups';
import { t } from '../content/strings';
import { pwa } from '../render/pwa';
import { money, int, localHour } from '../content/format';
import { pushSupported, loadReminder } from '../render/push';
import { openHowTo } from './HowTo';
import { orderRow, recipeRow, starRow } from './JobCard';
import { choiceDialog } from './choice';
import { LESSONS } from '../content/lessons';
import { jobFlavour, jobLine, starMarks, yardNote } from '../content/job';
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
  const testing = isTestEdition(); // a tester build has no server: what needs one stays out of sight
  const streak = currentStreak();
  const foremanText =
    streak === 30 ? foremanSays('streak30') : streak === 7 ? foremanSays('streak7') : streak === 3 ? foremanSays('streak3') : foremanSays('welcome');
  const foreman = foremanBox(foremanText, 'foreman', '', t('foreman.nameLong'));
  const playerName = btn(
    playerLabel(),
    'player-name',
    () => {
      void identityDialog(scene, verifierUrl, (note) => {
        playerName.textContent = playerLabel();
        if (!note) return;
        playerNote.textContent = note;
        playerNote.style.display = '';
        playerNote.dataset.testid = 'player-note';
      });
    },
    { small: true },
  );
  playerName.classList.add('jd-player');
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
        testing ? null : playerName,
        btn(t('home.settings'), 'settings', () => openSettings(scene, verifierUrl, restart), { small: true }),
      ),
      foreman,
    ),
  );

  // ---- the one thing to do ----
  const stars = careerStars();
  const earlier = loadArchivedBests()[0]?.bests.overall ?? null; // no best under these rules yet: the last one under earlier rules, said so
  const todayBest = bests.bySeed[todaySeed()];
  const modeSpan = h(
    'span',
    { class: 'jd-dim', tid: 'daily-mode', style: 'font-size:0.8125em; white-space:nowrap', title: t('title.modeTitle') },
    cachedDaily() ? t('common.minted') : t('title.modePracticeUntil'),
  );
  if (testing) modeSpan.style.display = 'none'; // there is nothing else for today's yard to be, so "practice" only raises the question
  const jobBox = h('div', { tid: 'today-job' });
  let salKnown: number | null = null; // the number to beat, in place of "you haven't played": Home has no height to spare at 130 %
  const todayLine = h('div', { class: 'jd-dim', tid: 'today-line', style: 'font-size:0.8125em' }); // PLAN-v3 0.6.3: days played and the streak, no loss copy when it breaks
  // yesterday's yard, while the rule still takes it and this device has not had it checked: a door, no clock time, no streak word (2026-11-06)
  const yesterdayLine = h('div', { class: 'jd-dim', tid: 'yesterday-line', style: 'font-size:0.8125em; display:none' });
  function paintToday() {
    todayLine.textContent = [
      todayBest
        ? t('title.todayBest', { score: money(todayBest.score) })
        : save?.seed === todaySeed()
          ? t('title.todayUnderway')
          : salKnown != null
            ? t('home.salToday', { amount: money(salKnown) })
            : t('title.todayNotPlayed'),
      daysPlayed() ? streakLine(daysPlayed(), currentStreak()) : '',
    ]
      .filter(Boolean)
      .join(' · ');
  }
  paintToday();
  const showJob = (seed: string) => {
    const job = yardFor(seed).job;
    jobBox.replaceChildren();
    if (!job) return;
    jobBox.append(
      h('div', { class: 'jd-dim jd-job-flavour' }, jobFlavour(seed, job)),
      h('div', { class: 'jd-job-goal', tid: 'job-goal' }, jobLine(job)),
      ...(job.orders ? [orderRow(job)] : []),
      starRow(job),
      ...(job.orders ? [] : [recipeRow(job)]),
      ...[yardNote(seed, job)].filter((n) => n).map((n) => h('div', { class: 'jd-amber', tid: 'home-yard-note', style: 'font-size:0.8125em' }, n)),
    );
    // the number to beat, worked out a shift at a time once Home is up
    if (job.orders)
      salLater(seed, (g) => {
        salKnown = g.score;
        paintToday();
      });
  };
  if (cachedDaily()) showJob(todaySeed()); // else the job appears once we know today's yard, never one job and then another
  const dailyBtn = btn(t('title.daily'), 'daily', playToday, { variant: fresh || save ? 'dark' : 'primary' });
  dailyBtn.classList.add('jd-home-go');
  const todayCard = h(
    'section',
    { class: 'jd-home-card jd-home-today', tid: 'today-card' },
    h('div', { class: 'jd-row jd-between' }, h('h2', { class: 'jd-head' }, t('job.headToday')), modeSpan),
    jobBox,
    dailyBtn,
    todayLine,
    yesterdayLine,
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
    loadSalBeaten().length
      ? h('div', { class: 'jd-gold', tid: 'sal-beaten', style: 'font-size:0.8125em' }, t('title.salBeaten', { n: loadSalBeaten().length }))
      : null,
    divisionBox,
    h(
      'div',
      { style: 'font-size:0.875em; margin-top:0.25em' },
      bests.overall
        ? t('title.bestScore', { score: money(bests.overall.score), yard: yardLabel(bests.overall.seed) })
        : earlier
          ? t('title.bestEarlier', { score: money(earlier.score), yard: yardLabel(earlier.seed) })
          : t('title.noGames'),
    ),
    h('div', { class: 'jd-dim', style: 'font-size:0.75em' }, t('title.gamesOnDevice', { n: gamesEver() })),
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

  /** The lessons, the next one first in line. */
  const chooseLesson = () => {
    const done = lessonsDone();
    const next = LESSONS.find((l) => !done.includes(l.n));
    choiceDialog(scene, {
      title: t('lessons.title'),
      tid: 'lessons-dialog',
      choices: [
        ...LESSONS.map((l) => ({
          label: t(done.includes(l.n) ? 'lessons.itemDone' : 'lessons.item', { n: l.n, title: t(l.title) }),
          tid: `lesson-${l.n}`,
          primary: l === next,
          run: () => start(l.seed, true),
        })),
        { label: t('lessons.cancel'), tid: 'lessons-back' },
      ],
      note: t('lessons.note'),
      onDismiss: () => {},
    });
  };

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
    fresh && !save
      ? null
      : btn(
          fresh ? t('title.learnFresh') : t('title.learn', { n: lessonsDone().length, total: LESSONS.length }),
          'learn',
          fresh ? () => start(TUTORIAL_SEED, true) : chooseLesson,
        ),
    btn(t('title.random'), 'random', () => start(randomSeed(), true)),
    testing ? null : weeklyBtn,
  );
  const link = (text: string, tid: string, onClick: () => void, title?: string) => h('button', { class: 'jd-link', tid, type: 'button', title, onClick }, text);
  // the inbox (0.11.7): there once this device has a game on a board, amber while something is unread
  const inboxLink = link(t('home.inbox'), 'inbox', () =>
    openInbox(scene, verifierUrl, () => {
      inboxLink.textContent = t('home.inbox');
      inboxLink.classList.remove('jd-amber');
    }),
  );
  inboxLink.style.display = 'none';
  // the day's talk (0.11.5): the server says there is one, or there is no way in
  let talkKey = '';
  const talkLink = link(t('home.talk'), 'talk', () => openThread(scene, verifierUrl, talkKey));
  talkLink.style.display = 'none';
  const hubLink = link(t('home.community'), 'community', () => openHub(scene, verifierUrl));
  hubLink.style.display = 'none';
  if (hasInbox(verifierUrl)) {
    inboxLink.style.display = '';
    void loadInbox(verifierUrl).then((inbox) => {
      if (!inbox?.unread) return;
      inboxLink.textContent = t('home.inboxUnread', { n: inbox.unread });
      inboxLink.classList.add('jd-amber');
    });
  }
  const feedbackLink = testing ? link(t('test.feedback'), 'feedback', () => openFeedback(scene)) : null;
  feedbackLink?.classList.add('jd-amber');
  const footer = h(
    'nav',
    { class: 'jd-home-foot', tid: 'home-foot' },
    link(t('home.howto'), 'howto', () => openHowTo(scene, tips)),
    link(t('title.record'), 'record', () => openRecord(scene), t('title.recordTitle')),
    testing ? null : link(t('title.crews'), 'groups', () => openGroups(scene, verifierUrl, () => scene.scene.restart()), t('title.crewsTitle')),
    inboxLink,
    talkLink,
    hubLink,
    loadLinked() ? link(t('home.friends'), 'friends', () => openFriends(scene, verifierUrl)) : null,
    testing
      ? null
      : link(t('home.more'), 'more', () => {
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
              { label: t('title.paint'), tid: 'paint', run: () => openPaint(scene, verifierUrl) },
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
  // a tester build goes straight to the offline path: nobody should wait on a server that is not there
  (testing ? Promise.reject(new Error('no server')) : fetch(`${url}/daily?limit=5${groupParam(url)}`, { headers: groupHeaders(url) }))
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
        entries: { player: string; score: number; replayHash: string; replayAvailable?: boolean; stars?: number; reactions?: ReactionCounts; badge?: string }[];
        botPar?: number | null;
        closesAt?: string;
        now?: string;
        final?: boolean;
        talk?: { posts: number };
      }) => {
        if (!alive()) return;
        const info = acceptDaily(d);
        if (!info) {
          practiceMode(t('title.practiceOtherDay', { date: d.date ?? t('title.anotherDay') }));
          line.textContent = t('title.boardOtherDay');
          return;
        }
        const seed = info.seed;
        if (d.talk) {
          talkKey = info.date;
          talkLink.style.display = '';
          hubLink.style.display = '';
          if (d.talk.posts) talkLink.textContent = t('home.talkCount', { n: d.talk.posts });
        }
        showJob(seed);
        todayCard.dataset.seed = seed;
        const open = save ? null : yesterdayOffer(info, loadDailyDates());
        if (open) {
          yesterdayLine.replaceChildren(
            t('title.yesterdayOpen', { left: closesIn(open.closesAt, d.now ?? new Date().toISOString()) }),
            ' ',
            link(t('title.yesterdayPlay'), 'yesterday-play', () => start(open.seed, true)),
          );
          yesterdayLine.style.display = '';
          ui.refit();
        }
        if (!(streak === 3 || streak === 7 || streak === 30)) setForeman(foreman, foremanSays(d.final ? 'dailyFinal' : 'dailyOpen'));
        modeSpan.textContent = `${d.final ? t('title.modeRankedFinal') : t('title.modeRankedProvisional', { closes: closesIn(d.closesAt ?? info.closesAt, d.now ?? new Date().toISOString()) })}${groupSel ? t('title.crewSuffix', { name: groupSel.name }) : ''}`; // PLAN-v3 0.6.2: one global deadline, said plainly
        const rows = d.entries.map((e, i) =>
          h(
            'div',
            { class: 'jd-board-line' },
            `${i + 1}. ${money(e.score)} ${withTitle(e.player, e.badge)}${e.stars ? ` ${starMarks(e.stars)}` : ''}${e.reactions ? ` ${reactionLine(e.reactions)}` : ''}`,
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
                h('span', { class: 'jd-dim', tid: 'daily-count', style: 'font-size:0.75em; margin-left:0.4em' }, t('title.playedToday', { n: hg.n })), // the count as text: a hover title is not a thing on a phone
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
    testing ? h('div', { class: 'jd-dim jd-home-note', tid: 'test-banner' }, t('test.banner')) : null,
    testing ? h('div', { class: 'jd-home-note' }, feedbackLink) : null,
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
  // email sign-in (0.11.1): a link that just came back asks first; a signed-in device brings itself level, and redraws if it learnt something
  const linkToken = takeLinkToken();
  if (linkToken) openLinkLanding(scene, verifierUrl, linkToken, restart);
  else
    void syncNow(verifierUrl).then((learnt) => {
      if (learnt && screen.isConnected && !ui.dialogOpen) restart();
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
