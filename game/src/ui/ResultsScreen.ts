import { verifierUrl as resolveVerifierUrl } from '../render/config';
/** Results screen as DOM (DOSSIER-v1 0.4.0): score, round bars, what shipped, the checked board, submission and sharing. Every string comes from the table (0.9.0). */
import type Phaser from 'phaser';
import { h, btn, ui, textureImg, promptText, showText, foremanBox, setForeman } from './dom';
import { foremanSays, resultsBand } from '../content/foreman';
import type { RunState } from '../sim/run';
import { encodeReplay, exportReplay } from '../sim/replay';
import { RULES } from '../sim/rules';
import {
  daysPlayed,
  loadBests,
  loadPlayer,
  loadSubmissions,
  randomSeed,
  recordSubmission,
  savePlayer,
  recordDailyDate,
  currentStreak,
  loadHistory,
  savePending,
  firstTime,
  recordStanding,
  recordMedal,
} from '../render/storage';
import { isMintedDailySeed, dailyDateOf } from '../sim/daily';
import { telemetry } from '../render/telemetry';
import { shareText, type Rank } from '../render/share';
import { badgesFor } from '../content/badges';
import { fetchVerifiedReplay, playVerifiedReplay } from '../render/verified';
import { audio } from '../render/audio';
import { authHeaders, bearerAllowed, claimName, loadIdentity } from '../render/identity';
import { labelFor } from '../identity/identity';
import { todaySeed, revealGate, todayUTC } from '../render/daily';
import { shiftUtcDate } from '../daily/streak';
import { medalFor, medalsLine, type Medals } from '../daily/medals';
import { openPolicy } from './PolicyPanel';
import { openPrivacy } from './PrivacyPanel';
import { challengeLink, challengeOutcome, type Challenge } from '../render/challenge';
import { groupHeaders, groupParam, loadGroup } from '../render/groups';
import { forkLabel } from '../content/fork';
import type { CardInput } from '../render/card';
import { loadForkBests } from '../render/storage';
import { t } from '../content/strings';
import { money, int, utcDateTime } from '../content/format';
import { yardLabel } from '../content/yard';
import { materialName } from '../content/machines';

/** What the scene keeps so tests and later screens can read it. */
export interface ResultsHost extends Phaser.Scene {
  lastRank: Rank | null;
  lastPlayer: string;
  lastShareText: string;
  lastPercentile: number | null;
  lastN: number;
  lastMedal: string | null;
  cardInput: (() => CardInput) | null;
  exportCard(): Promise<{ size: number; width: number; height: number; filename: string; savedTo: string; footer: string }>;
  verifiedHash: string | null;
  matchesStoredSubmission(): Promise<boolean>;
  exportClip(round?: number, onProgress?: (f: number) => void): Promise<{ filename: string; savedTo: string; size: number; ms: number }>;
  exportGif(round?: number, onProgress?: (f: number) => void): Promise<{ filename: string; savedTo: string; size: number; ms: number; frames: number }>;
}

export function mountResults(
  scene: ResultsHost,
  run: RunState,
  o: {
    replayed: boolean;
    replayLabel?: string;
    newOverall: boolean;
    newSeed: boolean;
    challenge?: Challenge;
    replayHash?: string;
    replayPlayer?: string;
    newFork?: boolean;
    prevSeedBest?: number | null;
  },
) {
  const fork = run.forkedFrom ?? null; // PLAN-v4 0.7.3
  const bests = loadBests();
  const go = (seed: string) => {
    audio.unlock();
    scene.scene.start('Game', { seed, fresh: true, challenge: o.challenge && o.challenge.seed === seed ? o.challenge : undefined });
  }; // a retry keeps the challenge; another yard drops it (PLAN-v4 0.7.1)
  const verifierUrl = resolveVerifierUrl();
  const cap = (x: string) => x.charAt(0).toUpperCase() + x.slice(1);

  // the results card (production roadmap 0.9.2): the standing sentence leads, then the money, then the deltas (the foreman's mark,
  // this device's best on the yard, the medal on a closed daily); the yard label and the rest follow; rank and the top five are below the fold
  const isToday = !o.replayed && !fork && run.seed === todaySeed();
  const scope = isToday ? t('results.scopeToday') : t('results.scopeYard');
  const headline = h(
    'div',
    { class: 'jd-head', tid: 'headline', style: 'font-size:1.0625em; letter-spacing:0.08em; text-transform:none' },
    o.replayed ? t('results.headReplay') : t('results.head'),
  );
  const setHeadline = (text: string, standing: boolean) => {
    headline.textContent = text;
    headline.classList.toggle('jd-dim', !standing);
    headline.classList.toggle('jd-amber', standing);
  };
  setHeadline(headline.textContent ?? '', false);
  const deltas = h('div', { class: 'jd-row jd-center', tid: 'deltas', style: 'gap:0.3em 1.1em; margin-top:0.3em; font-size:0.875em; min-height:1.3em' });
  const renderDeltas = () => {
    deltas.replaceChildren();
    if (o.replayed) return;
    if (botPar != null) {
      const d = run.score - botPar;
      deltas.append(
        h(
          'span',
          { class: d > 0 ? 'jd-green' : d < 0 ? 'jd-dim' : 'jd-amber', tid: 'delta-par' },
          d > 0 ? t('results.deltaParOver', { d: money(d) }) : d < 0 ? t('results.deltaParUnder', { d: money(d) }) : t('results.deltaParEqual'),
        ),
      );
    }
    if (!fork) {
      const prev = o.prevSeedBest ?? null;
      const d = prev == null ? null : run.score - prev;
      deltas.append(
        h(
          'span',
          { class: d != null && d > 0 ? 'jd-green' : 'jd-dim', tid: 'delta-best' },
          d == null
            ? t('results.deltaBestFirst')
            : d > 0
              ? t('results.deltaBestOver', { d: money(d) })
              : d < 0
                ? t('results.deltaBestUnder', { d: money(d), best: money(prev!) })
                : t('results.deltaBestEqual'),
        ),
      );
    }
    if (scene.lastMedal)
      deltas.append(h('span', { class: 'jd-badge-pill', tid: 'medal', style: 'font-size:0.75em' }, t('results.medalPill', { medal: cap(scene.lastMedal) })));
  };
  const yesterdayBest = (() => {
    if (!isToday) return null;
    const y = shiftUtcDate(todayUTC(), -1);
    for (const [seed, b] of Object.entries(bests.bySeed)) if (dailyDateOf(seed) === y) return b.score;
    return null;
  })();
  const header = h(
    'div',
    { style: 'text-align:center' },
    headline,
    h('div', { class: 'jd-gold jd-pop', tid: 'score', style: 'font-size:4.25em; font-weight:700; line-height:1.05' }, money(run.score)),
    deltas,
    h(
      'div',
      {
        class: `jd-mono ${o.replayed ? 'jd-blue' : 'jd-dim'}`,
        tid: 'results-subtitle',
        style: 'font-size:0.8125em; margin-top:0.25em; overflow-wrap:anywhere',
      },
      `${t('results.subtitle', { yard: yardLabel(run.seed) })}${o.replayed ? t('results.subtitleReplay', { label: o.replayLabel ?? t('results.replayPlayback') }) : ''}${fork ? t('results.subtitleTry', { label: forkLabel(fork) }) : ''}`,
    ),
    fork
      ? h(
          'div',
          { class: o.newFork ? 'jd-green' : 'jd-dim', tid: 'fork-best', style: 'margin-top:0.25em; font-size:0.875em' },
          o.newFork
            ? t('results.newTryBest', { score: money(run.score) })
            : t('results.tryBest', { score: money(loadForkBests()[run.seed]?.score ?? run.score) }),
        )
      : o.newOverall
        ? h('div', { class: 'jd-green', style: 'font-weight:700; letter-spacing:0.1em; margin-top:0.25em' }, t('results.newOverall'))
        : o.newSeed
          ? h('div', { class: 'jd-green', style: 'margin-top:0.25em' }, t('results.newYard'))
          : h(
              'div',
              { class: 'jd-dim', style: 'font-size:0.875em; margin-top:0.25em' },
              bests.overall ? t('results.bestLine', { score: money(bests.overall.score), seed: bests.overall.seed }) : '',
            ),
    yesterdayBest != null
      ? h(
          'div',
          { class: 'jd-mono jd-dim', tid: 'since-yesterday', style: 'font-size:0.8125em; margin-top:0.3em' },
          t('results.sinceYesterday', {
            yesterday: money(yesterdayBest),
            today: money(run.score),
            delta:
              run.score > yesterdayBest
                ? t('results.deltaUp', { d: money(run.score - yesterdayBest) })
                : run.score < yesterdayBest
                  ? money(run.score - yesterdayBest)
                  : t('results.deltaSame'),
          }),
        )
      : null,
    o.challenge && !o.replayed
      ? h(
          'div',
          { class: 'jd-mono jd-amber', tid: 'challenge-result', style: 'font-size:0.8125em; margin-top:0.3em' },
          t('results.challengeLine', {
            score: money(run.score),
            player: o.challenge.player,
            theirs: money(o.challenge.score),
            outcome: challengeOutcome(run.score, o.challenge).text,
          }),
        )
      : null,
  );

  // non-ranked badges (PLAN-v1 0.4.6): recognition, never a ladder; Minimalist needs the foreman's mark, so the row is refreshed when it lands
  let botPar: number | null = null;
  const badgeRow = h('div', { class: 'jd-row jd-center', tid: 'badges', style: 'gap:0.5em; margin-top:0.3em; min-height:1.6em' });
  const renderBadges = () => {
    const earned = badgesFor(run, botPar);
    badgeRow.replaceChildren(...earned.map((b) => h('span', { class: 'jd-badge-pill', tid: `badge-${b.id}`, title: b.text }, b.title)));
    if (earned.length) badgeRow.append(h('span', { class: 'jd-dim', style: 'font-size:0.6875em' }, t('results.badgesNote')));
  };
  renderBadges();
  renderDeltas();
  header.append(badgeRow);
  // the foreman (0.9.1): the first game on this device, else the band once everyone today has answered, else offline
  const foreman = foremanBox(
    !o.replayed && !fork && bests.runs === 1 ? foremanSays('resultsFirst') : '',
    'foreman',
    'margin:0.4em auto 0; max-width:44em; text-align:left',
  );
  header.append(foreman);
  let foremanSettled = !!foreman.textContent?.trim() && bests.runs === 1;
  const max = Math.max(1, ...run.rounds.map((r) => r.earned));
  const rounds = h(
    'div',
    { class: 'jd-panel', tid: 'round-bars' },
    h('div', { class: 'jd-head' }, t('results.roundByRound')),
    ...run.rounds.map((r, i) =>
      h(
        'div',
        { class: 'jd-row', style: 'margin-top:0.4em; flex-wrap:nowrap' },
        h('span', { class: 'jd-dim', style: 'width:5em; font-size:0.875em' }, t('results.round', { n: r.round })),
        h(
          'div',
          { style: 'flex:1' },
          h('div', { class: `jd-bar${i === run.rounds.length - 1 ? ' jd-bar-last' : ''}`, style: `width:${Math.round((100 * r.earned) / max)}%` }),
        ),
        h('span', { style: 'width:4em; text-align:right; font-weight:700; font-size:0.875em' }, money(r.earned)),
      ),
    ),
  );

  const shipped = run.rounds.reduce(
    (acc, r) => {
      for (const k of Object.keys(r.result.shipped) as (keyof typeof r.result.shipped)[]) acc[k] = (acc[k] || 0) + r.result.shipped[k];
      return acc;
    },
    {} as Record<string, number>,
  );
  const shippedPanel = h('div', { class: 'jd-panel' }, h('div', { class: 'jd-head' }, t('results.shipped')));
  for (const m of ['ingot', 'plate', 'shards', 'scrap', 'slag'] as const)
    if (shipped[m])
      shippedPanel.append(
        h(
          'div',
          { class: 'jd-row', style: 'margin-top:0.35em; gap:0.5em; font-size:0.875em' },
          textureImg(scene.game, `i-${m}`, materialName(m)),
          t('results.shippedLine', { n: shipped[m], mat: materialName(m), each: money(RULES.value[m]), total: money(shipped[m] * RULES.value[m]) }),
        ),
      );
  if (run.sold) shippedPanel.append(h('div', { style: 'margin-top:0.35em; font-size:0.875em' }, t('results.sold', { amount: money(run.sold) })));
  if (run.rerolls)
    shippedPanel.append(
      h(
        'div',
        { style: 'margin-top:0.35em; font-size:0.875em', tid: 'rerolls-line' },
        t('results.newOffers', { n: run.rerolls, cost: money(RULES.rerollCost), total: money(run.rerolls * RULES.rerollCost) }),
      ),
    ); // score = production + sales − offers bought
  shippedPanel.append(
    h('div', { class: 'jd-dim', style: 'margin-top:0.5em; font-size:0.8125em' }, t('results.picked', { list: run.picks.map((p) => cap(p)).join(', ') })),
  );
  shippedPanel.append(h('div', { class: 'jd-dim', style: 'margin-top:0.35em; font-size:0.75em' }, t('results.scoreNote')));

  const histBox = h('div', { tid: 'histogram' });
  const entriesBox = h('div', { class: 'jd-entries' });
  const boardHead = h(
    'div',
    { class: 'jd-head', tid: 'board-head' },
    `${t('results.boardHead')}${loadGroup() ? t('results.boardCrew', { name: loadGroup()!.name }) : ''}`,
  );
  const boardPanel = h(
    'div',
    { class: 'jd-panel', tid: 'board' },
    boardHead,
    h('div', { class: 'jd-grid2', style: 'gap:1.25em; align-items:start' }, histBox, entriesBox),
  );
  const status = h('div', { class: 'jd-mono jd-dim', tid: 'status', style: 'font-size:0.75em; min-height:1.3em' });
  const setStatus = (text: string, cls = 'jd-dim') => {
    status.textContent = text;
    status.className = `jd-mono ${cls}`;
  };

  /** Everyone today, first (PLAN-v1 0.4.1): where this game sits among real checked games; with fewer than five, the entries that exist and never an invented population. */
  let histGen = 0;
  const loadHistogram = async (attempt = 0) => {
    const gen = ++histGen; // a response for an older request or a replaced screen is ignored (review F11)
    histBox.replaceChildren();
    try {
      // standing is shown only for THIS game's recording: a submission made on this screen, or a stored one with the same identity
      if (!scene.verifiedHash && (await scene.matchesStoredSubmission())) scene.verifiedHash = loadSubmissions()[run.seed]?.replayHash ?? null;
      const mine = scene.verifiedHash ?? undefined;
      const prior = !mine ? loadSubmissions()[run.seed] : undefined;
      const hres = await fetch(
        `${verifierUrl}/histogram?seed=${encodeURIComponent(run.seed)}${mine ? `&hash=${encodeURIComponent(mine)}` : ''}${groupParam(verifierUrl)}`,
        { headers: groupHeaders(verifierUrl) },
      );
      const hg = (await hres.json()) as {
        n: number;
        step: number;
        bins: { from: number; to: number; count: number }[];
        mine: { score: number; rank: number; bin: number; percentile: number } | null;
        around: { rank: number; player: string; score: number; mine: boolean }[];
        botPar?: number | null;
        medals?: Medals | null;
      };
      if (gen !== histGen || !histBox.isConnected) return;
      // the mark is computed off the request path by the server the first time a yard is seen: poll a few times while it is pending
      if (hg.botPar == null && attempt < 22)
        setTimeout(() => {
          if (histBox.isConnected) void loadHistogram(attempt + 1);
        }, 4000); // the first game on a yard waits for the mark: keep asking for ~90 s (a loaded server can take that long), then stop
      const parLine =
        hg.botPar != null
          ? h(
              'div',
              { class: 'jd-mono jd-dim', tid: 'bot-par', style: 'font-size:0.75em; margin-top:0.3em' },
              t('results.foremanLine', {
                score: money(hg.botPar),
                suffix: run.score > hg.botPar ? t('results.foremanBeat') : run.score === hg.botPar ? t('results.foremanMatched') : '',
              }),
            )
          : null;
      if (hg.mine) {
        scene.lastPercentile = hg.mine.percentile;
        scene.lastN = hg.n;
        if (!o.replayed)
          recordStanding({ seed: run.seed, at: new Date().toISOString(), score: hg.mine.score, percentile: hg.mine.percentile, n: hg.n, rank: hg.mine.rank }); // 0.9.7: the record page
        if (!foremanSettled) {
          setForeman(foreman, foremanSays(resultsBand(hg.mine.percentile, hg.n)));
          foremanSettled = true;
        }
      }
      if (!o.replayed)
        setHeadline(
          hg.mine
            ? hg.n >= 5
              ? t('results.headBetter', { pct: int(hg.mine.percentile), n: int(hg.n), scope })
              : t('results.headRank', { rank: int(hg.mine.rank), n: hg.n, scope })
            : hg.n
              ? t('results.headUnchecked', { n: hg.n, scope })
              : t('results.head'),
          !!hg.mine,
        );
      if (hg.botPar != null && hg.botPar !== botPar) {
        botPar = hg.botPar;
        renderBadges();
      }
      renderDeltas();
      if (!hg.n) {
        if (parLine) histBox.append(parLine);
        return;
      }
      const maxBin = Math.max(1, ...hg.bins.map((b) => b.count));
      histBox.append(
        h(
          'div',
          { class: 'jd-hist', role: 'img', ariaLabel: t('results.histAria', { n: hg.n }) },
          ...hg.bins.map((b, i) =>
            h(
              'div',
              {
                class: `jd-hist-bin${hg.mine && hg.mine.bin === i ? ' jd-hist-mine' : ''}`,
                tid: `hist-bin-${i}`,
                title: `${money(b.from)}–${money(b.to)}: ${int(b.count)}`,
              },
              h('div', { class: 'jd-hist-count' }, b.count ? int(b.count) : ''),
              h('div', { class: 'jd-hist-bar', style: `height:${Math.max(2, Math.round((100 * b.count) / maxBin))}%` }),
            ),
          ),
        ),
      );
      histBox.append(h('div', { class: 'jd-hist-axis' }, h('span', {}, money(0)), h('span', {}, money(hg.bins[hg.bins.length - 1].to))));
      const pct = hg.mine
        ? hg.n >= 5
          ? t('results.rankLine', { rank: int(hg.mine.rank), n: int(hg.n) })
          : t('results.pctFew', { n: hg.n, rank: int(hg.mine.rank) })
        : t('results.pctNone', { n: hg.n });
      histBox.append(
        h('div', { class: hg.mine ? 'jd-amber' : 'jd-dim', tid: 'percentile', style: 'font-size:0.8125em; margin-top:0.3em; font-weight:700' }, pct),
      );
      if (parLine) histBox.append(parLine);
      if (hg.medals) {
        // a closed daily: the server sent thresholds (PLAN-v3 0.6.4); the medal is named only for this game's checked entry
        const medal = hg.mine ? medalFor(hg.mine.score, hg.medals) : null;
        scene.lastMedal = medal;
        if (medal && hg.mine && !o.replayed) recordMedal(run.seed, medal, hg.mine.score); // 0.9.7: the record page
        renderDeltas();
        histBox.append(
          h(
            'div',
            { class: 'jd-mono jd-amber', tid: 'medals', style: 'font-size:0.75em; margin-top:0.3em' },
            t('results.medals', { line: medalsLine(hg.medals), yours: hg.mine ? t('results.medalsYours', { medal: medal ?? t('results.medalNone') }) : '' }),
          ),
        );
      }
      if (hg.mine && hg.around.length > 1)
        histBox.append(
          h(
            'div',
            { class: 'jd-around', tid: 'around' },
            ...hg.around.map((a) => h('div', { class: a.mine ? 'jd-mine' : '' }, `#${int(a.rank)}  ${money(a.score)}  ${a.mine ? t('common.you') : a.player}`)),
          ),
        );
      if (prior)
        histBox.append(
          h(
            'div',
            { class: 'jd-mono jd-dim', tid: 'prior-best', style: 'font-size:0.7em; margin-top:0.3em' },
            t('results.priorChecked', { score: money(prior.score) }),
          ),
        );
    } catch {
      /* the chart is decoration over the board; the status line already says whether our server is reachable */
    }
  };
  const showOfflineBoard = () => {
    // 0.8.7: offline, the panel shows this device's own history for the yard instead of an empty board
    const runs = loadHistory(run.seed);
    const prior = loadSubmissions()[run.seed];
    boardHead.textContent = t('results.historyHead');
    entriesBox.replaceChildren();
    if (!runs.length)
      entriesBox.append(
        h(
          'div',
          { class: 'jd-mono jd-dim jd-board-note', tid: 'history-empty', style: 'font-size:0.75em' },
          o.replayed ? t('results.historyEmptyReplay') : t('results.historyEmpty'),
        ),
      );
    const latestAt = runs.reduce((m, r) => (r.at > m ? r.at : m), '');
    [...runs]
      .sort((a, b) => b.score - a.score || b.at.localeCompare(a.at))
      .slice(0, 5)
      .forEach((r, i) => {
        const mine = !o.replayed && !fork && r.at === latestAt;
        entriesBox.append(
          h(
            'div',
            { class: `jd-board-note jd-mono${mine ? ' jd-amber' : ' jd-dim'}`, tid: `history-${i}`, style: 'font-size:0.8125em; margin-top:0.2em' },
            t('results.historyRow', { n: i + 1, score: money(r.score), when: mine ? t('results.historyThis') : r.at.slice(0, 10) }),
          ),
        );
      });
    if (prior)
      entriesBox.append(
        h(
          'div',
          { class: 'jd-mono jd-dim jd-board-note', tid: 'history-verified', style: 'font-size:0.7em; margin-top:0.3em' },
          t('results.historyChecked', {
            score: money(prior.score),
            player: prior.player || t('common.anonymous'),
            when: prior.verifiedAt ? t('results.historyWhen', { date: prior.verifiedAt.slice(0, 10) }) : '',
          }),
        ),
      );
    entriesBox.append(
      h(
        'div',
        { class: 'jd-mono jd-dim jd-board-note', tid: 'history-note', style: 'font-size:0.7em; margin-top:0.3em' },
        t('results.historyNote', { n: runs.length }),
      ),
    );
  };
  const loadBoard = async (keepStatus = false) => {
    entriesBox.replaceChildren();
    void loadHistogram();
    try {
      const res = await fetch(`${verifierUrl}/board?seed=${encodeURIComponent(run.seed)}&limit=5${groupParam(verifierUrl)}`, {
        headers: groupHeaders(verifierUrl),
      });
      const body = (await res.json()) as {
        entries: { player: string; score: number; verifiedAt: string; replayHash: string; replayAvailable?: boolean; finalMachines?: number }[];
        tieBreak?: string;
      };
      if (!body.entries.length) entriesBox.append(h('div', { class: 'jd-mono jd-dim jd-board-note', style: 'font-size:0.75em' }, t('results.noScores')));
      const gate = revealGate(run.seed); // PLAN-v3 0.6.6: on an open daily, recordings open up once this device has submitted (loadBoard runs again after a submission)
      body.entries.forEach((e, i) => {
        const entry = h(
          'button',
          {
            class: 'jd-entry',
            tid: `board-entry-${i}`,
            type: 'button',
            disabled: !e.replayAvailable || !!gate,
            title: gate ?? (e.replayAvailable ? t('results.entryWatchTitle') : undefined),
            onClick: () => {
              setStatus(t('results.fetching', { player: e.player }));
              fetchVerifiedReplay(verifierUrl, e.replayHash, run.seed)
                .then((r) => playVerifiedReplay(scene, r))
                .catch((err: Error) => setStatus(err.message, 'jd-red'));
            },
          },
          `${t('results.entry', { n: i + 1, score: money(e.score), player: e.player })}${e.replayAvailable ? t('results.entryWatch') : ''}`,
        );
        const dare = btn(
          t('results.beatThis'),
          `challenge-${i}`,
          () =>
            copyWith(
              dare,
              t('results.beatThis'),
              challengeLink(e.replayHash),
              t('results.beatThisCopy', { seed: run.seed, player: e.player, score: money(e.score) }),
            ),
          { small: true, title: t('results.beatThisTitle', { player: e.player }) },
        );
        dare.style.cssText += 'padding:0 0.4em; font-size:0.65em; line-height:1.3; min-height:0; margin-left:0.4em';
        entriesBox.append(h('div', { class: 'jd-board-note jd-row', style: 'gap:0; flex-wrap:nowrap' }, entry, dare));
      });
      if (body.entries.some((e) => e.replayAvailable))
        entriesBox.append(
          h(
            'div',
            { class: 'jd-mono jd-dim jd-board-note', tid: gate ? 'reveal-note' : undefined, style: 'font-size:0.7em; margin-top:0.3em' },
            gate ? t('results.recordingsGate', { gate }) : t('results.recordingsHint'),
          ),
        );
      entriesBox.append(h('div', { class: 'jd-mono jd-dim jd-board-note', tid: 'tie-rule', style: 'font-size:0.7em; margin-top:0.3em' }, t('results.tieRule')));
      if (!keepStatus) setStatus(t('results.statusOnline'));
    } catch {
      showOfflineBoard();
      if (!o.replayed) setHeadline(t('results.headOffline'), false);
      if (!foremanSettled && !o.replayed) {
        setForeman(foreman, foremanSays('resultsOffline'));
        foremanSettled = true;
      }
      if (!keepStatus) setStatus(t('results.statusOffline'));
    }
  };

  /** The display name for the board: the saved one, or a dialog on the first submission; null when the player cancels. */
  const ensurePlayer = async (): Promise<string | null> => {
    const id = loadIdentity();
    if (id.name && id.tag) return labelFor(id.name, id.tag); // claimed: the server stamps the same label from the key
    let player = loadPlayer();
    if (!player) {
      const typed = await promptText(scene, t('results.nameTitle'), t('results.nameLabel', { max: 32 }), 'player', 32);
      if (typed === null) return null;
      player = typed.trim() ? typed.trim().slice(0, 32) : 'anonymous';
      if (player !== 'anonymous') savePlayer(player);
    }
    // PLAN-v3 0.6.0: the local name migrates into the first claim; offline or refused, the submission still goes out with the plain name
    if (player !== 'anonymous' && bearerAllowed(verifierUrl)) {
      const c = await claimName(verifierUrl, player);
      if (c && 'name' in c) return labelFor(c.name, c.tag);
    }
    return player;
  };
  const rankOf = async (replayHash: string): Promise<Rank> => {
    const res = await fetch(`${verifierUrl}/board?seed=${encodeURIComponent(run.seed)}&limit=100${groupParam(verifierUrl)}`, {
      headers: groupHeaders(verifierUrl),
    });
    const body = (await res.json()) as { entries: { replayHash: string }[] };
    const i = body.entries.findIndex((e) => e.replayHash === replayHash);
    return { n: i >= 0 ? i + 1 : null, of: body.entries.length };
  };
  const submitBtn = btn(
    t('results.submit'),
    'submit',
    async () => {
      submitBtn.disabled = true;
      let verified = false,
        queued = false;
      try {
        const player = await ensurePlayer();
        if (player === null) {
          setStatus(t('results.cancelled'));
          return;
        }
        setStatus(t('results.submitting'));
        let body: {
          ok: boolean;
          score?: number;
          error?: string;
          entry?: { replayHash: string; verifiedAt: string; score?: number };
          recorded?: boolean;
          player?: string;
          late?: boolean;
          closesAt?: string;
        };
        try {
          const res = await fetch(`${verifierUrl}/verify`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...authHeaders(verifierUrl) },
            body: JSON.stringify({ replay: exportReplay(run, import.meta.env.BUILD), player }),
          });
          body = (await res.json()) as typeof body;
          if (res.status === 503 || res.status === 429) {
            telemetry.track('daily_submit_result', { result: 'busy' });
            setStatus(t('results.busy', { error: body.error || res.status }));
            return;
          }
        } catch {
          // 0.8.7: no connection: keep the recording and send it from the next title load (render/pending.ts)
          savePending({
            seed: run.seed,
            rulesVersion: run.rulesVersion,
            replay: exportReplay(run, import.meta.env.BUILD),
            player,
            savedAt: new Date().toISOString(),
          });
          queued = true;
          submitBtn.textContent = t('results.savedButton');
          telemetry.track('daily_submit_result', { result: 'busy' });
          setStatus(t('results.savedOffline'), 'jd-amber');
          return;
        }
        if (body.ok && body.late) {
          // PLAN-v3 0.6.2: the day closed; the game was checked and is real, the final board does not move
          telemetry.track('daily_submit_result', { result: 'late' });
          setStatus(
            t('results.late', { score: money(body.score ?? run.score), closesAt: body.closesAt ? utcDateTime(body.closesAt) : t('results.deadline') }),
            'jd-amber',
          );
          return;
        }
        if (!body.ok || !body.entry) {
          telemetry.track('daily_submit_result', { result: 'rejected' });
          setStatus(t('results.rejected', { error: body.error || t('results.rejectedDefault') }), 'jd-red');
          return;
        }
        verified = true;
        telemetry.track('daily_submit_result', { result: 'verified' });
        if (isMintedDailySeed(run.seed)) {
          const dd = dailyDateOf(run.seed);
          if (dd) recordDailyDate(dd);
        } // PLAN-v3 0.6.3: a checked daily (recorded or keep-best) counts for the streak by the daily's date; late ones returned above
        const label = body.player || player;
        scene.lastPlayer = label;
        if (body.recorded === false) {
          // keep-best (PLAN-v3 0.6.0): checked, but an earlier game of this player on this yard ranks at least as well
          setStatus(
            t('results.keepBest', { score: money(body.score ?? run.score), earlier: body.entry.score != null ? money(body.entry.score) : '?' }),
            'jd-amber',
          );
          try {
            await loadBoard(true);
          } catch {
            /* decoration */
          }
          return;
        }
        recordSubmission(run.seed, { score: body.score ?? run.score, replayHash: body.entry.replayHash, verifiedAt: body.entry.verifiedAt, player: label });
        scene.verifiedHash = body.entry.replayHash; // this game, this recording: exports and standing may now say checked
        challengeBtn.disabled = false; // the checked entry can now be challenged (PLAN-v4 0.7.1)
        try {
          scene.lastRank = await rankOf(body.entry.replayHash);
          const r = scene.lastRank;
          setStatus(
            t('results.checkedRank', {
              score: money(body.score ?? run.score),
              rank: r.n != null ? t('common.rankOf', { n: int(r.n), of: int(r.of) }) : t('common.beyondTop', { of: int(r.of) }),
              label,
            }),
            'jd-green',
          );
        } catch {
          setStatus(t('results.checkedNoRank', { score: money(body.score ?? run.score), label }), 'jd-green');
        }
        try {
          await loadBoard(true);
        } catch {
          /* the board list is decoration; the status line already says what happened */
        }
      } finally {
        if (!verified && !queued) submitBtn.disabled = false;
      } // a cancelled, busy or rejected attempt leaves the control usable (review F04); a saved one stays put
    },
    { disabled: o.replayed, small: true, variant: 'steel', title: t('results.submitTitle') },
  );

  const copyWith = (b: HTMLButtonElement, label: string, text: string, title: string) => {
    const done = () => {
      b.textContent = t('common.copied');
      setTimeout(() => {
        b.textContent = label;
      }, 1500);
    };
    const fallback = () => {
      void showText(scene, title, text);
    };
    if (navigator.clipboard?.writeText) navigator.clipboard.writeText(text).then(done, fallback);
    else fallback();
  };
  // share (PLAN-v1 0.4.3): spoiler-free glyph grid by default, per-round dollars in the detailed variant; the link is on by default
  // (production roadmap 0.9.2, opt-out): the "Beat this" link once this game is checked, the yard's link before that
  const linkToggle = h('input', { type: 'checkbox', tid: 'share-link', ariaLabel: t('results.addLinkAria') });
  linkToggle.checked = true;
  const permalink = () =>
    linkToggle.checked
      ? scene.verifiedHash
        ? challengeLink(scene.verifiedHash)
        : `${location.origin}${location.pathname}?scene=game&seed=${encodeURIComponent(run.seed)}`
      : undefined;
  const buildShare = (variant: 'grid' | 'detailed') =>
    shareText({
      seed: run.seed,
      score: run.score,
      rulesVersion: run.rulesVersion,
      rounds: run.rounds.map((r) => r.earned),
      player: scene.lastPlayer || undefined,
      rank: scene.lastRank,
      percentile: scene.lastPercentile,
      n: scene.lastN,
      daysPlayed: daysPlayed(),
      streak: currentStreak(),
      medal: scene.lastMedal ?? undefined,
      fork: fork ? { player: fork.player, round: fork.round } : undefined,
      challenge: o.challenge && !o.replayed ? { player: o.challenge.player, score: o.challenge.score } : undefined,
      permalink: permalink(),
      variant,
      rerolls: run.rerolls,
      badges: badgesFor(run, botPar).map((b) => b.title),
    });
  scene.cardInput = () => ({
    seed: run.seed,
    score: run.score,
    rounds: run.rounds.map((r) => r.earned),
    rulesVersion: run.rulesVersion,
    player: scene.lastPlayer || undefined,
    verified: !!scene.verifiedHash,
    rank: scene.lastRank,
    percentile: scene.lastPercentile,
    n: scene.lastN,
    medal: scene.lastMedal,
    group: loadGroup(),
    challenge: o.challenge && !o.replayed ? { player: o.challenge.player, score: o.challenge.score } : null,
    fork: fork ? { player: fork.player, round: fork.round } : null,
    permalink: permalink(),
    build: import.meta.env.BUILD,
  }); // PLAN-v4 0.7.4
  const cardBtn = btn(
    t('results.cardBtn'),
    'share-card',
    async () => {
      cardBtn.disabled = true;
      try {
        const c = await scene.exportCard();
        setStatus(t('results.cardSaved', { file: c.savedTo, w: c.width, h: c.height, kb: int(Math.round(c.size / 1024)), footer: c.footer }), 'jd-green');
      } catch (e) {
        setStatus((e as Error).message, 'jd-red');
      } finally {
        cardBtn.disabled = false;
      }
    },
    { small: true, title: t('results.cardTitle') },
  );
  const shareBtn = btn(
    t('results.shareBtn'),
    'share',
    () => {
      const text = buildShare('grid');
      scene.lastShareText = text;
      telemetry.track('share_copied', { variant: 'grid' });
      if (firstTime('share')) {
        const line = foremanSays('firstShare');
        if (line) {
          setForeman(foreman, line);
          foremanSettled = true;
        }
      }
      copyWith(shareBtn, t('results.shareBtn'), text, t('results.shareDialog'));
    },
    { small: true, title: t('results.shareTitle') },
  );
  const detailedBtn = btn(
    t('results.detailedBtn'),
    'share-detailed',
    () => {
      const text = buildShare('detailed');
      scene.lastShareText = text;
      telemetry.track('share_copied', { variant: 'detailed' });
      copyWith(detailedBtn, t('results.detailedBtn'), text, t('results.detailedDialog'));
    },
    { small: true, title: t('results.detailedTitle') },
  );
  const shareLinkLabel = h(
    'label',
    { class: 'jd-dim', style: 'font-size:0.75em; display:inline-flex; align-items:center; gap:0.3em' },
    linkToggle,
    t('results.addLink'),
  );
  const challengeBtn = btn(
    t('results.beatThisLink'),
    'challenge-link',
    () => {
      if (scene.verifiedHash) copyWith(challengeBtn, t('results.beatThisLink'), challengeLink(scene.verifiedHash), t('results.beatThisLinkCopy'));
    },
    { small: true, disabled: !scene.verifiedHash, title: t('results.beatThisLinkTitle') },
  );
  const exportBtn = btn(
    t('results.exportBtn'),
    'export',
    () => copyWith(exportBtn, t('results.exportBtn'), encodeReplay(exportReplay(run, import.meta.env.BUILD)), t('results.exportDialog')),
    { small: true },
  );
  const best = run.rounds.reduce((b, r) => (r.earned > b.earned ? r : b), run.rounds[0]);
  const clipBtn = btn(
    t('results.clipBtn', { n: best?.round ?? 1 }),
    'export-clip',
    async () => {
      clipBtn.disabled = true;
      const label = clipBtn.textContent ?? '';
      setStatus(t('results.clipRecording'));
      try {
        const c = await scene.exportClip(undefined, (f) => {
          clipBtn.textContent = t('results.clipProgress', { pct: int(Math.round(f * 100)) });
        });
        setStatus(t('results.clipSaved', { file: c.savedTo, kb: int(Math.round(c.size / 1024)), s: (c.ms / 1000).toFixed(1) }), 'jd-green');
      } catch (e) {
        setStatus((e as Error).message, 'jd-red');
      } finally {
        clipBtn.textContent = label;
        clipBtn.disabled = false;
      }
    },
    { small: true, title: t('results.clipTitle') },
  );
  const gifBtn = btn(
    t('results.gifBtn'),
    'export-gif',
    async () => {
      gifBtn.disabled = true;
      const label = gifBtn.textContent ?? '';
      setStatus(t('results.gifDrawing'));
      try {
        const g = await scene.exportGif(undefined, (f) => {
          gifBtn.textContent = t('results.gifProgress', { pct: int(Math.round(f * 100)) });
        });
        setStatus(
          t('results.gifSaved', { file: g.savedTo, kb: int(Math.round(g.size / 1024)), frames: int(g.frames), s: (g.ms / 1000).toFixed(1) }),
          'jd-green',
        );
      } catch (e) {
        setStatus((e as Error).message, 'jd-red');
      } finally {
        gifBtn.textContent = label;
        gifBtn.disabled = false;
      }
    },
    { small: true, title: t('results.gifTitle') },
  );
  const downloadBtn = btn(
    t('results.downloadBtn'),
    'download',
    () => {
      const text = encodeReplay(exportReplay(run, import.meta.env.BUILD));
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
      a.download = `junkyard-draft-${run.seed}-${run.score}.replay.json`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    },
    { small: true },
  );

  const group = (label: string, tid: string, ...kids: (HTMLElement | null)[]) =>
    h('div', { class: 'jd-row jd-actions', tid }, h('span', { class: 'jd-actions-label' }, label), ...kids.filter((k): k is HTMLElement => !!k));
  const screen = h(
    'div',
    { class: 'jd-results' },
    header,
    h('div', { class: 'jd-grid2', style: 'margin-top:0.5em' }, rounds, shippedPanel),
    boardPanel,
    o.replayed && run.rounds.length === RULES.rounds
      ? h(
          'div',
          { class: 'jd-row jd-center', tid: 'fork-row', style: 'margin-top:0.25em; gap:0.4em' },
          h('span', { class: 'jd-mono jd-dim', style: 'font-size:0.75em' }, t('results.tryLabel')),
          ...Array.from({ length: RULES.rounds - 1 }, (_, i) =>
            btn(
              String(i + 1),
              `fork-${i + 1}`,
              () => {
                audio.unlock();
                scene.scene.start('Game', {
                  seed: run.seed,
                  fresh: false,
                  fork: {
                    origin: { hash: o.replayHash ?? null, player: o.replayPlayer ?? o.replayLabel?.replace(/^.*? by /, '') ?? t('results.replayPlayback') },
                    actions: run.actions,
                    round: i + 1,
                  },
                });
              },
              { small: true, title: t('results.tryTitle', { n: i + 1 }) },
            ),
          ),
        )
      : null,
    // actions in three labelled rows (production roadmap 0.8.7): Play (the one primary), Share, Watch; the legal links below
    group(
      t('results.rowPlay'),
      'actions-play',
      btn(t('results.retry'), 'retry', () => go(run.seed), { variant: 'primary' }),
      btn(t('results.newYardBtn'), 'newseed', () => go(randomSeed()), { variant: 'steel' }),
      btn(t('title.daily'), 'daily', () => go(todaySeed()), { variant: 'steel' }),
      btn(t('common.titleScreen'), 'title', () => scene.scene.start('Title'), { small: true }),
    ),
    group(t('results.rowShare'), 'actions-share', fork ? null : submitBtn, shareBtn, detailedBtn, shareLinkLabel, cardBtn, fork ? null : challengeBtn),
    group(t('results.rowWatch'), 'actions-watch', clipBtn, gifBtn, fork ? null : exportBtn, fork ? null : downloadBtn),
    h(
      'div',
      { class: 'jd-row jd-center', style: 'gap:0.4em' },
      btn(t('title.policy'), 'policy', () => openPolicy(scene), { small: true, title: t('results.policyTitle') }),
      btn(t('title.privacyLink'), 'privacy', () => openPrivacy(scene, verifierUrl, 'privacy'), { small: true, title: t('results.privacyTitle') }),
    ),
    status,
  );
  ui.mount(scene, screen, (e) => {
    if (e.key === 'Enter' && !(e.target instanceof HTMLButtonElement)) go(run.seed);
  });
  void loadBoard();
}
